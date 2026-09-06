"""
POST an image here (raw JPEG bytes) and get back a risk classification.
Loads the trained EfficientNet-B0 checkpoint (.pth) directly with PyTorch —
no ONNX conversion or ONNX Runtime involved anywhere in this path.

NOTE ON HOSTING: full PyTorch + torchvision is heavy. Vercel serverless
functions have a 250MB unzipped size limit. If deployment fails with a
size error, that's this constraint — not a bug in this file. Options at
that point: trim dependencies further, or move this endpoint to a host
without that limit (Render, Railway, a small VM, etc).
"""
from http.server import BaseHTTPRequestHandler
import json
import io
import os

import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "model", "efficientnet_b0_final_v3.pth")

IMG_SIZE = 224
DEVICE = torch.device("cpu")  # Vercel functions have no GPU

# Set this from the "Best threshold from validation data" line the v3
# training script prints — don't leave it at 0.5 unless that's genuinely best.
THRESHOLD = float(os.environ.get("RISK_THRESHOLD", "0.5"))

preprocess_transform = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                          std=[0.229, 0.224, 0.225]),
])

_model = None
_idx_to_class = None


def get_model():
    """Load the checkpoint once per warm function instance."""
    global _model, _idx_to_class
    if _model is None:
        checkpoint = torch.load(MODEL_PATH, map_location=DEVICE)

        model = models.efficientnet_b0(weights=None)
        num_features = model.classifier[1].in_features
        model.classifier[1] = nn.Linear(num_features, checkpoint.get("num_classes", 2))
        model.load_state_dict(checkpoint["model_state_dict"])
        model.eval()
        model.to(DEVICE)

        class_to_idx = checkpoint["class_to_idx"]  # e.g. {'high_risk': 0, 'low_risk': 1}
        _idx_to_class = {v: k for k, v in class_to_idx.items()}
        _model = model
    return _model, _idx_to_class


def preprocess(image_bytes: bytes) -> torch.Tensor:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    tensor = preprocess_transform(img)
    return tensor.unsqueeze(0)  # add batch dimension


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
            model, idx_to_class = get_model()
            input_tensor = preprocess(body).to(DEVICE)

            with torch.no_grad():
                logits = model(input_tensor)[0]
                probs = torch.softmax(logits, dim=0)

            # Find whichever index maps to "high_risk" in the checkpoint's
            # own class mapping, rather than assuming index 1.
            high_risk_idx = next(
                idx for idx, name in idx_to_class.items() if "high" in name.lower()
            )
            high_risk_prob = float(probs[high_risk_idx])
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
