// ============================================================
//  ClickSafe — controllers/scoreHistoryController.js
//
//  Manages per-user privacy score history stored in MySQL.
//  All routes are protected by requireAuth middleware.
//
//  Endpoints (mounted at /api/score-history):
//    GET  /         — fetch history for the user (newest first)
//    POST /         — append one entry
//    POST /bulk     — bulk-upsert array of entries (initial sync)
//    DELETE /       — clear all history for the user
// ============================================================

const db = require("../config/database");

const MAX_HISTORY = 1000; // hard cap per user

// ── Helpers ───────────────────────────────────────────────────

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url.slice(0, 253); }
}

function sanitizeEntry(e) {
  return {
    url:          String(e.url          || "").slice(0, 2048),
    domain:       String(e.domain       || extractDomain(e.url || "")).slice(0, 253),
    score:        Math.max(0, Math.min(100, parseInt(e.score)        || 0)),
    is_https:     e.isHttps !== false ? 1 : 0,
    cookie_count: Math.max(0, parseInt(e.cookieCount)  || 0),
    script_count: Math.max(0, parseInt(e.scriptCount)  || 0),
    company_count:Math.max(0, parseInt(e.companyCount) || 0),
    companies:    JSON.stringify((e.companies || []).slice(0, 5)),
    visited_at:   e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 19).replace("T", " ")
      : new Date().toISOString().slice(0, 19).replace("T", " "),
  };
}

// ── GET /api/score-history ────────────────────────────────────
async function getHistory(req, res, next) {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 200, 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0,   0);

    const [rows] = await db.query(
      `SELECT id, url, domain, score, is_https, cookie_count, script_count,
              company_count, companies, visited_at
       FROM   score_history
       WHERE  user_id = ?
       ORDER  BY visited_at DESC
       LIMIT  ? OFFSET ?`,
      [req.user.id, limit, offset]
    );

    const entries = rows.map(r => ({
      id:           r.id,
      url:          r.url,
      domain:       r.domain,
      score:        r.score,
      isHttps:      r.is_https === 1,
      cookieCount:  r.cookie_count,
      scriptCount:  r.script_count,
      companyCount: r.company_count,
      companies:    (() => { try { return JSON.parse(r.companies || "[]"); } catch { return []; } })(),
      timestamp:    r.visited_at,
    }));

    return res.json({ entries, total: entries.length, offset });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/score-history ───────────────────────────────────
async function addEntry(req, res, next) {
  try {
    const e = sanitizeEntry(req.body || {});
    if (!e.url) return res.status(400).json({ error: "url is required" });

    // Deduplicate: skip if same URL was saved within the last 5 minutes
    const [recent] = await db.query(
      `SELECT id FROM score_history
       WHERE  user_id = ? AND url = ?
         AND  visited_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
       LIMIT  1`,
      [req.user.id, e.url]
    );
    if (recent.length > 0) return res.json({ ok: true, duplicate: true });

    await db.query(
      `INSERT INTO score_history
         (user_id, url, domain, score, is_https, cookie_count, script_count,
          company_count, companies, visited_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, e.url, e.domain, e.score, e.is_https,
       e.cookie_count, e.script_count, e.company_count, e.companies, e.visited_at]
    );

    // Enforce per-user cap: drop oldest rows beyond MAX_HISTORY
    await db.query(
      `DELETE FROM score_history
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id FROM (
             SELECT id FROM score_history
             WHERE user_id = ?
             ORDER BY visited_at DESC
             LIMIT ?
           ) sub
         )`,
      [req.user.id, req.user.id, MAX_HISTORY]
    );

    console.log(`[score-history] saved entry for ${req.user.email}: ${e.domain} → ${e.score}`);
    return res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/score-history/bulk ─────────────────────────────
// Called once on first login to push locally-stored history to the server.
async function bulkSync(req, res, next) {
  try {
    const raw = req.body?.entries;
    if (!Array.isArray(raw) || raw.length === 0)
      return res.status(400).json({ error: "entries array is required" });

    const entries = raw.slice(0, 200).map(sanitizeEntry).filter(e => e.url);

    // Build multi-row INSERT … ON DUPLICATE KEY UPDATE (no-op) to avoid dupes.
    // We use INSERT IGNORE keyed on (user_id, url, visited_at) to skip exact
    // duplicates — no UNIQUE constraint needed since clock skew can vary.
    if (entries.length > 0) {
      const placeholders = entries.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",");
      const values = entries.flatMap(e => [
        req.user.id, e.url, e.domain, e.score, e.is_https,
        e.cookie_count, e.script_count, e.company_count, e.companies, e.visited_at
      ]);
      await db.query(
        `INSERT IGNORE INTO score_history
           (user_id, url, domain, score, is_https, cookie_count, script_count,
            company_count, companies, visited_at)
         VALUES ${placeholders}`,
        values
      );
    }

    // Trim to cap after bulk insert
    await db.query(
      `DELETE FROM score_history
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id FROM (
             SELECT id FROM score_history
             WHERE user_id = ?
             ORDER BY visited_at DESC
             LIMIT ?
           ) sub
         )`,
      [req.user.id, req.user.id, MAX_HISTORY]
    );

    console.log(`[score-history] bulk sync for ${req.user.email}: ${entries.length} entries`);
    return res.json({ ok: true, synced: entries.length });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/score-history ─────────────────────────────────
async function clearHistory(req, res, next) {
  try {
    await db.query("DELETE FROM score_history WHERE user_id = ?", [req.user.id]);
    console.log(`[score-history] cleared for ${req.user.email}`);
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHistory, addEntry, bulkSync, clearHistory };
