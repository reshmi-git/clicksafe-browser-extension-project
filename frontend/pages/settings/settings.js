// ============================================================
//  ClickSafe — settings.js
//  Handles load, save, reset, export, and import for settings page
// ============================================================

const DEFAULTS = {
  httpsEnabled:       true,
  cookiesEnabled:     true,
  linksEnabled:       true,
  downloadsEnabled:   true,
  modalsEnabled:      true,
  darkPatternsEnabled: true,
  whitelist:          []
};

// ── State ────────────────────────────────────────────────────
let whitelist = [];

// ── Load settings on open ────────────────────────────────────
chrome.storage.local.get(["settings"], async function (result) {
  const s = Object.assign({}, DEFAULTS, result.settings || {});

  document.getElementById("toggle-https").checked        = s.httpsEnabled;
  document.getElementById("toggle-cookies").checked      = s.cookiesEnabled;
  document.getElementById("toggle-links").checked        = s.linksEnabled;
  document.getElementById("toggle-downloads").checked    = s.downloadsEnabled;
  document.getElementById("toggle-modals").checked       = s.modalsEnabled;
  document.getElementById("toggle-darkpatterns").checked = s.darkPatternsEnabled;

  // Start with the locally stored whitelist
  let mergedWhitelist = [...(s.whitelist || [])];

  // If the user is logged in, fetch their server whitelist and merge
  // (server is the source of truth — it may have entries added on another device)
  const serverDomains = await fetchWhitelist();
  if (serverDomains.length > 0) {
    const merged = new Set([...mergedWhitelist, ...serverDomains]);
    mergedWhitelist = [...merged];
    // Persist the merged list locally so background.js can read it
    const updatedSettings = { ...s, whitelist: mergedWhitelist };
    chrome.storage.local.set({ settings: updatedSettings });
  }

  renderWhitelist(mergedWhitelist);
});

// ── Whitelist rendering ──────────────────────────────────────
function renderWhitelist(items) {
  whitelist = items;
  const list = document.getElementById("whitelist-list");
  list.innerHTML = "";

  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "whitelist-empty";
    empty.textContent = "No trusted sites added yet";
    list.appendChild(empty);
    return;
  }

  items.forEach((site, index) => {
    const li = document.createElement("li");
    li.className = "whitelist-item";
    li.innerHTML = `
      <span>${escapeHTML(site)}</span>
      <button class="btn-remove" data-index="${index}" aria-label="Remove ${escapeHTML(site)}">✕</button>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll(".btn-remove").forEach(btn => {
    btn.addEventListener("click", async function () {
      const removed = whitelist[parseInt(this.dataset.index)];
      whitelist.splice(parseInt(this.dataset.index), 1);
      renderWhitelist([...whitelist]);
      // Remove from server immediately (best-effort, no toast needed)
      await removeWhitelistDomain(removed);
    });
  });
}

// ── Whitelist domain validation ───────────────────────────────
const MAX_DOMAIN_LENGTH = 253;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function sanitizeDomain(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

function isValidDomain(domain) {
  if (!domain) return false;
  if (domain.length > MAX_DOMAIN_LENGTH) return false;
  if (!DOMAIN_RE.test(domain)) return false;
  if (domain.split(".").some(label => label.length > 63)) return false;
  return true;
}

// ── Add to whitelist ─────────────────────────────────────────
async function addToWhitelist() {
  const input  = document.getElementById("whitelist-input");
  const errMsg = document.getElementById("whitelist-error");
  const value  = sanitizeDomain(input.value);

  const showError = (msg) => {
    if (errMsg) { errMsg.textContent = msg; errMsg.style.display = "block"; }
    input.style.borderColor = "#E63946";
    setTimeout(() => {
      input.style.borderColor = "";
      if (errMsg) errMsg.style.display = "none";
    }, 2500);
  };

  if (!value) return;

  if (!isValidDomain(value)) {
    showError("Enter a valid domain (e.g. example.com)");
    input.value = "";
    return;
  }

  if (value.length > MAX_DOMAIN_LENGTH) {
    showError("Domain is too long (max 253 characters)");
    input.value = "";
    return;
  }

  if (whitelist.includes(value)) {
    showError("Already in your trusted sites list");
    input.value = "";
    return;
  }

  whitelist.push(value);
  renderWhitelist([...whitelist]);
  input.value = "";
  input.focus();

  // Sync to server immediately (best-effort)
  await addWhitelistDomain(value);
}

document.getElementById("add-whitelist").addEventListener("click", addToWhitelist);

document.getElementById("whitelist-input").addEventListener("keydown", function (e) {
  if (e.key === "Enter") addToWhitelist();
});

// ── Save settings ────────────────────────────────────────────
document.getElementById("save-btn").addEventListener("click", async function () {
  const settings = {
    httpsEnabled:        document.getElementById("toggle-https").checked,
    cookiesEnabled:      document.getElementById("toggle-cookies").checked,
    linksEnabled:        document.getElementById("toggle-links").checked,
    downloadsEnabled:    document.getElementById("toggle-downloads").checked,
    modalsEnabled:       document.getElementById("toggle-modals").checked,
    darkPatternsEnabled: document.getElementById("toggle-darkpatterns").checked,
    whitelist:           [...whitelist]
  };

  chrome.storage.local.set({ settings }, function () {
    if (chrome.runtime.lastError) {
      showErrorToast("Save failed: " + chrome.runtime.lastError.message);
      return;
    }
    chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED", settings });
    showSuccessToast("Settings saved successfully");
  });

  // Bulk-sync the full whitelist to the server (catches any drift)
  await syncWhitelistToServer([...whitelist]);
});

// ── Reset to defaults ────────────────────────────────────────
document.getElementById("reset-btn").addEventListener("click", function () {
  chrome.storage.local.set({ settings: DEFAULTS }, function () {
    chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED", settings: DEFAULTS });
    location.reload();
  });
});

// ── Export settings ──────────────────────────────────────────
document.getElementById("export-btn").addEventListener("click", function () {
  exportSettings();
  showSuccessToast("Settings exported successfully");
});

// ── Import settings ──────────────────────────────────────────
document.getElementById("import-file-input").addEventListener("change", function (e) {
  const file = e.target.files[0];
  e.target.value = ""; // reset so selecting the same file again fires the event

  importSettings(file, function (result) {
    if (result.ok) {
      const s = result.settings;
      document.getElementById("toggle-https").checked        = s.httpsEnabled;
      document.getElementById("toggle-cookies").checked      = s.cookiesEnabled;
      document.getElementById("toggle-links").checked        = s.linksEnabled;
      document.getElementById("toggle-downloads").checked    = s.downloadsEnabled;
      document.getElementById("toggle-modals").checked       = s.modalsEnabled;
      document.getElementById("toggle-darkpatterns").checked = s.darkPatternsEnabled;
      renderWhitelist(s.whitelist || []);
      showSuccessToast("Settings imported successfully");
    } else {
      showErrorToast(result.error);
    }
  });
});

// ── Toast helpers ────────────────────────────────────────────
function showSuccessToast(message) {
  const toast = document.getElementById("success-msg");
  if (!toast) return;
  let textSpan = toast.querySelector(".toast-text");
  if (!textSpan) {
    textSpan = document.createElement("span");
    textSpan.className = "toast-text";
    toast.appendChild(textSpan);
  }
  textSpan.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function showErrorToast(message) {
  const toast = document.getElementById("import-error-msg");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 4000);
}

// ── Helpers ──────────────────────────────────────────────────
function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// ── Auth UI ──────────────────────────────────────────────────────────────────
// Wires up the Account card: tab switching, login, register, logout, delete.

(async function initAuthUI() {
  // ── Helpers ────────────────────────────────────────────────
  function showLoggedIn(email) {
    document.getElementById('auth-logged-out').style.display = 'none';
    document.getElementById('auth-logged-in').style.display  = 'flex';
    const el = document.getElementById('auth-email-display');
    if (el) el.textContent = email || '—';
  }

  function showLoggedOut() {
    document.getElementById('auth-logged-in').style.display  = 'none';
    document.getElementById('auth-logged-out').style.display = 'flex';
  }

  function setError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('show', Boolean(msg));
  }

  function setSubmitLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled     = loading;
    btn.textContent  = loading ? 'Please wait…' : (btnId === 'login-submit' ? 'Log In' : 'Create Account');
  }

  // ── Check existing session ─────────────────────────────────
  const { user } = await getStoredAuth();
  if (user?.email) {
    showLoggedIn(user.email);
  } else {
    showLoggedOut();
  }

  // ── Tab switching ──────────────────────────────────────────
  document.getElementById('tab-login')?.addEventListener('click', () => {
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('form-login').classList.remove('hidden');
    document.getElementById('form-register').classList.add('hidden');
    setError('login-error', '');
  });
  document.getElementById('tab-register')?.addEventListener('click', () => {
    document.getElementById('tab-register').classList.add('active');
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('form-register').classList.remove('hidden');
    document.getElementById('form-login').classList.add('hidden');
    setError('reg-error', '');
  });

  // ── Login ──────────────────────────────────────────────────
  document.getElementById('login-submit')?.addEventListener('click', async () => {
    const email    = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-password')?.value;
    setError('login-error', '');
    if (!email || !password) return setError('login-error', 'Please fill in all fields');
    setSubmitLoading('login-submit', true);
    try {
      const { user } = await login(email, password);
      showLoggedIn(user.email);
      showSuccessToast('Logged in successfully');
      // Pull server whitelist and merge after login
      const serverDomains = await fetchWhitelist();
      if (serverDomains.length > 0) {
        const merged = [...new Set([...whitelist, ...serverDomains])];
        renderWhitelist(merged);
        chrome.storage.local.get(['settings'], r => {
          const s = Object.assign({}, r.settings || {}, { whitelist: merged });
          chrome.storage.local.set({ settings: s });
          chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: s });
        });
      }
      // Bulk-sync local score history to server (best-effort)
      if (typeof bulkSyncScoreHistory === 'function') {
        chrome.storage.local.get(['sidepanelTrackerHistory'], r => {
          const local = r.sidepanelTrackerHistory || [];
          if (local.length > 0) bulkSyncScoreHistory(local);
        });
      }
    } catch (err) {
      setError('login-error', err.message || 'Login failed');
    } finally {
      setSubmitLoading('login-submit', false);
    }
  });

  // ── Register ───────────────────────────────────────────────
  document.getElementById('reg-submit')?.addEventListener('click', async () => {
    const email    = document.getElementById('reg-email')?.value.trim();
    const password = document.getElementById('reg-password')?.value;
    const password2 = document.getElementById('reg-password2')?.value;
    setError('reg-error', '');
    if (!email || !password || !password2) return setError('reg-error', 'Please fill in all fields');
    if (password !== password2) return setError('reg-error', 'Passwords do not match');
    if (password.length < 8) return setError('reg-error', 'Password must be at least 8 characters');
    setSubmitLoading('reg-submit', true);
    try {
      const { user } = await register(email, password);
      showLoggedIn(user.email);
      showSuccessToast('Account created — you\'re logged in!');
      // Push the existing local whitelist to the new account
      if (whitelist.length > 0) {
        await syncWhitelistToServer([...whitelist]);
      }
    } catch (err) {
      setError('reg-error', err.message || 'Registration failed');
    } finally {
      setSubmitLoading('reg-submit', false);
    }
  });

  // ── Logout ─────────────────────────────────────────────────
  document.getElementById('auth-logout-btn')?.addEventListener('click', async () => {
    await logout();
    showLoggedOut();
    showSuccessToast('Logged out');
  });

  // ── Delete account ─────────────────────────────────────────
  document.getElementById('auth-delete-btn')?.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Delete your ClickSafe account?\n\nThis cannot be undone. All synced data will be permanently removed.'
    );
    if (!confirmed) return;
    const password = window.prompt('Enter your password to confirm:');
    if (password === null) return; // user cancelled
    try {
      await deleteAccount(password);
      showLoggedOut();
      showSuccessToast('Account deleted');
    } catch (err) {
      showErrorToast(err.message || 'Could not delete account');
    }
  });
})();