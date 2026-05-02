// ============================================================
//  ClickSafe — routes/auth.js
//
//  Public:    POST /api/auth/register
//             POST /api/auth/login
//  Protected: GET  /api/auth/me
//             POST /api/auth/logout
//             POST /api/auth/change-password
//             DELETE /api/auth/account
// ============================================================

const express    = require("express");
const router     = express.Router();
const requireAuth = require("../middleware/auth");
const {
  register,
  login,
  me,
  logout,
  changePassword,
  deleteAccount,
} = require("../controllers/authController");

// Public
router.post("/register",        register);
router.post("/login",           login);

// Protected
router.get ("/me",              requireAuth, me);
router.post("/logout",          requireAuth, logout);
router.post("/change-password", requireAuth, changePassword);
router.delete("/account",       requireAuth, deleteAccount);

module.exports = router;
