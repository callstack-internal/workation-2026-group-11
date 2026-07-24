import { getHealth } from "../api";

// Service worker: runs in the background and can talk to the server
// independently of any open popup or page.

chrome.runtime.onInstalled.addListener(() => {
  console.log("[workation] extension installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PING_SERVER") {
    getHealth()
      .then((health) => sendResponse({ ok: true, health }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: String(error) }),
      );
    // Return true to keep the message channel open for the async response.
    return true;
  }
  return undefined;
});
