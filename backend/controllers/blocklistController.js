// ============================================================
//  ClickSafe — controllers/blocklistController.js
//
//  Serves the tracker blocklist to the extension so the 70k-domain
//  list can be updated without requiring users to reinstall.
//
//  Flow:
//    1. Extension polls GET /api/blocklist (max once per 24h via
//       its own chrome.storage.local cache).
//    2. This controller checks its own in-memory server-side cache.
//    3. If the cache is fresh (< 24h), it returns immediately.
//    4. If stale, it re-fetches from the Disconnect.me GitHub repo,
//       parses the services.json format into a flat domain array,
//       updates the cache, and returns the new list.
//    5. If GitHub is unreachable, the stale cache is returned as a
//       fallback so the extension never gets an empty list.
//
//  Endpoint:
//    GET /api/blocklist  — returns { domains: string[], updatedAt: string, cached: bool }
// ============================================================

const DISCONNECT_ME_URL =
  "https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/services.json";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory cache — shared across all requests on this Render instance.
// On cold start the cache is empty; first request fetches from GitHub.
let _cache = {
  domains:   [],
  updatedAt: null,   // ISO string, or null if never populated
};

// ── Parse Disconnect.me services.json → flat domain array ────
function parseDomains(data) {
  const domains = [];
  for (const category of Object.values(data.categories || {})) {
    for (const service of Object.values(category)) {
      for (const [key, val] of Object.entries(service)) {
        if (key === "homepage") continue;
        if (Array.isArray(val)) {
          val.forEach(d => { if (typeof d === "string") domains.push(d); });
        }
      }
    }
  }
  return domains;
}

// ── Fetch + parse from GitHub ─────────────────────────────────
async function fetchFromGitHub() {
  const res = await fetch(DISCONNECT_ME_URL, {
    headers: { "User-Agent": "ClickSafe-backend/1.0" },
    signal:  AbortSignal.timeout(15_000),  // 15s hard timeout
  });
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);
  const data = await res.json();
  return parseDomains(data);
}

// ── GET /api/blocklist ────────────────────────────────────────
async function getBlocklist(req, res, next) {
  try {
    const now      = Date.now();
    const cacheAge = _cache.updatedAt ? now - new Date(_cache.updatedAt).getTime() : Infinity;
    const isFresh  = cacheAge < CACHE_TTL_MS;

    if (isFresh && _cache.domains.length > 0) {
      return res.json({
        domains:   _cache.domains,
        updatedAt: _cache.updatedAt,
        cached:    true,
      });
    }

    // Cache is stale or empty — re-fetch
    try {
      const domains  = await fetchFromGitHub();
      _cache.domains   = domains;
      _cache.updatedAt = new Date().toISOString();
      console.log(`[ClickSafe] Blocklist refreshed from GitHub: ${domains.length} domains`);
    } catch (fetchErr) {
      // GitHub unreachable — serve stale cache rather than an empty list
      console.warn("[ClickSafe] Blocklist GitHub fetch failed:", fetchErr.message);
      if (_cache.domains.length === 0) {
        // Nothing cached at all — return a 503 so the extension falls back
        // to its bundled trackers.json rather than wiping its blocklist.
        return res.status(503).json({ error: "Blocklist temporarily unavailable" });
      }
      // Return stale cache with original updatedAt so the extension knows
      // the data is old and can try again next time.
    }

    return res.json({
      domains:   _cache.domains,
      updatedAt: _cache.updatedAt,
      cached:    false,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getBlocklist };
