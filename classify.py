"""
POST an image here (raw JPEG bytes) and get back a risk classification.
Runs the exported EfficientNet-B0 ONNX model via ONNX Runtime — no PyTorch
needed at inference time, which is what keeps this small enough for Vercel.
"""
from http.server import BaseHTTPRequestHandler
import json
import io
import os

import numpy as np
from PIL import Image
import onnxruntime as ort

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "model", "efficientnet_b0_final_v3.onnx")

IMG_SIZE = 224
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# Set this from the "Best threshold from validation data" line the v3
# notebook prints in Section 6 — don't leave it at 0.5.
THRESHOLD = float(os.environ.get("RISK_THRESHOLD", "0.5"))

_session = None


def get_session():
    global _session
    if _session is None:
        _session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
    return _session


def preprocess(image_bytes: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((IMG_SIZE, IMG_SIZE))
    arr = np.asarray(img).astype(np.float32) / 255.0
    arr = (arr - MEAN) / STD
    arr = arr.transpose(2, 0, 1)[None, ...].astype(np.float32)  # NCHW
    return arr


def softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x))
    return e / e.sum()


class handler(BaseHTTPRequestHandler):
    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            session = get_session()
            input_tensor = preprocess(body)
            input_name = session.get_inputs()[0].name
            logits = session.run(None, {input_name: input_tensor})[0][0]
            probs = softmax(logits)
            high_risk_prob = float(probs[1])  # class1 == High Risk in the training notebook
            risk = "high" if high_risk_prob >= THRESHOLD else "low"

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                "risk": risk,
                "confidence": round(high_risk_prob, 4),
                "threshold": THRESHOLD,
            }).encode())
        except Exception as err:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(err)}).encode())
