// ============================================================
//  ClickSafe — historyView.js
//  Tracker history list: build, filter, render, expand/collapse
//  Depends on: domainToCompany() from companyData.js
//              allHistoryData, activeHFilter, histSearchVal
//              (all declared in dashboard.js)
// ============================================================


// ── HTML escaping (prevents XSS from tracker domain names / cookie names / URLs)
function esc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function buildHistoryData(data) {
  allHistoryData = [];

  // Build from trackerLog
  (data.trackerLog||[]).forEach(entry => {
    if (!entry.pageUrl && !entry.url) return;
    const url = entry.pageUrl||entry.url||'';
    let domain = '';
    try { domain = new URL(url).hostname; } catch { domain = url; }
    allHistoryData.push({
      domain, url, timestamp: entry.timestamp||'',
      scripts: entry.trackers||[],
      cookies: [],
      mixed: []
    });
  });

  // Add cookie data from cookieTrackerLog
  (data.cookieTrackerLog||[]).forEach(entry => {
    const url = entry.pageUrl||entry.url||'';
    let domain = '';
    try { domain = new URL(url).hostname; } catch { domain = url||'unknown'; }
    // Try merging with existing entry for same domain/time
    const existing = allHistoryData.find(h => h.domain===domain && Math.abs(new Date(h.timestamp)-new Date(entry.timestamp||''))<60000);
    if (existing) {
      existing.cookies = [...existing.cookies, ...(entry.trackers||[])];
    } else {
      allHistoryData.push({ domain, url, timestamp:entry.timestamp||'', scripts:[], cookies:entry.trackers||[], mixed:[] });
    }
  });

  // Add mixed content
  (data.mixedContentLog||[]).forEach(entry => {
    const url = entry.pageUrl||entry.url||'';
    let domain = '';
    try { domain = new URL(url).hostname; } catch { domain = url||'unknown'; }
    const existing = allHistoryData.find(h => h.domain===domain && Math.abs(new Date(h.timestamp)-new Date(entry.timestamp||''))<60000);
    if (existing) {
      existing.mixed = [...existing.mixed, ...(entry.resources||[])];
    } else {
      allHistoryData.push({ domain, url, timestamp:entry.timestamp||'', scripts:[], cookies:[], mixed:entry.resources||[] });
    }
  });

  // Sort newest first
  allHistoryData.sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp));
  renderHistoryList();
}

function renderHistoryList() {
  const container = document.getElementById('history-list');
  if (!container) return;

  let filtered = allHistoryData.filter(entry => {
    if (activeHFilter==='cookies' && entry.cookies.length===0) return false;
    if (activeHFilter==='scripts' && entry.scripts.length===0) return false;
    if (activeHFilter==='mixed'   && entry.mixed.length===0)   return false;
    if (histSearchVal && !entry.domain.toLowerCase().includes(histSearchVal)) return false;
    return true;
  });

  if (filtered.length===0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🕒</div><div class="empty-text">No entries match your filter</div></div>`;
    return;
  }

  container.innerHTML = filtered.slice(0,100).map((entry,idx) => {
    const initial = entry.domain.charAt(0).toUpperCase();
    const timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—';

    const badges = [];
    if (entry.cookies.length>0) badges.push(`<span class="hbadge hbadge-red">🍪 ${entry.cookies.length} cookies</span>`);
    if (entry.scripts.length>0) badges.push(`<span class="hbadge hbadge-orange">🔍 ${entry.scripts.length} scripts</span>`);
    if (entry.mixed.length>0)   badges.push(`<span class="hbadge hbadge-blue">⚠️ ${entry.mixed.length} mixed</span>`);

    // Company names from scripts
    const companySet = new Map();
    entry.scripts.forEach(t => {
      const c = domainToCompany(t.tracker||t.domain||'');
      if (c && !companySet.has(c.name)) companySet.set(c.name, c);
    });
    entry.cookies.forEach(t => {
      const domain = t.cookie?.domain||t.domain||'';
      const c = domainToCompany(domain);
      if (c && !companySet.has(c.name)) companySet.set(c.name, c);
    });

    const companiesList = Array.from(companySet.values()).slice(0,8);
    const scriptPills = entry.scripts.slice(0,10).map(t => {
      const domain = t.tracker||t.domain||'';
      const c = domainToCompany(domain);
      const dotColor = !c ? '#888' : c.tier===1 ? '#CC2020' : c.tier===2 ? '#FF9600' : '#1CB0F6';
      return `<span class="tracker-pill"><span class="tracker-pill-dot" style="background:${dotColor}"></span>${esc(domain)||'unknown'}</span>`;
    }).join('');
    const cookiePills = entry.cookies.slice(0,10).map(t => {
      const domain = (t.cookie?.domain||t.domain||'').replace(/^\./,'');
      return `<span class="tracker-pill"><span class="tracker-pill-dot" style="background:#CC2020"></span>${esc(domain)||'—'}: <em style="color:var(--muted)">${esc(t.cookie?.name||t.name||'?')}</em></span>`;
    }).join('');

    return `
    <div class="history-card" id="hcard-${idx}">
      <div class="history-card-header">
        <div class="history-card-favicon">${initial}</div>
        <div class="history-card-info">
          <div class="history-card-domain">${esc(entry.domain)||'Unknown site'}</div>
          <div class="history-card-time">${timeStr}</div>
        </div>
        <div class="history-card-badges">${badges.join('')}</div>
        <span class="expand-icon">▼</span>
      </div>
      <div class="history-card-body">
        ${companiesList.length>0 ? `
        <div class="tracker-sub-section">
          <div class="tracker-sub-title">🏢 Companies that tracked you here</div>
          <div class="tracker-pill-list">${companiesList.map(c=>{
            const dotColor = c.tier===1?'#CC2020':c.tier===2?'#FF9600':'#1CB0F6';
            return `<span class="tracker-pill"><span class="tracker-pill-dot" style="background:${dotColor}"></span>${esc(c.name)}</span>`;
          }).join('')}</div>
        </div>` : ''}
        ${scriptPills ? `<div class="tracker-sub-section"><div class="tracker-sub-title">🔍 Tracker Scripts</div><div class="tracker-pill-list">${scriptPills}</div></div>` : ''}
        ${cookiePills ? `<div class="tracker-sub-section"><div class="tracker-sub-title">🍪 Tracking Cookies</div><div class="tracker-pill-list">${cookiePills}</div></div>` : ''}
        ${entry.mixed.length>0 ? `<div class="tracker-sub-section"><div class="tracker-sub-title">⚠️ Mixed Content</div><div class="tracker-pill-list">${entry.mixed.slice(0,6).map(r=>`<span class="tracker-pill" style="font-size:10px;color:var(--muted)">${esc((typeof r==='string'?r:r.url||r).substring(0,50))}</span>`).join('')}</div></div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function toggleHistCard(id) {
  const card = document.getElementById(id);
  if (card) card.classList.toggle('expanded');
}