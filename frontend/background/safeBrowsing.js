// ============================================================
//  safeBrowsing.js — Local Safe Browsing hash-prefix store
// ============================================================

// Hard timeout for the backend prefix-fetch call. Generous enough for a
// cold Render instance to wake up, but short enough to not stall startup.
const SB_FETCH_TIMEOUT_MS = 15_000;

let sbPrefixStore = new Map();

function canonicaliseUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol + '//' + u.host + u.pathname + (u.search || '')).toLowerCase();
  } catch { return url.toLowerCase(); }
}

function getUrlExpressions(url) {
  try {
    const u    = new URL(url);
    const host = u.hostname;
    const path = u.pathname + (u.search || '');
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);
    const exprs = new Set();

    if (!isIp) {
      const parts = host.split('.');
      for (let i = Math.max(0, parts.length - 5); i < parts.length - 1; i++) {
        const h = parts.slice(i).join('.');
        exprs.add(h + path);
        exprs.add(h + '/');
      }
    }
    exprs.add(host + path);
    exprs.add(host + '/');
    return [...exprs];
  } catch { return [url]; }
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkUrlLocally(url) {
  if (sbPrefixStore.size === 0) return null;
  const canonical   = canonicaliseUrl(url);
  const expressions = getUrlExpressions(canonical);

  for (const expr of expressions) {
    const hash   = await sha256Hex(expr);
    const prefix = hash.substring(0, 8);
    for (const [threatType, prefixes] of sbPrefixStore) {
      if (prefixes.has(prefix)) return { needsConfirmation: true, hash, threatType, url };
    }
  }
  return { safe: true };
}

function applyRemovals(existingSet, removalIndices) {
  if (!removalIndices?.length) return existingSet;
  const sorted = [...existingSet].sort();
  removalIndices.slice().sort((a, b) => b - a)
    .forEach(i => { if (i < sorted.length) sorted.splice(i, 1); });
  return new Set(sorted);
}

async function updateSbPrefixes() {
  try {
    const stored       = await chrome.storage.local.get(['sbClientStates']);
    const clientStates = stored.sbClientStates || {};

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), SB_FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(`${BACKEND_URL}/api/sb-prefixes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ clientStates }),
        signal:  controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    for (const [threatType, update] of Object.entries(data.prefixes || {})) {
      const { entries, responseType, removals } = update;
      if (responseType === 'FULL_UPDATE' || !sbPrefixStore.has(threatType)) {
        sbPrefixStore.set(threatType, new Set(entries));
      } else {
        let existing = sbPrefixStore.get(threatType) || new Set();
        existing = applyRemovals(existing, removals);
        entries.forEach(p => existing.add(p));
        sbPrefixStore.set(threatType, existing);
      }
    }

    const storeable = {};
    for (const [threatType, prefixes] of sbPrefixStore) {
      storeable[threatType] = [...prefixes];
    }
    await chrome.storage.local.set({
      sbPrefixStore:     storeable,
      sbClientStates:    data.clientStates || {},
      sbPrefixesUpdated: Date.now()
    });

    const total = [...sbPrefixStore.values()].reduce((a, s) => a + s.size, 0);
    console.log(`[ClickSafe] SB prefixes: ${total} across ${sbPrefixStore.size} threat types`);

  } catch (err) {
    console.warn('[ClickSafe] SB prefix update failed:', err.message);
  }
}

async function loadSbPrefixesFromStorage() {
  try {
    const stored = await chrome.storage.local.get(['sbPrefixStore', 'sbPrefixesUpdated']);

    if (stored.sbPrefixStore && Object.keys(stored.sbPrefixStore).length > 0) {
      for (const [threatType, prefixes] of Object.entries(stored.sbPrefixStore)) {
        sbPrefixStore.set(threatType, new Set(prefixes));
      }
      const total = [...sbPrefixStore.values()].reduce((a, s) => a + s.size, 0);
      console.log(`[ClickSafe] SB prefixes restored: ${total}`);
      const age = Date.now() - (stored.sbPrefixesUpdated || 0);
      if (age > SB_REFRESH_MS) updateSbPrefixes();
    } else {
      console.log('[ClickSafe] No SB prefixes stored, fetching...');
      updateSbPrefixes();
    }
  } catch (err) {
    console.warn('[ClickSafe] SB restore failed:', err.message);
    updateSbPrefixes();
  }
}