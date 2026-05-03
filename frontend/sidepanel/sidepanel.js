// ============================================================
//  ClickSafe — sidepanel.js  (v1.5.0)
//  + Saved past tracker history (persisted across sessions)
// ============================================================

const COMPANY_MAP = {
  "google":            { name:"Google",                tier:1, what:"tracking your browsing history across the web" },
  "googletagmanager":  { name:"Google",                tier:1, what:"tracking your browsing history across the web" },
  "googleanalytics":   { name:"Google",                tier:1, what:"tracking your browsing history across the web" },
  "googlesyndication": { name:"Google",                tier:1, what:"serving targeted ads based on your profile" },
  "doubleclick":       { name:"Google (DoubleClick)",  tier:1, what:"building an ad profile on you" },
  "gstatic":           { name:"Google",                tier:1, what:"loading Google tracking resources" },
  "facebook":          { name:"Meta / Facebook",       tier:1, what:"tracking you even when you're not on Facebook" },
  "instagram":         { name:"Meta / Instagram",      tier:1, what:"tracking your activity across sites" },
  "tiktok":            { name:"TikTok",                tier:1, what:"tracking your browsing behavior" },
  "bytedance":         { name:"TikTok (ByteDance)",    tier:1, what:"tracking your browsing behavior" },
  "microsoft":         { name:"Microsoft",             tier:1, what:"tracking your activity for advertising" },
  "bing":              { name:"Microsoft (Bing)",      tier:1, what:"tracking your search and browsing activity" },
  "amazon-adsystem":   { name:"Amazon Ads",            tier:1, what:"building a shopping profile on you" },
  "amazon":            { name:"Amazon",                tier:1, what:"tracking your shopping behavior" },
  "adobe":             { name:"Adobe",                 tier:1, what:"tracking your behavior for analytics" },
  "demdex":            { name:"Adobe (Audience Mgr)",  tier:1, what:"building a cross-site profile on you" },
  "oracle":            { name:"Oracle",                tier:1, what:"collecting your data for a profile database" },
  "bluekai":           { name:"Oracle (BlueKai)",      tier:1, what:"selling your profile data to advertisers" },
  "salesforce":        { name:"Salesforce",            tier:1, what:"tracking your behavior for marketing" },
  "krux":              { name:"Salesforce (Krux)",     tier:1, what:"building an audience profile on you" },
  "twitter":           { name:"X / Twitter",           tier:1, what:"tracking your activity off-platform" },
  "linkedin":          { name:"LinkedIn",              tier:1, what:"tracking your professional browsing habits" },
  "snapchat":          { name:"Snapchat",              tier:1, what:"tracking you outside their app" },
  "criteo":            { name:"Criteo",                tier:2, what:"retargeting you with ads based on your history" },
  "taboola":           { name:"Taboola",               tier:2, what:"tracking you for sponsored content targeting" },
  "outbrain":          { name:"Outbrain",              tier:2, what:"tracking you for sponsored content targeting" },
  "appnexus":          { name:"Xandr (AppNexus)",      tier:2, what:"running real-time ad auctions using your data" },
  "rubiconproject":    { name:"Magnite",               tier:2, what:"auctioning your attention to advertisers" },
  "pubmatic":          { name:"PubMatic",              tier:2, what:"selling ad impressions using your profile" },
  "openx":             { name:"OpenX",                 tier:2, what:"running ad auctions using your data" },
  "quantcast":         { name:"Quantcast",             tier:2, what:"profiling your interests for advertisers" },
  "adroll":            { name:"AdRoll",                tier:2, what:"retargeting you with ads across sites" },
  "hotjar":            { name:"Hotjar",                tier:3, what:"recording your clicks and scrolls on this page" },
  "mixpanel":          { name:"Mixpanel",              tier:3, what:"tracking how you use this site" },
  "amplitude":         { name:"Amplitude",             tier:3, what:"tracking how you use this site" },
  "segment":           { name:"Segment",               tier:3, what:"collecting your usage data for the site owner" },
  "heap":              { name:"Heap",                  tier:3, what:"recording your interactions on this page" },
  "fullstory":         { name:"FullStory",             tier:3, what:"recording your session on this page" },
  "mouseflow":         { name:"Mouseflow",             tier:3, what:"recording your mouse movements" },
  "clarity":           { name:"Microsoft Clarity",     tier:3, what:"recording your session on this page" },
  "intercom":          { name:"Intercom",              tier:3, what:"tracking your activity for support purposes" },
  "zendesk":           { name:"Zendesk",               tier:3, what:"tracking your activity for support purposes" },
};

const TIER_LABELS = { 1:"High risk", 2:"Ad network", 3:"Analytics" };

function domainToCompany(domain) {
  if (!domain) return null;
  const d = domain.toLowerCase().replace(/^www\./, "");
  for (const key of Object.keys(COMPANY_MAP)) {
    if (d.includes(key)) return { domain, ...COMPANY_MAP[key] };
  }
  const name = d.split(".").slice(-2,-1)[0] || d;
  return { domain, name:name.charAt(0).toUpperCase()+name.slice(1), tier:2, what:"tracking your activity on this page" };
}

function extractCompanies(domains) {
  const seen = new Map();
  domains.forEach(domain => {
    const c = domainToCompany(domain);
    if (c && !seen.has(c.name)) seen.set(c.name, c);
  });
  return Array.from(seen.values()).sort((a,b) => a.tier-b.tier);
}

// ── Session state ──────────────────────────────────────────────
let sessionCompanyNames = new Set();
let sessionPageCount = 0;
let lastTrackerScripts = [];
let lastCookieData = {};

// ── HTML escaping ──────────────────────────────────────────────
// Prevents stored-XSS when tracker domain names or cookie names
// are interpolated into innerHTML.
function esc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

// ── Messaging ──────────────────────────────────────────────────
chrome.runtime.sendMessage({ type:"GET_CURRENT_TAB_STATS" }, response => {
  if (chrome.runtime.lastError) return;
  if (response) render(response);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PANEL_UPDATE") render(message.payload);
});

// ── Streak bar ─────────────────────────────────────────────────
function updateStreakBar(count) {
  const label = document.getElementById("streak-label");
  if (label) label.textContent = `${count} page${count !== 1 ? "s" : ""} scanned`;
}

// ── Render ─────────────────────────────────────────────────────
function render(payload) {
  if (!payload) return;

  const {
    url = "",
    isHttps = false,
    pageTrackerCount         = 0,
    pageTrackerScripts       = [],
    pageMixedCount           = 0,
    cookieData               = {},
    totalTrackersFound       = 0,
    totalLinksChecked        = 0,
    totalCookieTrackersFound = 0,
  } = payload;

  setText("page-url", url || "—");

  // ── Fix: Neutral state for browser-internal pages (chrome://, about:, etc.)
  // These pages are not real web pages — showing "insecure" for them is
  // misleading and drops the score to 70 unnecessarily.
  const isWebPage = url.startsWith("http://") || url.startsWith("https://");

  const pill = document.getElementById("conn-pill");
  const connText = document.getElementById("conn-text");
  if (pill) {
    if (!isWebPage) {
      pill.className = "conn-pill checking";
      const dot = pill.querySelector(".conn-dot");
      if (dot) dot.classList.remove("pulsing");
    } else {
      pill.className = "conn-pill " + (isHttps ? "secure" : "insecure");
      const dot = pill.querySelector(".conn-dot");
      if (dot) dot.classList.remove("pulsing");
    }
  }
  if (connText) {
    if (!isWebPage) connText.textContent = "N/A";
    else connText.textContent = isHttps ? "HTTPS" : "HTTP";
  }

  const trackerDomains = [
    ...(pageTrackerScripts||[]).map(t => t.tracker||t.domain||""),
    ...((cookieData.trackers||[]).map(t => t.cookie?.domain||""))
  ].filter(Boolean);

  const companies = extractCompanies(trackerDomains);

  // Don't track, score, or save browser-internal pages.
  if (!isWebPage) {
    renderCompanyList([]);
    renderBackFace([], {});
    setText("stat-companies", 0);
    setText("stat-trackers",  0);
    setText("stat-cookie-trackers", 0);
    setText("stat-mixed", 0);
    // Show a neutral score (100) for internal pages
    updateScore(true, 0, 0, 0);
    setText("stat-total-companies",       sessionCompanyNames.size);
    setText("stat-total-trackers",        totalTrackersFound);
    setText("stat-total-cookie-trackers", totalCookieTrackersFound);
    setText("stat-total-links",           totalLinksChecked);
    return;
  }

  const isNewPage = !sessionCompanyNames._lastUrl || sessionCompanyNames._lastUrl !== url;
  if (isNewPage && url) {
    sessionPageCount = Math.min(sessionPageCount+1, 7);
    sessionCompanyNames._lastUrl = url;
    // Save this page to history
    if (companies.length > 0 || (cookieData.trackingCookies||0) > 0) {
      saveToHistory({ url, isHttps, companies, scripts:pageTrackerScripts, cookieData, timestamp:new Date().toISOString() });
    }
  }
  companies.forEach(c => sessionCompanyNames.add(c.name));
  updateStreakBar(sessionPageCount);

  renderCompanyList(companies);

  lastTrackerScripts = pageTrackerScripts;
  lastCookieData = cookieData;
  renderBackFace(pageTrackerScripts, cookieData);

  setText("stat-companies",       companies.length);
  setText("stat-trackers",        pageTrackerCount);
  setText("stat-cookie-trackers", cookieData.trackingCookies||0);
  setText("stat-mixed",           pageMixedCount);

  updateScore(isHttps, cookieData.trackingCookies||0, pageTrackerCount, pageMixedCount);

  setText("stat-total-companies",       sessionCompanyNames.size);
  setText("stat-total-trackers",        totalTrackersFound);
  setText("stat-total-cookie-trackers", totalCookieTrackersFound);
  setText("stat-total-links",           totalLinksChecked);
}

// ── Company list ───────────────────────────────────────────────
function renderCompanyList(companies) {
  const list = document.getElementById("company-list");
  if (!list) return;

  if (companies.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div class="empty-title">No trackers detected</div>
        <div class="empty-sub">This page looks clean</div>
      </div>`;
    return;
  }

  let html = companies.map(c => {
    const initials = c.name.split(/[\s\/]+/).filter(w=>/^[a-zA-Z]/.test(w)).map(w=>w[0]).join("").slice(0,2).toUpperCase();
    const tierClass = c.tier===1?"t1":c.tier===2?"t2":"t3";
    const tierLabel = TIER_LABELS[c.tier] || "Tracker";
    return `
      <div class="company-card ${tierClass}">
        <div class="company-avatar ${tierClass}">${esc(initials)}</div>
        <div class="company-body">
          <div class="company-name">${esc(c.name)}</div>
          <div class="company-what">${esc(c.what)}</div>
        </div>
        <span class="tier-badge ${tierClass}">${esc(tierLabel)}</span>
      </div>`;
  }).join("");

  list.innerHTML = html;
}

// ── Back face ──────────────────────────────────────────────────
function renderBackFace(trackerScripts, cookieData) {
  const list = document.getElementById("cookie-script-list");
  if (!list) return;

  const cookieTrackers = cookieData?.trackers||[];
  const scripts = (trackerScripts||[]).filter(t => (t.tracker||t.domain||t.url));
  let html = "";

  if (cookieTrackers.length > 0) {
    html += `<div class="detail-sublabel"><span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 14v.01"/></svg></span> Tracking Cookies</div>`;
    const domainGroups = new Map();
    cookieTrackers.forEach(t => {
      const cookie = t.cookie||t;
      const domain = cookie.domain||"unknown";
      if (!domainGroups.has(domain)) domainGroups.set(domain, []);
      domainGroups.get(domain).push(t);
    });
    domainGroups.forEach((cookies, domain) => {
      const domainInitial = domain.replace(/^\./, "").charAt(0).toUpperCase();
      html += `<div class="cookie-domain-group"><div class="cookie-domain-header"><span class="domain-initial">${esc(domainInitial)}</span>${esc(domain)}</div>`;
      cookies.forEach(t => {
        const cookie = t.cookie||t;
        const reasons = t.reasons||[];
        html += `<div class="cookie-entry"><div class="cookie-entry-tags">${reasons.map(r=>`<span class="cookie-entry-tag">${esc(r)}</span>`).join(" · ")||"<span class='cookie-entry-tag'>Tracking cookie</span>"}</div><span class="cookie-name" title="${esc(cookie.name||'—')}">${esc(cookie.name||"—")}</span></div>`;
      });
      html += `</div>`;
    });
  }

  if (scripts.length > 0) {
    html += `<div class="detail-sublabel"><span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span> Tracker Scripts</div>`;
    html += scripts.map(t => {
      const domain = t.tracker||t.domain||"";
      const url = t.url||"";
      return `<div class="detail-script"><span>${esc(domain)}</span>${url ? esc(url.replace(domain,"").substring(0,60)||"/") : ""}</div>`;
    }).join("");
  }

  if (!html) html = `<div class="back-empty">No cookies or tracker scripts detected.</div>`;
  list.innerHTML = html;
}

// ── Past tracker history (persisted) ──────────────────────────
const HISTORY_KEY = "sidepanelTrackerHistory";
const HISTORY_MAX = 50; // keep last 50 pages

function saveToHistory(entry) {
  chrome.storage.local.get([HISTORY_KEY], result => {
    const history = result[HISTORY_KEY]||[];
    // Don't duplicate the same URL within 5 minutes
    const recent = history.find(h => h.url===entry.url && (Date.now()-new Date(h.timestamp).getTime()) < 5*60*1000);
    if (recent) return;

    const item = {
      url: entry.url,
      isHttps: entry.isHttps,
      timestamp: entry.timestamp,
      companyCount: entry.companies.length,
      cookieCount: entry.cookieData?.trackingCookies||0,
      scriptCount: entry.scripts?.length||0,
      companies: entry.companies.slice(0,5).map(c=>({ name:c.name, tier:c.tier })),
    };

    const updated = [item, ...history].slice(0, HISTORY_MAX);
    chrome.storage.local.set({ [HISTORY_KEY]: updated }, () => renderHistoryMini(updated));

    // Sync to server if logged in (best-effort, non-blocking)
    if (typeof saveScoreHistoryEntry === 'function') {
      saveScoreHistoryEntry({
        url:          item.url,
        domain:       (() => { try { return new URL(item.url).hostname; } catch { return item.url; } })(),
        score:        typeof computePrivacyScore === 'function'
                        ? computePrivacyScore({ isHttps: item.isHttps, trackingCookies: item.cookieCount, trackers: item.scriptCount, mixedContent: 0 })
                        : 0,
        isHttps:      item.isHttps,
        cookieCount:  item.cookieCount,
        scriptCount:  item.scriptCount,
        companyCount: item.companyCount,
        companies:    item.companies,
        timestamp:    item.timestamp,
      });
    }
  });
}

function loadHistory() {
  chrome.storage.local.get([HISTORY_KEY], result => {
    renderHistoryMini(result[HISTORY_KEY]||[]);
  });
}

function renderHistoryMini(history) {
  const container = document.getElementById("history-mini-list");
  if (!container) return;

  if (history.length === 0) {
    container.innerHTML = `<div class="sh-empty">No history yet — browse some sites</div>`;
    return;
  }

  container.innerHTML = history.slice(0, 8).map(item => {
    let domain = '';
    try { domain = new URL(item.url).hostname; } catch { domain = item.url||'?'; }
    const timeAgo = formatTimeAgo(new Date(item.timestamp));
    const badges = [];
    if (item.cookieCount>0) badges.push(`<span class="h-badge h-badge-red" style="display:inline-flex;align-items:center;gap:3px;"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 14v.01"/></svg> ${item.cookieCount}</span>`);
    if (item.scriptCount>0) badges.push(`<span class="h-badge h-badge-orange" style="display:inline-flex;align-items:center;gap:3px;"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${item.scriptCount}</span>`);

    return `<div class="history-row">
      <div class="history-domain">${esc(domain)}</div>
      <div class="history-badges">${badges.join('')}</div>
      <div class="history-time">${esc(timeAgo)}</div>
    </div>`;
  }).join('');
}

function formatTimeAgo(date) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

// ── History section toggle ─────────────────────────────────────
document.getElementById("saved-history-toggle")?.addEventListener("click", () => {
  const section = document.getElementById("saved-history-section");
  if (section) section.classList.toggle("expanded");
});

// ── Page nav buttons ───────────────────────────────────────────
document.getElementById("dashboard-btn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/dashboard/dashboard.html") });
});
document.getElementById("settings-btn2")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/settings/settings.html") });
});

// ── Profile button ─────────────────────────────────────────────
async function initProfileBtn() {
  const wrap = document.getElementById("profile-btn-wrap");
  const btn  = document.getElementById("profile-btn");
  if (!wrap || !btn) return;

  const { user } = await getStoredAuth();
  if (user) {
    wrap.classList.add("logged-in");
    btn.title = user.email;
  }

  // Click is handled by the inline auth modal script in sidepanel.html

  // Keep dot in sync if user logs in/out from settings while panel is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("authToken" in changes)) return;
    const newToken = changes.authToken.newValue;
    if (newToken) {
      chrome.storage.local.get(["authUser"], r => {
        wrap.classList.add("logged-in");
        btn.title = r.authUser?.email || "Account";
      });
    } else {
      wrap.classList.remove("logged-in");
      btn.title = "Account";
    }
  });
}
initProfileBtn();
document.getElementById("sh-view-all-btn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/dashboard/dashboard.html") });
});

// ── Flip toggle ────────────────────────────────────────────────
let isFlipped = false;

document.getElementById("flip-btn")?.addEventListener("click", () => {
  const front = document.getElementById("face-front");
  const back  = document.getElementById("face-back");
  const label = document.getElementById("flip-label");
  if (!front || !back || !label) return;

  isFlipped = !isFlipped;

  if (isFlipped) {
    front.style.display = "none";
    back.style.display  = "block";
    label.textContent   = "Cookies & Scripts";
    renderBackFace(lastTrackerScripts, lastCookieData);
  } else {
    back.style.display  = "none";
    front.style.display = "block";
    label.textContent   = "Who's Watching";
  }
});

// ── Privacy score ring ─────────────────────────────────────────
let _prevScore = null; // tracks last displayed score for delta calculation

function updateScore(isHttps, cookies, trackers, mixed) {
  // Formula lives in utils/helpers.js → computePrivacyScore()
  const score = computePrivacyScore({ isHttps, trackingCookies: cookies, trackers, mixedContent: mixed });

  const numEl     = document.getElementById("score-num");
  const arcEl     = document.getElementById("score-arc");
  const verdictEl = document.getElementById("score-verdict");
  if (!numEl || !arcEl) return;

  numEl.textContent = score;

  // Arc: circumference for r=35 is 219.9
  const circ = 219.9;
  arcEl.style.strokeDashoffset = circ - (circ * score / 100);

  let verdict;
  if (score >= 80) {
    verdict = "GOOD STANDING";
  } else if (score >= 50) {
    verdict = "MODERATE RISK";
  } else {
    verdict = "HIGH RISK";
  }

  // Arc is always white
  arcEl.style.stroke = "#ffffff";
  if (verdictEl) { verdictEl.textContent = verdict; verdictEl.style.color = "rgba(255,255,255,0.85)"; }

  // ── Score reason → shown below streak bar ────────────────────
  const reasonBar  = document.getElementById('reason-bar');
  const reasonIcon = document.getElementById('reason-icon');
  const reasonText = document.getElementById('reason-text');
  if (reasonBar && reasonIcon && reasonText) {
    if (_prevScore !== null && _prevScore !== score) {
      const diff = score - _prevScore;

      let topReason = '';
      if (!isHttps)       topReason = 'Unencrypted connection';
      else if (cookies)   topReason = `${cookies} tracking cookie${cookies > 1 ? 's' : ''} detected`;
      else if (trackers)  topReason = `${trackers} tracker script${trackers > 1 ? 's' : ''} detected`;
      else if (mixed)     topReason = `${mixed} mixed-content resource${mixed > 1 ? 's' : ''}`;
      else                topReason = 'Threats cleared';

      const arrow = diff > 0 ? '↑' : '↓';
      const cls   = diff > 0 ? 'up' : 'down';
      const absDiff = Math.abs(diff);

      reasonIcon.textContent = `${arrow}${absDiff}`;
      reasonIcon.className   = `reason-icon ${cls}`;
      reasonText.textContent = topReason;
      reasonBar.style.display = 'flex';
    } else if (_prevScore === null) {
      // First load — show current top reason without delta arrow
      let topReason = '';
      if (!isHttps)       topReason = 'Unencrypted connection';
      else if (cookies)   topReason = `${cookies} tracking cookie${cookies > 1 ? 's' : ''} detected`;
      else if (trackers)  topReason = `${trackers} tracker script${trackers > 1 ? 's' : ''} detected`;
      else if (mixed)     topReason = `${mixed} mixed-content resource${mixed > 1 ? 's' : ''}`;

      if (topReason) {
        reasonIcon.textContent = '—';
        reasonIcon.className   = 'reason-icon same';
        reasonText.textContent = topReason;
        reasonBar.style.display = 'flex';
      } else {
        reasonBar.style.display = 'none';
      }
    }
  }

  _prevScore = score;
}

// ── Init ───────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// Load saved history on open
loadHistory();

// ── Backend status indicator ────────────────────────────────────
// Polls /api/health on the Render backend and updates the pill in
// the header so the user knows immediately if Safe Browsing checks
// are unavailable rather than getting silent failures.

const BACKEND_HEALTH_URL     = 'https://clicksafe-backend.onrender.com/api/health';
const BACKEND_CHECK_INTERVAL = 2 * 60 * 1000; // re-check every 2 min
let   _backendCheckTimer     = null;

async function checkBackendStatus() {
  const pill = document.getElementById('backend-pill');
  const dot  = document.getElementById('backend-dot');
  const text = document.getElementById('backend-text');
  if (!pill) return;

  // Show "checking" state
  pill.className = 'conn-pill backend-checking';
  if (dot)  { dot.classList.add('pulsing'); }
  if (text) { text.textContent = 'API'; }

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(BACKEND_HEALTH_URL, {
      method: 'GET',
      signal: controller.signal,
      cache:  'no-store',
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      pill.className = 'conn-pill backend-online';
      if (dot)  { dot.classList.remove('pulsing'); }
      if (text) { text.textContent = data.apiKeySet === false ? 'NO KEY' : 'ONLINE'; }
      // If the key is missing warn in tooltip
      pill.title = data.apiKeySet === false
        ? 'Backend reachable but GOOGLE_SAFE_BROWSING_API_KEY is not set on the server'
        : 'ClickSafe backend is online — Safe Browsing checks active';
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    pill.className = 'conn-pill backend-offline';
    if (dot)  { dot.classList.remove('pulsing'); }
    if (text) { text.textContent = 'OFFLINE'; }
    pill.title = `Backend unreachable — link & download safety checks are disabled\n(${err.message})`;
  }
}

// Run immediately on panel open, then on a repeating interval
checkBackendStatus();
_backendCheckTimer = setInterval(checkBackendStatus, BACKEND_CHECK_INTERVAL);

// Re-check whenever the panel regains visibility (user switches back to it)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    clearInterval(_backendCheckTimer);
    checkBackendStatus();
    _backendCheckTimer = setInterval(checkBackendStatus, BACKEND_CHECK_INTERVAL);
  }
});