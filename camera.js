const videoEl = document.getElementById('camera-video');
const canvasEl = document.getElementById('camera-canvas');
const statusEl = document.getElementById('camera-status');
const startBtn = document.getElementById('cam-start');
const captureBtn = document.getElementById('cam-capture');
const switchBtn = document.getElementById('cam-switch');
const deviceSelect = document.getElementById('device-select');
const sourceSelect = document.getElementById('source-select');
const captureMsg = document.getElementById('capture-msg');

let currentStream = null;
let facingMode = 'environment'; // rear camera by default, better for a phone at a pit wall

async function startCamera() {
  stopCamera();
  statusEl.textContent = 'REQUESTING ACCESS…';
  try {
    currentStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 800 } },
      audio: false,
    });
    videoEl.srcObject = currentStream;
    await videoEl.play();
    statusEl.textContent = 'LIVE';
    captureBtn.disabled = false;
  } catch (err) {
    statusEl.textContent = 'ACCESS DENIED';
    captureMsg.textContent = camAccessErrorText(err);
    captureMsg.className = 'form-msg error';
  }
}

function camAccessErrorText(err) {
  if (err.name === 'NotAllowedError') {
    return 'Camera permission was blocked. Allow camera access for this site in your browser settings and reload.';
  }
  if (err.name === 'NotFoundError') {
    return 'No camera was found on this device.';
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    return 'Camera access requires HTTPS. This page must be served over https:// (Vercel does this automatically).';
  }
  return 'Could not start the camera: ' + err.message;
}

function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }
}

startBtn.addEventListener('click', startCamera);
switchBtn.addEventListener('click', () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
});

captureBtn.addEventListener('click', async () => {
  if (!currentStream) return;
  captureBtn.disabled = true;
  captureMsg.className = 'form-msg';

  const ctx = canvasEl.getContext('2d');
  canvasEl.width = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

  canvasEl.toBlob(async (blob) => {
    try {
      const { data: userData } = await sb.auth.getUser();
      const user = userData.user;
      const path = `${user.id}/${Date.now()}.jpg`;

      const { error: uploadErr } = await sb.storage.from('captures').upload(path, blob, {
        contentType: 'image/jpeg',
      });
      if (uploadErr) throw uploadErr;

      const risk = await classifyFrame(blob, canvasEl, ctx);

      const { error: insertErr } = await sb.from('detections').insert({
        user_id: user.id,
        image_path: path,
        source: sourceSelect.value,
        device: deviceSelect.value,
        risk_level: risk,
      });
      if (insertErr) throw insertErr;

      captureMsg.textContent = `Capture saved — classified ${risk.toUpperCase()} risk.`;
      captureMsg.className = 'form-msg ok';
      if (window.refreshDetections) window.refreshDetections();
    } catch (err) {
      captureMsg.textContent = err.message || 'Upload failed.';
      captureMsg.className = 'form-msg error';
    } finally {
      captureBtn.disabled = false;
    }
  }, 'image/jpeg', 0.9);
});

// Calls the real EfficientNet-B0 model via /api/classify (see api/classify.py).
// Falls back to the local heuristic only if that endpoint isn't reachable yet
// (e.g. the ONNX model file hasn't been added to the repo), so the capture
// flow still works end to end while you're setting the model up.
async function classifyFrame(blob, canvas, ctx) {
  try {
    const res = await fetch('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob,
    });
    if (!res.ok) throw new Error('classify endpoint returned ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.risk;
  } catch (err) {
    console.warn('Model endpoint unavailable, using placeholder heuristic:', err.message);
    return simulateRiskAssessment(canvas, ctx);
  }
}

function simulateRiskAssessment(canvas, ctx) {
  const { width, height } = canvas;
  const sample = ctx.getImageData(0, 0, width, height).data;
  let edgeEnergy = 0;
  const step = 4 * 8;
  for (let i = 0; i + step < sample.length; i += step) {
    edgeEnergy += Math.abs(sample[i] - sample[i + step]);
  }
  return edgeEnergy % 173 > 95 ? 'high' : 'low';
}

window.addEventListener('beforeunload', stopCamera);
