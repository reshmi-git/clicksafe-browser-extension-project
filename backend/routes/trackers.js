// ============================================================
//  ClickSafe — routes/trackers.js
//
//  POST /api/trackers/log          — log tracker hits (soft-auth)
//  GET  /api/trackers/top          — top trackers, all users
//  GET  /api/trackers/my-history   — per-user history (auth required)
// ============================================================

const express     = require("express");
const router      = express.Router();
const jwt         = require("jsonwebtoken");
const requireAuth = require("../middleware/auth");
const { logEncounters, getTopTrackers, getMyHistory } = require("../controllers/trackerEncounterController");

const JWT_SECRET = process.env.JWT_SECRET || "";

// Soft-auth: attach req.user if token is present and valid, but never block.
function softAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch (_) {}
  }
  next();
}

router.post("/log",        softAuth,    logEncounters);
router.get ("/top",                     getTopTrackers);
router.get ("/my-history", requireAuth, getMyHistory);

module.exports = router;
