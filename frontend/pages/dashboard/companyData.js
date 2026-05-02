// ============================================================
//  ClickSafe — companyData.js
//  COMPANY_INFO knowledge base, COMPANY_MAP, and domainToCompany()
// ============================================================

const COMPANY_INFO = {
  "Google": {
    tier: 1,
    what: "tracking your browsing history across the web",
    collects: "Browsing history, search queries, location data, device info, app usage, YouTube watch history",
    howUsed: "Sold to advertisers for targeted ads; used to build a permanent profile on you across all Google services",
    retains: "Up to 18 months by default (can be longer)",
    optOut: "myaccount.google.com/data-and-privacy",
    privacyRisk: "High — data shared with 4M+ advertisers globally"
  },
  "Google (DoubleClick)": {
    tier: 1,
    what: "building an ad profile on you",
    collects: "Cross-site browsing behavior, ad click history, conversion events",
    howUsed: "Real-time bidding — your profile is auctioned to advertisers in milliseconds when you load a page",
    retains: "13 months",
    optOut: "adssettings.google.com",
    privacyRisk: "High — present on over 80% of websites"
  },
  "Meta / Facebook": {
    tier: 1,
    what: "tracking you even when you're not on Facebook",
    collects: "Sites you visit, purchases made elsewhere, your friends' activity, location, facial recognition data",
    howUsed: "Sold to advertisers; used to target political ads; shared with app developers via their platform",
    retains: "Indefinitely — even after account deletion",
    optOut: "facebook.com/off_facebook_activity",
    privacyRisk: "Very High — largest data broker for social graph data"
  },
  "Meta / Instagram": {
    tier: 1,
    what: "tracking your activity across sites",
    collects: "Browsing outside Instagram, interaction data, location, device fingerprint",
    howUsed: "Combined with Facebook's profile to build richer advertising targets",
    retains: "Indefinitely",
    optOut: "facebook.com/off_facebook_activity",
    privacyRisk: "High — shares data with Facebook parent company"
  },
  "TikTok": {
    tier: 1,
    what: "tracking your browsing behavior",
    collects: "Keystrokes, clipboard data, browsing history, location, device identifiers",
    howUsed: "Behavioral profiling for ads; data may be accessible to ByteDance in China",
    retains: "Up to 13 months for advertising data",
    optOut: "Limited options within app settings",
    privacyRisk: "Very High — subject to Chinese national security laws"
  },
  "TikTok (ByteDance)": {
    tier: 1,
    what: "tracking your browsing behavior",
    collects: "Cross-site tracking, browsing history, behavioral signals",
    howUsed: "Ad targeting; parent company ByteDance may access under Chinese law",
    retains: "13 months",
    optOut: "TikTok app privacy settings",
    privacyRisk: "Very High"
  },
  "Microsoft": {
    tier: 1,
    what: "tracking your activity for advertising",
    collects: "Search history, browsing behavior via Edge/Bing, Windows telemetry, LinkedIn activity",
    howUsed: "Microsoft Advertising platform; improving products; shared across Microsoft services",
    retains: "Up to 13 months for advertising",
    optOut: "account.microsoft.com/privacy",
    privacyRisk: "High — deeply integrated into Windows OS"
  },
  "Microsoft (Bing)": {
    tier: 1,
    what: "tracking your search and browsing activity",
    collects: "Search queries, click behavior, IP address, device info",
    howUsed: "Search advertising; Bing Ads targeting; fed into Microsoft's advertising platform",
    retains: "13 months",
    optOut: "account.microsoft.com/privacy",
    privacyRisk: "High"
  },
  "Amazon Ads": {
    tier: 1,
    what: "building a shopping profile on you",
    collects: "Purchase history, search queries, products viewed, wishlists, streaming behavior (Prime Video)",
    howUsed: "Retargeting ads across 3rd party sites; data shared with Amazon DSP advertisers",
    retains: "Until account deletion (some data longer)",
    optOut: "amazon.com/adprefs",
    privacyRisk: "High — one of the most complete shopping profiles"
  },
  "Amazon": {
    tier: 1,
    what: "tracking your shopping behavior",
    collects: "Shopping history, search queries, device usage, location, Alexa recordings",
    howUsed: "Product recommendations; advertising to 3rd parties; sold to brand sellers on their platform",
    retains: "Indefinitely for purchase history",
    optOut: "amazon.com/adprefs",
    privacyRisk: "High"
  },
  "Adobe": {
    tier: 1,
    what: "tracking your behavior for analytics",
    collects: "Page views, clicks, form interactions, user journeys across sites using Adobe Analytics",
    howUsed: "Sold as analytics data to enterprise clients; Adobe Experience Cloud uses it for ad targeting",
    retains: "13-25 months depending on contract",
    optOut: "adobe.com/privacy/opt-out.html",
    privacyRisk: "Medium-High — used by major enterprise websites"
  },
  "Adobe (Audience Mgr)": {
    tier: 1,
    what: "building a cross-site profile on you",
    collects: "Behavioral data aggregated across thousands of enterprise websites",
    howUsed: "DMP (Data Management Platform) — packages your profile and sells to advertisers",
    retains: "120 days for segments",
    optOut: "adobe.com/privacy/opt-out.html",
    privacyRisk: "High — aggregates data from major media companies"
  },
  "Oracle": {
    tier: 1,
    what: "collecting your data for a profile database",
    collects: "Offline purchase data, demographics, location history, financial data",
    howUsed: "Oracle Data Cloud sells profiles to advertisers; links online behavior to offline purchases",
    retains: "Up to 5 years",
    optOut: "datacloudoptout.oracle.com",
    privacyRisk: "Very High — one of the largest data brokers"
  },
  "Oracle (BlueKai)": {
    tier: 1,
    what: "selling your profile data to advertisers",
    collects: "Browsing behavior, purchase intent, location, demographics",
    howUsed: "Auctioned to advertisers via real-time bidding; data exposed in 2020 breach affecting billions",
    retains: "Up to 5 years",
    optOut: "datacloudoptout.oracle.com",
    privacyRisk: "Very High — major data breach in 2020"
  },
  "Salesforce": {
    tier: 1,
    what: "tracking your behavior for marketing",
    collects: "CRM data, email opens, purchase history, support interactions",
    howUsed: "Marketing Cloud uses it to build customer journeys; shared with businesses using Salesforce",
    retains: "Defined by the business using Salesforce",
    optOut: "salesforce.com/company/privacy/full_privacy.jsp",
    privacyRisk: "Medium-High"
  },
  "Salesforce (Krux)": {
    tier: 1,
    what: "building an audience profile on you",
    collects: "Cross-site behavioral data, audience segments",
    howUsed: "DMP that packages behavioral profiles for ad targeting",
    retains: "90 days for segments",
    optOut: "salesforce.com/company/privacy/full_privacy.jsp",
    privacyRisk: "High"
  },
  "X / Twitter": {
    tier: 1,
    what: "tracking your activity off-platform",
    collects: "Sites you visit with Twitter embeds, ad click behavior, device info",
    howUsed: "Targeted advertising; data may be shared with new owner's other ventures",
    retains: "30 days for off-Twitter activity",
    optOut: "twitter.com/settings/your_twitter_data",
    privacyRisk: "High — privacy policies changed significantly under new ownership"
  },
  "LinkedIn": {
    tier: 1,
    what: "tracking your professional browsing habits",
    collects: "Pages you visit with LinkedIn pixels, professional profile data, job searches",
    howUsed: "LinkedIn Insight Tag tracks you across websites; used for B2B advertising",
    retains: "90 days",
    optOut: "linkedin.com/psettings/enhanced-advertising",
    privacyRisk: "Medium-High — shares data with Microsoft"
  },
  "Snapchat": {
    tier: 1,
    what: "tracking you outside their app",
    collects: "Website visits, app events, purchase behavior via Snap Pixel",
    howUsed: "Retargeting ads; lookalike audience creation",
    retains: "13 months",
    optOut: "snap.com/en-US/privacy/privacy-center",
    privacyRisk: "Medium-High"
  },
  "Criteo": {
    tier: 2,
    what: "retargeting you with ads based on your history",
    collects: "Products viewed, items in cart, pages visited, purchase history",
    howUsed: "Shows you ads for products you viewed on other sites (retargeting)",
    retains: "13 months",
    optOut: "criteo.com/privacy/corporate-privacy-policy",
    privacyRisk: "Medium — focused on e-commerce retargeting"
  },
  "Taboola": {
    tier: 2,
    what: "tracking you for sponsored content targeting",
    collects: "Content you read, time spent, scroll behavior, device info",
    howUsed: "Powers 'Recommended Content' widgets on news sites; profiles used for native advertising",
    retains: "13 months",
    optOut: "taboola.com/privacy-policy",
    privacyRisk: "Medium"
  },
  "Outbrain": {
    tier: 2,
    what: "tracking you for sponsored content targeting",
    collects: "Reading behavior, content preferences, browsing history",
    howUsed: "Native ad recommendations on publisher sites",
    retains: "13 months",
    optOut: "outbrain.com/legal/privacy",
    privacyRisk: "Medium"
  },
  "Xandr (AppNexus)": {
    tier: 2,
    what: "running real-time ad auctions using your data",
    collects: "Browsing history, demographic inferences, behavioral segments",
    howUsed: "Real-time bidding infrastructure — your profile is bid on in <100ms on many sites",
    retains: "13 months",
    optOut: "xandr.com/privacy/platform-privacy-policy",
    privacyRisk: "High — processes billions of ad auctions daily"
  },
  "Magnite": {
    tier: 2,
    what: "auctioning your attention to advertisers",
    collects: "Page context, user behavior signals, location",
    howUsed: "Sell-side platform that auctions publisher ad inventory using your data",
    retains: "13 months",
    optOut: "magnite.com/privacy-policy",
    privacyRisk: "Medium"
  },
  "PubMatic": {
    tier: 2,
    what: "selling ad impressions using your profile",
    collects: "Browsing behavior, content affinity, device data",
    howUsed: "Programmatic advertising platform — sells your eyeballs to the highest bidder",
    retains: "13 months",
    optOut: "pubmatic.com/privacy-policy",
    privacyRisk: "Medium"
  },
  "OpenX": {
    tier: 2,
    what: "running ad auctions using your data",
    collects: "Inferred interests, browsing patterns, demographic data",
    howUsed: "Ad exchange that runs real-time auctions using your behavioral profile",
    retains: "13 months",
    optOut: "openx.com/legal/privacy-policy",
    privacyRisk: "Medium"
  },
  "Quantcast": {
    tier: 2,
    what: "profiling your interests for advertisers",
    collects: "Content interests, demographics, purchase intent",
    howUsed: "Audience measurement and targeting; consent management",
    retains: "13 months",
    optOut: "quantcast.com/privacy/data-collection-opt-out",
    privacyRisk: "Medium"
  },
  "AdRoll": {
    tier: 2,
    what: "retargeting you with ads across sites",
    collects: "Products viewed, cart abandonment, site behavior",
    howUsed: "Cross-device retargeting for e-commerce sites",
    retains: "13 months",
    optOut: "adroll.com/about/privacy",
    privacyRisk: "Medium"
  },
  "Hotjar": {
    tier: 3,
    what: "recording your clicks and scrolls on this page",
    collects: "Mouse movements, clicks, scroll depth, form inputs (masked), heatmaps",
    howUsed: "Shared with website owner for UX analysis; no ad targeting",
    retains: "365 days",
    optOut: "hotjar.com/opt-out",
    privacyRisk: "Low-Medium — no ad profile, but records your on-page behavior"
  },
  "Mixpanel": {
    tier: 3,
    what: "tracking how you use this site",
    collects: "Feature usage, user flows, event data, device info",
    howUsed: "Product analytics for the website owner; not sold to advertisers",
    retains: "5 years",
    optOut: "mixpanel.com/optout",
    privacyRisk: "Low — analytics only, not shared with ad networks"
  },
  "Amplitude": {
    tier: 3,
    what: "tracking how you use this site",
    collects: "User journeys, feature engagement, session data",
    howUsed: "Product analytics; helps site owners understand usage patterns",
    retains: "2 years",
    optOut: "amplitude.com/privacy",
    privacyRisk: "Low"
  },
  "Segment": {
    tier: 3,
    what: "collecting your usage data for the site owner",
    collects: "User events, identity data, integration events",
    howUsed: "Routes your data to multiple analytics/marketing tools used by the site owner",
    retains: "Depends on destination tools",
    optOut: "segment.com/legal/privacy",
    privacyRisk: "Low-Medium — acts as a data router to other tools"
  },
  "FullStory": {
    tier: 3,
    what: "recording your session on this page",
    collects: "Full session recordings, mouse movements, rage clicks, form interactions",
    howUsed: "Session replay for UX improvement; data stays with site owner",
    retains: "1 year",
    optOut: "fullstory.com/optout",
    privacyRisk: "Low-Medium — can capture sensitive data if not properly masked"
  },
  "Microsoft Clarity": {
    tier: 3,
    what: "recording your session on this page",
    collects: "Session recordings, heatmaps, scroll behavior, click maps",
    howUsed: "UX analytics for site owner; Microsoft may use aggregated data",
    retains: "13 months",
    optOut: "clarity.microsoft.com",
    privacyRisk: "Low-Medium"
  },
  "Heap": {
    tier: 3,
    what: "recording your interactions on this page",
    collects: "All user interactions automatically (clicks, taps, pageviews, gestures)",
    howUsed: "Product analytics retroactively analyzed by site owner",
    retains: "Up to 3 years depending on plan",
    optOut: "heap.io/legal/privacy",
    privacyRisk: "Low"
  },
  "Intercom": {
    tier: 3,
    what: "tracking your activity for support purposes",
    collects: "Chat history, pages visited, account data, device info",
    howUsed: "Customer support; may be used for targeted in-app messages",
    retains: "Until account deletion or 3 years after inactivity",
    optOut: "intercom.com/legal/privacy",
    privacyRisk: "Low"
  },
  "Zendesk": {
    tier: 3,
    what: "tracking your activity for support purposes",
    collects: "Support tickets, chat logs, browsing behavior on help center",
    howUsed: "Customer service analytics; not used for advertising",
    retains: "Varies by customer configuration",
    optOut: "zendesk.com/company/privacy-and-data-protection",
    privacyRisk: "Low"
  }
};

// ── Company map (mirrors sidepanel) ──────────────────────────
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

function domainToCompany(domain) {
  if (!domain) return null;
  const d = domain.toLowerCase().replace(/^www\./, "");
  for (const key of Object.keys(COMPANY_MAP)) {
    if (d.includes(key)) return { domain, ...COMPANY_MAP[key] };
  }
  const name = d.split(".").slice(-2,-1)[0] || d;
  return { domain, name: name.charAt(0).toUpperCase()+name.slice(1), tier:2, what:"tracking your activity" };
}