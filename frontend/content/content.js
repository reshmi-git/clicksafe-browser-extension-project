// ============================================================
//  ClickSafe — content.js
//  Injected into every web page.
//  Handles: HTTPS Monitor, Tracker Detection (blocklist-based),
//           Link Hover Preview (debounced), Dark Pattern Detector,

// ── Extension context guard ───────────────────────────────────
// After an extension reload/update the old content script is still
// alive on existing tabs but chrome.runtime is invalidated.
// All chrome.runtime calls must go through this wrapper.
function isContextValid() {
  try { return !!chrome.runtime?.id; } catch { return false; }
}
function safeSendMessage(msg, cb) {
  if (!isContextValid()) return;
  try {
    chrome.runtime.sendMessage(msg, function(response) {
      if (chrome.runtime.lastError) return; // suppress "context invalidated" etc.
      if (cb) cb(response);
    });
  } catch { /* extension was reloaded — silently swallow */ }
}
//           Real-Time Privacy Banner
// ============================================================

// ============================================================
//  FEATURE 1: HTTPS MONITOR
//  Scans the current page for HTTP resources loaded on HTTPS pages
//  (mixed content detection)
// ============================================================

function scanForMixedContent() {
  if (!window.location.href.startsWith("https://")) return;

  const mixedResources = [];

  // Check all images loading over HTTP
  document.querySelectorAll("img[src^='http://']").forEach(el => {
    mixedResources.push({ type: "image", url: el.src });
  });

  // Check all scripts loading over HTTP
  document.querySelectorAll("script[src^='http://']").forEach(el => {
    mixedResources.push({ type: "script", url: el.src });
  });

  // Check all iframes loading over HTTP
  document.querySelectorAll("iframe[src^='http://']").forEach(el => {
    mixedResources.push({ type: "iframe", url: el.src });
  });

  // Check all stylesheets loading over HTTP
  document.querySelectorAll("link[rel='stylesheet'][href^='http://']").forEach(el => {
    mixedResources.push({ type: "stylesheet", url: el.href });
  });

  if (mixedResources.length > 0) {
    console.log(`[ClickSafe] [WARN] Mixed content found: ${mixedResources.length} HTTP resource(s) on HTTPS page`);
    console.table(mixedResources);

    safeSendMessage({
      type: "MIXED_CONTENT_DETECTED",
      data: {
        pageUrl: window.location.href,
        resources: mixedResources,
        timestamp: new Date().toISOString()
      }
    });
  } else {
    console.log("[ClickSafe] [OK] No mixed content detected on this page");
  }
}

// Run the scan once the page is fully loaded
// content.js runs at document_idle — DOM is ready, call directly
// Wrap in setTimeout(0) so any synchronous page scripts finish first
setTimeout(scanForMixedContent, 0);


// ============================================================
//  FEATURE 2: TRACKER DETECTOR
//  Checks script/resource src domains against the background's
//  loaded Disconnect.me blocklist (~70k entries).
//  No hardcoded list — asks background to do the lookup.
// ============================================================

// Batch all hostnames into ONE message instead of one sendMessage per element.
// Previously: 130 elements = 130 round-trips to the service worker per scan.
// Now: all hostnames sent in a single CHECK_TRACKERS message, background
// checks each against the blocklist and returns a Set of hits.
async function checkHostnames(hostnameUrlPairs) {
  if (!hostnameUrlPairs.length) return [];
  return new Promise(resolve => {
    const hostnames = hostnameUrlPairs.map(p => p.hostname);
    safeSendMessage({ type: "CHECK_TRACKERS", hostnames }, response => {
      if (chrome.runtime.lastError || !response?.trackers) { resolve([]); return; }
      const hitSet = new Set(response.trackers);
      resolve(hostnameUrlPairs.filter(p => hitSet.has(p.hostname)));
    });
  });
}

async function scanForTrackingScripts() {
  // Collect all candidate hostname+url pairs, deduped by hostname
  const seen = new Set();
  const candidates = [];
  const currentHost = window.location.hostname;

  const addEl = (src) => {
    if (!src) return;
    try {
      const hostname = new URL(src).hostname;
      if (hostname === currentHost) return;  // skip same-origin
      if (seen.has(hostname)) return;        // dedup — no point checking twice
      seen.add(hostname);
      candidates.push({ hostname, url: src });
    } catch (_) {}
  };

  document.querySelectorAll("script[src]").forEach(el => addEl(el.src));
  document.querySelectorAll("img[src]").forEach(el => addEl(el.src));
  document.querySelectorAll("iframe[src]").forEach(el => addEl(el.src));
  document.querySelectorAll("link[href]").forEach(el => addEl(el.href));

  // Single round-trip to the service worker for all hostnames
  const hits = await checkHostnames(candidates);
  const foundTrackers = hits.map(p => ({ tracker: p.hostname, url: p.url }));

  if (foundTrackers.length > 0) {
    console.log(`[ClickSafe] [COOKIE] Tracking scripts found: ${foundTrackers.length}`);
    console.table(foundTrackers);
    safeSendMessage({
      type: "TRACKERS_DETECTED",
      data: { pageUrl: window.location.href, trackers: foundTrackers, timestamp: new Date().toISOString() }
    });
  } else {
    console.log("[ClickSafe] [OK] No tracking scripts detected on this page");
  }
}

// Run tracker scan on page load
setTimeout(scanForTrackingScripts, 0);

// Re-scan only when a script/img/iframe/link node is actually added.
// Debounced at 600ms so rapid injections (ads, SPA route changes) are batched
// into one scan instead of firing hundreds of full-DOM sweeps per second.
const TRACKER_RELEVANT_TAGS = new Set(['SCRIPT', 'IMG', 'IFRAME', 'LINK']);
let _trackerDebounceTimer = null;

const _trackerObserver = new MutationObserver((mutations) => {
  const hasRelevantNode = mutations.some(m =>
    Array.from(m.addedNodes).some(n => n.nodeType === 1 && TRACKER_RELEVANT_TAGS.has(n.tagName))
  );
  if (!hasRelevantNode) return;
  clearTimeout(_trackerDebounceTimer);
  _trackerDebounceTimer = setTimeout(scanForTrackingScripts, 600);
});

_trackerObserver.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true
});


// ============================================================
//  FEATURE 3: LINK HOVER CHECKER
//  Debounced + pending-guard: at most one in-flight check
//  per URL. Local hash check happens in background.js first —
//  only confirmed threats reach the modal.
// ============================================================

// Issue 1 fix: cap checkedUrls so it never grows unboundedly on link-heavy pages.
// LRU-lite: when the map hits MAX_CHECKED_URLS entries, evict the oldest 20%
// before inserting the new entry.
const MAX_CHECKED_URLS = 500;
const checkedUrls = new Map();  // url -> true (safe) | false (unsafe)

function setCheckedUrl(url, value) {
  if (checkedUrls.size >= MAX_CHECKED_URLS) {
    // Evict oldest ~20 % of entries (insertion order)
    const evictCount = Math.ceil(MAX_CHECKED_URLS * 0.2);
    const iter = checkedUrls.keys();
    for (let i = 0; i < evictCount; i++) {
      const key = iter.next().value;
      if (key !== undefined) checkedUrls.delete(key);
    }
  }
  checkedUrls.set(url, value);
}

// Load the whitelist from settings (same key background.js uses).
// Previously used a separate 'whitelistedSites' key that never synced
// with background.js's currentSettings.whitelist — fixes that mismatch.
let whitelistedSites = [];
chrome.storage.local.get(['settings'], (result) => {
  whitelistedSites = result.settings?.whitelist || [];
});
// Keep in sync when settings change (e.g. user edits whitelist in settings page)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings?.newValue?.whitelist) {
    whitelistedSites = changes.settings.newValue.whitelist;
  }
});
const pendingUrls = {};  // url -> true (request in-flight)

// Offline cooldown: when the backend is unreachable, skip API calls for 30s
// to avoid hammering failed requests on every link hover.
const OFFLINE_COOLDOWN_MS = 30_000;
let offlineSince = null;  // timestamp (ms) of last API_UNAVAILABLE response, or null

function isOfflineCooldownActive() {
  if (offlineSince === null) return false;
  if (Date.now() - offlineSince < OFFLINE_COOLDOWN_MS) return true;
  offlineSince = null;  // cooldown expired, allow retries again
  return false;
}

function markBackendOffline() {
  if (offlineSince === null) {
    console.log("[ClickSafe] Backend unreachable — pausing link checks for 30s.");
  }
  offlineSince = Date.now();
}

function markBackendOnline() {
  if (offlineSince !== null) {
    console.log("[ClickSafe] Backend reachable again — resuming link checks.");
  }
  offlineSince = null;
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ── Hover tooltip for harmful links ──────────────────────────
// Shows a small red warning badge on the link element itself when
// it is confirmed dangerous, so users see a warning before clicking.
function attachHarmfulTooltip(linkEl, threat) {
  // Don't attach twice
  if (linkEl._clicksafeTooltip) return;

  const tip = document.createElement("div");
  tip.setAttribute("data-clicksafe-tip", "1");
  tip.style.cssText = [
    "position:fixed",
    "z-index:2147483646",
    "background:#dc2626",
    "color:#fff",
    "font:bold 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif",
    "padding:5px 10px",
    "border-radius:6px",
    "box-shadow:0 4px 12px rgba(0,0,0,0.35)",
    "pointer-events:none",
    "opacity:0",
    "transition:opacity 0.15s",
    "max-width:280px",
    "word-break:break-word",
    "display:flex",
    "align-items:center",
    "gap:6px",
  ].join(";");
  tip.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Harmful link — ${threat || "threat detected"}`;
  document.body.appendChild(tip);
  linkEl._clicksafeTooltip = tip;

  // Add a subtle red underline to the link itself so it's identifiable
  linkEl.style.setProperty("outline", "2px solid #dc2626", "important");
  linkEl.style.setProperty("outline-offset", "1px", "important");

  function positionTip(e) {
    const x = e.clientX + 12;
    const y = e.clientY + 16;
    const maxX = window.innerWidth  - tip.offsetWidth  - 8;
    const maxY = window.innerHeight - tip.offsetHeight - 8;
    tip.style.left = Math.min(x, maxX) + "px";
    tip.style.top  = Math.max(8, Math.min(y, maxY)) + "px";
  }

  linkEl.addEventListener("mouseenter", function(e) {
    tip.style.opacity = "1";
    positionTip(e);
  });
  linkEl.addEventListener("mousemove", positionTip);
  linkEl.addEventListener("mouseleave", function() {
    tip.style.opacity = "0";
  });
}

function handleLinkHover(url) {
  if (!url || url.startsWith("javascript:") || url.startsWith("#") || url.startsWith("mailto:")) return;
  if (whitelistedSites.includes(window.location.hostname)) return;
  if (checkedUrls.get(url) === true) return;
  if (pendingUrls[url]) return;
  // Skip during offline cooldown — backend is known to be unreachable
  if (isOfflineCooldownActive()) return;

  pendingUrls[url] = true;

  safeSendMessage({ type: "CHECK_LINK", url }, function (response) {
    delete pendingUrls[url];
    if (response && !response.safe) {
      checkedUrls.set(url, false);
      markBackendOnline();
      // Attach hover tooltip to the currently hovered link
      if (_hoveredLinkEl && _hoveredLinkEl.href === url) {
        attachHarmfulTooltip(_hoveredLinkEl, response.threat);
      }
      // Also attach to all other links with the same URL on this page
      document.querySelectorAll("a[href]").forEach(el => {
        if (el.href === url) attachHarmfulTooltip(el, response.threat);
      });
      // The modal still fires on click via background.js — tooltip is extra warning on hover
    } else if (response) {
      if (response.unavailable) {
        // Backend is down — activate cooldown, don't cache this URL
        markBackendOffline();
      } else {
        // Confirmed safe response from a live backend
        markBackendOnline();
        setCheckedUrl(url, true);
      }
    }
  });
}

const debouncedHover = debounce(handleLinkHover, 300);

// Track the currently hovered link element so attachHarmfulTooltip can target it
let _hoveredLinkEl = null;

document.addEventListener("mouseover", function (e) {
  const link = e.target.closest("a[href]");
  if (link) {
    _hoveredLinkEl = link;
    debouncedHover(link.href);
  }
});


// ============================================================
//  FEATURE 4: WARNING MODAL
// ============================================================

function showWarningModal({ type, url, filename, threat }) {
  // Remove existing modal if any
  const existing = document.getElementById("clicksafe-modal-container");
  if (existing) existing.remove();

  // Issue 3 fix: escape all server-supplied strings before DOM insertion.
  // threat, url, and filename are external data — interpolating them raw
  // into innerHTML is a stored-XSS vector.
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
  }

  // Create modal container
  const container = document.createElement("div");
  container.id = "clicksafe-modal-container";
  container.style.cssText = `
    all: initial;
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.6);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  `;

  const target = type === "download" ? (filename || url) : url;
  const icon = type === "download" ? `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  const title = type === "download" ? "Dangerous Download Blocked" : "Dangerous Link Detected";

  // Use escaped values in innerHTML
  const safeTitle   = escapeHtml(title);
  const safeThreat  = escapeHtml(threat);
  const safeTarget  = escapeHtml(target);

  container.innerHTML = `
    <div style="
      background: white; border-radius: 12px; padding: 28px;
      max-width: 440px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    ">
      <div style="font-size: 48px; margin-bottom: 12px;">${icon}</div>
      <h2 style="margin: 0 0 8px; font-size: 18px; color: #dc2626;">${safeTitle}</h2>
      <p style="margin: 0 0 16px; font-size: 13px; color: #6b7280;">
        Threat: <strong>${safeThreat}</strong>
      </p>
      <p style="margin: 0 0 20px; font-size: 12px; color: #9ca3af; word-break: break-all;">
        ${safeTarget}
      </p>
      <div style="margin-bottom: 14px;">
        <label style="font-size: 12px; color: #6b7280; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
          <input type="checkbox" id="clicksafe-dont-warn" style="cursor: pointer;">
          Don't warn me again for this site
        </label>
      </div>
      <div style="display: flex; gap: 10px; justify-content: center;">
        <button id="clicksafe-go-back" style="
          background: #dc2626; color: white; border: none;
          padding: 10px 20px; border-radius: 8px; cursor: pointer;
          font-size: 14px; font-weight: 600;
        ">Go Back</button>
        <button id="clicksafe-proceed" style="
          background: #f3f4f6; color: #374151; border: none;
          padding: 10px 20px; border-radius: 8px; cursor: pointer;
          font-size: 14px;
        ">Proceed Anyway</button>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  // Shared: save the site to whitelist if "don't warn" is checked.
  // Writes to settings.whitelist so background.js's currentSettings
  // sees the same data (fixes the whitelistedSites key mismatch bug).
  function maybeSaveWhitelist() {
    const dontWarn = document.getElementById("clicksafe-dont-warn")?.checked;
    if (dontWarn) {
      const hostname = window.location.hostname;
      chrome.storage.local.get(['settings'], (result) => {
        const settings = result.settings || {};
        const list = settings.whitelist || [];
        if (!list.includes(hostname)) list.push(hostname);
        const updated = { ...settings, whitelist: list };
        chrome.storage.local.set({ settings: updated });
        safeSendMessage({ type: 'SETTINGS_UPDATED', settings: updated });
        // Also update the local cache so hovered links on this page stop being checked
        whitelistedSites = list;
      });
    }
  }

  // Go Back — dismiss and stay on current page
  function handleDismiss() {
    maybeSaveWhitelist();
    container.remove();
  }

  // Proceed Anyway — navigate to the flagged URL (link) or allow download (download)
  function handleProceed() {
    maybeSaveWhitelist();
    container.remove();
    if (type === 'link' && url) {
      window.location.href = url;
    }
    // For downloads, the download was already cancelled by background.js.
    // We can't resume it from content.js, so we just dismiss and let the
    // user re-initiate the download if they choose.
  }

  document.getElementById("clicksafe-go-back").addEventListener("click", handleDismiss);
  document.getElementById("clicksafe-proceed").addEventListener("click", handleProceed);
}

// Make showWarningModal available globally for background.js messages
console.log("[ClickSafe] content.js loaded [OK]");


// ============================================================
//  FEATURE 5: REAL-TIME PRIVACY BANNER
//  Injected into the page when privacy score drops below 50.
//  background.js sends SHOW_PRIVACY_BANNER after every scan.
// ============================================================

const BANNER_ID = 'clicksafe-privacy-banner';

function showPrivacyBanner({ score, topReason, total }) {
  if (document.getElementById(BANNER_ID)) return;

  // score and total are integers (safe). topReason is a string built by
  // background.js that may embed a tracker domain name — escape it.
  function escBanner(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
  }
  const safeTopReason = escBanner(topReason);

  const isRed    = score < 35;
  const bgColor  = isRed ? '#fef2f2' : '#fffbeb';
  const border   = isRed ? '#fca5a5' : '#fcd34d';
  const iconBg   = isRed ? '#fee2e2' : '#fef3c7';
  const iconText = isRed ? '#dc2626' : '#d97706';
  const text     = isRed ? '#7f1d1d' : '#78350f';
  const label    = isRed ? 'High Risk' : 'Moderate Risk';

  const banner = document.createElement('div');
  banner.id = BANNER_ID;

  banner.style.cssText = `
    all: initial;
    display: block;
    width: 100%;
    box-sizing: border-box;
    background: ${bgColor};
    border-bottom: 1.5px solid ${border};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    z-index: 2147483647;
    position: fixed;
    top: 0;
  `;

  banner.innerHTML = `
    <div style="
      max-width: 900px;
      margin: 0 auto;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    ">
      <div style="
        background: ${iconBg};
        border-radius: 50%;
        width: 32px; height: 32px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        font-size: 16px;
      "><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>

      <div style="flex: 1; min-width: 0;">
        <span style="
          font-size: 13px; font-weight: 600;
          color: ${iconText}; margin-right: 8px;
        ">ClickSafe · ${label}</span>
        <span style="font-size: 13px; color: ${text};">
          Privacy score <strong style="color:${iconText};">${score}/100</strong>
          &nbsp;·&nbsp; ${safeTopReason}
        </span>
      </div>

      <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
        <span style="
          font-size: 11px; color: ${text}; opacity: 0.7;
        ">${total} threat${total !== 1 ? 's' : ''} detected</span>

        <button id="clicksafe-banner-dismiss" style="
          background: none; border: 1px solid ${border};
          border-radius: 6px; padding: 4px 10px;
          font-size: 12px; color: ${text};
          cursor: pointer; font-family: inherit;
        ">Dismiss</button>
      </div>
    </div>
  `;

  document.body.insertBefore(banner, document.body.firstChild);

  document.getElementById('clicksafe-banner-dismiss')
    .addEventListener('click', hidePrivacyBanner);
}

function hidePrivacyBanner() {
  const banner = document.getElementById(BANNER_ID);
  if (banner) banner.remove();
}


// ============================================================
//  FEATURE 6: DARK PATTERN DETECTOR
// ============================================================

// Keywords that indicate a pre-ticked checkbox is marketing-related.
// Defined here (outside runDarkPatternDetector) so the MutationObserver
// handler and the change-event listener can reuse the same list without
// re-creating the array on every mutation.
const PRETICK_KEYWORDS = [
  "newsletter","marketing","promotional","offers","updates","emails",
  "subscribe","news","deals","partner","third party","third-party"
];

const DARK_PATTERNS = {
  fakeUrgency: {
    label: "Fake Urgency", color: "#f97316",
    bgColor: "rgba(249,115,22,0.08)",
    // Scored keyword system — matched weights are summed; flag when >= scoreThreshold.
    // High-weight phrases (>= threshold) fire on their own; low-weight words
    // accumulate so creative phrasing like "Only a few remain!" still scores.
    scoreThreshold: 0.8,
    keywords: [
      // High-confidence phrases — each fires alone
      { re: /only\s+\d+\s+left/i,                         w: 0.9 },
      { re: /\d+\s+people\s+(are\s+)?(viewing|watching)/i, w: 0.9 },
      { re: /offer\s+expires/i,                             w: 0.9 },
      { re: /selling\s+fast/i,                              w: 0.9 },
      { re: /almost\s+gone/i,                               w: 0.9 },
      { re: /act\s+now/i,                                   w: 0.9 },
      { re: /don'?t\s+miss\s+out/i,                        w: 0.9 },
      { re: /last\s+chance/i,                               w: 0.9 },
      { re: /ends\s+soon/i,                                 w: 0.9 },
      { re: /today\s+only/i,                                w: 0.9 },
      { re: /limited\s+time/i,                              w: 0.9 },
      { re: /hurry[\s!]/i,                                  w: 0.9 },
      { re: /won'?t\s+last/i,                               w: 0.9 },
      // Individual words — accumulate toward threshold
      { re: /\bonly\b/i,     w: 0.3 },
      { re: /\bleft\b/i,     w: 0.3 },
      { re: /\blimited\b/i,  w: 0.4 },
      { re: /\bexpires?\b/i, w: 0.6 },
      { re: /\bhurry\b/i,    w: 0.5 },
      { re: /\bremains?\b/i, w: 0.4 },
      { re: /\bends?\b/i,    w: 0.3 },
      { re: /\bsoon\b/i,     w: 0.2 },
      { re: /\blast\b/i,     w: 0.3 },
      { re: /\bchance\b/i,   w: 0.3 },
      { re: /\balmost\b/i,   w: 0.2 },
      { re: /\btoday\b/i,    w: 0.3 },
      { re: /\bmiss\b/i,     w: 0.3 },
      { re: /\bfew\b/i,      w: 0.2 },
      { re: /\boffer\b/i,    w: 0.3 },
      { re: /\bdeal\b/i,     w: 0.3 },
    ]
  },
  confirmShaming: {
    label: "Confirm Shaming", color: "#ec4899",
    bgColor: "rgba(236,72,153,0.08)",
    patterns: [
      /no,?\s+i\s+don'?t\s+want/i, /no\s+thanks,?\s+i\s+(hate|prefer|don'?t)/i,
      /i\s+don'?t\s+want\s+(to\s+)?(save|deals|offers|discount)/i,
      /no\s+thanks,?\s+i'll\s+pay\s+full/i, /i\s+hate\s+saving/i,
      /i\s+prefer\s+to\s+pay\s+more/i,
    ]
  },
  fakeCountdown: {
    label: "Fake Countdown Timer", color: "#ef4444",
    bgColor: "rgba(239,68,68,0.08)",
    selectors: ['[class*="countdown"]','[class*="timer"]','[id*="countdown"]','[id*="timer"]','[class*="count-down"]','[class*="time-left"]']
  },
  preTickedCheckbox: {
    label: "Pre-ticked Checkbox", color: "#8b5cf6",
    bgColor: "rgba(139,92,246,0.08)"
  },
  cookieManipulation: {
    label: "Cookie Banner Manipulation", color: "#06b6d4",
    bgColor: "rgba(6,182,212,0.08)",
    acceptPatterns: [/accept\s+all/i, /allow\s+all/i, /agree\s+to\s+all/i, /i\s+accept/i],
    rejectPatterns: [/reject\s+all/i, /decline/i, /refuse/i, /necessary\s+only/i, /manage/i],
  }
};

function runDarkPatternDetector() {
  const detected = [];

  const textEls = document.querySelectorAll("p,span,div,h1,h2,h3,h4,h5,strong,em,b,label,a,button");
  textEls.forEach(el => {
    // Issue 2 fix: skip elements already highlighted — re-reading innerText on
    // every 800ms debounce tick forces a reflow over the entire element set.
    if (el.dataset.clicksafeHighlighted) return;
    if (el.children.length > 3) return;
    const text = el.innerText?.trim();
    if (!text || text.length > 300) return;

    // Scored keyword system: sum weights of all matched keywords/phrases.
    // Fires when total >= scoreThreshold — catches creative phrasing that
    // exact regexes miss (e.g. "Only a few remain!" scores 0.3+0.4+0.2 = 0.9).
    let urgencyScore = 0;
    for (const { re, w } of DARK_PATTERNS.fakeUrgency.keywords) {
      if (re.test(text)) urgencyScore += w;
      if (urgencyScore >= DARK_PATTERNS.fakeUrgency.scoreThreshold) break; // no need to keep summing
    }
    if (urgencyScore >= DARK_PATTERNS.fakeUrgency.scoreThreshold) {
      highlightElement(el, DARK_PATTERNS.fakeUrgency);
      detected.push({ type: "Fake Urgency", text: text.substring(0, 80) });
    }
    DARK_PATTERNS.confirmShaming.patterns.forEach(p => {
      if (p.test(text)) { highlightElement(el, DARK_PATTERNS.confirmShaming); detected.push({ type: "Confirm Shaming", text: text.substring(0, 80) }); }
    });
  });

  // A standalone digit is not enough — video players, delivery trackers,
  // and real sale timers all match class="timer" and contain digits.
  // Require (a) a colon-separated time format AND (b) urgency language
  // in a nearby ancestor or sibling (up to 2 levels up).
  const COUNTDOWN_URGENCY = /offer|deal|expires?|sale|discount|ends?|hurry|limited|only|saving/i;

  function hasNearbyUrgency(el) {
    let node = el.parentElement;
    for (let depth = 0; depth < 2 && node; depth++, node = node.parentElement) {
      // Check the ancestor's own direct text
      const ownText = Array.from(node.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent).join(' ');
      if (COUNTDOWN_URGENCY.test(ownText)) return true;
      // Check siblings at this level
      for (const sibling of node.children) {
        if (sibling !== (depth === 0 ? el : el.parentElement) &&
            COUNTDOWN_URGENCY.test(sibling.innerText || '')) return true;
      }
    }
    return false;
  }

  DARK_PATTERNS.fakeCountdown.selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      if (el.dataset.clicksafeHighlighted) return;
      const text = el.innerText || '';
      // Must look like a timer (e.g. 23:59 or 1:02:45) — not just any digit
      if (!/\d{1,2}:\d{2}/.test(text)) return;
      // Must have urgency language nearby — lone timers are legitimate
      if (!hasNearbyUrgency(el)) return;
      highlightElement(el, DARK_PATTERNS.fakeCountdown);
      detected.push({ type: "Fake Countdown Timer", text: text.substring(0, 80) });
    });
  });

  document.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
    if (cb.dataset.clicksafeHighlighted) return;  // already caught by observer
    const label = findCheckboxLabel(cb);
    const labelText = label?.innerText?.toLowerCase() || "";
    if (PRETICK_KEYWORDS.some(kw => labelText.includes(kw))) {
      highlightElement(label || cb, DARK_PATTERNS.preTickedCheckbox);
      detected.push({ type: "Pre-ticked Checkbox", text: labelText.substring(0, 80) });
    }
  });

  const allBtns = Array.from(document.querySelectorAll('button,a[role="button"],[class*="cookie"] button,[id*="cookie"] button'));
  let acceptBtn = null, rejectBtn = null;
  allBtns.forEach(btn => {
    const t = btn.innerText?.trim();
    if (!t) return;
    if (!acceptBtn && DARK_PATTERNS.cookieManipulation.acceptPatterns.some(p => p.test(t))) acceptBtn = btn;
    if (!rejectBtn && DARK_PATTERNS.cookieManipulation.rejectPatterns.some(p => p.test(t))) rejectBtn = btn;
  });

  if (acceptBtn && !rejectBtn) {
    // Classic case: no way to decline at all
    highlightElement(acceptBtn, DARK_PATTERNS.cookieManipulation);
    detected.push({ type: "Cookie Banner Manipulation", text: "Accept button with no Reject option" });
  } else if (acceptBtn && rejectBtn) {
    // Both exist — check visual asymmetry nudging users toward Accept.
    // Signal 1: Accept is significantly larger (area ratio > 2.5x)
    const aRect = acceptBtn.getBoundingClientRect();
    const rRect = rejectBtn.getBoundingClientRect();
    const aArea = aRect.width * aRect.height;
    const rArea = rRect.width * rRect.height;
    const sizeAsymmetry = rArea > 0 && aArea / rArea > 2.5;

    // Signal 2: Accept has a coloured bg; Reject is transparent/ghosted.
    // Parse computed backgroundColor to relative luminance (null = transparent).
    function bgLuminance(el) {
      const bg = getComputedStyle(el).backgroundColor;
      const m  = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      if (m[4] !== undefined && +m[4] < 0.1) return null; // transparent
      return 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
    }
    const aLum = bgLuminance(acceptBtn);
    const rLum = bgLuminance(rejectBtn);
    // Accept is coloured/dark (lum < 200); Reject is ghosted (transparent or near-white)
    const colorAsymmetry = aLum !== null && aLum < 200 && (rLum === null || rLum > 230);

    if (sizeAsymmetry || colorAsymmetry) {
      const reason = sizeAsymmetry && colorAsymmetry
        ? "Accept button is larger and more prominent than Reject"
        : sizeAsymmetry
          ? "Accept button is significantly larger than Reject"
          : "Accept button is visually prominent; Reject is hidden/ghosted";
      highlightElement(acceptBtn, DARK_PATTERNS.cookieManipulation);
      detected.push({ type: "Cookie Banner Manipulation", text: reason });
    }
  }

  if (detected.length > 0) {
    showDarkPatternBadge(detected.length);
    safeSendMessage({
      type: "DARK_PATTERNS_DETECTED",
      data: { pageUrl: window.location.href, patterns: detected, count: detected.length, timestamp: new Date().toISOString() }
    });
  }
}

// Issue 4 fix: keep a registry of live tooltips so they can be swept on
// SPA navigation.  WeakRef lets the element be GC-ed naturally; the registry
// is cleaned up either by the navigation listener below or lazily during the
// next sweep if the element has already been collected.
const _tooltipRegistry = [];   // [ { elRef: WeakRef, tooltip: HTMLElement } ]

function _sweepOrphanedTooltips() {
  for (let i = _tooltipRegistry.length - 1; i >= 0; i--) {
    const { elRef, tooltip } = _tooltipRegistry[i];
    const el = elRef.deref();
    // Remove tooltip if source element was GC-ed or is no longer in the DOM
    if (!el || !document.body.contains(el)) {
      tooltip.remove();
      _tooltipRegistry.splice(i, 1);
    }
  }
}

// Sweep on every SPA-style navigation (history.pushState / replaceState / popstate)
function _patchHistoryForTooltipCleanup() {
  const _wrap = (original) => function (...args) {
    const result = original.apply(this, args);
    _sweepOrphanedTooltips();
    return result;
  };
  history.pushState    = _wrap(history.pushState);
  history.replaceState = _wrap(history.replaceState);
  window.addEventListener('popstate', _sweepOrphanedTooltips);
}
_patchHistoryForTooltipCleanup();

function highlightElement(el, pattern) {
  if (el.dataset.clicksafeHighlighted) return;
  el.dataset.clicksafeHighlighted = "true";

  // Subtle light-blue text highlight — no wrapper, no border, no layout disruption
  el.style.setProperty("background-color", "rgba(147, 210, 255, 0.45)", "important");
  el.style.setProperty("border-radius",     "3px",                       "important");
  el.style.setProperty("cursor",            "help",                      "important");
  el.style.setProperty("position",          "relative",                  "important");

  // Hover tooltip — injected once, shown/hidden via opacity
  const tooltip = document.createElement("div");
  tooltip.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f1f5f9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${pattern.label}`;
  tooltip.style.cssText = [
    "position:fixed!important",
    "background:#1e293b!important",
    "color:#f1f5f9!important",
    "font-size:12px!important",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif!important",
    "font-weight:500!important",
    "padding:5px 10px!important",
    "border-radius:6px!important",
    "box-shadow:0 4px 12px rgba(0,0,0,0.25)!important",
    "z-index:2147483647!important",
    "pointer-events:none!important",
    "white-space:nowrap!important",
    "opacity:0!important",
    "transition:opacity 0.15s ease!important"
  ].join(";");

  document.body.appendChild(tooltip);

  // Issue 4 fix: register so the sweep can remove this tooltip if the source
  // element disappears (e.g. SPA route change removes it from the DOM).
  _tooltipRegistry.push({ elRef: new WeakRef(el), tooltip });

  el.addEventListener("mouseenter", function(e) {
    // Position tooltip near the cursor
    const x = e.clientX + 12;
    const y = e.clientY - 32;
    // Keep inside viewport
    const maxX = window.innerWidth  - tooltip.offsetWidth  - 8;
    const maxY = window.innerHeight - tooltip.offsetHeight - 8;
    tooltip.style.setProperty("left", Math.min(x, maxX) + "px", "important");
    tooltip.style.setProperty("top",  Math.max(8, Math.min(y, maxY)) + "px", "important");
    tooltip.style.setProperty("opacity", "1", "important");
  });

  el.addEventListener("mousemove", function(e) {
    const x = e.clientX + 12;
    const y = e.clientY - 32;
    const maxX = window.innerWidth  - tooltip.offsetWidth  - 8;
    const maxY = window.innerHeight - tooltip.offsetHeight - 8;
    tooltip.style.setProperty("left", Math.min(x, maxX) + "px", "important");
    tooltip.style.setProperty("top",  Math.max(8, Math.min(y, maxY)) + "px", "important");
  });

  el.addEventListener("mouseleave", function() {
    tooltip.style.setProperty("opacity", "0", "important");
  });

  // ── Dismiss button ──────────────────────────────────────────
  // Shown on hover alongside the tooltip. Clicking it removes the highlight,
  // removes the tooltip, and reports the dismissal to the backend as a
  // potential false positive.
  const dismissBtn = document.createElement("span");
  dismissBtn.title = "Not a dark pattern? Click to dismiss and report";
  dismissBtn.style.cssText = [
    "position:absolute!important",
    "top:-7px!important",
    "right:-7px!important",
    "width:16px!important",
    "height:16px!important",
    "background:#1e293b!important",
    "color:#94a3b8!important",
    "border:1px solid rgba(255,255,255,0.15)!important",
    "border-radius:50%!important",
    "font-size:9px!important",
    "line-height:14px!important",
    "text-align:center!important",
    "cursor:pointer!important",
    "z-index:2147483646!important",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif!important",
    "font-weight:700!important",
    "display:none!important",           // hidden until hover
    "pointer-events:auto!important",
    "user-select:none!important"
  ].join(";");
  dismissBtn.textContent = "×";
  el.appendChild(dismissBtn);

  el.addEventListener("mouseenter", function() {
    dismissBtn.style.setProperty("display", "block", "important");
  });
  el.addEventListener("mouseleave", function() {
    dismissBtn.style.setProperty("display", "none", "important");
  });

  dismissBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    e.preventDefault();

    // Remove the highlight styling
    el.style.removeProperty("background-color");
    el.style.removeProperty("border-radius");
    el.style.removeProperty("cursor");
    delete el.dataset.clicksafeHighlighted;

    // Remove tooltip and dismiss button from DOM
    tooltip.remove();
    dismissBtn.remove();

    // Report to background script → backend
    try {
      safeSendMessage({
        type:        "DARK_PATTERN_DISMISSED",
        domain:      window.location.hostname,
        pageUrl:     window.location.href,
        patternType: pattern.label,
        patternText: (el.innerText || "").trim().substring(0, 160),
      });
    } catch (_) { /* content script context may be invalidated */ }
  });
}

function findCheckboxLabel(cb) {
  if (cb.id) { const l = document.querySelector(`label[for="${cb.id}"]`); if (l) return l; }
  const p = cb.closest("label"); if (p) return p;
  const s = cb.nextElementSibling; if (s?.tagName === "LABEL") return s;
  return null;
}

// ── JS-ticked checkbox helpers ────────────────────────────────
// These are called from the MutationObserver (attribute mutations + newly
// added nodes) and the document 'change' listener, so they must run fast
// and be safe to call multiple times on the same element.

/**
 * Check a single checkbox element. If it is checked, visible, unprocessed,
 * and its label contains a marketing keyword, flag it immediately without
 * waiting for the next full runDarkPatternDetector sweep.
 */
function checkNodeForPreTickedCheckbox(cb) {
  if (!_darkPatternsEnabled) return;
  if (!cb || cb.type !== 'checkbox' || !cb.checked) return;
  if (cb.dataset.clicksafeHighlighted) return;  // already flagged
  const label     = findCheckboxLabel(cb);
  const labelText = (label?.innerText || '').toLowerCase();
  if (!PRETICK_KEYWORDS.some(kw => labelText.includes(kw))) return;

  highlightElement(label || cb, DARK_PATTERNS.preTickedCheckbox);
  showDarkPatternBadge(1);
  safeSendMessage({
    type: "DARK_PATTERNS_DETECTED",
    data: {
      pageUrl:   window.location.href,
      patterns:  [{ type: "Pre-ticked Checkbox", text: labelText.substring(0, 80) }],
      count:     1,
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Walk a list of newly-added DOM nodes and check any checkboxes inside them.
 * Called synchronously from the MutationObserver childList handler so boxes
 * that arrive in the DOM already checked are caught before the 800ms debounce.
 */
function scanAddedNodesForCheckboxes(addedNodes) {
  addedNodes.forEach(node => {
    if (node.nodeType !== 1) return;
    // The node itself might be a checkbox
    if (node.tagName === 'INPUT') {
      checkNodeForPreTickedCheckbox(node);
    }
    // Or it might be a container with checkboxes inside
    node.querySelectorAll?.('input[type="checkbox"]:checked').forEach(checkNodeForPreTickedCheckbox);
  });
}

function showDarkPatternBadge(count) {
  const existing = document.getElementById("clicksafe-dp-badge");
  if (existing) existing.remove();
  const badge = document.createElement("div");
  badge.id = "clicksafe-dp-badge";
  badge.innerHTML = `<div style="position:fixed;bottom:24px;right:24px;background:#1a1a2e;border:1px solid rgba(249,115,22,0.4);color:white;padding:12px 18px;border-radius:12px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;z-index:999999;box-shadow:0 8px 32px rgba(0,0,0,0.4);display:flex;align-items:center;gap:10px;cursor:pointer;"><span style="display:flex;align-items:center;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span><div><div style="color:#f97316;">${count} Dark Pattern${count > 1 ? "s" : ""} Detected</div><div style="font-weight:normal;font-size:11px;color:#9ca3af;margin-top:2px;">Highlighted on page · Click to dismiss</div></div></div>`;
  badge.addEventListener("click", () => badge.remove());
  document.body.appendChild(badge);
  setTimeout(() => badge?.remove(), 8000);
}

// ── Dark pattern observer setup ───────────────────────────────
// Debounced at 800ms so rapid DOM mutations (SPAs, ads, infinite scroll)
// don't fire a full querySelector-over-thousands-of-nodes sweep on every tick.
// Moved outside the storage callback so the observer lifecycle is predictable.
let _dpDebounceTimer = null;
let _darkPatternsEnabled = false;  // set after storage check below

const _darkPatternObserver = new MutationObserver((mutations) => {
  if (!_darkPatternsEnabled) return;

  let hasNewNodes = false;

  for (const m of mutations) {
    if (m.type === 'attributes') {
      // A 'checked' attribute was set on an input — check it immediately.
      // Note: this catches setAttribute('checked', '') but NOT the common
      // el.checked = true property assignment. The 'change' listener below
      // covers that case.
      if (m.target.tagName === 'INPUT') checkNodeForPreTickedCheckbox(m.target);
    } else if (m.type === 'childList' && m.addedNodes.length > 0) {
      hasNewNodes = true;
      // Immediately check any newly-added checkboxes — don't wait for the
      // 800ms debounce, which exists for the expensive full-DOM sweep.
      scanAddedNodesForCheckboxes(m.addedNodes);
    }
  }

  // Still queue the full sweep for everything else (urgency text, countdowns…)
  if (hasNewNodes) {
    clearTimeout(_dpDebounceTimer);
    _dpDebounceTimer = setTimeout(runDarkPatternDetector, 800);
  }
});

_darkPatternObserver.observe(document.body || document.documentElement, {
  childList:       true,
  subtree:         true,
  attributes:      true,
  attributeFilter: ['checked']   // only watch the 'checked' attribute to keep mutation volume low
});

// ── Change-event listener for JS-property-ticked checkboxes ──
// Direct property assignment (el.checked = true) does NOT fire a MutationObserver
// attribute mutation. But most frameworks (React, Vue synthetic events, etc.)
// DO dispatch a 'change' event when they update checkbox state programmatically.
// Capture phase ensures we see it even if a page handler calls stopPropagation.
document.addEventListener('change', function(e) {
  if (!_darkPatternsEnabled) return;
  const t = e.target;
  if (t?.tagName === 'INPUT' && t.type === 'checkbox' && t.checked) {
    checkNodeForPreTickedCheckbox(t);
  }
}, true);

// Respect darkPatternsEnabled setting before running detector.
// Also responds to live setting changes (enable/disable without page reload).
chrome.storage.local.get(['settings'], function(result) {
  const settings = result.settings || {};
  _darkPatternsEnabled = settings.darkPatternsEnabled !== false;
  if (_darkPatternsEnabled) runDarkPatternDetector();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    const wasEnabled = _darkPatternsEnabled;
    _darkPatternsEnabled = changes.settings.newValue?.darkPatternsEnabled !== false;
    // Run immediately when re-enabled so the user sees results right away
    if (!wasEnabled && _darkPatternsEnabled) runDarkPatternDetector();
  }
});


// ============================================================
//  MESSAGE LISTENER
// ============================================================

chrome.runtime.onMessage.addListener(function (message) {
  if (message.type === "SHOW_DOWNLOAD_WARNING") {
    showWarningModal({
      type: "download",
      url: message.url,
      filename: message.filename,
      threat: message.threat
    });
  }

  if (message.type === 'SHOW_PRIVACY_BANNER') {
    showPrivacyBanner({
      score:     message.score,
      topReason: message.topReason,
      total:     message.total
    });
  }

  if (message.type === 'HIDE_PRIVACY_BANNER') {
    hidePrivacyBanner();
  }
});
setTimeout(() => showWarningModal({ type: 'link', url: 'http://malware.testing.google.test/', threat: 'MALWARE' }), 3000);