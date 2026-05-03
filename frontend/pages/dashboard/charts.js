// ============================================================
//  ClickSafe — charts.js
//  renderDonut, renderTimeline, renderCalendarHeatmap,
//  _renderCal, changeCalMonth, buildDayCountMap
// ============================================================

// ── Calendar state (shared across renderCalendarHeatmap calls) ─
window._calData = {};
window._calState = {};

function buildDayCountMap(data) {
  const map = {};
  const add = (ts, n) => {
    if (!ts) return;
    const key = new Date(ts).toDateString();
    map[key] = (map[key]||0) + n;
  };
  [...(data.trackerLog||[]),...(data.darkPatternLog||[])].forEach(e => {
    const ts = e.timestamp||e.data?.timestamp;
    add(ts, e.trackers?.length||e.patterns?.length||e.count||1);
  });
  (data.mixedContentLog||[]).forEach(e => add(e.timestamp, e.resources?.length||1));
  (data.cookieTrackerLog||[]).forEach(e => add(e.timestamp, e.count||1));
  return map;
}

function renderCalendarHeatmap(data, gridId, lblId) {
  const gridEl = document.getElementById(gridId);
  if (!gridEl) return;
  const now = new Date();
  if (!window._calState[gridId]) window._calState[gridId] = { year: now.getFullYear(), month: now.getMonth() };
  window._calData[gridId] = data;
  _renderCal(gridId, lblId);
}

function _renderCal(gridId, lblId) {
  const gridEl = document.getElementById(gridId);
  const lblEl  = document.getElementById(lblId);
  if (!gridEl) return;
  const { year, month } = window._calState[gridId];
  const data = window._calData[gridId] || {};
  const dayMap = buildDayCountMap(data);
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  if (lblEl) lblEl.textContent = `${monthNames[month]} ${year}`;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  let maxCount = 1;
  for (let d=1; d<=daysInMonth; d++) {
    const key = new Date(year, month, d).toDateString();
    if ((dayMap[key]||0) > maxCount) maxCount = dayMap[key];
  }
  const today = new Date().toDateString();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  gridEl.innerHTML = '';
  for (let i=0; i<totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    const num = document.createElement('span');
    num.className = 'cal-cell-num';
    let dayNum, dateStr, isOther = false;
    if (i < firstDay) {
      dayNum = daysInPrevMonth - firstDay + 1 + i;
      dateStr = new Date(year, month-1, dayNum).toDateString();
      isOther = true;
    } else if (i >= firstDay + daysInMonth) {
      dayNum = i - firstDay - daysInMonth + 1;
      dateStr = new Date(year, month+1, dayNum).toDateString();
      isOther = true;
    } else {
      dayNum = i - firstDay + 1;
      dateStr = new Date(year, month, dayNum).toDateString();
    }
    num.textContent = dayNum;
    const count = dayMap[dateStr]||0;
    if (count === 0) {
      cell.style.background = isOther ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0.09)';
    } else {
      const a = 0.15 + (count/maxCount)*0.85;
      cell.style.background = `rgba(193,18,31,${a.toFixed(2)})`;
    }
    if (isOther) cell.classList.add('other-month');
    if (dateStr === today) cell.classList.add('today');
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.textContent = `${dateStr.slice(4,10)} · ${count} event${count!==1?'s':''}`;
    cell.appendChild(num);
    cell.appendChild(tip);
    gridEl.appendChild(cell);
  }
}

function changeCalMonth(delta, gridId) {
  if (!window._calState[gridId]) return;
  let { year, month } = window._calState[gridId];
  month += delta;
  if (month > 11) { month = 0; year++; }
  if (month < 0)  { month = 11; year--; }
  window._calState[gridId] = { year, month };
  const lblId = gridId.replace('cal-','cal-lbl-');
  _renderCal(gridId, lblId);
}

// ── Donut ─────────────────────────────────────────────────────
function renderDonut(data, canvasId, legendId, totalId) {
  const cookieTrackers = data.totalCookieTrackersFound||0;
  const trackerScripts = data.totalTrackersFound||0;
  const mixedContent   = data.totalMixedContent||0;
  const darkPatterns   = data.totalDarkPatterns||0;
  const linksBlocked   = data.totalThreatsBlocked||0;
  const total = cookieTrackers+trackerScripts+mixedContent+darkPatterns+linksBlocked;
  setText(totalId, total);

  const labels = ['Cookie Trackers','Tracker Scripts','Mixed Content','Dark Patterns','Links Blocked'];
  const values = [cookieTrackers,trackerScripts,mixedContent,darkPatterns,linksBlocked];
  const colors = ['#E63946','#FF9600','#a78bfa','#38bdf8','#4ade80'];

  const canvasEl = document.getElementById(canvasId);
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');

  const chartVar = canvasId === 'donut-chart' ? 'donutChart' : 'donutChart2';
  if (window[chartVar]) window[chartVar].destroy();
  window[chartVar] = new Chart(ctx, {
    type:'doughnut',
    data: { labels, datasets:[{ data:values, backgroundColor:colors.map(c=>c+'cc'), borderColor:colors, borderWidth:1.5, hoverOffset:6 }] },
    options: { cutout:'72%', plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>` ${ctx.label}: ${ctx.raw}`}} }, animation:{animateRotate:true,duration:800} }
  });

  const legend = document.getElementById(legendId);
  if (legend) legend.innerHTML = labels.map((l,i)=>`<div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dark);font-weight:700;"><div style="width:10px;height:10px;border-radius:2px;background:${colors[i]};flex-shrink:0;"></div>${l}</div>`).join('');
}

// ── Timeline ──────────────────────────────────────────────────
function renderTimeline(data, canvasId) {
  const buckets = Array(24).fill(0);
  const now = new Date();
  const allLogs = [...(data.trackerLog||[]),...(data.darkPatternLog||[]),...(data.mixedContentLog||[]),...(data.cookieTrackerLog||[])];
  allLogs.forEach(entry => {
    const ts = entry.timestamp||entry.data?.timestamp;
    if (!ts) return;
    const diffHours = (now - new Date(ts))/(1000*60*60);
    if (diffHours <= 24) {
      const hour = Math.floor(diffHours);
      buckets[23-hour] += (entry.trackers?.length||entry.patterns?.length||entry.resources?.length||entry.count||1);
    }
  });
  const labels = Array(24).fill(0).map((_,i)=>{ const h=new Date(now-(23-i)*3600000); return h.getHours()+':00'; });
  const canvasEl = document.getElementById(canvasId);
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');
  const chartVar = canvasId === 'timeline-chart' ? 'timelineChart' : 'timelineChart2';
  if (window[chartVar]) window[chartVar].destroy();
  window[chartVar] = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[{ label:'Threats', data:buckets, borderColor:'#C1121F', backgroundColor:'rgba(193,18,31,0.07)', borderWidth:2, pointRadius:3, pointBackgroundColor:'#C1121F', fill:true, tension:0.4 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:'#9ca3af',font:{size:11},maxTicksLimit:8},grid:{color:'rgba(0,0,0,0.06)'}}, y:{ticks:{color:'#9ca3af',font:{size:11}},grid:{color:'rgba(0,0,0,0.06)'},beginAtZero:true} } }
  });
}