// CallCost — content script for Google Calendar.
// Injects an "Estimated cost" row into the event-detail dialog, styled to
// match the native "Notifications" row that sits above it.

export {};

const STORAGE_KEY = "callcost:enabled";
const MARKER_ATTR = "data-callcost-cost";

// Hardcoded for now; will be computed from participants/duration/rates later.
const ESTIMATED_COST = "$42.50";

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
      <ol class="oIOto" aria-label="Estimated cost"><li>${ESTIMATED_COST}</li></ol>
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

  injectCostRow();

  const observer = new MutationObserver(() => injectCostRow());
  observer.observe(document.body, { childList: true, subtree: true });
}

void main();
