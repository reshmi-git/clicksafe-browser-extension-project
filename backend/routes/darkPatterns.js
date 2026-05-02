// ============================================================
//  ClickSafe — routes/darkPatterns.js
//
//  POST /api/dark-patterns/dismiss  — log a dismissal (no auth required,
//                                     but token is read if present)
//  GET  /api/dark-patterns/stats    — top false-positive domains
// ============================================================

const express    = require("express");
const router     = express.Router();
const jwt        = require("jsonwebtoken");
const { logDismissal, getStats } = require("../controllers/darkPatternController");

const JWT_SECRET = process.env.JWT_SECRET || "";

// Soft-auth: attach req.user if a valid token is present, but don't block
// the request if there's no token or the token is invalid.
function softAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch (_) { /* ignored */ }
  }
  next();
}

router.post("/dismiss", softAuth, logDismissal);
router.get ("/stats",   getStats);

module.exports = router;
