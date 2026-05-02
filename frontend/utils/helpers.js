// ============================================================
//  ClickSafe — utils/helpers.js
//  Shared utility functions used across the extension
// ============================================================

// ── Privacy score penalty weights & caps ─────────────────────
// Named here so tuning (e.g. from false-positive data) is a
// single-line change rather than a grep-and-replace across files.
//
// | Signal           | Per-unit | Cap | Rationale                                      |
// |------------------|----------|-----|------------------------------------------------|
// | No HTTPS         | −30 flat | —   | Binary condition; exposes all traffic.         |
// |                  |          |     | A clean HTTP site should not score above 70.   |
// | Tracking cookies | −5       | 30  | Persistent, identity-linked. 1 is already      |
// |                  |          |     | meaningful. Cap at 6 — beyond that the harm    |
// |                  |          |     | plateaus; you're fully tracked regardless.     |
// | Tracker scripts  | −4       | 20  | Session-scoped, easier to block. Less severe   |
// |                  |          |     | per unit than cookies. Cap at 5 scripts.       |
// | Mixed content    | −5       | 20  | Each leaks HTTPS session to HTTP endpoint.     |
// |                  |          |     | Rarer than trackers; cap at 4 resources.       |
const SCORE_PENALTY_NO_HTTPS      = 30;
const SCORE_PENALTY_PER_COOKIE    = 5;
const SCORE_CAP_COOKIES           = 30;
const SCORE_PENALTY_PER_TRACKER   = 4;
const SCORE_CAP_TRACKERS          = 20;
const SCORE_PENALTY_PER_MIXED     = 5;
const SCORE_CAP_MIXED             = 20;

/**
 * Compute the privacy score for a page. This is the SINGLE SOURCE OF TRUTH
 * for the formula. background/privacyScore.js, pages/dashboard/dashboard.js,
 * and sidepanel/sidepanel.js all import this file and call this function
 * directly — do NOT copy the formula elsewhere.
 *
 * Formula: start at 100, deduct penalties, clamp to 0–100.
 *
 * @param {{ isHttps: boolean, trackingCookies: number, trackers: number, mixedContent: number }} opts
 * @returns {number} Integer in [0, 100]
 */
function computePrivacyScore({ isHttps, trackingCookies, trackers, mixedContent }) {
  let score = 100;
  if (!isHttps) score -= SCORE_PENALTY_NO_HTTPS;
  score -= Math.min((trackingCookies || 0) * SCORE_PENALTY_PER_COOKIE,  SCORE_CAP_COOKIES);
  score -= Math.min((trackers        || 0) * SCORE_PENALTY_PER_TRACKER, SCORE_CAP_TRACKERS);
  score -= Math.min((mixedContent    || 0) * SCORE_PENALTY_PER_MIXED,   SCORE_CAP_MIXED);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Truncates a URL for display, keeping the hostname visible.
 * @param {string} url
 * @param {number} maxLength
 * @returns {string}
 */
function truncateUrl(url, maxLength = 60) {
  if (!url) return "";
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + "…";
}

/**
 * Returns a human-readable label for a threat type string
 * returned by the Google Safe Browsing API.
 * @param {string} threatType
 * @returns {string}
 */
function formatThreatType(threatType) {
  const labels = {
    MALWARE: "Malware",
    SOCIAL_ENGINEERING: "Phishing / Social Engineering",
    UNWANTED_SOFTWARE: "Unwanted Software",
    POTENTIALLY_HARMFUL_APPLICATION: "Potentially Harmful App",
    API_UNAVAILABLE: "API Unavailable",
    CONFIG_ERROR: "Configuration Error"
  };
  return labels[threatType] || threatType || "Unknown Threat";
}

/**
 * Returns true if a hostname matches a whitelist entry.
 * Supports exact match and subdomain match (e.g. "example.com" matches "sub.example.com").
 * @param {string} hostname
 * @param {string[]} whitelist
 * @returns {boolean}
 */
function isWhitelisted(hostname, whitelist = []) {
  return whitelist.some(entry => hostname === entry || hostname.endsWith("." + entry));
}

/**
 * Formats a timestamp ISO string into a short human-readable time.
 * @param {string} isoString
 * @returns {string}
 */
function formatTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
