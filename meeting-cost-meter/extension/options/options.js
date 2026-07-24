// Load/save settings to chrome.storage.sync. main.js reacts live via
// chrome.storage.onChanged, so no reload is needed.

const SETTINGS = window.__MCM.settings;
const DEFAULTS = SETTINGS.DEFAULTS;

const NUMERIC = ['thresholdMin', 'alphaPerMin', 'maxMultiplier', 'mockSpeedX'];
const BOOLEAN = ['overlayEnabled', 'mockMode', 'calendarEnabled'];
const TEXT = ['customSelector'];
const statusEl = document.getElementById('status');

function flash(msg) {
  statusEl.textContent = msg;
  setTimeout(() => (statusEl.textContent = ''), 1200);
}

async function restore() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  for (const key of BOOLEAN) document.getElementById(key).checked = s[key] !== false && !!s[key];
  document.getElementById('overlayEnabled').checked = s.overlayEnabled !== false;
  for (const key of NUMERIC) document.getElementById(key).value = s[key];
  for (const key of TEXT) document.getElementById(key).value = s[key] || '';
  document.getElementById('displayCurrency').value = s.displayCurrency === 'USD' ? 'USD' : 'PLN';
  const alerts = SETTINGS.alertThresholds(s.alertThresholdsUsd);
  document.getElementById('alertYellowUsd').value = alerts.yellow;
  document.getElementById('alertOrangeUsd').value = alerts.orange;
  document.getElementById('alertRedUsd').value = alerts.red;
}

function save() {
  const patch = {};
  for (const key of BOOLEAN) patch[key] = document.getElementById(key).checked;
  for (const key of NUMERIC) {
    const n = Number(document.getElementById(key).value);
    if (Number.isFinite(n)) patch[key] = n;
  }
  for (const key of TEXT) patch[key] = document.getElementById(key).value.trim();
  patch.displayCurrency = document.getElementById('displayCurrency').value === 'USD' ? 'USD' : 'PLN';
  patch.alertThresholdsUsd = SETTINGS.alertThresholds({
    yellow: document.getElementById('alertYellowUsd').value,
    orange: document.getElementById('alertOrangeUsd').value,
    red: document.getElementById('alertRedUsd').value,
  });
  chrome.storage.sync.set(patch).then(() => flash('Saved ✓'));
}

document.addEventListener('DOMContentLoaded', restore);
for (const key of [
  ...BOOLEAN,
  ...NUMERIC,
  ...TEXT,
  'displayCurrency',
  'alertYellowUsd',
  'alertOrangeUsd',
  'alertRedUsd',
]) {
  document.getElementById(key).addEventListener('change', save);
}
