// ============================================================
//  ClickSafe — services/safeBrowsingService.js
//
//  Two modes:
//  1. Full URL check  — used as fallback when no local hash data
//  2. Hash confirmation — used when the extension finds a local
//     prefix match and needs to confirm with the full hash
// ============================================================

const THREAT_TYPES = [
  "MALWARE",
  "SOCIAL_ENGINEERING",
  "UNWANTED_SOFTWARE",
  "POTENTIALLY_HARMFUL_APPLICATION"
];

function getApiKey() {
  const key = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!key || key === "YOUR_API_KEY_HERE") {
    throw new Error("GOOGLE_SAFE_BROWSING_API_KEY is not configured");
  }
  return key;
}

// ── Full URL lookup (fallback path) ──────────────────────────
async function checkUrl(url) {
  try {
    const API_KEY = getApiKey();
    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "clicksafe", clientVersion: "1.0.0" },
          threatInfo: {
            threatTypes: THREAT_TYPES,
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }]
          }
        })
      }
    );

    if (!response.ok) throw new Error(`Google API HTTP ${response.status}`);

    const data = await response.json();
    if (data.matches && data.matches.length > 0) {
      return { safe: false, threat: data.matches[0].threatType };
    }
    return { safe: true };

  } catch (error) {
    console.error("[ClickSafe] Safe Browsing full check error:", error.message);
    // Fail open — Google's API being temporarily unreachable is not evidence
    // that a URL is dangerous. Returning safe:false here causes false-positive
    // warning modals in the extension. Match the signal background.js uses
    // when the backend itself is down: safe:true + unavailable:true.
    return { safe: true, threat: "API_UNAVAILABLE", unavailable: true };
  }
}

// ── Full-hash confirmation (local-first path) ─────────────────
// Called when the extension finds a local prefix match.
// We confirm with the full SHA-256 hash using the fullHashes:find endpoint.
async function confirmHash(fullHashHex, threatType) {
  try {
    const API_KEY = getApiKey();

    // Convert hex string to base64 for the API
    const hashBytes = Buffer.from(fullHashHex, "hex");
    const hashBase64 = hashBytes.toString("base64");
    // Prefix is first 4 bytes
    const prefixBase64 = hashBytes.slice(0, 4).toString("base64");

    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/fullHashes:find?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "clicksafe", clientVersion: "1.0.0" },
          clientStates: [],
          threatInfo: {
            threatTypes: [threatType],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ hash: prefixBase64 }]
          }
        })
      }
    );

    if (!response.ok) throw new Error(`Google API HTTP ${response.status}`);

    const data = await response.json();

    // Check if the full hash appears in the response matches
    if (data.matches) {
      for (const match of data.matches) {
        const matchHashHex = Buffer.from(match.threat.hash, "base64").toString("hex");
        if (matchHashHex === fullHashHex) {
          return { safe: false, threat: match.threatType };
        }
      }
    }

    // Prefix matched locally but full hash didn't confirm — false positive
    return { safe: true };

  } catch (error) {
    console.error("[ClickSafe] Hash confirmation error:", error.message);
    // Fail open — same reasoning as checkUrl above.
    return { safe: true, threat: "API_UNAVAILABLE", unavailable: true };
  }
}

module.exports = { checkUrl, confirmHash };
