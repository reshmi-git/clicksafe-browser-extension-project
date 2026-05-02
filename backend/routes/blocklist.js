// ============================================================
//  ClickSafe — routes/blocklist.js
//
//  GET /api/blocklist  — serves the tracker domain list to the
//                        extension so updates don't require a reinstall.
// ============================================================

const express = require("express");
const router  = express.Router();
const { getBlocklist } = require("../controllers/blocklistController");

router.get("/", getBlocklist);

module.exports = router;
