// ============================================================
//  ClickSafe — dashboard.js  (v1.5.0)
//  Functional sidebar nav + Tracker History + Companies pages
// ============================================================

const CIRCUMFERENCE = 219.9;


// ── State ─────────────────────────────────────────────────────
let donutChart = null, timelineChart = null, donutChart2 = null, timelineChart2 = null;
let allDpLog = [], activeFilter = 'all';
let allHistoryData = [], activeHFilter = 'all', histSearchVal = '';

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  loadAll();
  initFilterButtons();
  initProfileBtn();
  document.getElementById('btn-clear').addEventListener('click', clearAllData);

  // ── Calendar nav buttons (inline onclick blocked by MV3 CSP) ─
  document.getElementById('cal-1-prev').addEventListener('click', () => changeCalMonth(-1, 'cal-1'));
  document.getElementById('cal-1-next').addEventListener('click', () => changeCalMonth( 1, 'cal-1'));
  document.getElementById('cal-2-prev').addEventListener('click', () => changeCalMonth(-1, 'cal-2'));
  document.getElementById('cal-2-next').addEventListener('click', () => changeCalMonth( 1, 'cal-2'));

  // History filters
  document.querySelectorAll('.hist-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.hist-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeHFilter = btn.dataset.hfilter;
      renderHistoryList();
    });
  });
  document.getElementById('hist-search-input').addEventListener('input', e => {
    histSearchVal = e.target.value.toLowerCase();
    renderHistoryList();
  });

  // ── Fix 1: Live updates via storage.onChanged ─────────────
  // Re-render whenever background.js writes anything to storage
  // so the dashboard is never a stale snapshot.
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      loadAll();
    });
  }

  // ── Fix 2: Live updates via PANEL_UPDATE messages ──────────
  // background.js calls chrome.runtime.sendMessage({ type:'PANEL_UPDATE', payload })
  // after every scan event — handle it so the gauge updates instantly.
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'PANEL_UPDATE') {
        const p = message.payload || {};
        // Re-render the score gauge directly from the per-tab payload
        // (much faster than a full loadAll() round-trip).
        const cookieTrackers = p.cookieData?.trackers?.length || p.totalCookieTrackersFound || 0;
        const trackerScripts = p.pageTrackerCount || 0;
        const mixedContent   = p.pageMixedCount   || 0;
        const isHttps        = p.isHttps !== false;
        const score = computePrivacyScore({ isHttps, trackingCookies: cookieTrackers, trackers: trackerScripts, mixedContent });
        renderGauge(score, trackerScripts, cookieTrackers, mixedContent);
        // Also do a full reload so totals / charts stay in sync.
        loadAll();
      }
    });
  }
});

// ── Sidebar Nav ───────────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pageId = btn.dataset.page;
      // Update nav active state
      document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Show correct page
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const page = document.getElementById('page-' + pageId);
      if (page) page.classList.add('active');
    });
  });
}

// ── Analytics empty-state guard ──────────────────────────────
// Returns true if any log data exists that can populate charts.
function hasAnalyticsData(data) {
  return (
    (data.trackerLog        || []).length > 0 ||
    (data.cookieTrackerLog  || []).length > 0 ||
    (data.mixedContentLog   || []).length > 0 ||
    (data.darkPatternLog    || []).length > 0
  );
}

function showAnalyticsEmptyState() {
  // Overlay approach: does NOT wipe the canvas elements so charts can render
  // correctly if data appears later without needing a full page reload.
  const page = document.getElementById('page-analytics');
  if (!page) return;
  if (page.querySelector('.analytics-empty-overlay')) return; // already shown
  const overlay = document.createElement('div');
  overlay.className = 'analytics-empty-overlay';
  overlay.style.cssText = [
    'position:absolute', 'inset:0', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'background:var(--bg,#f9fafb)', 'z-index:10',
    'padding:60px 20px', 'text-align:center', 'border-radius:inherit'
  ].join(';');
  overlay.innerHTML =
    '<div style="font-size:36px;margin-bottom:16px;">📊</div>' +
    '<div style="font-size:15px;font-weight:700;margin-bottom:8px;color:var(--text-dark,#111)">No data yet</div>' +
    '<div style="font-size:13px;color:var(--muted,#6b7280);max-width:280px;margin:0 auto;line-height:1.6;">' +
    'Browse a few sites and come back \u2014 charts will populate automatically.</div>';
  if (getComputedStyle(page).position === 'static') page.style.position = 'relative';
  page.appendChild(overlay);
}

// ── Load everything ───────────────────────────────────────────
function loadAll() {
  chrome.storage.local.get(null, data => {
    renderOverview(data);

    // Overview page charts — always render (show zero gracefully)
    renderCalendarHeatmap(data, 'cal-1', 'cal-lbl-1');
    renderDonut(data, 'donut-chart', 'donut-legend', 'donut-total');
    renderTimeline(data, 'timeline-chart');
    renderTopDomains(data, 'domain-list');

    // Analytics page charts — hide behind empty state until data exists
    if (!hasAnalyticsData(data)) {
      showAnalyticsEmptyState();
    } else {
      renderCalendarHeatmap(data, 'cal-2', 'cal-lbl-2');
      renderDonut(data, 'donut-chart-2', 'donut-legend-2', 'donut-total-2');
      renderTimeline(data, 'timeline-chart-2');
      renderTopDomains(data, 'domain-list-2');
    }

    renderFeatureStatus(data);
    renderDarkPatternLog(data);
    buildHistoryData(data);
    buildCompaniesData(data);
    renderScoreHistoryPage();

    // Update badge
    const total = (data.totalCookieTrackersFound||0) + (data.totalTrackersFound||0);
    const badge = document.getElementById('badge-threats');
    if (badge) badge.textContent = total;

    setText('sum-cookies',  data.totalCookieTrackersFound||0);
    setText('sum-trackers', data.totalTrackersFound||0);
    setText('sum-dp',       data.totalDarkPatterns||0);
    setText('sum-mixed',    data.totalMixedContent||0);
    setText('sum-https',    data.totalHttpsRedirects||0);
    setText('sum-links',    data.totalLinksChecked||0);
    document.getElementById('last-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  });
}

// ── Overview Stats ────────────────────────────────────────────
function renderOverview(data) {
  // Global session totals for the stat cards
  const cookieTrackers = data.totalCookieTrackersFound||0;
  const trackerScripts    = data.totalTrackersFound||0;
  const mixedContent      = data.totalMixedContent||0;
  const linksChecked      = data.totalLinksChecked||0;
  const darkPatterns      = data.totalDarkPatterns||0;
  const downloads         = data.totalDownloadsScanned||0;
  const downloadsBlocked  = data.totalDownloadsBlocked||0;
  const httpsRedirects    = data.totalHttpsRedirects||0;
  const blocked           = data.totalThreatsBlocked||0;

  setText('dash-cookie-trackers',  cookieTrackers);
  setText('dash-tracker-scripts',  trackerScripts);
  setText('dash-mixed',            mixedContent);
  setText('dash-links',            linksChecked);
  setText('dash-dark-patterns',    darkPatterns);
  setText('dash-downloads',        downloads);
  setText('dash-downloads-blocked',downloadsBlocked);
  setText('dash-https',            httpsRedirects);
  setText('dash-links-hero',       linksChecked);

  // ── Fix 3: Score card uses real active tab, not the highest-numbered tabUrl_ key.
  // Query the actual active tab in the current window, then read its per-tab
  // storage keys for an accurate score. Falls back gracefully if tabs API is
  // unavailable (e.g. opened as a standalone page during development).
  const renderScoreFromTab = (tabId, tabUrl) => {
    const isHttps = (tabUrl || '').startsWith('https://');
    const perTabKeys = [
      `trackerData_${tabId}`,
      `mixedContent_${tabId}`,
      `cookieData_${tabId}`,
    ];
    chrome.storage.local.get(perTabKeys, tabData => {
      const tabCookies  = tabData[`cookieData_${tabId}`]?.trackers?.length || 0;
      const tabScripts  = tabData[`trackerData_${tabId}`]?.count           || 0;
      const tabMixed    = tabData[`mixedContent_${tabId}`]?.count          || 0;
      const score = computePrivacyScore({ isHttps, trackingCookies: tabCookies, trackers: tabScripts, mixedContent: tabMixed });
      renderGauge(score, tabScripts, tabCookies, tabMixed);
    });
  };

  if (chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs && tabs.length > 0) {
        renderScoreFromTab(tabs[0].id, tabs[0].url || '');
      } else {
        // No active tab found — fall back to global totals with https guess
        const isHttps = (() => {
          const tabUrlKeys = Object.keys(data).filter(k => k.startsWith('tabUrl_'));
          if (!tabUrlKeys.length) return true;
          const latest = tabUrlKeys.sort((a,b)=>(parseInt(b.split('_')[1])||0)-(parseInt(a.split('_')[1])||0))[0];
          return (data[latest]||'').startsWith('https://');
        })();
        const score = computePrivacyScore({ isHttps, trackingCookies: cookieTrackers, trackers: trackerScripts, mixedContent });
        renderGauge(score, trackerScripts, cookieTrackers, mixedContent);
      }
    });
  } else {
    // Fallback for environments where chrome.tabs is not available
    const score = computePrivacyScore({ isHttps: true, trackingCookies: cookieTrackers, trackers: trackerScripts, mixedContent });
    renderGauge(score, trackerScripts, cookieTrackers, mixedContent);
  }
}

// computeScore() removed — use computePrivacyScore() from utils/helpers.js
// Parameter mapping: cookieTrackers→trackingCookies, trackerScripts→trackers

function renderGauge(score, trackers, cookies, mixed) {
  const arc     = document.getElementById('dash-gauge-arc');
  const num     = document.getElementById('dash-score');
  const label   = document.getElementById('dash-score-label');
  const verdict = document.getElementById('dash-score-verdict');
  const bar     = document.getElementById('dash-score-bar');

  let color, lbl, desc;
  if (score >= 80)      { color='#16a34a'; lbl='Safe';          desc='Your browsing looks clean!'; }
  else if (score >= 50) { color='#C1121F'; lbl='Moderate Risk'; desc='Some trackers detected.'; }
  else                  { color='#dc2626'; lbl='High Risk';      desc='Significant threats found.'; }

  if (arc) { arc.style.strokeDashoffset = CIRCUMFERENCE * (1-score/100); arc.style.stroke = color; }
  if (num)     { num.textContent=score; num.style.color=color; }
  if (label)   { label.textContent=lbl; label.style.color=color; }
  if (verdict) verdict.textContent=desc;
  // bar (dash-score-bar) shows tracker proportion — set below with sbt

  const max = Math.max(trackers, cookies, mixed, 1);
  const svt = document.getElementById('sv-t');
  const svc = document.getElementById('sv-c');
  const svm = document.getElementById('sv-m');
  const sbt = document.getElementById('dash-score-bar');
  const sbc = document.getElementById('sb-c');
  const sbm = document.getElementById('sb-m');
  if (svt) svt.textContent = trackers;
  if (svc) svc.textContent = cookies;
  if (svm) svm.textContent = mixed;
  if (sbt) sbt.style.width = (trackers/max*100)+'%';
  if (sbc) sbc.style.width = (cookies/max*100)+'%';
  if (sbm) sbm.style.width = (mixed/max*100)+'%';
}

// ── Top Domains ───────────────────────────────────────────────
function renderTopDomains(data, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const domainCounts = {};
  (data.trackerLog||[]).forEach(entry => {
    (entry.trackers||[]).forEach(t => {
      const domain = t.tracker||t.domain||'unknown';
      domainCounts[domain] = (domainCounts[domain]||0)+1;
    });
  });
  (data.cookieTrackerLog||[]).forEach(entry => {
    (entry.trackers||[]).forEach(t => {
      const domain = (t.domain||'').replace(/^\./,'');
      if (domain) domainCounts[domain] = (domainCounts[domain]||0)+1;
    });
  });
  Object.keys(data).forEach(key => {
    if (key.startsWith('cookieData_')) {
      (data[key].trackers||[]).forEach(t => {
        const domain = (t.cookie?.domain||'').replace(/^\./,'');
        if (domain) domainCounts[domain] = (domainCounts[domain]||0)+1;
      });
    }
  });
  const sorted = Object.entries(domainCounts).sort((a,b)=>b[1]-a[1]).slice(0,10);
  if (sorted.length===0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No tracker data yet — browse some sites!</div></div>`;
    return;
  }
  const max = sorted[0][1];
  const colors = ['#C1121F','#8B0000','#9B1C1C','#7B0D1E','#E5383B','#A4161A','#BA181B','#660708','#D00000','#6A0000'];
  container.innerHTML = sorted.map(([domain, count], i) => `
    <div class="domain-row">
      <div class="domain-name" title="${esc(domain)}">${esc(domain)}</div>
      <div class="domain-bar-wrap"><div class="domain-bar-fill" data-w="${(count/max*100).toFixed(1)}" data-c="${colors[i%colors.length]}"></div></div>
      <div class="domain-count">${count}</div>
    </div>`).join('');
  // Apply styles after render to avoid VS Code CSS linter false positives on template literals
  container.querySelectorAll('.domain-bar-fill').forEach(el => {
    el.style.width = el.dataset.w + '%';
    el.style.background = el.dataset.c;
  });
}

// ── Feature Status ────────────────────────────────────────────
function renderFeatureStatus(data) {
  const settings = data.settings||{};
  const isOn = key => settings[key]!==false;
  setStatusDot('fs-https',        isOn('httpsEnabled'));
  setStatusDot('fs-cookies',      isOn('cookiesEnabled'));
  setStatusDot('fs-links',        isOn('linksEnabled'));
  setStatusDot('fs-downloads',    isOn('downloadsEnabled'));
  setStatusDot('fs-darkpatterns', isOn('darkPatternsEnabled'));
  setText('fs-https-count',     (data.totalHttpsRedirects||0)+' redirects');
  setText('fs-cookies-count',   (data.totalCookieTrackersFound||0)+' caught');
  setText('fs-links-count',     (data.totalLinksChecked||0)+' checked');
  setText('fs-downloads-count', (data.totalDownloadsScanned||0)+' scanned');
  setText('fs-dp-count',        (data.totalDarkPatterns||0)+' caught');
  setText('fs-mixed-count',     (data.totalMixedContent||0)+' found');
}

// Event delegation for all expandable cards
document.addEventListener('click', e => {
  const histHeader = e.target.closest('.history-card-header');
  if (histHeader) {
    const card = histHeader.closest('.history-card');
    if (card) card.classList.toggle('expanded');
    return;
  }
  const compHeader = e.target.closest('.company-info-header');
  if (compHeader) {
    const card = compHeader.closest('.company-info-card');
    if (card) card.classList.toggle('expanded');
    return;
  }
  const shHeader = e.target.closest('.score-history-header');
  if (shHeader) {
    const card = shHeader.closest('.score-history-card');
    if (card) card.classList.toggle('expanded');
    return;
  }
});

// ── Companies Page ────────────────────────────────────────────
function buildCompaniesData(data) {
  // Aggregate all companies seen and sites where they appeared
  const companyMap = new Map(); // name → { company info, sites: Set, count }

  const processDomain = (domain, pageUrl) => {
    if (!domain) return;
    const c = domainToCompany(domain);
    if (!c) return;
    if (!companyMap.has(c.name)) {
      companyMap.set(c.name, { ...c, sites: new Set(), count: 0 });
    }
    const entry = companyMap.get(c.name);
    entry.count++;
    if (pageUrl) {
      let hostname = '';
      try { hostname = new URL(pageUrl).hostname; } catch { hostname = pageUrl; }
      if (hostname) entry.sites.add(hostname);
    }
  };

  (data.trackerLog||[]).forEach(entry => {
    (entry.trackers||[]).forEach(t => processDomain(t.tracker||t.domain||'', entry.pageUrl||entry.url));
  });
  (data.cookieTrackerLog||[]).forEach(entry => {
    (entry.trackers||[]).forEach(t => processDomain((t.cookie?.domain||t.domain||'').replace(/^\./,''), entry.pageUrl||entry.url));
  });
  Object.keys(data).forEach(key => {
    if (key.startsWith('cookieData_')) {
      (data[key].trackers||[]).forEach(t => processDomain((t.cookie?.domain||'').replace(/^\./,''), ''));
    }
  });

  const container = document.getElementById('companies-list');
  if (!container) return;
  if (companyMap.size===0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🏢</div><div class="empty-text">No company data yet — browse some sites</div></div>`;
    return;
  }

  const sorted = Array.from(companyMap.values()).sort((a,b) => a.tier-b.tier || b.count-a.count);

  container.innerHTML = sorted.map((c, idx) => {
    const initials = c.name.split(/[\s\/]+/).filter(w=>/^[a-zA-Z]/.test(w)).map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const info = COMPANY_INFO[c.name] || {};
    const tierLabel = c.tier===1?'High Risk':c.tier===2?'Ad Network':'Analytics';

    const sitesHtml = c.sites.size>0
      ? `<div class="tracker-sub-title" style="margin-top:12px">Sites where this tracker was found</div>
         <div class="company-sites-list">${Array.from(c.sites).slice(0,8).map(s=>`<div class="company-site-row">🌐 <span>${esc(s)}</span></div>`).join('')}</div>`
      : '';

    const dataInfoHtml = info.collects ? `
      <div class="data-use-grid">
        <div class="data-use-item"><div class="data-use-label">📥 What they collect</div><div class="data-use-value">${esc(info.collects)}</div></div>
        <div class="data-use-item"><div class="data-use-label">💰 How they use it</div><div class="data-use-value">${esc(info.howUsed)}</div></div>
        <div class="data-use-item"><div class="data-use-label">⏱️ How long they keep it</div><div class="data-use-value">${esc(info.retains||'Unknown')}</div></div>
        <div class="data-use-item"><div class="data-use-label">⚠️ Privacy risk</div><div class="data-use-value">${esc(info.privacyRisk||'Unknown')}</div></div>
      </div>
      ${info.optOut ? `<div style="margin-top:12px;padding:10px 12px;background:var(--green-bg);border:2px solid var(--green-dark);border-radius:var(--r-xs);">
        <span style="font-size:10px;font-weight:900;color:var(--green-dark);text-transform:uppercase;letter-spacing:.06em;">🛡️ How to opt out</span>
        <div style="font-size:12px;font-weight:700;color:var(--text-dark);margin-top:4px;">${esc(info.optOut)}</div>
      </div>` : ''}` : '<div style="padding:12px 0;color:var(--muted);font-size:12px;font-weight:700;">Detailed data use info not available for this tracker.</div>';

    return `
    <div class="company-info-card" id="ccard-${idx}">
      <div class="company-info-header">
        <div class="company-avatar-lg t${c.tier}">${esc(initials)}</div>
        <div class="company-info-meta">
          <div class="company-info-name">${esc(c.name)}</div>
          <div class="company-info-what">${esc(c.what)}</div>
        </div>
        <span class="tier-badge-lg t${c.tier}">${esc(tierLabel)}</span>
        <span class="company-info-count">${c.count}x</span>
        <span class="expand-icon">▼</span>
      </div>
      <div class="company-info-body">
        ${dataInfoHtml}
        ${sitesHtml}
      </div>
    </div>`;
  }).join('');
}

function toggleCompanyCard(id) {
  const card = document.getElementById(id);
  if (card) card.classList.toggle('expanded');
}

// ── Dark Pattern Log ──────────────────────────────────────────
function renderDarkPatternLog(data) {
  allDpLog = [];
  (data.darkPatternLog||[]).forEach(entry => {
    const pageUrl = entry.pageUrl||'—';
    const ts = entry.timestamp||'';
    (entry.patterns||[]).forEach(p => { allDpLog.push({ type:p.type, text:p.text, url:pageUrl, timestamp:ts }); });
  });
  allDpLog.sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp));
  renderDpTable();
}

function renderDpTable() {
  const tbody = document.getElementById('dp-log-body');
  if (!tbody) return;
  const filtered = activeFilter==='all' ? allDpLog : allDpLog.filter(r=>r.type===activeFilter);
  if (filtered.length===0) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">✨</div><div class="empty-text">No dark patterns logged yet</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.slice(0,100).map(row => {
    const tag  = getPatternTag(row.type);
    const site = (() => { try { return new URL(row.url).hostname; } catch { return row.url||'—'; } })();
    const time = row.timestamp ? new Date(row.timestamp).toLocaleString() : '—';
    const text = (row.text||'').substring(0,60);
    return `<tr><td><span class="pattern-tag ${tag.cls}">${esc(row.type||'Unknown')}</span></td><td style="font-family:'Courier New',monospace;font-size:11px;color:#6b7280;">${esc(site)}</td><td style="color:#6b7280;font-size:11px;">${esc(text)}${row.text?.length>60?'…':''}</td><td style="font-family:'Courier New',monospace;font-size:10px;color:#9ca3af;white-space:nowrap;">${esc(time)}</td></tr>`;
  }).join('');
}

function getPatternTag(type) {
  if (!type) return { cls:'tag-unknown' };
  if (type.includes('Urgency'))   return { cls:'tag-urgency' };
  if (type.includes('Shaming'))   return { cls:'tag-shaming' };
  if (type.includes('Countdown')) return { cls:'tag-countdown' };
  if (type.includes('Checkbox'))  return { cls:'tag-checkbox' };
  if (type.includes('Cookie'))    return { cls:'tag-cookie' };
  return { cls:'tag-unknown' };
}

function initFilterButtons() {
  const dpFilters = document.getElementById('dp-filters');
  if (dpFilters) {
    dpFilters.addEventListener('click', e => {
      const btn = e.target.closest('.dp-filter');
      if (!btn) return;
      document.querySelectorAll('.dp-filter').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.type;
      renderDpTable();
    });
  }
}

// ── Clear data ────────────────────────────────────────────────
function clearAllData() {
  if (!confirm('Clear all ClickSafe stats? This cannot be undone.')) return;
  chrome.storage.local.clear(() => { loadAll(); alert('All data cleared!'); });
}

// ── Helpers ───────────────────────────────────────────────────
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
function setStatusDot(id, isOn) {
  const el = document.getElementById(id);
  if (el) el.className = 'status-dot '+(isOn?'on':'off');
}

// ── Profile button ─────────────────────────────────────────────
async function initProfileBtn() {
  const wrap = document.getElementById('profile-btn-wrap');
  const btn  = document.getElementById('profile-btn');
  if (!wrap || !btn) return;

  const { user } = await getStoredAuth();
  if (user) {
    wrap.classList.add('logged-in');
    btn.title = user.email;
  }

  btn.addEventListener('click', () => {
    window.location.href = '../settings/settings.html';
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('authToken' in changes)) return;
    const newToken = changes.authToken.newValue;
    if (newToken) {
      chrome.storage.local.get(['authUser'], r => {
        wrap.classList.add('logged-in');
        btn.title = r.authUser?.email || 'Account';
      });
    } else {
      wrap.classList.remove('logged-in');
      btn.title = 'Account';
    }
  });
}