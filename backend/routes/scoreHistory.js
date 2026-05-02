// ============================================================
//  ClickSafe — routes/scoreHistory.js
//
//  All routes require a valid JWT (requireAuth).
//
//  GET    /api/score-history        — fetch history (newest first)
//  POST   /api/score-history        — append one entry
//  POST   /api/score-history/bulk   — bulk-sync local history on login
//  DELETE /api/score-history        — clear all history
// ============================================================

const express     = require("express");
const router      = express.Router();
const requireAuth = require("../middleware/auth");
const {
  getHistory,
  addEntry,
  bulkSync,
  clearHistory,
} = require("../controllers/scoreHistoryController");

router.get   ("/",     requireAuth, getHistory);
router.post  ("/",     requireAuth, addEntry);
router.post  ("/bulk", requireAuth, bulkSync);
router.delete("/",     requireAuth, clearHistory);

module.exports = router;
