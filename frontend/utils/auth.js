// ============================================================
//  ClickSafe — utils/auth.js
//  Auth helpers shared by sidepanel, settings, and background.
//
//  Token is stored in chrome.storage.local under the key 'authToken'.
//  User info is stored under 'authUser' { id, email }.
//  All calls go through BACKEND_URL (defined in background.js for
//  the service worker, or the constant below for pages).
// ============================================================

// ── Backend URL — auto-detects local dev vs production ────────────────────────
// When the extension is loaded unpacked (developer mode), the manifest has no
// update_url. In production (store install) update_url is always present.
// For now (pre-store), ALL installs are local, so we default to localhost.
// Once deployed to Render, this will automatically switch to the prod URL.
const PROD_BACKEND_URL  = 'https://clicksafe-browser-extension-project.onrender.com';
const LOCAL_BACKEND_URL = 'http://localhost:3000';

function resolveBackendUrl() {
  try {
    // update_url is injected by the store during packaging — present = prod
    const manifest = chrome.runtime.getManifest();
    if (manifest.update_url) return PROD_BACKEND_URL;
  } catch (_) {}
  return LOCAL_BACKEND_URL;
}

const AUTH_BACKEND_URL = resolveBackendUrl();

// ── Token storage ─────────────────────────────────────────────────────────────

function getStoredAuth() {
  return new Promise(resolve => {
    chrome.storage.local.get(['authToken', 'authUser'], r => {
      resolve({ token: r.authToken || null, user: r.authUser || null });
    });
  });
}

function setStoredAuth(token, user) {
  return new Promise(resolve => {
    chrome.storage.local.set({ authToken: token, authUser: user }, resolve);
  });
}

function clearStoredAuth() {
  return new Promise(resolve => {
    chrome.storage.local.remove(['authToken', 'authUser'], resolve);
  });
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function authFetch(path, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${AUTH_BACKEND_URL}${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a new account. Stores token + user on success.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ token: string, user: { id: string, email: string } }>}
 */
async function register(email, password) {
  const data = await authFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await setStoredAuth(data.token, data.user);
  return data;
}

/**
 * Log in to an existing account. Stores token + user on success.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ token: string, user: { id: string, email: string } }>}
 */
async function login(email, password) {
  const data = await authFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await setStoredAuth(data.token, data.user);
  return data;
}

/**
 * Log out. Clears stored auth regardless of server response.
 */
async function logout() {
  const { token } = await getStoredAuth();
  try {
    if (token) await authFetch('/api/auth/logout', { method: 'POST' }, token);
  } catch (_) { /* best-effort */ }
  await clearStoredAuth();
}

/**
 * Fetch current user from server (validates the stored token).
 * Returns null if not logged in or token is invalid.
 * @returns {Promise<{ id: string, email: string, createdAt: string } | null>}
 */
async function fetchCurrentUser() {
  const { token } = await getStoredAuth();
  if (!token) return null;
  try {
    const data = await authFetch('/api/auth/me', {}, token);
    return data.user;
  } catch (err) {
    if (err.status === 401) await clearStoredAuth();
    return null;
  }
}

/**
 * Change password for the currently logged-in user.
 */
async function changePassword(currentPassword, newPassword) {
  const { token } = await getStoredAuth();
  if (!token) throw new Error('Not logged in');
  return authFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  }, token);
}

/**
 * Permanently delete the current account.
 */
async function deleteAccount(password) {
  const { token } = await getStoredAuth();
  if (!token) throw new Error('Not logged in');
  await authFetch('/api/auth/account', {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  }, token);
  await clearStoredAuth();
}

// ── Whitelist API ─────────────────────────────────────────────────────────────

/**
 * Fetch the user's synced whitelist from the server.
 * Returns [] if not logged in or on any error.
 * @returns {Promise<string[]>}
 */
async function fetchWhitelist() {
  const { token } = await getStoredAuth();
  if (!token) return [];
  try {
    const data = await authFetch('/api/whitelist', {}, token);
    return Array.isArray(data.domains) ? data.domains : [];
  } catch {
    return [];
  }
}

/**
 * Add a single domain to the server whitelist.
 * No-op if not logged in.
 * @param {string} domain
 */
async function addWhitelistDomain(domain) {
  const { token } = await getStoredAuth();
  if (!token) return;
  try {
    await authFetch('/api/whitelist', {
      method: 'POST',
      body: JSON.stringify({ domain }),
    }, token);
  } catch (_) { /* best-effort */ }
}

/**
 * Remove a single domain from the server whitelist.
 * No-op if not logged in.
 * @param {string} domain
 */
async function removeWhitelistDomain(domain) {
  const { token } = await getStoredAuth();
  if (!token) return;
  try {
    await authFetch(`/api/whitelist/${encodeURIComponent(domain)}`, {
      method: 'DELETE',
    }, token);
  } catch (_) { /* best-effort */ }
}

/**
 * Bulk-sync locally-stored score history to the server.
 * Called once after login so the server has the full local history.
 * No-op if not logged in.
 * @param {Array} entries  array of history items from chrome.storage.local
 */
async function bulkSyncScoreHistory(entries) {
  const { token } = await getStoredAuth();
  if (!token || !Array.isArray(entries) || entries.length === 0) return;
  try {
    await authFetch('/api/score-history/bulk', {
      method: 'POST',
      body: JSON.stringify({ entries }),
    }, token);
  } catch (_) { /* best-effort */ }
}

/**
 * Append a single scored-page entry to the server.
 * No-op if not logged in.
 * @param {Object} entry  { url, domain, score, isHttps, cookieCount, scriptCount, companyCount, companies, timestamp }
 */
async function saveScoreHistoryEntry(entry) {
  const { token } = await getStoredAuth();
  if (!token) return;
  try {
    await authFetch('/api/score-history', {
      method: 'POST',
      body: JSON.stringify(entry),
    }, token);
  } catch (_) { /* best-effort */ }
}

/**
 * Fetch the user's full score history from the server.
 * Returns [] if not logged in or on any error.
 * @param {number} [limit=200]
 * @returns {Promise<Array>}
 */
async function fetchScoreHistory(limit = 200) {
  const { token } = await getStoredAuth();
  if (!token) return [];
  try {
    const data = await authFetch(`/api/score-history?limit=${limit}`, {}, token);
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

/**
 * Clear all server-side score history for the current user.
 * No-op if not logged in.
 */
async function clearServerScoreHistory() {
  const { token } = await getStoredAuth();
  if (!token) return;
  try {
    await authFetch('/api/score-history', { method: 'DELETE' }, token);
  } catch (_) { /* best-effort */ }
}
/**
 * Called on settings save to keep server perfectly in sync.
 * No-op if not logged in.
 * @param {string[]} domains
 */
async function syncWhitelistToServer(domains) {
  const { token } = await getStoredAuth();
  if (!token) return;
  try {
    await authFetch('/api/whitelist', {
      method: 'PUT',
      body: JSON.stringify({ domains }),
    }, token);
  } catch (_) { /* best-effort */ }
}