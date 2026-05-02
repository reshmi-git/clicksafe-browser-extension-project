// ============================================================
//  ClickSafe — controllers/authController.js
//
//  Handles user authentication: register, login, me,
//  logout, change-password, and account deletion.
//
//  Storage: MySQL via the shared db pool in config/database.js.
//  Tokens:  JWT, 30-day expiry, signed with JWT_SECRET.
// ============================================================

const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const crypto = require("crypto");
const db     = require("../config/database");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("[ClickSafe] FATAL: JWT_SECRET environment variable is not set.");
  console.error("[ClickSafe] Set it in your Render dashboard (Dashboard → Environment → Add Variable).");
  process.exit(1);
}
const JWT_EXPIRES_IN = "30d";
const SALT_ROUNDS    = 10;

// ── Helpers ───────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateEmail(e)    { return EMAIL_RE.test((e || "").trim()); }
function validatePassword(p) { return typeof p === "string" && p.length >= 8; }

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

// ── POST /api/auth/register ───────────────────────────────────
async function register(req, res, next) {
  try {
    const { email: rawEmail, password } = req.body || {};
    const email = (rawEmail || "").trim().toLowerCase();

    if (!validateEmail(email))
      return res.status(400).json({ error: "Invalid email address" });
    if (!validatePassword(password))
      return res.status(400).json({ error: "Password must be at least 8 characters" });

    // Check for existing account
    const [existing] = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    if (existing.length > 0)
      return res.status(409).json({ error: "An account with this email already exists" });

    const id           = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const createdAt    = new Date().toISOString().slice(0, 19).replace("T", " ");

    await db.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      [id, email, passwordHash, createdAt]
    );

    const token = signToken({ id, email });
    console.log(`[auth] registered: ${email}`);
    return res.status(201).json({ token, user: { id, email } });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/login ──────────────────────────────────────
async function login(req, res, next) {
  try {
    const { email: rawEmail, password } = req.body || {};
    const email = (rawEmail || "").trim().toLowerCase();

    const [rows] = await db.query(
      "SELECT id, email, password_hash FROM users WHERE email = ?",
      [email]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken({ id: user.id, email: user.email });
    console.log(`[auth] login: ${email}`);
    return res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/auth/me ──────────────────────────────────────────
async function me(req, res, next) {
  try {
    const [rows] = await db.query(
      "SELECT id, email, created_at FROM users WHERE id = ?",
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "Account not found" });
    return res.json({ user: { id: user.id, email: user.email, createdAt: user.created_at } });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/logout ─────────────────────────────────────
// Stateless JWTs — client drops the token. Endpoint exists for
// UX symmetry and future token-blocklist support.
function logout(req, res) {
  console.log(`[auth] logout: ${req.user.email}`);
  return res.json({ ok: true });
}

// ── POST /api/auth/change-password ───────────────────────────
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};

    const [rows] = await db.query(
      "SELECT id, password_hash FROM users WHERE id = ?",
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "Account not found" });

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });
    if (!validatePassword(newPassword))
      return res.status(400).json({ error: "New password must be at least 8 characters" });

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.query(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      [newHash, user.id]
    );
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/auth/account ──────────────────────────────────
async function deleteAccount(req, res, next) {
  try {
    const { password } = req.body || {};

    const [rows] = await db.query(
      "SELECT id, password_hash FROM users WHERE id = ?",
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "Account not found" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Incorrect password" });

    // Delete user and cascade to their whitelists
    await db.query("DELETE FROM user_whitelists WHERE user_id = ?", [user.id]);
    await db.query("DELETE FROM users WHERE id = ?", [user.id]);

    console.log(`[auth] deleted account: ${req.user.email}`);
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, me, logout, changePassword, deleteAccount };
