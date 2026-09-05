const form = document.getElementById('auth-form');
const msg = document.getElementById('form-msg');
const submitBtn = document.getElementById('submit-btn');
const toggleBtn = document.getElementById('toggle-mode');
const modeTitle = document.getElementById('mode-title');
const modeSub = document.getElementById('mode-sub');
const roleField = document.getElementById('role-field');

let mode = 'signin'; // or 'signup'

function setMode(next) {
  mode = next;
  const isSignup = mode === 'signup';
  modeTitle.textContent = isSignup ? 'Create your account' : 'Sign in to command center';
  modeSub.textContent = isSignup
    ? 'Register for site access. An administrator can upgrade your role later.'
    : 'Enter your credentials to view live telemetry.';
  submitBtn.textContent = isSignup ? 'Create account' : 'Sign in';
  roleField.style.display = isSignup ? 'block' : 'none';
  toggleBtn.textContent = isSignup ? 'Sign in instead' : 'Create an account instead';
  msg.className = 'form-msg';
}

toggleBtn.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

// Redirect immediately if already signed in.
sb.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = 'dashboard.html';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'form-msg';
  submitBtn.disabled = true;

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const role = document.getElementById('role').value;

  try {
    if (mode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;

      if (data.user) {
        // profiles row is also created by a DB trigger (see schema.sql);
        // this upsert just records the chosen role for that trigger-created row.
        await sb.from('profiles').upsert({ id: data.user.id, email, role });
      }

      if (!data.session) {
        msg.textContent = 'Account created. Check your email to confirm, then sign in.';
        msg.className = 'form-msg ok';
        setMode('signin');
        submitBtn.disabled = false;
        return;
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    window.location.href = 'dashboard.html';
  } catch (err) {
    msg.textContent = err.message || 'Something went wrong. Try again.';
    msg.className = 'form-msg error';
    submitBtn.disabled = false;
  }
});
