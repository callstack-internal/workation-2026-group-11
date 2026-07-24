// Load/save settings to chrome.storage.sync. main.js reacts live via
// chrome.storage.onChanged, so no reload is needed.

const DEFAULTS = {
  thresholdMin: 30,
  alphaPerMin: 0.05,
  maxMultiplier: 4,
  overlayEnabled: true,
  mockMode: false,
  mockSpeedX: 60,
  calendarEnabled: false,
  customSelector: '',
};

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
}

function save() {
  const patch = {};
  for (const key of BOOLEAN) patch[key] = document.getElementById(key).checked;
  for (const key of NUMERIC) {
    const n = Number(document.getElementById(key).value);
    if (Number.isFinite(n)) patch[key] = n;
  }
  for (const key of TEXT) patch[key] = document.getElementById(key).value.trim();
  chrome.storage.sync.set(patch).then(() => flash('Saved ✓'));
}

document.addEventListener('DOMContentLoaded', restore);
for (const key of [...BOOLEAN, ...NUMERIC, ...TEXT]) {
  document.getElementById(key).addEventListener('change', save);
}
