// ============================================================
//  ClickSafe — controllers/trackerEncounterController.js
//
//  Logs tracker encounters server-side. user_id is nullable so
//  anonymous users still contribute to aggregate data.
//
//  Endpoints (mounted at /api/trackers):
//    POST /log          — log a batch of tracker hits for one page
//    GET  /top          — top tracker domains across all users (last 30d)
//    GET  /my-history   — per-user encounter log (auth required)
// ============================================================

const db = require("../config/database");

const MAX_TRACKERS_PER_REQUEST = 50;  // guard against oversized payloads
const MAX_LOG_PER_USER         = 5000;

// ── POST /api/trackers/log ────────────────────────────────────
// Accepts { pageDomain, pageUrl, trackers: ['doubleclick.net', ...] }
// user_id is read from req.user if soft-auth attached it, else null.
async function logEncounters(req, res, next) {
  try {
    const { pageDomain, pageUrl, trackers } = req.body || {};

    if (!pageDomain || !Array.isArray(trackers) || trackers.length === 0)
      return res.status(400).json({ error: "pageDomain and trackers[] are required" });

    const userId = req.user?.id || null;
    const domain = String(pageDomain).slice(0, 253);
    const url    = pageUrl ? String(pageUrl).slice(0, 2048) : null;
    const now    = new Date().toISOString().slice(0, 19).replace("T", " ");
    const batch  = [...new Set(trackers)]           // deduplicate within request
      .slice(0, MAX_TRACKERS_PER_REQUEST)
      .map(t => String(t).slice(0, 253))
      .filter(Boolean);

    if (batch.length === 0) return res.json({ ok: true, logged: 0 });

    const placeholders = batch.map(() => "(?,?,?,?,?)").join(",");
    const values       = batch.flatMap(t => [userId, domain, t, url, now]);

    await db.query(
      `INSERT INTO tracker_encounters
         (user_id, page_domain, tracker_domain, page_url, encountered_at)
       VALUES ${placeholders}`,
      values
    );

    // Enforce per-user cap: drop oldest rows beyond MAX_LOG_PER_USER
    if (userId) {
      await db.query(
        `DELETE FROM tracker_encounters
         WHERE user_id = ?
           AND id NOT IN (
             SELECT id FROM (
               SELECT id FROM tracker_encounters
               WHERE user_id = ?
               ORDER BY encountered_at DESC
               LIMIT ?
             ) sub
           )`,
        [userId, userId, MAX_LOG_PER_USER]
      );
    }

    return res.status(201).json({ ok: true, logged: batch.length });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/trackers/top ─────────────────────────────────────
// Returns the top 30 most-encountered tracker domains across all
// users in the last 30 days, with unique-user and hit counts.
async function getTopTrackers(req, res, next) {
  try {
    const [rows] = await db.query(
      `SELECT
         tracker_domain,
         COUNT(*)                    AS total_hits,
         COUNT(DISTINCT page_domain) AS sites_seen_on,
         COUNT(DISTINCT user_id)     AS unique_users
       FROM   tracker_encounters
       WHERE  encountered_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP  BY tracker_domain
       ORDER  BY total_hits DESC
       LIMIT  30`
    );
    return res.json({ trackers: rows });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/trackers/my-history ──────────────────────────────
// Returns the authenticated user's tracker encounter log,
// newest first, grouped by page visit (page_domain + date).
async function getMyHistory(req, res, next) {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 200, 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0,   0);

    const [rows] = await db.query(
      `SELECT tracker_domain, page_domain, page_url, encountered_at
       FROM   tracker_encounters
       WHERE  user_id = ?
       ORDER  BY encountered_at DESC
       LIMIT  ? OFFSET ?`,
      [req.user.id, limit, offset]
    );
    return res.json({ encounters: rows, total: rows.length, offset });
  } catch (err) {
    next(err);
  }
}

module.exports = { logEncounters, getTopTrackers, getMyHistory };
