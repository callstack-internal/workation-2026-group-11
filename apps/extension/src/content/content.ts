// CallCost — content script for Google Calendar.
// Injects an "Estimated cost" row into the event-detail dialog, styled to
// match the native "Notifications" row that sits above it.

export {};

const STORAGE_KEY = "callcost:enabled";
const MARKER_ATTR = "data-callcost-cost";
const STYLE_ID = "callcost-styles";

// Hardcoded for now; will be computed from participants/duration/rates later.
const ESTIMATED_COST = "$42.50";

// Injected once. Gives the cost label a funny "your wallet is on fire" vibe:
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

  [${MARKER_ATTR}] .callcost-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: 999px;
    background: #fce8e6;
    color: #c5221f;
    font-weight: 700;
    border: 1px solid #f5b5b0;
    animation: callcost-pulse 1.2s ease-in-out infinite;
    transform-origin: center;
  }

  [${MARKER_ATTR}] .callcost-badge::before {
    content: "\\1F525";
    animation: callcost-shake 0.9s ease-in-out infinite;
  }

  @keyframes callcost-shake {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    25% { transform: translateY(-1px) rotate(-8deg); }
    75% { transform: translateY(1px) rotate(8deg); }
  }
`;

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
      <ol class="oIOto" aria-label="Estimated cost"><li><span class="callcost-badge">${ESTIMATED_COST} to be burned</span></li></ol>
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

async function main(): Promise<void> {
  if (!(await isEnabled())) return;

  injectStyles();
  injectCostRow();

  const observer = new MutationObserver(() => injectCostRow());
  observer.observe(document.body, { childList: true, subtree: true });
}

void main();
