// dotenv MUST be configured before any other require() that reads process.env
require("dotenv").config();
process.on('uncaughtException', err => {
  console.error('[ClickSafe] CRASH:', err.message);
  console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  console.error('[ClickSafe] UNHANDLED REJECTION:', reason);
  process.exit(1);
});

const express = require("express");
const path    = require("path");
const cors    = require("./middleware/cors");
const rateLimiter        = require("./middleware/rateLimiter");
const errorHandler       = require("./middleware/errorHandler");
const checkLinkRoute     = require("./routes/checkLink");
const checkDownloadRoute = require("./routes/checkDownload");
const sbUpdateRoute      = require("./routes/sbUpdate");
const authRoute            = require("./routes/auth");
const whitelistRoute       = require("./routes/whitelist");
const scoreHistoryRoute    = require("./routes/scoreHistory");
const darkPatternsRoute    = require("./routes/darkPatterns");
const trackersRoute        = require("./routes/trackers");
const blocklistRoute       = require("./routes/blocklist");

const app = express();

app.use(express.json());

// ── Health check ─────────────────────────────────────────────
// Registered BEFORE the cors middleware so Render's own health-check
// probe (which sends no Origin header) is never blocked, and so the
// sidepanel's status indicator gets a real response too.
app.get("/api/health", (req, res) => {
  res.json({
    status:    "ok",
    apiKeySet: Boolean(process.env.GOOGLE_SAFE_BROWSING_API_KEY),
    timestamp: Date.now(),
  });
});

app.use(cors);
app.use(rateLimiter);

// ── API routes ──────────────────────────────────────────────
app.use("/api", checkLinkRoute);
app.use("/api", checkDownloadRoute);
app.use("/api", sbUpdateRoute);
app.use("/api/auth",          authRoute);
app.use("/api/whitelist",     whitelistRoute);
app.use("/api/score-history", scoreHistoryRoute);
app.use("/api/dark-patterns", darkPatternsRoute);
app.use("/api/trackers",      trackersRoute);
app.use("/api/blocklist",     blocklistRoute);

// ── Landing page (static files) ─────────────────────────────
const landingPath = path.join(__dirname, "..", "landing-page");
app.use(express.static(landingPath));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(landingPath, "index.html"));
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[ClickSafe] Server running on port ${PORT}`);
  console.log(`[ClickSafe] Landing page → http://localhost:${PORT}/`);
  console.log(`[ClickSafe] API          → http://localhost:${PORT}/api/`);
});
