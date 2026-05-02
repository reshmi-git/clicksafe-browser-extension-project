// ============================================================
//  ClickSafe — utils/settingsPorter.js
//  Export and import settings as a JSON file.
// ============================================================

const SETTING_DEFAULTS = {
  httpsEnabled:        true,
  cookiesEnabled:      true,
  linksEnabled:        true,
  downloadsEnabled:    true,
  modalsEnabled:       true,
  darkPatternsEnabled: true,
  whitelist:           []
};

const BOOLEAN_KEYS = [
  "httpsEnabled",
  "cookiesEnabled",
  "linksEnabled",
  "downloadsEnabled",
  "modalsEnabled",
  "darkPatternsEnabled"
];

// ── Export ────────────────────────────────────────────────────

function exportSettings() {
  chrome.storage.local.get(["settings"], function (stored) {
    const settings = Object.assign({}, SETTING_DEFAULTS, stored.settings || {});

    const payload = {
      clicksafe_version: "1",
      exported_at: new Date().toISOString(),
      settings
    };

    const json   = JSON.stringify(payload, null, 2);
    const blob   = new Blob([json], { type: "application/json" });
    const url    = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href     = url;
    anchor.download = "clicksafe-settings-" + new Date().toISOString().slice(0, 10) + ".json";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
}

// ── Import ────────────────────────────────────────────────────

// Calls onDone({ ok, error?, settings? }) when finished.
function importSettings(file, onDone) {
  if (!file) {
    return onDone({ ok: false, error: "No file selected." });
  }

  if (!file.name.endsWith(".json") && file.type !== "application/json") {
    return onDone({ ok: false, error: "Please select a .json file exported by ClickSafe." });
  }

  if (file.size > 50 * 1024) {
    return onDone({ ok: false, error: "File is too large to be a valid settings export." });
  }

  const reader = new FileReader();

  reader.onerror = function () {
    onDone({ ok: false, error: "Could not read the file." });
  };

  reader.onload = function (e) {
    let parsed;
    try {
      parsed = JSON.parse(e.target.result);
    } catch (_) {
      return onDone({ ok: false, error: "File is not valid JSON." });
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.clicksafe_version === undefined ||
      typeof parsed.settings !== "object" ||
      parsed.settings === null
    ) {
      return onDone({
        ok: false,
        error: "This doesn't look like a ClickSafe settings file."
      });
    }

    const incoming = parsed.settings;

    // Validate boolean toggles
    for (const key of BOOLEAN_KEYS) {
      if (key in incoming && typeof incoming[key] !== "boolean") {
        return onDone({ ok: false, error: "Invalid value for setting \"" + key + "\" — expected true or false." });
      }
    }

    // Validate whitelist
    if ("whitelist" in incoming) {
      if (!Array.isArray(incoming.whitelist)) {
        return onDone({ ok: false, error: "The whitelist field must be an array." });
      }
      for (const entry of incoming.whitelist) {
        if (typeof entry !== "string" || entry.trim().length === 0 || entry.length > 253) {
          return onDone({ ok: false, error: "Invalid whitelist entry: \"" + entry + "\"" });
        }
        if (entry.includes("..") || /[/\\]/.test(entry)) {
          return onDone({ ok: false, error: "Invalid whitelist entry: \"" + entry + "\"" });
        }
      }
      incoming.whitelist = [...new Set(incoming.whitelist)];
    }

    // Merge over current settings
    chrome.storage.local.get(["settings"], function (stored) {
      const current = Object.assign({}, SETTING_DEFAULTS, stored.settings || {});
      const merged  = Object.assign({}, current);

      for (const key of BOOLEAN_KEYS) {
        if (key in incoming) merged[key] = incoming[key];
      }
      if ("whitelist" in incoming) merged.whitelist = incoming.whitelist;

      chrome.storage.local.set({ settings: merged }, function () {
        chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED", settings: merged });
        onDone({ ok: true, settings: merged });
      });
    });
  };

  reader.readAsText(file);
}