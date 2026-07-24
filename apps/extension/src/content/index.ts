// Content script: injected into matching pages. Kept minimal here; it asks
// the background service worker whether the server is reachable.

chrome.runtime.sendMessage({ type: "PING_SERVER" }, (response) => {
  if (chrome.runtime.lastError) {
    return;
  }
  if (response?.ok) {
    console.log("[workation] server reachable from content script", response.health);
  }
});
