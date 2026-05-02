// ============================================================
//  ClickSafe — routes/whitelist.js
//
//  All routes require a valid JWT (requireAuth).
//
//  GET    /api/whitelist           — fetch user's domains
//  POST   /api/whitelist           — add one domain
//  DELETE /api/whitelist/:domain   — remove one domain
//  PUT    /api/whitelist           — bulk-sync full list
// ============================================================

const express      = require("express");
const router       = express.Router();
const requireAuth  = require("../middleware/auth");
const {
  getWhitelist,
  addDomain,
  removeDomain,
  syncWhitelist,
} = require("../controllers/whitelistController");

router.get   ("/",        requireAuth, getWhitelist);
router.post  ("/",        requireAuth, addDomain);
router.delete("/:domain", requireAuth, removeDomain);
router.put   ("/",        requireAuth, syncWhitelist);

module.exports = router;
