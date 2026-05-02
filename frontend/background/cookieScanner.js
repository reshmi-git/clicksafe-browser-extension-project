// ============================================================
//  cookieScanner.js — Cookie analysis & tracker detection
// ============================================================

const KNOWN_TRACKER_DOMAINS = [
  'doubleclick.net', 'google-analytics.com', 'googleadservices.com',
  'googlesyndication.com', 'googletagmanager.com', 'facebook.com',
  'facebook.net', 'fbcdn.net', 'adnxs.com', 'adsrvr.org',
  'amazon-adsystem.com', 'criteo.com', 'rubiconproject.com',
  'pubmatic.com', 'openx.net', 'mixpanel.com', 'segment.com',
  'quantserve.com', 'scorecardresearch.com', 'chartbeat.com',
  'hotjar.com', 'twitter.com', 'linkedin.com', 'pinterest.com',
  'reddit.com', 'snapchat.com', 'tiktok.com', 'addthis.com', 'sharethis.com',
  'outbrain.com', 'taboola.com'
];

function _cleanDomain(domain) { return domain.replace(/^\./, ''); }

function _isKnownCookieTracker(cookieDomain) {
  const cleaned = _cleanDomain(cookieDomain);
  return KNOWN_TRACKER_DOMAINS.some(t => cleaned.includes(t));
}

function _isThirdPartyCookie(cookieDomain, currentDomain) {
  const cookieBase  = _cleanDomain(cookieDomain).split('.').slice(-2).join('.');
  const currentBase = _cleanDomain(currentDomain).split('.').slice(-2).join('.');
  return cookieBase !== currentBase;
}

function _hasLongExpiration(expirationDate) {
  if (!expirationDate) return false;
  return (expirationDate - Date.now() / 1000) > 90 * 24 * 60 * 60;
}

function _analyzeCookie(cookie, currentDomain) {
  const isKnown      = _isKnownCookieTracker(cookie.domain);
  const isThirdParty = _isThirdPartyCookie(cookie.domain, currentDomain);
  const hasLongLife  = _hasLongExpiration(cookie.expirationDate);
  const reasons      = [];

  if (isKnown)      reasons.push('Known tracking domain');
  if (isThirdParty) reasons.push('Third-party cookie');
  if (hasLongLife)  reasons.push('Long expiration (>90 days)');

  return {
    isTracker: isKnown || (isThirdParty && hasLongLife),
    reasons,
    cookie: { name: cookie.name, domain: cookie.domain, expirationDate: cookie.expirationDate }
  };
}

async function scanAllCookiesForUrl(currentUrl, tabId) {
  try {
    if (!currentUrl ||
        currentUrl.startsWith('chrome://') ||
        currentUrl.startsWith('chrome-extension://')) {
      return { error: 'Unsupported URL' };
    }

    const urlObj        = new URL(currentUrl);
    const currentDomain = urlObj.hostname;
    const currentBase   = currentDomain.split('.').slice(-2).join('.');
    const allCookies    = await chrome.cookies.getAll({});

    const pageCookies = allCookies.filter(c => {
      const base = _cleanDomain(c.domain).split('.').slice(-2).join('.');
      return base === currentBase || _isKnownCookieTracker(c.domain);
    });

    const firstPartyCookies = pageCookies.filter(c => {
      const base = _cleanDomain(c.domain).split('.').slice(-2).join('.');
      return base === currentBase;
    });

    const trackingCookies = [];
    for (const cookie of pageCookies) {
      const analysis = _analyzeCookie(cookie, currentDomain);
      if (analysis.isTracker) trackingCookies.push(analysis);
    }

    return {
      pageUrl:         currentUrl,
      pageDomain:      currentDomain,
      timestamp:       new Date().toISOString(),
      totalCookies:    firstPartyCookies.length,
      trackingCookies: trackingCookies.length,
      trackers:        trackingCookies
    };

  } catch (error) {
    console.error('[ClickSafe Cookie] Error:', error);
    return { error: error.message };
  }
}