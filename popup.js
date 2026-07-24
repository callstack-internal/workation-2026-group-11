// CallCost — popup logic
// Handles the enable/disable (eye) toggle and persists the state.
// No Google Meet / cost logic yet — this is the baseline UI only.

(() => {
  "use strict";

  const STORAGE_KEY = "callcost:enabled";

  const body = document.body;
  const toggle = document.getElementById("toggle");
  const statusEl = document.getElementById("status");
  const hintEl = document.getElementById("hint");

  const COPY = {
    on: {
      status: "Tracking active",
      hint: "CallCost is keeping an eye on your calls.",
    },
    off: {
      status: "Paused",
      hint: "Tracking is off. Tap the eye to resume.",
    },
  };

  // --- storage helpers (chrome.storage with a localStorage fallback) ---
  const hasChromeStorage =
    typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

  function loadEnabled() {
    return new Promise((resolve) => {
      if (hasChromeStorage) {
        chrome.storage.local.get({ [STORAGE_KEY]: true }, (res) => {
          resolve(Boolean(res[STORAGE_KEY]));
        });
      } else {
        const raw = localStorage.getItem(STORAGE_KEY);
        resolve(raw === null ? true : raw === "true");
      }
    });
  }

  function saveEnabled(enabled) {
    if (hasChromeStorage) {
      chrome.storage.local.set({ [STORAGE_KEY]: enabled });
    } else {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    }
  }

  // Reflect state on the toolbar icon (best-effort; no-op outside the extension).
  function updateBadge(enabled) {
    if (typeof chrome === "undefined" || !chrome.action) return;
    try {
      chrome.action.setBadgeText({ text: enabled ? "" : "off" });
      chrome.action.setBadgeBackgroundColor({ color: "#4b4d68" });
      chrome.action.setTitle({
        title: enabled ? "CallCost — tracking active" : "CallCost — paused",
      });
    } catch (_) {
      /* ignore */
    }
  }

  function render(enabled) {
    body.classList.toggle("is-disabled", !enabled);
    toggle.setAttribute("aria-checked", String(enabled));
    const copy = enabled ? COPY.on : COPY.off;
    statusEl.textContent = copy.status;
    hintEl.textContent = copy.hint;
  }

  let enabled = true;

  function setEnabled(next) {
    enabled = next;
    render(enabled);
    saveEnabled(enabled);
    updateBadge(enabled);
  }

  toggle.addEventListener("click", () => setEnabled(!enabled));

  // init
  loadEnabled().then((initial) => {
    enabled = initial;
    render(enabled);
    updateBadge(enabled);
  });
})();
