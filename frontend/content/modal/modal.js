// ============================================================
//  ClickSafe — modal/modal.js
//  Runs inside the warning modal iframe.
//  Listens for postMessage from content.js with threat details
//  and updates the modal UI. Uses IDs from modal.html.
// ============================================================

const SVG_ALERT  = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#E63946" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
const SVG_SHIELD = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#E63946" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>';

window.addEventListener("message", function (event) {
  if (!event.data || event.data.source !== "clicksafe") return;

  const { type, url, filename, threat } = event.data;

  const icon    = document.getElementById("clicksafe-modal-icon");
  const title   = document.getElementById("clicksafe-modal-title");
  const threatEl = document.getElementById("clicksafe-modal-threat");
  const urlEl   = document.getElementById("clicksafe-modal-url");

  if (icon)     icon.innerHTML    = type === "download" ? SVG_SHIELD : SVG_ALERT;
  const label = document.getElementById("clicksafe-modal-label");
  if (label)    label.textContent  = type === "download" ? "DOWNLOAD BLOCKED" : "THREAT DETECTED";
  if (title)    title.textContent  = type === "download" ? "Dangerous Download Blocked!" : "Dangerous Link Detected!";
  if (threatEl) threatEl.textContent = `Threat: ${threat || "Unknown"}`;
  if (urlEl)    urlEl.textContent  = filename || url || "";
});

document.getElementById("clicksafe-go-back")?.addEventListener("click", () => {
  window.parent.postMessage({ source: "clicksafe-modal", action: "dismiss" }, "*");
});

document.getElementById("clicksafe-proceed")?.addEventListener("click", () => {
  window.parent.postMessage({ source: "clicksafe-modal", action: "proceed" }, "*");
});
