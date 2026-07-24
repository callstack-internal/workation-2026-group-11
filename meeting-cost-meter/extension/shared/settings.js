// Shared runtime defaults and alert-level rules. This is the single source of
// truth for the content script, options page, and service worker.
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const MCM = (G.__MCM = G.__MCM || {});

  const ALERT_THRESHOLDS_USD = Object.freeze({
    yellow: 10,
    orange: 20,
    red: 30,
  });

  const ALERT_COLORS = Object.freeze({
    idle: '#5f6368',
    unavailable: '#5f6368',
    green: '#188038',
    yellow: '#f9ab00',
    orange: '#e8710a',
    red: '#d93025',
  });

  const DEFAULTS = Object.freeze({
    thresholdMin: 30,
    alphaPerMin: 0.05,
    maxMultiplier: 4,
    overlayEnabled: true,
    mockMode: false,
    mockSpeedX: 60,
    calendarEnabled: false,
    customSelector: '',
    displayCurrency: 'PLN',
    alertThresholdsUsd: ALERT_THRESHOLDS_USD,
  });

  function alertThresholds(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const yellow = positiveNumber(raw.yellow, ALERT_THRESHOLDS_USD.yellow);
    const orange = Math.max(positiveNumber(raw.orange, ALERT_THRESHOLDS_USD.orange), yellow);
    const red = Math.max(positiveNumber(raw.red, ALERT_THRESHOLDS_USD.red), orange);
    return { yellow, orange, red };
  }

  function alertLevel(totalUsd, thresholds) {
    if (!Number.isFinite(totalUsd)) return 'unavailable';
    const t = alertThresholds(thresholds);
    if (totalUsd > t.red) return 'red';
    if (totalUsd > t.orange) return 'orange';
    if (totalUsd > t.yellow) return 'yellow';
    return 'green';
  }

  function positiveNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  MCM.settings = {
    ALERT_THRESHOLDS_USD,
    ALERT_COLORS,
    DEFAULTS,
    alertThresholds,
    alertLevel,
  };
})();
