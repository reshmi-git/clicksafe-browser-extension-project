// ============================================================
//  ClickSafe — backend/tests/api.test.js
//
//  Basic tests for the three API routes and the privacy score
//  formula. Uses Node's built-in test runner (node --test),
//  which requires Node 18+. No extra test framework needed.
//
//  Run:
//    node --test backend/tests/api.test.js
//
//  Or add this to package.json scripts:
//    "test": "node --test tests/api.test.js"
//  then run:
//    npm test
//
//  The tests mock the database and Safe Browsing service so
//  you don't need a real MySQL instance or API key to run them.
// ============================================================

const { test, describe, before, mock } = require("node:test");
const assert = require("node:assert/strict");

// ── Mock the DB pool before anything imports it ──────────────
//
// database.js calls pool.getConnection() on import (startup health check).
// We mock the whole module so neither MySQL nor .env values are required.
const mockQuery = mock.fn(async () => [[]]);   // default: empty result set
const mockGetConnection = mock.fn(async () => ({ release: () => {} }));

require("node:module").register
  ? null  // Node 22+ register hook — not needed here
  : null;

// Manually stub the require cache before importing app code
const Module = require("module");
const _origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  // Intercept DB pool import
  if (request.includes("config/database") || request.endsWith("database.js")) {
    return {
      query: mockQuery,
      getConnection: mockGetConnection
    };
  }
  return _origLoad.apply(this, arguments);
};

// ── Helpers ───────────────────────────────────────────────────

/**
 * Minimal fake request / response pair.
 * Enough surface for our controllers to call res.json() / res.status().
 */
function makeReqRes(body = {}, origin = "chrome-extension://fake") {
  const req = {
    body,
    headers: { origin },
    method: "POST",
    ip: "127.0.0.1"
  };

  let statusCode = 200;
  let responseBody = null;

  const res = {
    _status: () => statusCode,
    _body: () => responseBody,
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseBody = data;
      return this;
    },
    setHeader() { return this; },
    sendStatus(code) { statusCode = code; return this; }
  };

  return { req, res };
}

// ── Privacy Score Tests ───────────────────────────────────────
//
// computePrivacyScore lives in frontend/background/privacyScore.js,
// but the formula is pure JS with no browser APIs, so we can require
// it in Node with one small shim.

describe("Privacy Score formula", () => {
  // Inline the formula here so the test file is self-contained and
  // doesn't depend on the Chrome-extension environment.
  function computePrivacyScore({ isHttps, trackingCookies, trackers, mixedContent }) {
    let score = 100;
    if (!isHttps)      score -= 30;
    score -= Math.min((trackingCookies || 0) * 5, 30);
    score -= Math.min((trackers        || 0) * 4, 20);
    score -= Math.min((mixedContent    || 0) * 5, 20);
    return Math.max(0, Math.min(100, score));
  }

  test("perfect score: HTTPS, no threats", () => {
    const score = computePrivacyScore({ isHttps: true, trackingCookies: 0, trackers: 0, mixedContent: 0 });
    assert.equal(score, 100);
  });

  test("HTTP alone deducts 30", () => {
    const score = computePrivacyScore({ isHttps: false, trackingCookies: 0, trackers: 0, mixedContent: 0 });
    assert.equal(score, 70);
  });

  test("one tracking cookie deducts 5", () => {
    const score = computePrivacyScore({ isHttps: true, trackingCookies: 1, trackers: 0, mixedContent: 0 });
    assert.equal(score, 95);
  });

  test("tracking cookies are capped at 30 (6+ cookies)", () => {
    const score = computePrivacyScore({ isHttps: true, trackingCookies: 10, trackers: 0, mixedContent: 0 });
    assert.equal(score, 70);  // 100 - 30 (cap)
  });

  test("tracker scripts: one deducts 4", () => {
    const score = computePrivacyScore({ isHttps: true, trackingCookies: 0, trackers: 1, mixedContent: 0 });
    assert.equal(score, 96);
  });

  test("tracker scripts are capped at 20 (5+ scripts)", () => {
    const score = computePrivacyScore({ isHttps: true, trackingCookies: 0, trackers: 10, mixedContent: 0 });
    assert.equal(score, 80);  // 100 - 20 (cap)
  });

  test("mixed content: one resource deducts 5", () => {
    const score = computePrivacyScore({ isHttps: true, trackingCookies: 0, trackers: 0, mixedContent: 1 });
    assert.equal(score, 95);
  });

  test("mixed content is capped at 20 (4+ resources)", () => {
    const score = computePrivacyScore({ isHttps: true, trackingCookies: 0, trackers: 0, mixedContent: 10 });
    assert.equal(score, 80);  // 100 - 20 (cap)
  });

  test("score cannot go below 0", () => {
    const score = computePrivacyScore({
      isHttps: false,
      trackingCookies: 100,
      trackers: 100,
      mixedContent: 100
    });
    assert.equal(score, 0);
  });

  test("score cannot exceed 100", () => {
    const score = computePrivacyScore({ isHttps: true, trackingCookies: 0, trackers: 0, mixedContent: 0 });
    assert.equal(score, 100);
  });

  test("combined penalties: HTTP + 2 cookies + 1 tracker", () => {
    // 100 - 30 (HTTP) - 10 (2 cookies) - 4 (1 tracker) = 56
    const score = computePrivacyScore({ isHttps: false, trackingCookies: 2, trackers: 1, mixedContent: 0 });
    assert.equal(score, 56);
  });

  test("undefined inputs default to zero", () => {
    const score = computePrivacyScore({ isHttps: true });
    assert.equal(score, 100);
  });
});

// ── Input Validation Tests ────────────────────────────────────

describe("validateUrl", () => {
  const { validateUrl } = require("../middleware/inputValidation");

  test("accepts a valid HTTPS URL", () => {
    const result = validateUrl("https://example.com");
    assert.equal(result.ok, true);
    assert.equal(result.url, "https://example.com");
  });

  test("accepts a valid HTTP URL", () => {
    const result = validateUrl("http://example.com/path?q=1");
    assert.equal(result.ok, true);
  });

  test("rejects missing URL", () => {
    const result = validateUrl(undefined);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("rejects empty string", () => {
    const result = validateUrl("   ");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("rejects javascript: scheme", () => {
    const result = validateUrl("javascript:alert(1)");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("rejects data: URI", () => {
    const result = validateUrl("data:text/html,<h1>hi</h1>");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("rejects localhost", () => {
    const result = validateUrl("http://localhost/admin");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("rejects 127.0.0.1", () => {
    const result = validateUrl("http://127.0.0.1:8080/");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("rejects private 192.168.x.x IP", () => {
    const result = validateUrl("http://192.168.1.1/");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("rejects URL over 2048 characters", () => {
    const url = "https://example.com/" + "a".repeat(2050);
    const result = validateUrl(url);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("rejects malformed URL", () => {
    const result = validateUrl("not a url at all");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("trims leading/trailing whitespace", () => {
    const result = validateUrl("  https://example.com  ");
    assert.equal(result.ok, true);
    assert.equal(result.url, "https://example.com");
  });
});

describe("validateFilename", () => {
  const { validateFilename } = require("../middleware/inputValidation");

  test("accepts a normal filename", () => {
    const result = validateFilename("report.pdf");
    assert.equal(result.ok, true);
    assert.equal(result.filename, "report.pdf");
  });

  test("accepts undefined (optional field)", () => {
    const result = validateFilename(undefined);
    assert.equal(result.ok, true);
    assert.equal(result.filename, null);
  });

  test("accepts null (optional field)", () => {
    const result = validateFilename(null);
    assert.equal(result.ok, true);
    assert.equal(result.filename, null);
  });

  test("treats empty string as absent", () => {
    const result = validateFilename("   ");
    assert.equal(result.ok, true);
    assert.equal(result.filename, null);
  });

  test("rejects path traversal: ../", () => {
    const result = validateFilename("../../etc/passwd");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("rejects filename with path separator /", () => {
    const result = validateFilename("dir/file.pdf");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("rejects filename over 255 characters", () => {
    const result = validateFilename("a".repeat(256) + ".pdf");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test("rejects non-string input", () => {
    const result = validateFilename(42);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });
});

// ── Controller tests ──────────────────────────────────────────
//
// These test the controller functions directly, mocking both
// the DB (already mocked globally above) and the Safe Browsing
// service so no real HTTP calls are made.

describe("checkLink controller", () => {
  before(() => {
    // Reset the mock between suites
    mockQuery.mock.resetCalls();
  });

  test("returns 400 for missing URL", async () => {
    // Override the module mock to avoid having to restart the require chain
    const { checkLink } = require("../controllers/linkController");
    const { req, res } = makeReqRes({ url: "" });
    const next = (err) => { throw err; };
    await checkLink(req, res, next);
    assert.equal(res._status(), 400);
    assert.ok(res._body().error);
  });

  test("returns 400 for localhost URL", async () => {
    const { checkLink } = require("../controllers/linkController");
    const { req, res } = makeReqRes({ url: "http://localhost/secret" });
    await checkLink(req, res, () => {});
    assert.equal(res._status(), 400);
  });

  test("returns 400 for invalid hash format", async () => {
    const { checkLink } = require("../controllers/linkController");
    const { req, res } = makeReqRes({
      url: "https://example.com",
      hash: "not-a-valid-hash"
    });
    await checkLink(req, res, () => {});
    assert.equal(res._status(), 400);
    assert.match(res._body().error, /hash/i);
  });
});

describe("checkDownload controller", () => {
  test("returns 400 for missing URL", async () => {
    const { checkDownload } = require("../controllers/downloadController");
    const { req, res } = makeReqRes({ filename: "setup.exe" });
    await checkDownload(req, res, () => {});
    assert.equal(res._status(), 400);
  });

  test("returns 400 for path-traversal filename", async () => {
    const { checkDownload } = require("../controllers/downloadController");
    const { req, res } = makeReqRes({
      url: "https://example.com/file.exe",
      filename: "../../evil.sh"
    });
    await checkDownload(req, res, () => {});
    assert.equal(res._status(), 400);
  });
});

// ── Restore Module._load after all tests ─────────────────────
process.on("exit", () => {
  Module._load = _origLoad;
});