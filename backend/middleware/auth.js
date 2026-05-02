// ============================================================
//  ClickSafe — middleware/auth.js
//  Verifies JWT Bearer token on protected routes
// ============================================================

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("[ClickSafe] FATAL: JWT_SECRET environment variable is not set.");
  console.error("[ClickSafe] Set it in your Render dashboard (Dashboard → Environment → Add Variable).");
  process.exit(1);
}

module.exports = function requireAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
