// ============================================================
//  ClickSafe — controllers/sbUpdateController.js
//
//  Fetches Safe Browsing hash prefix lists from Google and
//  returns them to the extension for local lookup.
//
//  Uses the Update API v4:
//  https://developers.google.com/safe-browsing/v4/update-api
//
//  Flow:
//  1. Extension sends its current clientStates (empty on first call)
//  2. We call Google's threatListUpdates:fetch with those states
//  3. Google returns additions (and removals for incremental updates)
//  4. We decode the raw base64 prefix blobs into hex arrays
//  5. Return to extension: { prefixes: {...}, clientStates: {...} }
//
//  The extension stores these locally and checks hovered URLs
//  against them — URLs never leave the browser unless there's
//  a local prefix match that needs full-hash confirmation.
// ============================================================

const THREAT_TYPES = [
  "MALWARE",
  "SOCIAL_ENGINEERING",
  "UNWANTED_SOFTWARE",
  "POTENTIALLY_HARMFUL_APPLICATION"
];

// Max entries per threat type — keeps response size manageable
// and stays within chrome.storage.local 5MB limit on the extension side.
// 4096 * 4 bytes * 4 threat types = ~64KB, well within limits.
const MAX_DATABASE_ENTRIES = 4096;
const MAX_UPDATE_ENTRIES = 2048;
const PREFIX_SIZE = 4; // bytes — Google's default

function getApiKey() {
  const key = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!key || key === "YOUR_API_KEY_HERE") {
    throw new Error("GOOGLE_SAFE_BROWSING_API_KEY is not configured");
  }
  return key;
}

// Decode Google's raw base64 prefix blob into an array of hex strings
// Each prefix is PREFIX_SIZE bytes long
function decodeRawPrefixes(rawHashesBase64, prefixSize = PREFIX_SIZE) {
  const buf = Buffer.from(rawHashesBase64, "base64");
  const prefixes = [];
  for (let i = 0; i + prefixSize <= buf.length; i += prefixSize) {
    prefixes.push(buf.slice(i, i + prefixSize).toString("hex"));
  }
  return prefixes;
}

async function getSbPrefixes(req, res, next) {
  try {
    const API_KEY = getApiKey();

    // Extension sends its stored clientStates so Google can send incremental diffs
    // On first call this will be an empty object — Google sends the full list
    const incomingClientStates = req.body.clientStates || {};

    // Build one request entry per threat type
    const listUpdateRequests = THREAT_TYPES.map(threatType => ({
      threatType,
      platformType: "ANY_PLATFORM",
      threatEntryType: "URL",
      // Pass stored state for incremental update, or empty string for full download
      state: incomingClientStates[threatType] || "",
      constraints: {
        maxUpdateEntries: MAX_UPDATE_ENTRIES,
        maxDatabaseEntries: MAX_DATABASE_ENTRIES,
        supportedCompressions: ["RAW"]
      }
    }));

    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatListUpdates:fetch?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "clicksafe", clientVersion: "1.0.0" },
          listUpdateRequests
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google Safe Browsing API error ${response.status}: ${errText}`);
    }

    const data = await response.json();

    // Process each threat type's response
    const prefixes = {};
    const newClientStates = {};

    for (const update of (data.listUpdateResponses || [])) {
      const { threatType, additions, removals, newClientState, responseType } = update;

      newClientStates[threatType] = newClientState || "";

      // Decode all addition blobs for this threat type
      const addedPrefixes = [];
      for (const addition of (additions || [])) {
        if (addition.rawHashes && addition.rawHashes.rawHashes) {
          const decoded = decodeRawPrefixes(
            addition.rawHashes.rawHashes,
            addition.rawHashes.prefixSize || PREFIX_SIZE
          );
          addedPrefixes.push(...decoded);
        }
      }

      // For FULL_UPDATE the extension should replace its entire list
      // For PARTIAL_UPDATE it should apply removals then additions
      prefixes[threatType] = {
        entries: addedPrefixes,
        responseType: responseType || "FULL_UPDATE",
        // Removals are indices into the existing sorted list
        // Pass them through so the extension can apply them
        removals: (removals || []).flatMap(r =>
          r.rawIndices ? r.rawIndices.indices : []
        )
      };
    }

    return res.json({
      prefixes,
      clientStates: newClientStates,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error("[ClickSafe] SB prefix fetch error:", error.message);
    // Don't crash the extension — return empty so it falls back to full URL checks.
    // Do NOT forward error.message to the client — it may contain API error details.
    return res.status(500).json({
      error: "Could not fetch Safe Browsing prefix list"
    });
  }
}

module.exports = { getSbPrefixes };