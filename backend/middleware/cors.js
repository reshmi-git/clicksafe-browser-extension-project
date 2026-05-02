// ============================================================
//  ClickSafe — middleware/cors.js
//  Allows requests from Chrome/Edge/Firefox extensions and
//  localhost (for auth endpoints and local development).
//
//  Note: /api/health is registered BEFORE this middleware in
//  server.js so Render's health probe is never blocked here.
// ============================================================

module.exports = function (req, res, next) {
  const origin = req.headers.origin;

  // Allow extension origins and localhost (auth / dev)
  const allowed =
    origin &&
    (origin.startsWith("chrome-extension://") ||
      origin.startsWith("moz-extension://") ||
      /^http:\/\/localhost(:\d+)?$/.test(origin));

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return allowed ? res.sendStatus(204) : res.sendStatus(403);
  }

  if (!allowed) {
    return res.status(403).json({ error: "Forbidden: requests must come from the ClickSafe extension" });
  }

  next();
};
