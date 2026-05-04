# ClickSafe — Installation Guide

ClickSafe is a browser extension that protects you in real time by scanning links, blocking trackers, detecting dark patterns, and scoring your page's privacy.

> ClickSafe is not yet on the Chrome Web Store. You install it manually using Chrome's **Load Unpacked** feature — it takes about a minute.

---

## What's in this ZIP

```
frontend/
├── manifest.json          ← Extension config (don't rename or move this)
├── background.js          ← Service worker: core scanning logic
├── background/            ← Modular background scripts
├── content/               ← Content script injected into every page
├── sidepanel/             ← The side panel UI you interact with
├── pages/                 ← Dashboard, settings, onboarding screens
├── utils/                 ← Shared helpers
├── data/                  ← Tracker blocklist (~85 KB JSON)
├── assets/                ← Icons, fonts, charting library
└── rules.json             ← Declarative net request rules
```

---

## Step-by-Step Installation

### Step 1 — Extract the ZIP

Unzip `clicksafe-extension.zip` somewhere you won't accidentally delete it (e.g. `Documents/clicksafe/`). The folder you want is **`frontend/`** — it contains `manifest.json` at its root.

### Step 2 — Open Chrome Extensions

In Chrome, paste this into the address bar and press Enter:

```
chrome://extensions
```

### Step 3 — Enable Developer Mode

In the top-right corner of the extensions page, toggle **Developer mode** ON. Three new buttons will appear: "Load unpacked", "Pack extension", and "Update".

### Step 4 — Load the Extension

Click **Load unpacked**. A file picker will open. Navigate to the folder you extracted and select the **`frontend`** folder (the one that contains `manifest.json`). Do **not** select the outer zip or a parent folder.

### Step 5 — Confirm It's Running

The ClickSafe shield icon (🛡) will appear in your Chrome toolbar. Click it — the side panel will open and show your Privacy Score for the current page. If the icon is hidden, click the puzzle-piece 🧩 icon in the toolbar and pin ClickSafe.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Manifest file is missing or unreadable" | You selected the wrong folder. Make sure you pick the `frontend/` folder that has `manifest.json` directly inside it, not a parent folder. |
| Extension loads but shows no data | The backend API may not be reachable. Check your internet connection. |
| Shield icon doesn't appear | Click the 🧩 puzzle piece in Chrome toolbar → find ClickSafe → click the pin icon. |
| Extension disappears after Chrome restarts | This is normal for unpacked extensions if Chrome resets. Just go to `chrome://extensions` and click **Update** or re-load it. |

---

## Updating ClickSafe

When a new version is released, download the new ZIP, extract it, replace the `frontend/` folder contents, then go to `chrome://extensions` and click the **refresh** icon on the ClickSafe card.

---

## Privacy

ClickSafe does not sell your data. Link and download checks send minimal metadata to the ClickSafe API. See the full [Privacy Policy](https://clicksafe.example.com/privacy) for details.

---

*Built with care. Questions? Visit the [ClickSafe About page](https://clicksafe.example.com/about).*
