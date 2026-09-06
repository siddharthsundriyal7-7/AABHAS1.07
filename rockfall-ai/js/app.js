const roleTagEl = document.getElementById('role-tag');
const userEmailEl = document.getElementById('user-email');
const signoutBtn = document.getElementById('signout-btn');
const detectListEl = document.getElementById('detect-list');
const stampEl = document.getElementById('stamp');

async function guardSession() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = 'index.html';
    return null;
  }
  return data.session.user;
}

async function loadProfile(user) {
  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = profile?.role || 'worker';
  roleTagEl.textContent = role === 'admin' ? 'Administrator · UAV Ops' : 'Mine Worker · Fixed Camera';
  userEmailEl.textContent = user.email;
  return role;
}

async function refreshDetections() {
  const { data, error } = await sb
    .from('detections')
    .select('id, image_path, risk_level, source, device, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data || data.length === 0) {
    detectListEl.innerHTML = '<li class="empty-state">No detections logged yet. Capture a frame to start the record.</li>';
    return;
  }

  const rows = await Promise.all(
    data.map(async (d) => {
      const { data: signed } = await sb.storage.from('captures').createSignedUrl(d.image_path, 3600);
      return { ...d, url: signed?.signedUrl };
    })
  );

  detectListEl.innerHTML = rows
    .map(
      (d) => `
      <li class="detect-item">
        <img class="detect-thumb" src="${d.url || ''}" alt="" />
        <div class="detect-meta">
          <div class="loc">${escapeHtml(d.device)} · ${escapeHtml(d.source)}</div>
          <div class="ts">${new Date(d.created_at).toLocaleString()}</div>
        </div>
        <span class="risk-chip ${d.risk_level === 'high' ? 'high' : 'low'}">${d.risk_level} risk</span>
      </li>`
    )
    .join('');
}
window.refreshDetections = refreshDetections;

// ---- Risk trend + escalation detection per device ----
const trendDeviceSelect = document.getElementById('trend-device');
const trendCanvas = document.getElementById('trend-chart');
const trendEmptyEl = document.getElementById('trend-empty');
const escalationBannerEl = document.getElementById('escalation-banner');
let trendChart = null;

async function loadTrend() {
  const device = trendDeviceSelect.value;
  const { data, error } = await sb
    .from('detections')
    .select('risk_level, confidence, created_at')
    .eq('device', device)
    .order('created_at', { ascending: true })
    .limit(30);

  if (error || !data || data.length === 0) {
    trendCanvas.style.display = 'none';
    trendEmptyEl.style.display = 'block';
    escalationBannerEl.style.display = 'none';
    return;
  }
  trendCanvas.style.display = 'block';
  trendEmptyEl.style.display = 'none';

  // Escalation check: last 3 readings for this device all high risk
  const lastThree = data.slice(-3);
  const escalating = lastThree.length === 3 && lastThree.every((d) => d.risk_level === 'high');
  if (escalating) {
    escalationBannerEl.textContent =
      `⚠ Escalation pattern detected on ${device}: the last 3 readings were all HIGH risk. Consider a field inspection.`;
    escalationBannerEl.style.display = 'block';
  } else {
    escalationBannerEl.style.display = 'none';
  }

  const labels = data.map((d) => new Date(d.created_at).toLocaleTimeString());
  const confidences = data.map((d) => (d.confidence != null ? d.confidence * 100 : null));
  const pointColors = data.map((d) => (d.risk_level === 'high' ? '#c4432b' : '#4a9b6e'));

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(trendCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'High-risk confidence (%)',
        data: confidences,
        borderColor: '#e8a33d',
        backgroundColor: 'rgba(232,163,61,0.1)',
        pointBackgroundColor: pointColors,
        pointRadius: 5,
        tension: 0.25,
        spanGaps: true,
      }],
    },
    options: {
      scales: {
        y: { min: 0, max: 100, ticks: { color: '#8b93a1' }, grid: { color: '#2b303a' } },
        x: { ticks: { color: '#8b93a1' }, grid: { color: '#2b303a' } },
      },
      plugins: { legend: { labels: { color: '#c3c8d1' } } },
    },
  });
}
trendDeviceSelect.addEventListener('change', loadTrend);
window.loadTrend = loadTrend;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

signoutBtn.addEventListener('click', async () => {
  await sb.auth.signOut();
  window.location.href = 'index.html';
});

(async function init() {
  const user = await guardSession();
  if (!user) return;
  await loadProfile(user);
  stampEl.textContent = new Date().toLocaleString();
  refreshDetections();
  loadTrend();
})();
