// ============================================================
//  ClickSafe — pages/onboarding/onboarding.js
//  Controls slide navigation, progress dots, and the
//  integrated account creation / login on the final card.
// ============================================================

const TOTAL_SLIDES = 5;
let current = 0;

// ── Slide navigation ──────────────────────────────────────────────────────────

function goTo(index) {
  if (index < 0 || index >= TOTAL_SLIDES) return;
  current = index;

  // Shift the slides strip
  document.getElementById('slides').style.transform = `translateX(-${current * 20}%)`;

  // Update progress dots
  const dots = document.querySelectorAll('.dot');
  dots.forEach((dot, i) => {
    dot.className = 'dot';
    if (i < current) dot.classList.add('done');
    else if (i === current) dot.classList.add('active');
  });

  // Hide skip button on last slide
  document.getElementById('skip-btn').style.display = current === TOTAL_SLIDES - 1 ? 'none' : '';
}

// ── Skip: mark onboarding done and close ─────────────────────────────────────

function finishOnboarding() {
  chrome.storage.local.set({ onboardingComplete: true }, () => {
    window.close();
  });
}

document.getElementById('skip-btn').addEventListener('click', finishOnboarding);

// ── Nav button wiring (inline onclick is blocked by MV3 CSP) ─────────────────
document.getElementById('btn-slide1-next').addEventListener('click', () => goTo(1));
document.getElementById('btn-slide2-back').addEventListener('click', () => goTo(0));
document.getElementById('btn-slide2-next').addEventListener('click', () => goTo(2));
document.getElementById('btn-slide3-back').addEventListener('click', () => goTo(1));
document.getElementById('btn-slide3-next').addEventListener('click', () => goTo(3));
document.getElementById('btn-slide4-back').addEventListener('click', () => goTo(2));
document.getElementById('btn-slide4-next').addEventListener('click', () => goTo(4));

// ── Keyboard navigation ───────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' && current < TOTAL_SLIDES - 1) goTo(current + 1);
  if (e.key === 'ArrowLeft'  && current > 0)                goTo(current - 1);
  if (e.key === 'Escape')                                    finishOnboarding();
});

// ── Auth UI (slide 5) ─────────────────────────────────────────────────────────

function setError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('show', Boolean(msg));
}

function showSuccess(email, isNew) {
  document.getElementById('auth-forms').style.display = 'none';
  document.getElementById('skip-account-btn').style.display = 'none';

  const s = document.getElementById('auth-success');
  s.classList.remove('hidden');

  document.getElementById('success-label').textContent  = isNew ? `Welcome, ${email}!` : `Welcome back!`;
  document.getElementById('success-sub').textContent    = isNew
    ? 'Your account is active. Settings will sync across devices.'
    : 'Logged in successfully. Your data is synced.';

  // Update slide copy
  document.getElementById('slide5-title').textContent = 'You\'re all set.';
  document.getElementById('slide5-sub').textContent   = 'ClickSafe is active. Close this tab to start browsing safely.';

  // Replace icon with a green check
  document.getElementById('slide5-icon').innerHTML = `
    <svg viewBox="0 0 24 24" fill="#4ade80"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`;

  // Show a "Done" button
  const wrap = document.getElementById('auth-wrap');
  const done = document.createElement('button');
  done.className   = 'nav-btn';
  done.textContent = 'Start browsing safely →';
  done.style.marginTop = '16px';
  done.addEventListener('click', finishOnboarding);
  wrap.parentNode.insertBefore(done, wrap.nextSibling);

  // Mark onboarding complete in storage (but keep the tab open for the Done button)
  chrome.storage.local.set({ onboardingComplete: true });
}

// Tab switching
document.getElementById('ob-tab-reg').addEventListener('click', () => {
  document.getElementById('ob-tab-reg').classList.add('active');
  document.getElementById('ob-tab-login').classList.remove('active');
  document.getElementById('ob-form-reg').classList.remove('hidden');
  document.getElementById('ob-form-login').classList.add('hidden');
  setError('ob-reg-error', '');
});

document.getElementById('ob-tab-login').addEventListener('click', () => {
  document.getElementById('ob-tab-login').classList.add('active');
  document.getElementById('ob-tab-reg').classList.remove('active');
  document.getElementById('ob-form-login').classList.remove('hidden');
  document.getElementById('ob-form-reg').classList.add('hidden');
  setError('ob-login-error', '');
});

// Register
document.getElementById('ob-reg-submit').addEventListener('click', async () => {
  const email     = document.getElementById('ob-reg-email').value.trim();
  const password  = document.getElementById('ob-reg-password').value;
  const password2 = document.getElementById('ob-reg-password2').value;
  setError('ob-reg-error', '');

  if (!email || !password || !password2) return setError('ob-reg-error', 'Please fill in all fields.');
  if (password !== password2)            return setError('ob-reg-error', 'Passwords do not match.');
  if (password.length < 8)              return setError('ob-reg-error', 'Password must be at least 8 characters.');

  const btn = document.getElementById('ob-reg-submit');
  btn.disabled = true; btn.textContent = 'Creating account…';

  try {
    const { user } = await register(email, password);
    showSuccess(user.email, true);
  } catch (err) {
    setError('ob-reg-error', err.message || 'Registration failed. Is the backend online?');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account';
  }
});

// Login
document.getElementById('ob-login-submit').addEventListener('click', async () => {
  const email    = document.getElementById('ob-login-email').value.trim();
  const password = document.getElementById('ob-login-password').value;
  setError('ob-login-error', '');

  if (!email || !password) return setError('ob-login-error', 'Please fill in all fields.');

  const btn = document.getElementById('ob-login-submit');
  btn.disabled = true; btn.textContent = 'Logging in…';

  try {
    const { user } = await login(email, password);
    showSuccess(user.email, false);
  } catch (err) {
    setError('ob-login-error', err.message || 'Login failed. Check your credentials.');
  } finally {
    btn.disabled = false; btn.textContent = 'Log In';
  }
});

// Skip account
document.getElementById('skip-account-btn').addEventListener('click', finishOnboarding);

// ── Check if user already has an account ─────────────────────────────────────
(async function checkExistingAuth() {
  const { user } = await getStoredAuth();
  if (user?.email) {
    // Already logged in — show success state immediately on slide 5
    showSuccess(user.email, false);
  }
})();
