// ============================================================
//  ClickSafe — controllers/whitelistController.js
//
//  Manages per-user trusted-domain whitelists stored in MySQL.
//  All routes are protected by requireAuth middleware —
//  req.user.id is the authenticated user's UUID.
//
//  Endpoints (mounted at /api/whitelist):
//    GET    /           — fetch all domains for the user
//    POST   /           — add a domain  { domain }
//    DELETE /:domain    — remove a domain
//    PUT    /           — bulk-replace (sync full list from extension)
// ============================================================

const db = require("../config/database");

// ── Domain validation ─────────────────────────────────────────
const MAX_DOMAIN_LENGTH = 253;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function sanitizeDomain(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

function isValidDomain(domain) {
  if (!domain || domain.length > MAX_DOMAIN_LENGTH) return false;
  if (!DOMAIN_RE.test(domain)) return false;
  if (domain.split(".").some(label => label.length > 63)) return false;
  return true;
}

// ── GET /api/whitelist ────────────────────────────────────────
// Returns { domains: string[] } for the authenticated user.
async function getWhitelist(req, res, next) {
  try {
    const [rows] = await db.query(
      `SELECT domain FROM user_whitelists
        WHERE user_id = ?
        ORDER BY created_at ASC`,
      [req.user.id]
    );
    return res.json({ domains: rows.map(r => r.domain) });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/whitelist ───────────────────────────────────────
// Body: { domain: string }
// Adds a single domain. Idempotent (duplicate = 200, not 409).
async function addDomain(req, res, next) {
  try {
    const domain = sanitizeDomain(req.body?.domain);

    if (!isValidDomain(domain)) {
      return res.status(400).json({ error: "Invalid domain. Use the format: example.com" });
    }

    await db.query(
      `INSERT IGNORE INTO user_whitelists (user_id, domain)
       VALUES (?, ?)`,
      [req.user.id, domain]
    );

    return res.status(201).json({ domain });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/whitelist/:domain ─────────────────────────────
// Removes a single domain for the authenticated user.
async function removeDomain(req, res, next) {
  try {
    const domain = sanitizeDomain(req.params.domain);

    await db.query(
      `DELETE FROM user_whitelists
        WHERE user_id = ? AND domain = ?`,
      [req.user.id, domain]
    );

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ── PUT /api/whitelist ────────────────────────────────────────
// Body: { domains: string[] }
// Full sync — replaces the user's entire whitelist in one transaction.
// Called by the extension on settings save when logged in.
async function syncWhitelist(req, res, next) {
  const conn = await db.getConnection();
  try {
    const rawDomains = Array.isArray(req.body?.domains) ? req.body.domains : [];
    const domains = rawDomains
      .map(sanitizeDomain)
      .filter(isValidDomain)
      // Deduplicate
      .filter((d, i, arr) => arr.indexOf(d) === i);

    await conn.beginTransaction();

    // Delete all existing entries for this user
    await conn.query(
      `DELETE FROM user_whitelists WHERE user_id = ?`,
      [req.user.id]
    );

    // Bulk-insert the new list (if non-empty)
    if (domains.length > 0) {
      const values = domains.map(d => [req.user.id, d]);
      await conn.query(
        `INSERT INTO user_whitelists (user_id, domain) VALUES ?`,
        [values]
      );
    }

    await conn.commit();
    return res.json({ domains });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = { getWhitelist, addDomain, removeDomain, syncWhitelist };
