// ============================================================
//  ClickSafe — controllers/linkController.js
//
//  Handles link safety checks with a 24-hour DB cache.
//
//  Request flow:
//  1. Validate and parse the incoming URL
//  2. Check the DB cache — if a fresh result exists, return it immediately
//  3. If no cache hit, call the Google Safe Browsing API
//  4. Store the result in the DB cache for future requests
//  5. Return the result to the extension
//
//  Two API paths:
//  - hash + threatType provided → full-hash confirmation (local-first flow)
//  - URL only → full URL lookup (fallback flow)
// ============================================================

const { checkUrl, confirmHash } = require("../services/safeBrowsingService");
const db = require("../config/database");
const { validateUrl } = require("../middleware/inputValidation");

const CACHE_TTL_HOURS = 24;

// ── Cache helpers ─────────────────────────────────────────────

/**
 * Look up a URL in the cache.
 * Returns the cached row if it exists and is less than CACHE_TTL_HOURS old,
 * or null if there's no valid cache entry.
 */
async function getCached(url) {
  try {
    const [rows] = await db.query(
      `SELECT is_safe, threat_type, checked_at
         FROM checked_urls
        WHERE url_hash = MD5(?)
          AND url      = ?
          AND checked_at > NOW() - INTERVAL ? HOUR
        LIMIT 1`,
      [url, url, CACHE_TTL_HOURS]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    // Cache read failure is non-fatal — just fall through to the API
    console.error("[ClickSafe] Cache read error:", err.message);
    return null;
  }
}

/**
 * Insert or update a URL result in the cache.
 * Uses INSERT … ON DUPLICATE KEY UPDATE so re-checking a URL
 * refreshes its timestamp rather than creating a duplicate row.
 */
async function setCached(url, isSafe, threatType) {
  try {
    await db.query(
      `INSERT INTO checked_urls (url, url_hash, is_safe, threat_type, checked_at)
            VALUES (?, MD5(?), ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
            is_safe    = VALUES(is_safe),
            threat_type = VALUES(threat_type),
            checked_at  = NOW()`,
      [url, url, isSafe ? 1 : 0, threatType || null]
    );
  } catch (err) {
    // Cache write failure is non-fatal — the result is still returned to the extension
    console.error("[ClickSafe] Cache write error:", err.message);
  }
}

// ── Controller ────────────────────────────────────────────────

async function checkLink(req, res, next) {
  try {
    const { url, hash, threatType } = req.body;

    // ── Input validation ────────────────────────────────────
    const urlCheck = validateUrl(url);
    if (!urlCheck.ok) {
      return res.status(urlCheck.status).json({ error: urlCheck.error });
    }
    const safeUrl = urlCheck.url;

    // ── Hash format validation (if provided) ─────────────────
    if (hash !== undefined && (typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash))) {
      return res.status(400).json({ error: "Invalid hash format — expected 64-character hex SHA-256" });
    }

    // ── Cache lookup (skip cache for hash-confirmation requests) ──
    if (!hash) {
      const cached = await getCached(safeUrl);
      if (cached) {
        return res.json({
          safe:       cached.is_safe === 1,
          url:        safeUrl,
          threat:     cached.threat_type || null,
          checked_at: cached.checked_at.toISOString(),
          cached:     true
        });
      }
    }

    // ── Google Safe Browsing API call ────────────────────────
    let result;

    if (hash && threatType) {
      // Local prefix matched — confirm the full hash
      result = await confirmHash(hash, threatType);
    } else {
      // No local data — full URL lookup
      result = await checkUrl(safeUrl);
    }

    // ── Write result to cache (skip API_UNAVAILABLE results) ──
    if (result.threat !== "API_UNAVAILABLE") {
      await setCached(safeUrl, result.safe, result.threat || null);
    }

    return res.json({
      safe:        result.safe,
      url:         safeUrl,
      threat:      result.threat || null,
      unavailable: result.unavailable || false,
      checked_at:  new Date().toISOString(),
      cached:      false
    });

  } catch (error) {
    next(error);
  }
}

module.exports = { checkLink };