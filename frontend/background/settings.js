// ============================================================
//  settings.js — Default settings + runtime state
// ============================================================

const DEFAULT_SETTINGS = {
  httpsEnabled:        true,
  cookiesEnabled:      true,
  linksEnabled:        true,
  downloadsEnabled:    true,
  modalsEnabled:       true,
  darkPatternsEnabled: true,
  whitelist:           []
};

let currentSettings = { ...DEFAULT_SETTINGS };

chrome.storage.local.get(["settings"], result => {
  if (result.settings) currentSettings = { ...DEFAULT_SETTINGS, ...result.settings };
});