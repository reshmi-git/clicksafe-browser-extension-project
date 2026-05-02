// ============================================================
//  trackerBlocklist.js — Disconnect.me tracker blocklist
// ============================================================

let trackerSet = new Set();

async function loadTrackerBlocklist() {
  try {
    const bundledRes  = await fetch(chrome.runtime.getURL('data/trackers.json'));
    const bundledList = await bundledRes.json();
    bundledList.forEach(d => trackerSet.add(d));
    console.log(`[ClickSafe] Bundled tracker list: ${trackerSet.size} domains`);
  } catch (err) {
    console.warn('[ClickSafe] Bundled tracker list failed:', err.message);
  }

  try {
    const stored  = await chrome.storage.local.get(['trackerBlocklist', 'trackerBlocklistUpdated']);
    const age     = Date.now() - (stored.trackerBlocklistUpdated || 0);
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (age < ONE_DAY && stored.trackerBlocklist?.length) {
      stored.trackerBlocklist.forEach(d => trackerSet.add(d));
      console.log(`[ClickSafe] Cached live tracker list: ${trackerSet.size} total`);
      return;
    }

    // Poll the ClickSafe backend instead of hitting GitHub directly —
    // keeps the API key and fetch logic server-side, and lets us push
    // blocklist updates without requiring users to reinstall the extension.
    const liveRes = await fetch(`${BACKEND_URL}/api/blocklist`);
    if (!liveRes.ok) throw new Error(`Backend returned HTTP ${liveRes.status}`);

    const liveData    = await liveRes.json();
    const liveDomains = liveData.domains || [];

    liveDomains.forEach(d => trackerSet.add(d));

    await chrome.storage.local.set({
      trackerBlocklist:        liveDomains,
      trackerBlocklistUpdated: Date.now()
    });

    console.log(`[ClickSafe] Live tracker list from backend: ${trackerSet.size} total`);
  } catch (err) {
    console.warn('[ClickSafe] Live tracker fetch failed:', err.message);
  }
}

function isTracker(hostname) {
  if (!hostname) return false;
  if (trackerSet.has(hostname)) return true;
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (trackerSet.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}