// ============================================================
//  ClickSafe — scoreHistory.js
//  Score history page: render scored-page cards, expand/collapse
//  Depends on: computePrivacyScore() defined in dashboard.js
//              (loaded before this file via <script> tags)
// ============================================================


// esc() is defined in historyView.js (loaded before this file)

async function renderScoreHistoryPage() {
  const container = document.getElementById('score-history-list-page');
  if (!container) return;

  // Try server first if the user is logged in
  let history = [];
  let fromServer = false;
  if (typeof fetchScoreHistory === 'function') {
    try {
      const serverEntries = await fetchScoreHistory(200);
      if (serverEntries.length > 0) {
        // Normalise server shape to match local shape
        history = serverEntries.map(e => ({
          url:          e.url,
          isHttps:      e.isHttps,
          timestamp:    e.timestamp,
          companyCount: e.companyCount,
          cookieCount:  e.cookieCount,
          scriptCount:  e.scriptCount,
          companies:    e.companies || [],
        }));
        fromServer = true;
      }
    } catch (_) { /* fall through to local */ }
  }

  // Fall back to chrome.storage.local if server returned nothing
  if (!fromServer) {
    history = await new Promise(resolve =>
      chrome.storage.local.get(['sidepanelTrackerHistory'], r =>
        resolve(r.sidepanelTrackerHistory || [])
      )
    );
  }

  if (history.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">No scored pages yet — browse some sites</div></div>';
    return;
  }

    container.innerHTML = history.slice(0, 20).map((item, idx) => {
      let domain = '';
      try { domain = new URL(item.url).hostname; } catch { domain = item.url || '?'; }

      const isHttps   = item.isHttps !== false;
      const cookies   = item.cookieCount  || 0;
      const scripts   = item.scriptCount  || 0;
      const mixed     = 0; // not stored per-entry in sidepanel history

      const score = computePrivacyScore({
        isHttps,
        trackingCookies: cookies,
        trackers:        scripts,
        mixedContent:    mixed
      });

      let scoreColor, verdictLabel, verdictDesc, verdictBg;
      if (score >= 80) {
        scoreColor   = '#16a34a';
        verdictLabel = 'Safe';
        verdictDesc  = 'No major threats detected';
        verdictBg    = 'var(--green-bg)';
      } else if (score >= 50) {
        scoreColor   = '#d97706';
        verdictLabel = 'Moderate Risk';
        verdictDesc  = 'Some trackers found on this page';
        verdictBg    = 'var(--orange-bg)';
      } else {
        scoreColor   = '#cc2020';
        verdictLabel = 'High Risk';
        verdictDesc  = 'Heavy tracking detected';
        verdictBg    = 'var(--red-bg)';
      }

      const circ = 120;
      const offset = circ - (circ * score / 100);
      const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleString() : '—';

      const httpsImpact  = isHttps ? '0 pts' : '-30 pts';
      const cookieImpact = cookies > 0 ? `-${Math.min(cookies*5,30)} pts` : '0 pts';
      const scriptImpact = scripts > 0 ? `-${Math.min(scripts*4,20)} pts` : '0 pts';

      const companies = (item.companies || []).slice(0, 5);

      return `
        <div class="score-history-card" id="shcard-${idx}">
          <div class="score-history-header">
            <div class="score-history-ring">
              <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                <circle cx="24" cy="24" r="19" fill="none" stroke="var(--border)" stroke-width="4"/>
                <circle cx="24" cy="24" r="19" fill="none" stroke="${scoreColor}" stroke-width="4"
                  stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
              </svg>
              <div class="score-history-ring-center" style="color:${scoreColor}">${score}</div>
            </div>
            <div class="score-history-info">
              <div class="score-history-domain">${esc(domain)}</div>
              <div class="score-history-url">${esc(item.url || '')}</div>
            </div>
            <div class="score-history-time">${timeStr}</div>
            <span class="expand-icon" style="font-size:12px;color:var(--muted);margin-left:8px">▼</span>
          </div>
          <div class="score-history-body">
            <div class="score-verdict-row" style="background:${verdictBg};border-color:${scoreColor};margin-bottom:14px;">
              <div class="score-verdict-num" style="color:${scoreColor}">${score}</div>
              <div>
                <div class="score-verdict-label" style="color:${scoreColor}">${verdictLabel}</div>
                <div class="score-verdict-desc" style="color:var(--muted)">${verdictDesc}</div>
              </div>
            </div>
            <div class="score-why-grid">
              <div class="score-why-box">
                <div class="score-why-label">HTTPS</div>
                <div class="score-why-val" style="color:${isHttps?'#16a34a':'#cc2020'}">${isHttps?'Yes':'No'}</div>
                <div class="score-why-impact" style="color:${isHttps?'#16a34a':'#cc2020'}">${httpsImpact}</div>
              </div>
              <div class="score-why-box">
                <div class="score-why-label">Track. Cookies</div>
                <div class="score-why-val" style="color:${cookies>0?'#cc2020':'var(--text-dark)'}">${cookies}</div>
                <div class="score-why-impact" style="color:${cookies>0?'#cc2020':'var(--muted)'}">${cookieImpact}</div>
              </div>
              <div class="score-why-box">
                <div class="score-why-label">Scripts</div>
                <div class="score-why-val" style="color:${scripts>0?'#d97706':'var(--text-dark)'}">${scripts}</div>
                <div class="score-why-impact" style="color:${scripts>0?'#d97706':'var(--muted)'}">${scriptImpact}</div>
              </div>
              <div class="score-why-box">
                <div class="score-why-label">Companies</div>
                <div class="score-why-val" style="color:var(--purple-dark)">${item.companyCount||0}</div>
                <div class="score-why-impact" style="color:var(--muted)">tracked</div>
              </div>
            </div>
            ${companies.length > 0 ? `
            <div style="font-size:10px;font-weight:900;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:7px;">Who was watching</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;">
              ${companies.map(c => {
                const col = c.tier===1?'var(--red-dark)':c.tier===2?'var(--orange-dark)':'var(--blue-dark)';
                const bg  = c.tier===1?'var(--red-bg)':c.tier===2?'var(--orange-bg)':'var(--blue-bg)';
                return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;background:${bg};color:${col};border:2px solid ${col}">${esc(c.name)}</span>`;
              }).join('')}
            </div>` : ''}
          </div>
        </div>`;
    }).join('');
}

function toggleShCard(id) {
  const card = document.getElementById(id);
  if (card) card.classList.toggle('expanded');
}