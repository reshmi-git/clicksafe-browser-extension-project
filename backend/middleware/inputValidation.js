// ============================================================
//  ClickSafe — middleware/inputValidation.js
//
//  Shared input validation constants and helpers used by
//  linkController, downloadController, and any future routes.
//
//  Keeps URL length limits and sanitization rules in one place
//  so they can't drift out of sync between controllers.
// ============================================================

// ── Constants ────────────────────────────────────────────────

/**
 * Maximum allowed URL length (characters).
 * RFC 7230 has no hard limit, but 2048 is a safe practical ceiling
 * — IE had a 2083-char limit and many servers cap at 8KB.
 * Google Safe Browsing also rejects URLs over 2048 chars.
 */
const MAX_URL_LENGTH = 2048;

/**
 * Maximum allowed filename length (bytes).
 * Most POSIX filesystems cap filenames at 255 bytes.
 */
const MAX_FILENAME_LENGTH = 255;

/**
 * Allowed URL schemes.  Data URIs, javascript:, and file: URIs
 * are never safe to forward to an external API.
 */
const ALLOWED_SCHEMES = ["http:", "https:"];

/**
 * Regex for safe filenames — printable ASCII, no path separators
 * or Windows-reserved characters.
 */
const SAFE_FILENAME_RE = /^[^/\\:*?"<>|]+$/;

// ── Validators ───────────────────────────────────────────────

/**
 * Validate and parse a URL string.
 * Returns { ok: true, parsed } on success.
 * Returns { ok: false, status, error } on failure so callers can
 * immediately respond with the right HTTP status code.
 *
 * @param {string} url
 * @returns {{ ok: boolean, parsed?: URL, status?: number, error?: string }}
 */
function validateUrl(url) {
  if (!url || typeof url !== "string") {
    return { ok: false, status: 400, error: "URL is required" };
  }

  const trimmed = url.trim();

  if (trimmed.length === 0) {
    return { ok: false, status: 400, error: "URL must not be empty" };
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `URL exceeds maximum allowed length of ${MAX_URL_LENGTH} characters`
    };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, status: 400, error: "Invalid URL format" };
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return {
      ok: false,
      status: 400,
      error: `URL scheme '${parsed.protocol}' is not permitted. Only http and https are allowed.`
    };
  }

  // Reject localhost / 127.x / private-range IPs to prevent SSRF
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host) ||
    /^169\.254\.\d+\.\d+$/.test(host)   // link-local (AWS metadata: 169.254.169.254)
  ) {
    return { ok: false, status: 400, error: "Private or loopback URLs are not permitted" };
  }

  return { ok: true, parsed, url: trimmed };
}

/**
 * Validate a filename string.
 * Returns { ok: true, filename } on success (or null if the input was absent).
 * Returns { ok: false, status, error } on failure.
 *
 * @param {string|undefined|null} filename
 * @returns {{ ok: boolean, filename?: string|null, status?: number, error?: string }}
 */
function validateFilename(filename) {
  if (filename === undefined || filename === null) {
    return { ok: true, filename: null };
  }

  if (typeof filename !== "string") {
    return { ok: false, status: 400, error: "Filename must be a string" };
  }

  const trimmed = filename.trim();

  if (trimmed.length === 0) {
    return { ok: true, filename: null }; // treat empty string same as absent
  }

  if (trimmed.length > MAX_FILENAME_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Filename exceeds maximum allowed length of ${MAX_FILENAME_LENGTH} characters`
    };
  }

  if (!SAFE_FILENAME_RE.test(trimmed)) {
    return {
      ok: false,
      status: 400,
      error: "Filename contains invalid characters"
    };
  }

  // Reject path traversal sequences
  if (trimmed.includes("..")) {
    return { ok: false, status: 400, error: "Filename must not contain path traversal sequences" };
  }

  return { ok: true, filename: trimmed };
}

module.exports = {
  MAX_URL_LENGTH,
  MAX_FILENAME_LENGTH,
  ALLOWED_SCHEMES,
  validateUrl,
  validateFilename
};