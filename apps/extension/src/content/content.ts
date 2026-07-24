// CallCost — content script for Google Calendar.
// Injects an "Estimated cost" row into the event-detail dialog, styled to
// match the native "Notifications" row that sits above it. The value comes
// from the backend, bridged in from calendar.ts via costBridge.

import { onCost, type CostDetail } from "./costBridge";

const STORAGE_KEY = "callcost:enabled";
const MARKER_ATTR = "data-callcost-cost";
const STYLE_ID = "callcost-styles";
const SLOT_CLASS = "callcost-slot";

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

function buildCostRow(notificationsRow: Element): HTMLElement {
  const row = document.createElement("div");
  row.className = notificationsRow.className;
  row.setAttribute(MARKER_ATTR, "");

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

function injectCostRow(): void {
  const notifications = document.getElementById("xDetDlgNot");
  if (!notifications) return;

  const notificationsRow = notifications.closest(".nBzcnc");
  if (!notificationsRow || !notificationsRow.parentElement) return;

  if (notificationsRow.parentElement.querySelector(`[${MARKER_ATTR}]`)) return;

  const costRow = buildCostRow(notificationsRow);
  notificationsRow.insertAdjacentElement("afterend", costRow);
}

// Refresh any already-injected badge to reflect `current`.
function updateSlots(): void {
  for (const slot of document.querySelectorAll(`[${MARKER_ATTR}] .${SLOT_CLASS}`)) {
    slot.innerHTML = badgeHtml();
  }
}

async function main(): Promise<void> {
  if (!(await isEnabled())) return;

  injectStyles();
  injectCostRow();

  onCost((detail) => {
    current = detail;
    updateSlots();
  });

  const observer = new MutationObserver(() => injectCostRow());
  observer.observe(document.body, { childList: true, subtree: true });
}

void main();
