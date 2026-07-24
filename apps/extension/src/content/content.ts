// CallCost — content script for Google Calendar.
// Injects an "Estimated cost" row into the event-detail dialog, styled to
// match the native "Notifications" row that sits above it. The value comes
// from the backend, bridged in from calendar.ts via costBridge.

import { onCost, type CostDetail } from "./costBridge";

const STORAGE_KEY = "callcost:enabled";
const MARKER_ATTR = "data-callcost-cost";
const STYLE_ID = "callcost-styles";
const SLOT_CLASS = "callcost-slot";
const HIDDEN_CLASS = "callcost-hidden";

// Mirrors the popup's eye toggle (callcost:enabled). When disabled (crossed
// eye) the injected cost row is hidden; when enabled (open eye) it's shown.
let enabled = true;

// Latest cost we've heard about for the open event (null before the first
// event opens). Drives what the badge renders.
let current: CostDetail | null = null;

const currencyFmt = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
});

// Injected once. Gives the priced badge a funny "your wallet is on fire" vibe:
// a red warning pill that pulses and gently wobbles.
const STYLES = `
  @keyframes callcost-pulse {
    0%, 100% {
      transform: scale(1) rotate(-1deg);
      box-shadow: 0 0 0 0 rgba(217, 48, 37, 0.55);
    }
    50% {
      transform: scale(1.06) rotate(1deg);
      box-shadow: 0 0 0 8px rgba(217, 48, 37, 0);
    }
  }

  @keyframes callcost-shake {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    25% { transform: translateY(-1px) rotate(-8deg); }
    75% { transform: translateY(1px) rotate(8deg); }
  }

  [${MARKER_ATTR}].${HIDDEN_CLASS} {
    display: none !important;
  }

  [${MARKER_ATTR}] .callcost-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: 999px;
    font-weight: 700;
    background: #fce8e6;
    color: #c5221f;
    border: 1px solid #f5b5b0;
    animation: callcost-pulse 1.2s ease-in-out infinite;
    transform-origin: center;
  }

  [${MARKER_ATTR}] .callcost-badge::before {
    content: "\\1F525";
    animation: callcost-shake 0.9s ease-in-out infinite;
  }

  /* Calm, non-alarming states while loading or on error. */
  [${MARKER_ATTR}] .callcost-badge--muted {
    background: #e8eaed;
    color: #5f6368;
    border-color: #dadce0;
    font-weight: 500;
    animation: none;
  }

  [${MARKER_ATTR}] .callcost-badge--muted::before {
    content: "";
    animation: none;
  }
`;

function badgeHtml(): string {
  if (!current || current.status === "loading") {
    return `<span class="callcost-badge callcost-badge--muted">Calculating…</span>`;
  }
  if (current.status === "error") {
    return `<span class="callcost-badge callcost-badge--muted">Cost unavailable</span>`;
  }
  if (current.status === "hidden") {
    return `<span class="callcost-badge callcost-badge--muted">Guest list hidden</span>`;
  }
  return `<span class="callcost-badge">${currencyFmt.format(current.result.totalCost)} to be burned</span>`;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function isEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get({ [STORAGE_KEY]: true }, (res) => {
        resolve(Boolean(res[STORAGE_KEY]));
      });
    } else {
      resolve(true);
    }
  });
}

function buildCostRow(): HTMLElement {
  const row = document.createElement("div");
  // Matches the native metadata rows (Notifications, organizer, etc.).
  row.className = "nBzcnc OcVpRe";
  row.setAttribute(MARKER_ATTR, "");
  // Respect the current toggle state at creation to avoid a flash of the label
  // when the plugin is disabled and the dialog (re)renders.
  if (!enabled) row.classList.add(HIDDEN_CLASS);

  row.innerHTML = `
    <div aria-hidden="true" class="zZj8Pb EaVNbc">
      <i class="google-material-icons notranslate" aria-hidden="true">payments</i>
    </div>
    <div class="toUqff ">
      <ol class="oIOto" aria-label="Estimated cost"><li class="${SLOT_CLASS}">${badgeHtml()}</li></ol>
    </div>
  `;

  return row;
}

// Find a native detail row to anchor the cost row to. The Notifications row is
// preferred, but it's absent for events without reminders (e.g. all-day events,
// see no-notif.html), so fall back to rows that are always present: the
// organizer row, then the date/time row.
function findAnchor(): { row: Element; position: InsertPosition } | null {
  const notifications = document.getElementById("xDetDlgNot")?.closest(".nBzcnc");
  if (notifications) return { row: notifications, position: "afterend" };

  const organizer = document.getElementById("xDetDlgCal")?.closest(".nBzcnc");
  if (organizer) return { row: organizer, position: "beforebegin" };

  const when = document.getElementById("xDetDlgWhen")?.closest(".nBzcnc");
  if (when) return { row: when, position: "afterend" };

  return null;
}

function injectCostRow(): void {
  const anchor = findAnchor();
  if (!anchor || !anchor.row.parentElement) return;

  // Dedupe across the whole dialog, since the anchor can change between ticks
  // (e.g. if the Notifications row shows up later) and land in another parent.
  const scope = anchor.row.closest('[role="dialog"]') ?? document;
  if (scope.querySelector(`[${MARKER_ATTR}]`)) return;

  const costRow = buildCostRow();
  anchor.row.insertAdjacentElement(anchor.position, costRow);
}

// Refresh any already-injected badge to reflect `current`.
function updateSlots(): void {
  for (const slot of document.querySelectorAll(`[${MARKER_ATTR}] .${SLOT_CLASS}`)) {
    slot.innerHTML = badgeHtml();
  }
}

// Show/hide every injected cost row to match the current toggle state.
function applyVisibility(): void {
  document
    .querySelectorAll(`[${MARKER_ATTR}]`)
    .forEach((row) => row.classList.toggle(HIDDEN_CLASS, !enabled));
}

async function main(): Promise<void> {
  enabled = await isEnabled();

  // Always inject the row + styles; visibility is driven by the toggle so the
  // label can be shown/hidden live without reloading the Calendar tab.
  injectStyles();
  injectCostRow();

  onCost((detail) => {
    current = detail;
    updateSlots();
  });

  const observer = new MutationObserver(() => injectCostRow());
  observer.observe(document.body, { childList: true, subtree: true });

  // React to the eye toggle in the popup (writes callcost:enabled to storage).
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      enabled = Boolean(changes[STORAGE_KEY].newValue);
      applyVisibility();
    });
  }
}

void main();
