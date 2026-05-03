// ClickSafe Auth Modal — drop this script + the modal HTML into any page
// Depends on: auth.js (getStoredAuth, login, register, logout)

(function () {
  'use strict';

  // ── Inject modal HTML into body ──────────────────────────────
  const MODAL_HTML = `
<div id="cs-auth-modal" style="
  display:none;position:fixed;inset:0;z-index:2147483647;
  background:rgba(0,0,0,0.55);
  align-items:flex-start;justify-content:center;
  padding-top:54px;
  font-family:'Satoshi',system-ui,sans-serif;
">
  <div style="
    background:#fff;border-radius:16px;
    width:calc(100% - 32px);max-width:320px;
    box-shadow:0 24px 64px rgba(0,0,0,0.3);
    overflow:hidden;
    animation:csAuthIn .2s cubic-bezier(.34,1.2,.64,1);
  ">
    <style>
      @keyframes csAuthIn{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
      #cs-auth-modal *{box-sizing:border-box;font-family:'Satoshi',system-ui,sans-serif}
      #cs-auth-modal input{display:block;width:100%;padding:9px 12px;border-radius:8px;border:1.5px solid rgba(0,0,0,0.13);background:#f8f8f8;font-size:13px;color:#111;outline:none;transition:border-color .15s,background .15s;margin-top:4px}
      #cs-auth-modal input:focus{border-color:#C1121F;background:#fff}
      #cs-auth-modal input::placeholder{color:#aaa}
      #cs-auth-modal label{font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.7px}
      .cs-btn-primary{display:block;width:100%;padding:10px;border-radius:8px;background:#C1121F;border:none;color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin-top:14px;transition:background .15s}
      .cs-btn-primary:hover{background:#a50f1a}
      .cs-btn-primary:disabled{background:#ccc;cursor:not-allowed}
      .cs-tab{flex:1;padding:11px 0;text-align:center;font-size:13px;font-weight:600;color:#6B7280;cursor:pointer;border:none;background:transparent;border-bottom:2px solid transparent;transition:all .15s}
      .cs-tab.active{color:#C1121F;border-bottom-color:#C1121F}
      .cs-msg{display:none;font-size:12px;text-align:center;padding:8px 10px;border-radius:7px;margin-bottom:10px}
      .cs-msg.err{display:block;background:#FEE8EA;color:#C1121F;border:1px solid rgba(193,18,31,.2)}
      .cs-msg.ok{display:block;background:rgba(22,163,74,.08);color:#15803d;border:1px solid rgba(22,163,74,.2)}
      .cs-field{margin-bottom:10px}
      .cs-logout{display:block;width:100%;padding:9px;border-radius:8px;background:#f5f5f5;border:1.5px solid rgba(0,0,0,.1);font-size:13px;font-weight:600;color:#6B7280;cursor:pointer;margin-top:10px;transition:all .15s}
      .cs-logout:hover{background:#FEE8EA;color:#C1121F;border-color:rgba(193,18,31,.25)}
    </style>

    <!-- Red header -->
    <div style="background:#C1121F;padding:18px 18px 16px;display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:30px;height:30px;background:rgba(255,255,255,.18);border-radius:8px;display:flex;align-items:center;justify-content:center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5L12 1zm-1 14l-3-3 1.41-1.41L11 12.17l4.59-4.58L17 9l-6 6z"/></svg>
        </div>
        <div>
          <div style="font-size:14px;font-weight:700;color:#fff">ClickSafe Account</div>
          <div id="cs-header-sub" style="font-size:11px;color:rgba(255,255,255,.75);margin-top:1px">Sync your data across devices</div>
        </div>
      </div>
      <button id="cs-modal-close" style="width:26px;height:26px;border-radius:6px;background:rgba(255,255,255,.18);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <!-- LOGGED-OUT VIEW -->
    <div id="cs-loggedout">
      <div style="display:flex;border-bottom:1px solid rgba(0,0,0,.08)">
        <button class="cs-tab active" id="cs-tab-login">Sign In</button>
        <button class="cs-tab" id="cs-tab-signup">Create Account</button>
      </div>
      <div style="padding:18px">
        <div id="cs-msg" class="cs-msg"></div>

        <!-- Login -->
        <div id="cs-login-form">
          <div class="cs-field"><label>Email</label><input type="email" id="cs-login-email" placeholder="you@example.com" autocomplete="email"/></div>
          <div class="cs-field"><label>Password</label><input type="password" id="cs-login-pw" placeholder="Your password" autocomplete="current-password"/></div>
          <button class="cs-btn-primary" id="cs-login-btn">Sign In</button>
        </div>

        <!-- Signup -->
        <div id="cs-signup-form" style="display:none">
          <div class="cs-field"><label>Email</label><input type="email" id="cs-signup-email" placeholder="you@example.com" autocomplete="email"/></div>
          <div class="cs-field"><label>Password</label><input type="password" id="cs-signup-pw" placeholder="Min. 8 characters" autocomplete="new-password"/></div>
          <div class="cs-field"><label>Confirm Password</label><input type="password" id="cs-signup-confirm" placeholder="Repeat password" autocomplete="new-password"/></div>
          <button class="cs-btn-primary" id="cs-signup-btn">Create Account</button>
        </div>
      </div>
    </div>

    <!-- LOGGED-IN VIEW -->
    <div id="cs-loggedin" style="display:none;padding:20px">
      <div style="text-align:center">
        <div id="cs-avatar" style="width:52px;height:52px;border-radius:50%;background:#FEE8EA;border:2px solid rgba(193,18,31,.2);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#C1121F;font-family:'Space Mono',monospace;margin:0 auto 10px">?</div>
        <div id="cs-user-email" style="font-size:14px;font-weight:700;color:#111;margin-bottom:4px">—</div>
        <div style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;background:rgba(22,163,74,.08);border:1px solid rgba(22,163,74,.2);font-size:11px;font-weight:700;color:#15803d">
          <div style="width:6px;height:6px;border-radius:50%;background:#16a34a"></div>
          Data syncing to cloud
        </div>
        <button class="cs-logout" id="cs-logout-btn">Sign Out</button>
      </div>
    </div>

  </div>
</div>`;

  // Inject modal into document
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);

  // ── References ───────────────────────────────────────────────
  const modal      = document.getElementById('cs-auth-modal');
  const closeBtn   = document.getElementById('cs-modal-close');
  const tabLogin   = document.getElementById('cs-tab-login');
  const tabSignup  = document.getElementById('cs-tab-signup');
  const loginForm  = document.getElementById('cs-login-form');
  const signupForm = document.getElementById('cs-signup-form');
  const msgEl      = document.getElementById('cs-msg');
  const loggedout  = document.getElementById('cs-loggedout');
  const loggedin   = document.getElementById('cs-loggedin');
  const headerSub  = document.getElementById('cs-header-sub');

  // ── Helpers ──────────────────────────────────────────────────
  function showMsg(text, type) { msgEl.textContent = text; msgEl.className = 'cs-msg ' + (type === 'error' ? 'err' : 'ok'); }
  function clearMsg() { msgEl.className = 'cs-msg'; msgEl.textContent = ''; }

  function setBusy(btn, busy, defaultLabel) {
    btn.disabled = busy;
    btn.textContent = busy ? '…' : defaultLabel;
  }

  async function refreshState() {
    const { user } = await getStoredAuth();
    if (user) {
      loggedout.style.display = 'none';
      loggedin.style.display  = 'block';
      headerSub.textContent   = 'Signed in & syncing';
      document.getElementById('cs-avatar').textContent    = user.email[0].toUpperCase();
      document.getElementById('cs-user-email').textContent = user.email;
    } else {
      loggedout.style.display = 'block';
      loggedin.style.display  = 'none';
      headerSub.textContent   = 'Sync your data across devices';
    }
  }

  function updateProfileDot(loggedIn, email) {
    const wrap = document.getElementById('profile-btn-wrap');
    const btn  = document.getElementById('profile-btn');
    if (!wrap || !btn) return;
    if (loggedIn) { wrap.classList.add('logged-in'); btn.title = email || 'Account'; }
    else          { wrap.classList.remove('logged-in'); btn.title = 'Account'; }
  }

  // ── Open / close ─────────────────────────────────────────────
  function openModal() {
    clearMsg();
    modal.style.display = 'flex';
    refreshState();
  }

  function closeModal() {
    modal.style.display = 'none';
  }

  // Wire the profile button — wait for it to exist
  function wireProfileBtn() {
    const btn = document.getElementById('profile-btn');
    if (!btn) { setTimeout(wireProfileBtn, 100); return; }
    // Remove any old listeners by cloning
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', openModal);
  }
  wireProfileBtn();

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  // ── Tabs ─────────────────────────────────────────────────────
  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active'); tabSignup.classList.remove('active');
    loginForm.style.display = 'block'; signupForm.style.display = 'none';
    clearMsg();
  });
  tabSignup.addEventListener('click', () => {
    tabSignup.classList.add('active'); tabLogin.classList.remove('active');
    signupForm.style.display = 'block'; loginForm.style.display = 'none';
    clearMsg();
  });

  // ── Login ────────────────────────────────────────────────────
  document.getElementById('cs-login-btn').addEventListener('click', async () => {
    const btn      = document.getElementById('cs-login-btn');
    const email    = document.getElementById('cs-login-email').value.trim();
    const password = document.getElementById('cs-login-pw').value;
    if (!email || !password) return showMsg('Please fill in all fields.', 'error');
    clearMsg(); setBusy(btn, true, 'Sign In');
    try {
      await login(email, password);
      showMsg('Signed in! Your data is now syncing.', 'ok');
      updateProfileDot(true, email);
      setTimeout(closeModal, 1200);
    } catch (err) {
      showMsg(err.message || 'Sign in failed. Check your credentials.', 'error');
    } finally { setBusy(btn, false, 'Sign In'); }
  });

  // ── Signup ───────────────────────────────────────────────────
  document.getElementById('cs-signup-btn').addEventListener('click', async () => {
    const btn      = document.getElementById('cs-signup-btn');
    const email    = document.getElementById('cs-signup-email').value.trim();
    const password = document.getElementById('cs-signup-pw').value;
    const confirm  = document.getElementById('cs-signup-confirm').value;
    if (!email || !password) return showMsg('Please fill in all fields.', 'error');
    if (password.length < 8)  return showMsg('Password must be at least 8 characters.', 'error');
    if (password !== confirm)  return showMsg('Passwords do not match.', 'error');
    clearMsg(); setBusy(btn, true, 'Create Account');
    try {
      await register(email, password);
      showMsg('Account created! Welcome to ClickSafe.', 'ok');
      updateProfileDot(true, email);
      setTimeout(closeModal, 1200);
    } catch (err) {
      showMsg(err.message || 'Registration failed. Try a different email.', 'error');
    } finally { setBusy(btn, false, 'Create Account'); }
  });

  // ── Logout ───────────────────────────────────────────────────
  document.getElementById('cs-logout-btn').addEventListener('click', async () => {
    await logout();
    updateProfileDot(false);
    refreshState();
  });

})();