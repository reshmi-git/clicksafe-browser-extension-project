// ============================================================
//  privacyScore.js — Threat badge + privacy banner updater
//
//  The score formula lives in utils/helpers.js → computePrivacyScore().
//  background.js loads helpers.js via importScripts before this file,
//  so computePrivacyScore() is already in scope here.
// ============================================================

// Per-tab debounce timers — ensures the privacy banner fires only after
// all async scans (cookies from background, trackers + mixed content from
// content.js) have landed in storage.
const BANNER_DEBOUNCE_MS      = 1500; // ms to wait for all scan results to settle
const BANNER_SCORE_THRESHOLD  = 50;  // scores below this trigger the banner
const _bannerTimers = {};

async function updateThreatBadge(tabId) {
  try {
    const data = await chrome.storage.local.get([
      `cookieData_${tabId}`,
      `trackerData_${tabId}`,
      `mixedContent_${tabId}`,
      `tabUrl_${tabId}`
    ]);

    const cookieThreats  = data[`cookieData_${tabId}`]?.trackingCookies || 0;
    const trackerThreats = data[`trackerData_${tabId}`]?.count           || 0;
    const mixedThreats   = data[`mixedContent_${tabId}`]?.count          || 0;
    const tabUrl         = data[`tabUrl_${tabId}`]                       || '';
    const isHttps        = tabUrl.startsWith('https://');
    const total          = cookieThreats + trackerThreats + mixedThreats;

    if (total > 0) {
      chrome.action.setBadgeText({ text: String(total), tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#DC2626', tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }

    const score = computePrivacyScore({
      isHttps,
      trackingCookies: cookieThreats,
      trackers:        trackerThreats,
      mixedContent:    mixedThreats
    });

    chrome.storage.local.set({ [`privacyScore_${tabId}`]: score });

    // Debounce banner so all scan results are settled before we decide
    clearTimeout(_bannerTimers[tabId]);
    _bannerTimers[tabId] = setTimeout(async () => {
      delete _bannerTimers[tabId];
      try {
        const settled = await chrome.storage.local.get([
          `cookieData_${tabId}`,
          `trackerData_${tabId}`,
          `mixedContent_${tabId}`,
          `tabUrl_${tabId}`
        ]);
        const sCookies  = settled[`cookieData_${tabId}`]?.trackingCookies || 0;
        const sTrackers = settled[`trackerData_${tabId}`]?.count           || 0;
        const sMixed    = settled[`mixedContent_${tabId}`]?.count          || 0;
        const sUrl      = settled[`tabUrl_${tabId}`]                       || '';
        const sHttps    = sUrl.startsWith('https://');
        const sTotal    = sCookies + sTrackers + sMixed;
        const sScore    = computePrivacyScore({
          isHttps:         sHttps,
          trackingCookies: sCookies,
          trackers:        sTrackers,
          mixedContent:    sMixed
        });

        chrome.storage.local.set({ [`privacyScore_${tabId}`]: sScore });

        if (sScore < BANNER_SCORE_THRESHOLD && sTotal > 0) {
          let topReason = '';
          if (!sHttps)        topReason = 'This page is not encrypted (HTTP)';
          else if (sCookies)  topReason = `${sCookies} tracking cookie${sCookies > 1 ? 's' : ''} detected`;
          else if (sTrackers) topReason = `${sTrackers} tracker script${sTrackers > 1 ? 's' : ''} detected`;
          else if (sMixed)    topReason = `${sMixed} mixed-content resource${sMixed > 1 ? 's' : ''} loaded`;
          chrome.tabs.sendMessage(tabId, {
            type: 'SHOW_PRIVACY_BANNER', score: sScore, topReason, total: sTotal
          }).catch(() => {});
        } else {
          chrome.tabs.sendMessage(tabId, { type: 'HIDE_PRIVACY_BANNER' }).catch(() => {});
        }
      } catch (_) {}
    }, BANNER_DEBOUNCE_MS);

  } catch (e) {
    console.error('[ClickSafe Badge]', e);
  }
}