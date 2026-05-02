// ============================================================
//  ClickSafe — controllers/downloadController.js
//
//  Handles download URL safety checks with a 24-hour DB cache.
//  Reuses the same checked_urls cache table as linkController
//  so a URL checked on hover doesn't get re-checked on download.
// ============================================================

const { checkUrl } = require("../services/safeBrowsingService");
const db = require("../config/database");
const { validateUrl, validateFilename } = require("../middleware/inputValidation");

const CACHE_TTL_HOURS    = 24;

// ── Cache helpers ─────────────────────────────────────────────

async function getCached(url) {
  try {
    const [rows] = await db.query(
      `SELECT is_safe, threat_type, checked_at
         FROM checked_urls
        WHERE url_hash  = MD5(?)
          AND url       = ?
          AND checked_at > NOW() - INTERVAL ? HOUR
        LIMIT 1`,
      [url, url, CACHE_TTL_HOURS]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error("[ClickSafe] Cache read error:", err.message);
    return null;
  }
}

async function setCached(url, isSafe, threatType) {
  try {
    await db.query(
      `INSERT INTO checked_urls (url, url_hash, is_safe, threat_type, checked_at)
            VALUES (?, MD5(?), ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
            is_safe     = VALUES(is_safe),
            threat_type = VALUES(threat_type),
            checked_at  = NOW()`,
      [url, url, isSafe ? 1 : 0, threatType || null]
    );
  } catch (err) {
    console.error("[ClickSafe] Cache write error:", err.message);
  }
}

// ── Controller ────────────────────────────────────────────────

async function checkDownload(req, res, next) {
  try {
    const { url, filename } = req.body;

    // ── Input validation ────────────────────────────────────
    const urlCheck = validateUrl(url);
    if (!urlCheck.ok) {
      return res.status(urlCheck.status).json({ error: urlCheck.error });
    }
    const safeUrl = urlCheck.url;

    const fnCheck = validateFilename(filename);
    if (!fnCheck.ok) {
      return res.status(fnCheck.status).json({ error: fnCheck.error });
    }
    const safeFilename = fnCheck.filename;

    // ── Cache lookup ─────────────────────────────────────────
    const cached = await getCached(safeUrl);
    if (cached) {
      return res.json({
        safe:       cached.is_safe === 1,
        url:        safeUrl,
        filename:   safeFilename,
        threat:     cached.threat_type || null,
        checked_at: cached.checked_at.toISOString(),
        cached:     true
      });
    }

    // ── Google Safe Browsing API call ────────────────────────
    const result = await checkUrl(safeUrl);

    // ── Write to cache (skip API_UNAVAILABLE results) ────────
    if (result.threat !== "API_UNAVAILABLE") {
      await setCached(safeUrl, result.safe, result.threat || null);
    }

    return res.json({
      safe:        result.safe,
      url:         safeUrl,
      filename:    safeFilename,
      threat:      result.threat || null,
      unavailable: result.unavailable || false,
      checked_at:  new Date().toISOString(),
      cached:      false
    });

  } catch (error) {
    next(error);
  }
}

module.exports = { checkDownload };