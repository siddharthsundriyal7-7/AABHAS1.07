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
})();
