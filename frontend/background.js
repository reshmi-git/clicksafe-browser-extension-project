// ============================================================
//  background.js — Orchestrator (Service Worker)
//
//  Imports (via importScripts):
//    background/settings.js
//    background/cookieScanner.js
//    background/privacyScore.js
//    background/safeBrowsing.js
//    background/trackerBlocklist.js
// ============================================================

importScripts(
  'utils/helpers.js',
  'utils/auth.js',
  'background/settings.js',
  'background/cookieScanner.js',
  'background/privacyScore.js',
  'background/safeBrowsing.js',
  'background/trackerBlocklist.js'
);

// ── Backend URL ─────────────────────────────────────────────────────────────
// All Safe Browsing API calls are proxied through this Render server so the
// Google API key never touches the client.  Replace the placeholder below
// with your actual Render service URL once you have deployed the backend
// (see /backend/README.md for deployment steps).
const BACKEND_URL = 'https://clicksafe-backend.onrender.com';
// SB prefix refresh is driven by chrome.alarms (30-min period) instead of
// setInterval, because service workers can be suspended between events which
// would silently kill a setInterval timer.
const SB_ALARM_NAME    = 'clicksafe-sb-refresh';
const SB_ALARM_MINUTES = 30;
const SB_REFRESH_MS    = SB_ALARM_MINUTES * 60 * 1000; // ms — mirrors the alarm period

// How long to keep rolling log entries (cookieLog, trackerLog, mixedContent, dark patterns).
const LOG_CUTOFF_MS    = 30 * 24 * 60 * 60 * 1000; // 30 days

// Hard timeout applied to every fetchWithTimeout() call unless overridden.
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

// ── Fetch with timeout ──────────────────────────────────────────────────────
// Wraps fetch() with an AbortController so a hung backend never leaves a
// download paused forever or blocks a link-check response indefinitely.
function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

// ============================================================
//  PANEL PAYLOAD
// ============================================================

async function buildPanelPayload(tabId, tabUrl) {
  const isHttps = (tabUrl || '').startsWith('https://');

  const keys = [
    'totalTrackersFound',
    'totalMixedContent',
    'totalCookieTrackersFound',
    'totalLinksChecked',
    `trackerData_${tabId}`,
    `mixedContent_${tabId}`,
    `cookieData_${tabId}`,
    `privacyScore_${tabId}`,
    `linksChecked_${tabId}`
  ];

  const result = await chrome.storage.local.get(keys);

  return {
    url:              tabUrl || '',
    isHttps,
    score:            result[`privacyScore_${tabId}`],
    pageTrackerCount: result[`trackerData_${tabId}`]?.count || 0,
    pageTrackerScripts: result[`trackerData_${tabId}`]?.trackers || [],
    pageMixedCount:   result[`mixedContent_${tabId}`]?.count || 0,
    cookieData:       result[`cookieData_${tabId}`] || {},
    linksChecked:     result[`linksChecked_${tabId}`] || 0,
    totalTrackersFound:       result.totalTrackersFound       || 0,
    totalMixedContent:        result.totalMixedContent        || 0,
    totalCookieTrackersFound: result.totalCookieTrackersFound || 0,
    totalLinksChecked:        result.totalLinksChecked        || 0,
  };
}

async function pushPanelUpdate(tabId, tabUrl) {
  try {
    const payload = await buildPanelPayload(tabId, tabUrl);
    chrome.runtime.sendMessage({ type: 'PANEL_UPDATE', payload }).catch(() => {});
  } catch (e) {}
}

// ============================================================
//  STARTUP
// ============================================================

// ── First-run onboarding ─────────────────────────────────────────────────────
// Opens the onboarding page once when the extension is first installed.
// On updates or browser restarts this listener fires with reason !== 'install'
// so existing users are never shown it again.
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason !== 'install') return;

  // Belt-and-suspenders: also check storage in case the flag was set during
  // a previous dev-mode reload where reason was still 'install'.
  chrome.storage.local.get(['onboardingComplete'], result => {
    if (result.onboardingComplete) return;
    chrome.tabs.create({
      url: chrome.runtime.getURL('pages/onboarding/onboarding.html'),
      active: true,
    });
  });
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(err => console.warn('[ClickSafe] sidePanel.setPanelBehavior:', err));

loadTrackerBlocklist();
loadSbPrefixesFromStorage();

// ── Sync server whitelist into currentSettings on startup ────────────────────
// If the user is logged in, pull their server whitelist and merge it into
// currentSettings.whitelist so CHECK_LINK respects it immediately, without
// requiring the settings page to be opened first.
(async function syncWhitelistOnStartup() {
  try {
    const serverDomains = await fetchWhitelist();
    if (!serverDomains.length) return;
    const merged = [...new Set([...(currentSettings.whitelist || []), ...serverDomains])];
    currentSettings.whitelist = merged;
    // Persist merged list so it survives worker restarts
    chrome.storage.local.get(['settings'], r => {
      const updated = { ...DEFAULT_SETTINGS, ...(r.settings || {}), whitelist: merged };
      chrome.storage.local.set({ settings: updated });
    });
  } catch (_) { /* best-effort — never block startup */ }
})();

// Use chrome.alarms instead of setInterval so the periodic refresh survives
// service worker suspension. The alarm is persistent across worker restarts;
// createProperties.when is only respected on the very first creation, so
// calling create() on every startup is safe — Chrome ignores it if the alarm
// already exists with the same name.
chrome.alarms.create(SB_ALARM_NAME, { periodInMinutes: SB_ALARM_MINUTES });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === SB_ALARM_NAME) updateSbPrefixes();
});

if (chrome.webNavigation) {
  chrome.webNavigation.onCommitted.addListener(details => {
    if (
      details.frameId === 0 &&
      details.url.startsWith('https://') &&
      details.transitionQualifiers &&
      details.transitionQualifiers.includes('server_redirect')
    ) {
      chrome.storage.local.get(['totalHttpsRedirects'], r => {
        chrome.storage.local.set({ totalHttpsRedirects: (r.totalHttpsRedirects || 0) + 1 });
      });
    }
  });
}

// ============================================================
//  TAB LOAD — icon + cookie scan
// ============================================================

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  await chrome.storage.local.remove([
    `cookieData_${tabId}`,
    `trackerData_${tabId}`,
    `mixedContent_${tabId}`,
    `privacyScore_${tabId}`,
    `linksChecked_${tabId}`
  ]);
  chrome.action.setBadgeText({ text: '', tabId });
  await chrome.storage.local.set({ [`tabUrl_${tabId}`]: tab.url });

  const icon = tab.url.startsWith('https://')
    ? 'assets/logo/16.png'
    : tab.url.startsWith('http://')
      ? 'assets/logo/16-red.png'
      : null;
  if (icon) chrome.action.setIcon({ tabId, path: { 16: icon } });

  if (currentSettings.cookiesEnabled) {
    try {
      const cookieData = await scanAllCookiesForUrl(tab.url, tabId);
      if (cookieData && !cookieData.error) {
        await chrome.storage.local.set({
          [`cookieData_${tabId}`]: cookieData,
          lastPageTracking:        cookieData.trackers,
          totalCookiesFound:       cookieData.totalCookies
        });

        const stored = await chrome.storage.local.get(['cookieTrackerLog', 'totalCookieTrackersFound']);
        const updates = {
          totalCookieTrackersFound: (stored.totalCookieTrackersFound || 0) + cookieData.trackingCookies
        };
        if (cookieData.trackingCookies > 0) {
          const log = stored.cookieTrackerLog || [];
          log.push({
            pageUrl:   cookieData.pageUrl,
            timestamp: cookieData.timestamp,
            count:     cookieData.trackingCookies,
            trackers:  cookieData.trackers.map(t => ({
              domain: (t.cookie?.domain || '').replace(/^\./, '')
            }))
          });
          const cutoff = Date.now() - LOG_CUTOFF_MS;
          updates.cookieTrackerLog = log.filter(e => new Date(e.timestamp).getTime() > cutoff);
        }
        await chrome.storage.local.set(updates);

        updateThreatBadge(tabId);
        pushPanelUpdate(tabId, tab.url);
      }
    } catch (err) {
      console.error('[ClickSafe Cookie]', err);
    }
  }

  pushPanelUpdate(tabId, tab.url);
});

// ============================================================
//  MESSAGE LISTENER
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'SETTINGS_UPDATED') {
    currentSettings = { ...DEFAULT_SETTINGS, ...message.settings };
    return;
  }

  if (message.type === 'GET_CURRENT_TAB_STATS') {
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      if (!tabs[0]) { sendResponse(null); return; }
      const payload = await buildPanelPayload(tabs[0].id, tabs[0].url);
      sendResponse(payload);
    });
    return true;
  }

  if (message.type === 'MIXED_CONTENT_DETECTED') {
    if (!currentSettings.httpsEnabled) return;
    const tabId = sender.tab?.id;
    chrome.storage.local.get(['totalMixedContent', 'mixedContentLog'], result => {
      const log = result.mixedContentLog || [];
      log.push(message.data);
      // Trim to 30 days to prevent unbounded growth
      const _mixedCutoff = Date.now() - LOG_CUTOFF_MS;
      const trimmedMixedLog = log.filter(e => new Date(e.timestamp || 0).getTime() > _mixedCutoff);
      chrome.storage.local.set({
        totalMixedContent:         (result.totalMixedContent || 0) + message.data.resources.length,
        mixedContentLog:           trimmedMixedLog,
        [`mixedContent_${tabId}`]: { count: message.data.resources.length, resources: message.data.resources }
      }, () => {
        if (tabId) {
          updateThreatBadge(tabId);
          chrome.storage.local.get([`tabUrl_${tabId}`], r => pushPanelUpdate(tabId, r[`tabUrl_${tabId}`] || ''));
        }
      });
    });
    return;
  }

  if (message.type === 'TRACKERS_DETECTED') {
    // No guard needed here — tracker scanning is already controlled by content.js
    // (which only runs if the blocklist is loaded). The background always records
    // whatever content.js reports. Previously this was gated on cookiesEnabled,
    // which is incorrect — tracker script detection and cookie detection are
    // independent features.
    const tabId = sender.tab?.id ?? null;
    chrome.storage.local.get(['trackerLog', 'totalTrackersFound', 'tabTrackers', `trackerData_${tabId}`], result => {
      const log         = result.trackerLog  || [];
      const tabTrackers = result.tabTrackers || {};

      const prevTrackers  = result[`trackerData_${tabId}`]?.trackers || [];
      const prevHostnames = new Set(prevTrackers.map(t => t.tracker));
      const newTrackers   = message.data.trackers.filter(t => !prevHostnames.has(t.tracker));

      log.push(message.data);
      // Cap trackerLog to 30 days — without this it grows forever since there
      // is no eviction path unlike cookieTrackerLog.
      const _logCutoff = Date.now() - LOG_CUTOFF_MS;
      const trimmedLog = log.filter(e => new Date(e.timestamp || 0).getTime() > _logCutoff);

      if (tabId !== null) tabTrackers[tabId] = message.data.trackers;

      // Build the storage update object conditionally so we never write a
      // "trackerData_null" key when sender.tab is undefined (background messages).
      const trackerUpdate = {
        trackerLog:         trimmedLog,
        totalTrackersFound: (result.totalTrackersFound || 0) + newTrackers.length,
        tabTrackers,
      };
      if (tabId !== null) {
        trackerUpdate[`trackerData_${tabId}`] = { count: message.data.trackers.length, trackers: message.data.trackers };
      }

      chrome.storage.local.set(trackerUpdate, () => {
        if (tabId) {
          updateThreatBadge(tabId);
          chrome.storage.local.get([`tabUrl_${tabId}`], r => pushPanelUpdate(tabId, r[`tabUrl_${tabId}`] || ''));
        }
      });

      // Log tracker hits to server (best-effort, fire-and-forget)
      if (message.data.trackers?.length > 0) {
        (async () => {
          try {
            const stored  = await new Promise(resolve =>
              chrome.storage.local.get(['authToken'], r => resolve(r))
            );
            const headers = { 'Content-Type': 'application/json' };
            if (stored.authToken) headers['Authorization'] = `Bearer ${stored.authToken}`;
            let pageDomain = '';
            try { pageDomain = new URL(message.data.pageUrl || '').hostname; } catch { pageDomain = message.data.pageUrl || ''; }
            await fetchWithTimeout(`${BACKEND_URL}/api/trackers/log`, {
              method:  'POST',
              headers,
              body:    JSON.stringify({
                pageDomain,
                pageUrl:  message.data.pageUrl || '',
                trackers: message.data.trackers.map(t => t.tracker || t.domain || t).filter(Boolean),
              }),
            });
          } catch (_) { /* never block the UI */ }
        })();
      }
    });
    return;
  }

  if (message.type === 'CHECK_TRACKERS') {
    // Batched lookup — content.js sends all hostnames in one message instead of
    // one message per element. We check each against the blocklist and return
    // only the ones that matched, so content.js can build its foundTrackers list.
    const hits = (message.hostnames || []).filter(h => isTracker(h));
    sendResponse({ trackers: hits });
    return true;
  }

  // Legacy single-hostname handler kept for backwards compatibility
  // (e.g. if an older content script is still running in an open tab)
  if (message.type === 'CHECK_TRACKER') {
    sendResponse({ isTracker: isTracker(message.hostname) });
    return true;
  }

  if (message.type === 'CHECK_LINK') {
    if (!currentSettings.linksEnabled) { sendResponse({ safe: true }); return true; }

    // Wrap the entire async body in an IIFE so `await` works correctly.
    // The onMessage listener itself is synchronous — using `await` at the
    // top level of the callback causes it to silently return a resolved
    // Promise instead of keeping the channel open for sendResponse.
    // `return true` below tells Chrome to keep the channel open; the IIFE
    // actually calls sendResponse when its work is done.
    (async () => {
      const senderTabId = sender.tab?.id;

      if (senderTabId) {
        chrome.storage.local.get([
          `linksChecked_${senderTabId}`,
          `tabUrl_${senderTabId}`,
          'totalLinksChecked'
        ], r => {
          chrome.storage.local.set({
            [`linksChecked_${senderTabId}`]: (r[`linksChecked_${senderTabId}`] || 0) + 1,
            totalLinksChecked:               (r.totalLinksChecked               || 0) + 1
          }, () => {
            pushPanelUpdate(senderTabId, r[`tabUrl_${senderTabId}`] || '');
          });
        });
      }

      try {
        const parsed = new URL(message.url);
        // Check both the settings whitelist (managed by settings page) and the
        // per-site dismissal list (written by the "don't warn again" modal checkbox).
        const storedWL = await new Promise(res =>
          chrome.storage.local.get(['whitelistedSites'], r => res(r.whitelistedSites || []))
        );
        const allWhitelisted = [...(currentSettings.whitelist || []), ...storedWL];
        if (allWhitelisted.some(e =>
          parsed.hostname === e || parsed.hostname.endsWith('.' + e)
        )) {
          sendResponse({ safe: true, source: 'whitelist' });
          return;
        }
      } catch (_) {}

      const localResult = await checkUrlLocally(message.url);
      if (localResult?.safe === true) {
        sendResponse({ safe: true, source: 'local' });
      } else if (localResult?.needsConfirmation) {
        try {
          const r = await fetchWithTimeout(`${BACKEND_URL}/api/check-link`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ url: message.url, hash: localResult.hash, threatType: localResult.threatType })
          });
          const d = await r.json();
          if (d && !d.safe) {
            chrome.storage.local.get(['totalThreatsBlocked'], r => {
              chrome.storage.local.set({ totalThreatsBlocked: (r.totalThreatsBlocked || 0) + 1 });
            });
          }
          sendResponse({ ...d, source: 'confirmed' });
        } catch {
          sendResponse({ safe: true, threat: 'API_UNAVAILABLE', unavailable: true });
        }
      } else {
        try {
          const r = await fetchWithTimeout(`${BACKEND_URL}/api/check-link`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ url: message.url })
          });
          const d = await r.json();
          sendResponse({ ...d, source: 'backend' });
        } catch {
          sendResponse({ safe: true, threat: 'API_UNAVAILABLE', unavailable: true });
        }
      }
    })();
    return true;  // keep message channel open for the async IIFE above
  }

  if (message.type === 'DARK_PATTERNS_DETECTED') {
    chrome.storage.local.get(['darkPatternLog', 'totalDarkPatterns'], result => {
      const log = result.darkPatternLog || [];
      log.push(message.data);
      // Trim to 30 days to prevent unbounded growth
      const _dpCutoff = Date.now() - LOG_CUTOFF_MS;
      const trimmedDpLog = log.filter(e => new Date(e.timestamp || 0).getTime() > _dpCutoff);
      chrome.storage.local.set({
        darkPatternLog:       trimmedDpLog,
        totalDarkPatterns:    (result.totalDarkPatterns || 0) + message.data.count,
        lastPageDarkPatterns: message.data.patterns
      });
    });
    return;
  }

  if (message.type === 'DARK_PATTERN_DISMISSED') {
    // Forward dismissal report to backend (best-effort, fire-and-forget).
    // Attach auth token if the user is logged in so the server can link
    // the report to their account.
    (async () => {
      try {
        const stored = await new Promise(resolve =>
          chrome.storage.local.get(['authToken'], r => resolve(r))
        );
        const headers = { 'Content-Type': 'application/json' };
        if (stored.authToken) headers['Authorization'] = `Bearer ${stored.authToken}`;

        await fetchWithTimeout(`${BACKEND_URL}/api/dark-patterns/dismiss`, {
          method:  'POST',
          headers,
          body:    JSON.stringify({
            domain:      message.domain,
            patternType: message.patternType,
            patternText: message.patternText,
            pageUrl:     message.pageUrl,
          }),
        });
      } catch (_) { /* best-effort — never block UI */ }
    })();
    return;
  }

});

// ============================================================
//  DOWNLOAD BLOCKER
// ============================================================

chrome.downloads.onCreated.addListener(async downloadItem => {
  if (!currentSettings.downloadsEnabled) return;

  const { url, filename = '', id } = downloadItem;
  chrome.downloads.pause(id);

  try {
    const res  = await fetchWithTimeout(`${BACKEND_URL}/api/check-download`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url, filename })
    });
    const data = await res.json();

    chrome.storage.local.get(['totalDownloadsScanned'], r => {
      chrome.storage.local.set({ totalDownloadsScanned: (r.totalDownloadsScanned || 0) + 1 });
    });

    if (data.safe) {
      chrome.downloads.resume(id);
    } else {
      chrome.downloads.cancel(id);
      chrome.storage.local.get(['totalThreatsBlocked'], r => {
        chrome.storage.local.set({ totalThreatsBlocked: (r.totalThreatsBlocked || 0) + 1 });
      });
      if (currentSettings.modalsEnabled !== false) {
        chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
          if (!tabs[0]) return;
          const tabId = tabs[0].id;
          try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
          } catch (_) {}
          chrome.tabs.sendMessage(tabId, {
            type: 'SHOW_DOWNLOAD_WARNING', url, filename, threat: data.threat
          }).catch(() => {});
        });
      }
    }
  } catch (err) {
    console.error('[ClickSafe Download] check failed, resuming:', err.message);
    chrome.downloads.resume(id);
  }
});

// Tab switch
chrome.tabs.onActivated.addListener(info => {
  chrome.tabs.get(info.tabId, tab => {
    if (tab?.url) pushPanelUpdate(tab.id, tab.url);
  });
});

// Tab close
chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.local.get(['tabTrackers'], result => {
    const tabTrackers = result.tabTrackers || {};
    delete tabTrackers[tabId];
    chrome.storage.local.set({ tabTrackers });
  });
  chrome.storage.local.remove([
    `cookieData_${tabId}`,
    `trackerData_${tabId}`,
    `mixedContent_${tabId}`,
    `tabUrl_${tabId}`,
    `privacyScore_${tabId}`,
    `linksChecked_${tabId}`
  ]);
});

console.log('[ClickSafe] Background service worker started [OK]');