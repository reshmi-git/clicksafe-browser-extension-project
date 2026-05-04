// ============================================================
//  ClickSafe — middleware/cors.js
// ============================================================

const VERCEL_ORIGIN_RE = /^https:\/\/clicksafe[\w-]*\.vercel\.app$/;

const ALLOWED_ORIGINS = new Set([
  'https://clicksafe-browser-extension-project.vercel.app',
]);

module.exports = function (req, res, next) {
  // /api/health is a public status endpoint — no Origin restriction.
  // The extension sidepanel fetches it directly (no chrome-extension Origin
  // header in that context), so blocking it causes the OFFLINE badge even
  // when the backend is perfectly healthy.
  if (req.path === '/api/health') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return next();
  }

  const origin = req.headers.origin;

  const allowed =
    origin && (
      origin.startsWith('chrome-extension://') ||
      origin.startsWith('moz-extension://')    ||
      /^http:\/\/localhost(:\d+)?$/.test(origin) ||
      VERCEL_ORIGIN_RE.test(origin)              ||
      ALLOWED_ORIGINS.has(origin)
    );

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin',  origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age',       '86400');
  }

  if (req.method === 'OPTIONS') {
    return allowed ? res.sendStatus(204) : res.sendStatus(403);
  }

  if (!allowed) {
    return res.status(403).json({
      error: 'Forbidden: requests must come from the ClickSafe extension or landing page'
    });
  }

  next();
};