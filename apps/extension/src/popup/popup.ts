// CallCost — popup logic
// Main view: the enable/disable (eye) toggle.
// Settings view: the Google API key used later for fetching data.

import { storageGet, storageSet } from "../storage";
import {
  getGoogleApiKey,
  hasGoogleApiKey,
  loadSettings,
  setGoogleApiKey,
} from "../settings";

const ENABLED_KEY = "callcost:enabled";

const body = document.body;

// --- main view elements ---
const toggle = document.getElementById("toggle") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const hintEl = document.getElementById("hint") as HTMLParagraphElement;
const openSettingsBtn = document.getElementById(
  "open-settings",
) as HTMLButtonElement;

// --- settings view elements ---
const mainView = document.getElementById("view-main") as HTMLElement;
const settingsView = document.getElementById("view-settings") as HTMLElement;
const settingsForm = document.getElementById("settings-form") as HTMLFormElement;
const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const revealBtn = document.getElementById("reveal-key") as HTMLButtonElement;
const keyStatus = document.getElementById("key-status") as HTMLParagraphElement;
const cancelBtn = document.getElementById("cancel-settings") as HTMLButtonElement;

const COPY = {
  on: {
    status: "Tracking active",
    hint: "CallCost is keeping an eye on your calls.",
  },
  off: {
    status: "Paused",
    hint: "Tracking is off. Tap the eye to resume.",
  },
} as const;

/* ------------------------- enable/disable toggle ------------------------- */

let enabled = true;

// Reflect state on the toolbar icon (best-effort; no-op outside the extension).
function updateBadge(on: boolean): void {
  if (typeof chrome === "undefined" || !chrome.action) return;
  try {
    chrome.action.setBadgeText({ text: on ? "" : "off" });
    chrome.action.setBadgeBackgroundColor({ color: "#4b4d68" });
    chrome.action.setTitle({
      title: on ? "CallCost — tracking active" : "CallCost — paused",
    });
  } catch {
    /* ignore */
  }
}

function renderEnabled(on: boolean): void {
  body.classList.toggle("is-disabled", !on);
  toggle.setAttribute("aria-checked", String(on));
  const copy = on ? COPY.on : COPY.off;
  statusEl.textContent = copy.status;
  hintEl.textContent = copy.hint;
}

function setEnabled(next: boolean): void {
  enabled = next;
  renderEnabled(enabled);
  void storageSet(ENABLED_KEY, enabled);
  updateBadge(enabled);
}

toggle.addEventListener("click", () => setEnabled(!enabled));

/* ------------------------------ settings ------------------------------ */

function setRevealed(revealed: boolean): void {
  apiKeyInput.type = revealed ? "text" : "password";
  revealBtn.setAttribute("aria-pressed", String(revealed));
  revealBtn.setAttribute("aria-label", revealed ? "Hide API key" : "Show API key");
}

function renderKeyStatus(): void {
  const set = hasGoogleApiKey();
  keyStatus.textContent = set
    ? "A key is saved and ready to use."
    : "No key saved yet.";
  keyStatus.classList.toggle("is-set", set);
}

function openSettings(): void {
  // Seed the input from the persisted value so unsaved edits are discarded
  // whenever the settings view is (re)opened.
  apiKeyInput.value = getGoogleApiKey();
  setRevealed(false);
  renderKeyStatus();
  mainView.hidden = true;
  settingsView.hidden = false;
  apiKeyInput.focus();
}

function closeSettings(): void {
  settingsView.hidden = true;
  mainView.hidden = false;
  openSettingsBtn.focus();
}

async function saveSettings(): Promise<void> {
  await setGoogleApiKey(apiKeyInput.value);
  closeSettings();
}

openSettingsBtn.addEventListener("click", openSettings);
cancelBtn.addEventListener("click", closeSettings);
revealBtn.addEventListener("click", () =>
  setRevealed(apiKeyInput.type === "password"),
);
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

/* -------------------------------- init -------------------------------- */

async function init(): Promise<void> {
  await loadSettings(); // hydrate the in-memory Google API key
  const initialEnabled = await storageGet<boolean>(ENABLED_KEY, true);
  enabled = initialEnabled;
  renderEnabled(enabled);
  updateBadge(enabled);
}

void init();
