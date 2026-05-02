// ============================================================
//  ClickSafe — controllers/darkPatternController.js
//
//  Records user dismissals of dark-pattern highlights as
//  potential false positives. user_id is nullable so anonymous
//  users (not logged in) are recorded too — their dismissals
//  still contribute to aggregate false-positive data.
//
//  Endpoints (mounted at /api/dark-patterns):
//    POST /dismiss   — log one dismissal
//    GET  /stats     — top false-positive domains (auth optional)
// ============================================================

const db = require("../config/database");

// ── POST /api/dark-patterns/dismiss ──────────────────────────
async function logDismissal(req, res, next) {
  try {
    const { domain, patternType, patternText, pageUrl } = req.body || {};

    if (!domain || !patternType)
      return res.status(400).json({ error: "domain and patternType are required" });

    // user_id comes from requireAuth if the token was supplied,
    // but this endpoint accepts anonymous calls too (no auth middleware).
    const userId = req.user?.id || null;

    await db.query(
      `INSERT INTO dark_pattern_dismissals
         (user_id, domain, pattern_type, pattern_text, page_url)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userId,
        String(domain).slice(0, 253),
        String(patternType).slice(0, 64),
        patternText ? String(patternText).slice(0, 160) : null,
        pageUrl     ? String(pageUrl).slice(0, 2048)    : null,
      ]
    );

    console.log(`[dark-patterns] dismiss: ${patternType} on ${domain}${userId ? ` by ${userId}` : " (anon)"}`);
    return res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/dark-patterns/stats ─────────────────────────────
// Returns the top 20 most-dismissed domain+pattern combinations,
// useful for tuning detection thresholds over time.
async function getStats(req, res, next) {
  try {
    const [rows] = await db.query(
      `SELECT domain, pattern_type, COUNT(*) AS dismissals
       FROM   dark_pattern_dismissals
       WHERE  dismissed_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
       GROUP  BY domain, pattern_type
       ORDER  BY dismissals DESC
       LIMIT  20`
    );
    return res.json({ stats: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { logDismissal, getStats };
