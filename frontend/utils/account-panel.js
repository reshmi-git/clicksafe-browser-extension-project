// ClickSafe Account Panel — utils/account-panel.js
// A positioned dropdown anchored to #profile-btn.
// Works in both the side panel (body overflow:hidden) and full dashboard pages.
// Depends on: auth.js (getStoredAuth, login, register, logout)

(function () {
  'use strict';

  // ── Inject panel HTML ────────────────────────────────────────
  const PANEL_HTML = `
<div id="cs-account-panel" style="
  display:none;
  position:fixed;
  z-index:2147483647;
  top:0;left:0;
  width:100%;height:100%;
  pointer-events:none;
">
  <!-- Click-outside backdrop (invisible, pointer-events enabled) -->
  <div id="cs-panel-backdrop" style="
    position:absolute;inset:0;
    pointer-events:auto;
  "></div>

  <!-- The actual panel card -->
  <div id="cs-panel-card" style="
    position:absolute;
    width:280px;
    background:#fff;
    border-radius:14px;
    box-shadow:0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10);
    border:1px solid rgba(0,0,0,0.07);
    overflow:hidden;
    pointer-events:auto;
    animation:csPanelIn .18s cubic-bezier(.34,1.2,.64,1);
    transform-origin: top right;
  ">
    <style>
      @keyframes csPanelIn {
        from { opacity:0; transform:scale(.93) translateY(-6px); }
        to   { opacity:1; transform:scale(1)  translateY(0); }
      }
      #cs-account-panel * { box-sizing:border-box; font-family:'Satoshi',system-ui,sans-serif; }
      #cs-account-panel input {
        display:block; width:100%; padding:9px 12px;
        border-radius:8px; border:1.5px solid rgba(0,0,0,0.13);
        background:#f8f8f8; font-size:12px; color:#111;
        outline:none; transition:border-color .15s,background .15s;
        margin-top:4px;
      }
      #cs-account-panel input:focus { border-color:#C1121F; background:#fff; }
      #cs-account-panel input::placeholder { color:#aaa; }
      #cs-account-panel label {
        font-size:10px; font-weight:700; color:#374151;
        text-transform:uppercase; letter-spacing:.7px;
      }
      .cs-p-btn {
        display:block; width:100%; padding:9px 14px;
        border-radius:8px; background:#C1121F; border:none;
        color:#fff; font-size:12px; font-weight:700;
        cursor:pointer; margin-top:12px;
        transition:background .15s, transform .1s;
        font-family:'Satoshi',system-ui,sans-serif;
      }
      .cs-p-btn:hover  { background:#a50f1a; }
      .cs-p-btn:active { transform:scale(.98); }
      .cs-p-btn:disabled { background:#ccc; cursor:not-allowed; }
      .cs-p-tab {
        flex:1; padding:10px 0; text-align:center;
        font-size:12px; font-weight:600; color:#6B7280;
        cursor:pointer; border:none; background:transparent;
        border-bottom:2px solid transparent; transition:all .15s;
        font-family:'Satoshi',system-ui,sans-serif;
      }
      .cs-p-tab.active { color:#C1121F; border-bottom-color:#C1121F; }
      .cs-p-msg {
        display:none; font-size:11px; text-align:center;
        padding:7px 10px; border-radius:7px; margin-bottom:8px;
      }
      .cs-p-msg.err { display:block; background:#FEE8EA; color:#C1121F; border:1px solid rgba(193,18,31,.2); }
      .cs-p-msg.ok  { display:block; background:rgba(22,163,74,.08); color:#15803d; border:1px solid rgba(22,163,74,.2); }
      .cs-p-field { margin-bottom:8px; }
      .cs-p-signout {
        display:block; width:100%; padding:9px 14px;
        border-radius:8px; background:#f5f5f5;
        border:1.5px solid rgba(0,0,0,.1);
        font-size:12px; font-weight:600; color:#6B7280;
        cursor:pointer; margin-top:10px;
        transition:all .15s;
        font-family:'Satoshi',system-ui,sans-serif;
      }
      .cs-p-signout:hover { background:#FEE8EA; color:#C1121F; border-color:rgba(193,18,31,.25); }
    </style>

    <!-- Header -->
    <div style="background:#C1121F;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:9px;">
        <div style="width:26px;height:26px;background:rgba(255,255,255,.18);border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5L12 1zm-1 14l-3-3 1.41-1.41L11 12.17l4.59-4.58L17 9l-6 6z"/></svg>
        </div>
        <div>
          <div style="font-size:13px;font-weight:700;color:#fff;line-height:1.2;">ClickSafe Account</div>
          <div id="cs-panel-header-sub" style="font-size:10px;color:rgba(255,255,255,.75);margin-top:1px;">Sync your data across devices</div>
        </div>
      </div>
      <button id="cs-panel-close" style="
        width:24px;height:24px;border-radius:6px;
        background:rgba(255,255,255,.18);border:none;
        cursor:pointer;display:flex;align-items:center;justify-content:center;
        flex-shrink:0;
      ">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <!-- LOGGED-OUT VIEW -->
    <div id="cs-panel-loggedout">
      <div style="display:flex;border-bottom:1px solid rgba(0,0,0,.08);">
        <button class="cs-p-tab active" id="cs-ptab-login">Sign In</button>
        <button class="cs-p-tab"        id="cs-ptab-signup">Create Account</button>
      </div>
      <div style="padding:16px;">
        <div id="cs-panel-msg" class="cs-p-msg"></div>

        <!-- Login form -->
        <div id="cs-panel-login-form">
          <div class="cs-p-field">
            <label>Email</label>
            <input type="email" id="cs-panel-login-email" placeholder="you@example.com" autocomplete="email"/>
          </div>
          <div class="cs-p-field">
            <label>Password</label>
            <input type="password" id="cs-panel-login-pw" placeholder="Your password" autocomplete="current-password"/>
          </div>
          <button class="cs-p-btn" id="cs-panel-login-btn">Sign In</button>
        </div>

        <!-- Signup form -->
        <div id="cs-panel-signup-form" style="display:none;">
          <div class="cs-p-field">
            <label>Email</label>
            <input type="email" id="cs-panel-signup-email" placeholder="you@example.com" autocomplete="email"/>
          </div>
          <div class="cs-p-field">
            <label>Password</label>
            <input type="password" id="cs-panel-signup-pw" placeholder="Min. 8 characters" autocomplete="new-password"/>
          </div>
          <div class="cs-p-field">
            <label>Confirm Password</label>
            <input type="password" id="cs-panel-signup-confirm" placeholder="Repeat password" autocomplete="new-password"/>
          </div>
          <button class="cs-p-btn" id="cs-panel-signup-btn">Create Account</button>
        </div>
      </div>
    </div>

    <!-- LOGGED-IN VIEW -->
    <div id="cs-panel-loggedin" style="display:none;padding:18px;">
      <div style="text-align:center;">
        <div id="cs-panel-avatar" style="
          width:46px;height:46px;border-radius:50%;
          background:#FEE8EA;border:2px solid rgba(193,18,31,.2);
          display:flex;align-items:center;justify-content:center;
          font-size:18px;font-weight:700;color:#C1121F;
          font-family:'Space Mono',monospace;
          margin:0 auto 8px;
        ">?</div>
        <div id="cs-panel-user-email" style="font-size:13px;font-weight:700;color:#111;margin-bottom:6px;">—</div>
        <div style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;background:rgba(22,163,74,.08);border:1px solid rgba(22,163,74,.2);font-size:10px;font-weight:700;color:#15803d;">
          <div style="width:5px;height:5px;border-radius:50%;background:#16a34a;"></div>
          Data syncing to cloud
        </div>
        <button class="cs-p-signout" id="cs-panel-logout-btn">Sign Out</button>
      </div>
    </div>

  </div>
</div>`;

  document.body.insertAdjacentHTML('beforeend', PANEL_HTML);

  // ── References ───────────────────────────────────────────────
  const panel      = document.getElementById('cs-account-panel');
  const card       = document.getElementById('cs-panel-card');
  const backdrop   = document.getElementById('cs-panel-backdrop');
  const closeBtn   = document.getElementById('cs-panel-close');
  const tabLogin   = document.getElementById('cs-ptab-login');
  const tabSignup  = document.getElementById('cs-ptab-signup');
  const loginForm  = document.getElementById('cs-panel-login-form');
  const signupForm = document.getElementById('cs-panel-signup-form');
  const msgEl      = document.getElementById('cs-panel-msg');
  const loggedout  = document.getElementById('cs-panel-loggedout');
  const loggedin   = document.getElementById('cs-panel-loggedin');
  const headerSub  = document.getElementById('cs-panel-header-sub');

  // ── Helpers ──────────────────────────────────────────────────
  function showMsg(text, type) {
    msgEl.textContent  = text;
    msgEl.className    = 'cs-p-msg ' + (type === 'error' ? 'err' : 'ok');
  }
  function clearMsg() { msgEl.className = 'cs-p-msg'; msgEl.textContent = ''; }

  function setBusy(btn, busy, label) {
    btn.disabled    = busy;
    btn.textContent = busy ? '…' : label;
  }

  // ── Position card relative to the profile button ─────────────
  function positionCard() {
    const btn = document.getElementById('profile-btn');
    if (!btn) return;

    const rect      = btn.getBoundingClientRect();
    const vpW       = window.innerWidth;
    const vpH       = window.innerHeight;
    const cardW     = 280;
    const gap       = 6;

    // Align right edge of card with right edge of button (or clamp to viewport)
    let left = rect.right - cardW;
    if (left < 8) left = 8;
    if (left + cardW > vpW - 8) left = vpW - cardW - 8;

    // Place below button; if it would overflow bottom, place above
    let top = rect.bottom + gap;
    // Rough card height estimate for overflow check
    const estimatedH = 340;
    if (top + estimatedH > vpH - 8) {
      top = rect.top - estimatedH - gap;
      if (top < 8) top = 8;
    }

    card.style.left = left + 'px';
    card.style.top  = top  + 'px';
  }

  // ── State ─────────────────────────────────────────────────────
  async function refreshState() {
    const { user } = await getStoredAuth();
    if (user) {
      loggedout.style.display = 'none';
      loggedin.style.display  = 'block';
      headerSub.textContent   = 'Signed in & syncing';
      document.getElementById('cs-panel-avatar').textContent     = user.email[0].toUpperCase();
      document.getElementById('cs-panel-user-email').textContent = user.email;
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
    if (loggedIn) { wrap.classList.add('logged-in');    btn.title = email || 'Account'; }
    else          { wrap.classList.remove('logged-in'); btn.title = 'Account'; }
  }

  // ── Open / close ─────────────────────────────────────────────
  function openPanel() {
    clearMsg();
    panel.style.display = 'block';
    positionCard();
    refreshState();
  }

  function closePanel() {
    panel.style.display = 'none';
  }

  // ── Wire the profile button ───────────────────────────────────
  function wireProfileBtn() {
    const btn = document.getElementById('profile-btn');
    if (!btn) { setTimeout(wireProfileBtn, 100); return; }
    // Remove any old listeners by cloning the node
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel.style.display === 'none' || panel.style.display === '') {
        openPanel();
      } else {
        closePanel();
      }
    });
  }
  wireProfileBtn();

  closeBtn.addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.style.display !== 'none') closePanel();
  });

  // Reposition on scroll/resize
  window.addEventListener('resize', () => {
    if (panel.style.display !== 'none') positionCard();
  });

  // ── Tabs ─────────────────────────────────────────────────────
  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');   tabSignup.classList.remove('active');
    loginForm.style.display  = 'block'; signupForm.style.display = 'none';
    clearMsg();
  });
  tabSignup.addEventListener('click', () => {
    tabSignup.classList.add('active'); tabLogin.classList.remove('active');
    signupForm.style.display = 'block'; loginForm.style.display  = 'none';
    clearMsg();
  });

  // ── Login ────────────────────────────────────────────────────
  document.getElementById('cs-panel-login-btn').addEventListener('click', async () => {
    const btn      = document.getElementById('cs-panel-login-btn');
    const email    = document.getElementById('cs-panel-login-email').value.trim();
    const password = document.getElementById('cs-panel-login-pw').value;
    if (!email || !password) return showMsg('Please fill in all fields.', 'error');
    clearMsg(); setBusy(btn, true, 'Sign In');
    try {
      await login(email, password);
      showMsg('Signed in! Your data is now syncing.', 'ok');
      updateProfileDot(true, email);
      setTimeout(closePanel, 1200);
    } catch (err) {
      showMsg(err.message || 'Sign in failed. Check your credentials.', 'error');
    } finally {
      setBusy(btn, false, 'Sign In');
    }
  });

  // Enter key submits login
  ['cs-panel-login-email', 'cs-panel-login-pw'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('cs-panel-login-btn').click();
    });
  });

  // ── Signup ───────────────────────────────────────────────────
  document.getElementById('cs-panel-signup-btn').addEventListener('click', async () => {
    const btn      = document.getElementById('cs-panel-signup-btn');
    const email    = document.getElementById('cs-panel-signup-email').value.trim();
    const password = document.getElementById('cs-panel-signup-pw').value;
    const confirm  = document.getElementById('cs-panel-signup-confirm').value;
    if (!email || !password) return showMsg('Please fill in all fields.', 'error');
    if (password.length < 8) return showMsg('Password must be at least 8 characters.', 'error');
    if (password !== confirm) return showMsg('Passwords do not match.', 'error');
    clearMsg(); setBusy(btn, true, 'Create Account');
    try {
      await register(email, password);
      showMsg('Account created! Welcome to ClickSafe.', 'ok');
      updateProfileDot(true, email);
      setTimeout(closePanel, 1200);
    } catch (err) {
      showMsg(err.message || 'Registration failed. Try a different email.', 'error');
    } finally {
      setBusy(btn, false, 'Create Account');
    }
  });

  // Enter key submits signup
  ['cs-panel-signup-email', 'cs-panel-signup-pw', 'cs-panel-signup-confirm'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('cs-panel-signup-btn').click();
    });
  });

  // ── Logout ───────────────────────────────────────────────────
  document.getElementById('cs-panel-logout-btn').addEventListener('click', async () => {
    await logout();
    updateProfileDot(false);
    refreshState();
  });

  // ── Keep dot in sync when auth changes from another tab ───────
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !('authToken' in changes)) return;
      const newToken = changes.authToken.newValue;
      if (newToken) {
        chrome.storage.local.get(['authUser'], r => {
          updateProfileDot(true, r.authUser?.email);
        });
      } else {
        updateProfileDot(false);
      }
      // Refresh panel state if it's open
      if (panel.style.display !== 'none') refreshState();
    });
  }

})();