// Standalone demo orchestrator. Runs on an extension page (real chrome APIs), so
// it drives the same match/cost/overlay modules the content script uses — but
// with a mock roster and a controllable, accelerated clock instead of scraping a
// live Meet.
(function () {
  const MCM = window.__MCM;

  const clock = { baseMin: 20, speed: 60, running: true, wallStart: Date.now() };
  let roster = [...MCM.mock.DEFAULT_ROSTER];
  let rates = { currency: 'USD', defaultRatePerMinute: 1, people: [] };
  let index = new Map();
  let overlay = null;
  let settings = {
    ...MCM.settings.DEFAULTS,
    alertThresholdsUsd: { ...MCM.settings.ALERT_THRESHOLDS_USD },
  };
  let ledger = MCM.cost.createLedger();
  let fxQuote = null;

  function elapsedMin() {
    const live = clock.running ? ((Date.now() - clock.wallStart) / 60000) * clock.speed : 0;
    return Math.max(0, clock.baseMin + live);
  }
  function freeze() {
    // Fold live time into baseMin so speed/pause changes don't jump the clock.
    clock.baseMin = elapsedMin();
    clock.wallStart = Date.now();
  }

  async function loadRates() {
    try {
      const res = await fetch(chrome.runtime.getURL('data/rates.mock.json'));
      if (res.ok) rates = await res.json();
    } catch (_) {
      /* keep defaults */
    }
    index = MCM.match.buildIndex(rates);
  }

  async function loadSettings() {
    try {
      settings = {
        ...settings,
        ...(await chrome.storage.sync.get(settings)),
      };
      settings.alertThresholdsUsd = MCM.settings.alertThresholds(settings.alertThresholdsUsd);
    } catch (_) {
      /* keep defaults */
    }
  }

  async function loadFx() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'mcm-fx-rate' });
      if (Number(response?.plnPerUsd) > 0) fxQuote = response;
    } catch (_) {
      /* PLN demo still works; USD and alert colors remain unavailable */
    }
  }

  function tick() {
    const m = MCM.match.matchParticipants(roster, rates, index);
    const t = elapsedMin();
    const c = ledger.update({
      nowMs: t * 60000,
      ratePerMinute: m.ratePerMinuteTotal,
      hasPresence: roster.length > 0,
      settings,
    });
    const displayCurrency = settings.displayCurrency === 'USD' ? 'USD' : 'PLN';
    const total = MCM.currency.convert(
      c.total,
      rates.currency,
      displayCurrency,
      fxQuote?.plnPerUsd,
    );
    const currentRatePerMin = MCM.currency.convert(
      c.currentRatePerMin,
      rates.currency,
      displayCurrency,
      fxQuote?.plnPerUsd,
    );
    const totalUsd = MCM.currency.convert(c.total, rates.currency, 'USD', fxQuote?.plnPerUsd);
    overlay.update({
      total,
      currentRatePerMin,
      multiplier: c.multiplier,
      matched: m.matched,
      totalPeople: m.total,
      elapsedMin: c.elapsedMin,
      currency: displayCurrency,
      mock: true,
      alertLevel: MCM.settings.alertLevel(totalUsd, settings.alertThresholdsUsd),
      alertThresholdsUsd: settings.alertThresholdsUsd,
      availabilityMessage:
        totalUsd == null ? 'Live NBP USD/PLN quote unavailable; USD alerts are paused.' : '',
      ratesAvailable: true,
      started: c.started,
      estimated: m.estimated,
      fallback: m.fallback,
      unknown: m.unknown,
    });
  }

  function renderChips() {
    const chips = document.getElementById('chips');
    chips.innerHTML = '';
    roster.forEach((name, i) => {
      const isMatch = MCM.match.matchParticipants([name], rates, index).matched === 1;
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = (isMatch ? '👤 ' : '❓ ') + name;
      const x = document.createElement('button');
      x.textContent = '✕';
      x.title = 'Remove';
      x.addEventListener('click', () => {
        roster.splice(i, 1);
        renderChips();
        tick();
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }

  function wireControls() {
    document.getElementById('playPause').addEventListener('click', (e) => {
      freeze();
      clock.running = !clock.running;
      e.target.textContent = clock.running ? '⏸ Pause' : '▶ Play';
    });
    for (const btn of document.querySelectorAll('[data-jump]')) {
      btn.addEventListener('click', () => {
        freeze();
        clock.baseMin += Number(btn.dataset.jump);
        tick();
      });
    }
    document.getElementById('reset').addEventListener('click', () => {
      clock.baseMin = 0;
      clock.wallStart = Date.now();
      ledger = MCM.cost.createLedger();
      tick();
    });
    for (const btn of document.querySelectorAll('.speed')) {
      btn.addEventListener('click', () => {
        freeze();
        clock.speed = Number(btn.dataset.speed);
        document.querySelectorAll('.speed').forEach((b) => b.classList.toggle('active', b === btn));
      });
    }
    const addName = (name) => {
      const n = (name || '').trim();
      if (!n) return;
      roster.push(n);
      renderChips();
      tick();
    };
    document.getElementById('addBtn').addEventListener('click', () => {
      const input = document.getElementById('newName');
      addName(input.value);
      input.value = '';
    });
    document.getElementById('newName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('addBtn').click();
    });
    document.getElementById('addUnknown').addEventListener('click', () => addName('Random Outsider ' + (roster.length + 1)));
  }

  async function main() {
    await Promise.all([loadRates(), loadSettings(), loadFx()]);
    // Seed the roster at t=0 so the initial 20-minute demo state has history.
    const initial = MCM.match.matchParticipants(roster, rates, index);
    ledger.update({
      nowMs: 0,
      ratePerMinute: initial.ratePerMinuteTotal,
      hasPresence: roster.length > 0,
      settings,
    });
    overlay = MCM.overlay.createOverlay({
      currency: settings.displayCurrency,
      onCurrencyChange: (currency) => {
        settings.displayCurrency = currency;
        chrome.storage.sync.set({ displayCurrency: currency }).catch(() => {});
        tick();
      },
    });
    wireControls();
    renderChips();
    tick();
    setInterval(tick, 250);
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'sync') {
        for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
        settings.alertThresholdsUsd = MCM.settings.alertThresholds(settings.alertThresholdsUsd);
        tick();
      }
    });
  }

  main();
})();
