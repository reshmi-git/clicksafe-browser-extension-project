# ClickSafe

A Chrome extension that protects you while browsing — real-time link safety checks, tracker blocking, HTTPS enforcement, download scanning, and dark pattern detection.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Quick Start](#quick-start)
- [API Key Setup](#api-key-setup)
- [Backend Setup](#backend-setup)
- [Database Setup](#database-setup)
- [Extension Setup](#extension-setup)
- [API Reference](#api-reference)
- [Privacy Score Formula](#privacy-score-formula)
- [Project Structure](#project-structure)

---

## Architecture Overview

ClickSafe has three parts that work together:

```
┌─────────────────────────────────────────┐
│           Chrome Extension              │
│                                         │
│  background.js  ←→  content.js          │
│       ↕                                 │
│  chrome.storage.local (state)           │
│       ↕                                 │
│  pages/dashboard, sidepanel, settings   │
└──────────────┬──────────────────────────┘
               │ HTTP (localhost:3000)
┌──────────────▼──────────────────────────┐
│         Node.js / Express Backend       │
│                                         │
│  POST /api/check-link                   │
│  POST /api/check-download               │
│  POST /api/sb-prefixes                  │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───▼────────┐   ┌────────▼──────────────┐
│  MySQL DB  │   │  Google Safe Browsing │
│  (cache)   │   │  API v4               │
└────────────┘   └───────────────────────┘
```

**How URL checking works:**

1. The extension fetches hash prefixes from Google Safe Browsing (via your backend) and stores them locally.
2. When you hover over a link, the extension hashes the URL and checks it against the local prefix list — the URL never leaves your browser unless there is a match.
3. If a local prefix match is found, the extension asks the backend to confirm the full hash against the Safe Browsing API.
4. Results are cached in MySQL for 24 hours so repeat visits do not cost extra API quota.

---

## Quick Start

```bash
# 1. Clone / unzip the project
cd ClickSafe

# 2. Set up the backend
cd backend
cp .env.example .env        # then fill in your API key and DB credentials
npm install
node server.js

# 3. Set up the database (in a separate terminal)
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS clicksafe_db;"
mysql -u root -p clicksafe_db < ../database/schema.sql
mysql -u root -p clicksafe_db < ../database/seed.sql   # optional test data

# 4. Load the extension in Chrome
# Open chrome://extensions, enable Developer Mode, click Load unpacked, select the frontend/ folder
```

---

## API Key Setup

ClickSafe requires a **Google Safe Browsing API key**. Without it the backend will start but all link checks will fail.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select an existing one)
3. Navigate to **APIs & Services → Library**
4. Search for **Safe Browsing API** and enable it
5. Go to **APIs & Services → Credentials → Create Credentials → API Key**
6. Copy the key into your `backend/.env` file:

```
GOOGLE_SAFE_BROWSING_API_KEY=AIza...your_key_here
```

The free tier allows 10,000 lookups/day, which is more than enough for personal use.

---

## Backend Setup

### Prerequisites

- Node.js 18+
- MySQL 8.0+

### Installation

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your values:

```env
GOOGLE_SAFE_BROWSING_API_KEY=your_key_here

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=clicksafe_db

PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=chrome-extension://*
```

```bash
npm install
node server.js        # production
npm run dev           # development (auto-restart with nodemon)
```

You should see:

```
[ClickSafe] MySQL connected successfully
[ClickSafe] Server running on port 3000
```

### Rate limiting

The backend applies rate limiting per IP. Limits are defined in `middleware/rateLimiter.js`. In development you can raise them freely; tighten before deploying publicly.

---

## Database Setup

```bash
# Create the database
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS clicksafe_db;"

# Apply schema (creates the checked_urls table and a cleanup event)
mysql -u root -p clicksafe_db < database/schema.sql

# Load optional test data (known-safe URLs and fake-dangerous ones for testing)
mysql -u root -p clicksafe_db < database/seed.sql
```

### Enable the cache cleanup event

The schema creates a MySQL Event that purges cache entries older than 24 hours. To activate it, run this once in MySQL:

```sql
SET GLOBAL event_scheduler = ON;
```

Or add `event_scheduler=ON` to your `my.cnf` / `my.ini` to make it permanent.

### Schema overview

**`checked_urls`** — URL safety cache

| Column | Type | Description |
|---|---|---|
| `id` | INT UNSIGNED PK | Auto-increment |
| `url` | VARCHAR(2048) | The checked URL |
| `url_hash` | CHAR(32) UNIQUE | MD5 of the URL (enables fast indexed lookup) |
| `is_safe` | TINYINT(1) | 1 = safe, 0 = dangerous |
| `threat_type` | VARCHAR(64) NULL | e.g. MALWARE, SOCIAL_ENGINEERING |
| `checked_at` | DATETIME | When it was last checked (used for TTL) |

---

## Extension Setup

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer Mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the `frontend/` folder
5. The ClickSafe icon should appear in your toolbar

The extension connects to `http://localhost:3000` by default. If you change the backend port, update `frontend/utils/api.js`.

---

## API Reference

All endpoints accept and return JSON. The backend runs at `http://localhost:3000` by default.

---

### POST /api/check-link

Check whether a URL is safe using Google Safe Browsing.

**Request body:**

```json
{
  "url": "https://example.com/some-page",
  "hash": "optional-full-sha256-hex",
  "threatType": "MALWARE"
}
```

`hash` and `threatType` are optional. If provided, the backend performs a full-hash confirmation (used when the extension finds a local prefix match). If omitted, it does a full URL lookup.

**Response:**

```json
{
  "safe": true,
  "url": "https://example.com/some-page",
  "threat": null,
  "checked_at": "2025-05-01T12:00:00.000Z",
  "cached": false
}
```

| Field | Type | Description |
|---|---|---|
| `safe` | boolean | true if no threats found |
| `url` | string | The normalized URL that was checked |
| `threat` | string or null | Threat type if unsafe, or API_UNAVAILABLE if the check failed |
| `checked_at` | ISO string | When the check ran (or was cached) |
| `cached` | boolean | Whether this result came from the DB cache |

**Error responses:**

| Status | Meaning |
|---|---|
| 400 | Invalid URL, missing fields, or bad hash format |
| 429 | Rate limit exceeded |
| 500 | Server error |

---

### POST /api/check-download

Check whether a download URL is safe.

**Request body:**

```json
{
  "url": "https://example.com/file.exe",
  "filename": "file.exe"
}
```

`filename` is optional but recommended — it appears in warning messages.

**Response:**

```json
{
  "safe": false,
  "url": "https://example.com/file.exe",
  "filename": "file.exe",
  "threat": "MALWARE",
  "checked_at": "2025-05-01T12:00:00.000Z",
  "cached": false
}
```

Same fields as `/api/check-link`, plus `filename`.

---

### POST /api/sb-prefixes

Fetch Safe Browsing hash prefixes for local lookup. The extension calls this on startup and periodically to keep its local blocklist fresh.

**Request body:**

```json
{
  "clientStates": {
    "MALWARE": "state_token_from_last_update",
    "SOCIAL_ENGINEERING": ""
  }
}
```

Pass the `clientStates` object returned from the previous call. On first call, send `{}` or omit the field — Google will return a full list.

**Response:**

```json
{
  "prefixes": {
    "MALWARE": {
      "entries": ["a1b2c3d4", "e5f6..."],
      "responseType": "FULL_UPDATE",
      "removals": []
    }
  },
  "clientStates": {
    "MALWARE": "new_state_token"
  },
  "updatedAt": "2025-05-01T12:00:00.000Z"
}
```

The extension stores `entries` in `chrome.storage.local` and sends `clientStates` back on the next call to get incremental diffs instead of the full list.

---

## Privacy Score Formula

Scores range from 0 to 100. The extension starts at 100 and deducts penalties:

| Signal | Deduction | Cap | Rationale |
|---|---|---|---|
| No HTTPS | −30 flat | — | Binary condition; all traffic is exposed. A clean HTTP site should never score above 70. |
| Tracking cookies | −5 each | −30 | Persistent and identity-linked. Even one is meaningful. Beyond 6, the harm plateaus. |
| Tracker scripts | −4 each | −20 | Session-scoped and easier to block. Less severe per unit than cookies. Cap at 5. |
| Mixed content | −5 each | −20 | Each leaks your HTTPS session to an HTTP endpoint. Cap at 4 resources. |

```
score = 100
      − 30                              (if not HTTPS)
      − min(trackingCookies × 5, 30)
      − min(trackers × 4, 20)
      − min(mixedContent × 5, 20)
score = clamp(score, 0, 100)
```

The score computation lives in `frontend/background/privacyScore.js` and is mirrored in `frontend/pages/dashboard/dashboard.js`. If you change the weights in one place, update the other.

---

## Project Structure

```
ClickSafe/
├── README.md                      ← you are here
│
├── backend/                       ← Node.js / Express API
│   ├── server.js                  # Entry point
│   ├── .env.example               # Copy to .env and fill in
│   ├── config/
│   │   └── database.js            # MySQL connection pool
│   ├── controllers/
│   │   ├── linkController.js      # /api/check-link logic + DB cache
│   │   ├── downloadController.js  # /api/check-download logic + DB cache
│   │   └── sbUpdateController.js  # /api/sb-prefixes
│   ├── middleware/
│   │   ├── cors.js
│   │   ├── rateLimiter.js
│   │   ├── errorHandler.js
│   │   └── inputValidation.js     # URL + filename validators (shared)
│   ├── routes/
│   │   ├── checkLink.js
│   │   ├── checkDownload.js
│   │   └── sbUpdate.js
│   └── services/
│       └── safeBrowsingService.js # Google Safe Browsing API calls
│
├── database/
│   ├── schema.sql                 # CREATE TABLE + cache-cleanup event
│   └── seed.sql                   # Optional test rows
│
├── frontend/                      ← Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js              # Service worker entry point
│   ├── background/                # Service worker modules
│   │   ├── privacyScore.js        # Score formula + threat badge updater
│   │   ├── safeBrowsing.js        # Local prefix lookup + hash confirmation
│   │   ├── cookieScanner.js       # Tracks tracking cookies per tab
│   │   ├── trackerBlocklist.js    # Loads and queries the tracker blocklist
│   │   └── settings.js            # Reads/writes extension settings
│   ├── content/
│   │   └── content.js             # Injected into every page
│   ├── data/
│   │   └── trackers.json          # Local tracker blocklist
│   ├── pages/
│   │   ├── dashboard/             # Full dashboard UI
│   │   └── settings/              # Settings page
│   ├── sidepanel/                 # Side panel UI
│   └── utils/
│       ├── api.js                 # Fetch wrappers for the backend
│       ├── storage.js             # chrome.storage helpers
│       ├── helpers.js             # Shared utility functions
│       ├── cookieTracker.js       # Cookie classification helpers
│       └── httpsMonitor.js        # HTTPS upgrade detection
│
└── landing-page/                  ← Static marketing site (served by backend)
```