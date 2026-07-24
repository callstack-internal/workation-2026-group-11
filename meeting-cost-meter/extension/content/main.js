// Live orchestrator. Rates, attendance, and time are deliberately independent:
// - real mode never loads demo rates;
// - Calendar identifies scraped attendees but never substitutes invitees;
// - a cumulative ledger preserves prior cost when the roster changes.
(function () {
  const MCM = window.__MCM;
  if (
    !MCM?.scrape ||
    !MCM?.match ||
    !MCM?.cost ||
    !MCM?.currency ||
    !MCM?.overlay ||
    !MCM?.settings
  ) {
    console.error('[MCM] namespace incomplete — check content script order in manifest.json');
    return;
  }

  const TICK_MS = 1000;
  const LEDGER_SAVE_MS = 5000;
  const MAX_MEETING_MS = 8 * 60 * 60 * 1000;
  const CALENDAR_REFRESH_MS = 10 * 60 * 1000;
  const FX_REFRESH_MS = 6 * 60 * 60 * 1000;
  const OVERRIDES_KEY = 'mcm_overrides';

  async function loadRatesFile(file) {
    try {
      const res = await fetch(chrome.runtime.getURL(file));
      if (!res.ok) return null;
      const json = await res.json();
      if (!Array.isArray(json?.people) || !json.people.length || !json.currency) return null;
      return json;
    } catch {
      return null;
    }
  }

  async function loadSettings() {
    const defaults = {
      ...MCM.settings.DEFAULTS,
      alertThresholdsUsd: { ...MCM.settings.ALERT_THRESHOLDS_USD },
    };
    try {
      const stored = await chrome.storage.sync.get(defaults);
      return {
        ...defaults,
        ...stored,
        displayCurrency: stored.displayCurrency === 'USD' ? 'USD' : 'PLN',
        alertThresholdsUsd: MCM.settings.alertThresholds(stored.alertThresholdsUsd),
      };
    } catch {
      return defaults;
    }
  }

  async function loadOverrides() {
    try {
      const { [OVERRIDES_KEY]: saved } = await chrome.storage.local.get(OVERRIDES_KEY);
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  }

  function meetingCode() {
    return MCM.scrape.meetingCodeFromPath(location.pathname);
  }

  function ledgerStorageKey(code) {
    return `mcm_ledger_${code}`;
  }

  async function loadLedgerSnapshot(code) {
    if (!code) return null;
    const key = ledgerStorageKey(code);
    try {
      const { [key]: saved } = await chrome.storage.local.get(key);
      const age = Date.now() - Number(saved?.savedAt);
      if (
        saved?.code === code &&
        saved.snapshot?.version === 1 &&
        age >= 0 &&
        age < MAX_MEETING_MS
      ) {
        return saved.snapshot;
      }
    } catch {
      // A non-persistent ledger is still safe; it just will not survive reload.
    }
    return null;
  }

  async function requestFxQuote() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'mcm-fx-rate' });
      const rate = Number(response?.plnPerUsd);
      return rate > 0 ? { plnPerUsd: rate, effectiveDate: response.effectiveDate || '' } : null;
    } catch {
      return null;
    }
  }

  async function main() {
    const initialMeetingCode = meetingCode();
    const [realRates, mockRates, settings, savedOverrides, savedLedger] = await Promise.all([
      loadRatesFile('data/rates.json'),
      loadRatesFile('data/rates.mock.json'),
      loadSettings(),
      loadOverrides(),
      loadLedgerSnapshot(initialMeetingCode),
    ]);

    if (!realRates) {
      console.warn(
        '[MCM] real rates are unavailable. Real mode will not use demo values; run `npm run ingest` and reload the extension.',
      );
    }

    const realIndex = realRates ? MCM.match.buildIndex(realRates) : new Map();
    const mockIndex = mockRates ? MCM.match.buildIndex(mockRates) : new Map();
    let currentSettings = settings;
    let overrides = savedOverrides;
    let realLedger = MCM.cost.createLedger(savedLedger);
    let mockLedger = MCM.cost.createLedger();
    let mockWallStart = Date.now();
    let fxQuote = null;
    let calendarAttendees = null;
    let calendarWarned = false;
    let lastLedgerSave = 0;
    let lastToolbarState = '';
    let currentMeetingCode = initialMeetingCode;
    let finishedMeeting = null;
    let lastMatchedRates = emptyMatchSummary();
    const suggestionCache = new Map();

    MCM.scrape.setCustomSelector(currentSettings.customSelector);

    const overlay = MCM.overlay.createOverlay({
      currency: currentSettings.displayCurrency,
      onCurrencyChange: (currency) => {
        currentSettings.displayCurrency = currency;
        chrome.storage.sync.set({ displayCurrency: currency }).catch(() => {});
        tick();
      },
      onManualRoster: (names) => {
        MCM.scrape.setManualRoster(names);
        tick();
      },
      onConfirmOverride: (displayName, key) => {
        overrides[MCM.match.normalizeName(displayName)] = key;
        suggestionCache.clear();
        chrome.storage.local.set({ [OVERRIDES_KEY]: overrides }).catch(() => {});
        tick();
      },
    });
    overlay.setVisible(currentSettings.overlayEnabled !== false);
    overlay.setActive(initialMeetingCode != null);

    function suggestionsFor(detail, keys) {
      const norm = MCM.match.normalizeName(detail.name);
      if (!suggestionCache.has(norm)) {
        suggestionCache.set(norm, MCM.match.suggestFor(detail.name, keys, { floor: 0.5 }));
      }
      return suggestionCache.get(norm);
    }

    function emptyMatchSummary() {
      return {
        matched: 0,
        total: 0,
        ratePerMinuteTotal: 0,
        estimated: 0,
        fallback: 0,
        unknown: 0,
        details: [],
      };
    }

    async function refreshFx() {
      const quote = await requestFxQuote();
      if (quote) {
        fxQuote = quote;
        tick();
      } else if (!fxQuote) {
        console.warn('[MCM] NBP USD/PLN quote unavailable; USD display and USD alert thresholds are paused.');
      }
    }

    async function refreshCalendar() {
      if (!currentSettings.calendarEnabled || currentSettings.mockMode) return;
      const code = meetingCode();
      if (!code) return;
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'mcm-calendar-attendees',
          code,
        });
        if (res?.error) throw new Error(res.error);
        calendarAttendees = res?.eventFound ? res.attendees : null;
        if (res && !res.eventFound && !calendarWarned) {
          calendarWarned = true;
          console.info('[MCM] no Calendar event found for this Meet — using name matching.');
        }
      } catch (err) {
        calendarAttendees = null;
        if (!calendarWarned) {
          calendarWarned = true;
          console.warn(
            `[MCM] Calendar lookup failed (${err.message}) — using name matching. Check the OAuth client ID in manifest.json.`,
          );
        }
      }
    }

    function saveRealLedger(force = false) {
      if (!currentMeetingCode) return;
      const now = Date.now();
      if (!force && now - lastLedgerSave < LEDGER_SAVE_MS) return;
      lastLedgerSave = now;
      const key = ledgerStorageKey(currentMeetingCode);
      chrome.storage.local
        .set({
          [key]: {
            code: currentMeetingCode,
            savedAt: now,
            snapshot: realLedger.snapshot(),
          },
        })
        .catch(() => {});
    }

    function notifyToolbar(level, allowBlink = true) {
      const blinkOn =
        level !== 'red' || !allowBlink || Math.floor(Date.now() / 1000) % 2 === 0;
      const stateKey = `${level}:${allowBlink}:${blinkOn}`;
      if (stateKey === lastToolbarState) return;
      lastToolbarState = stateKey;
      chrome.runtime
        .sendMessage({ type: 'mcm-alert-state', level, blinkOn })
        .catch(() => {});
    }

    function renderUnavailable(names, mock) {
      const message = mock
        ? 'Mock rates are unavailable. Reinstall the extension data files.'
        : 'Real rates unavailable. Run `npm run ingest`, then reload the extension.';
      overlay.update({
        total: null,
        currentRatePerMin: null,
        multiplier: 1,
        matched: 0,
        totalPeople: names.length,
        elapsedMin: 0,
        currency: currentSettings.displayCurrency,
        mock,
        unmatched: [],
        alertLevel: 'unavailable',
        alertThresholdsUsd: currentSettings.alertThresholdsUsd,
        availabilityMessage: message,
        ratesAvailable: false,
        started: false,
        estimated: 0,
        fallback: 0,
        unknown: 0,
      });
      notifyToolbar('unavailable');
    }

    function renderCost({ ledgerState, matchedRates, rates, mock, unmatched = [], ended = false }) {
      const sourceCurrency = MCM.currency.normalizeCurrency(rates.currency);
      const displayCurrency = currentSettings.displayCurrency;
      const plnPerUsd = fxQuote?.plnPerUsd;
      const total = MCM.currency.convert(
        ledgerState.total,
        sourceCurrency,
        displayCurrency,
        plnPerUsd,
      );
      const currentRatePerMin = MCM.currency.convert(
        ended ? 0 : ledgerState.currentRatePerMin,
        sourceCurrency,
        displayCurrency,
        plnPerUsd,
      );
      const totalUsd = MCM.currency.convert(
        ledgerState.total,
        sourceCurrency,
        'USD',
        plnPerUsd,
      );
      const alertLevel = MCM.settings.alertLevel(
        totalUsd,
        currentSettings.alertThresholdsUsd,
      );
      const fxUnavailable = total == null || currentRatePerMin == null || totalUsd == null;
      const messages = [];
      if (ended) messages.push('Meeting ended — final cost frozen.');
      if (fxUnavailable) {
        messages.push('Live NBP USD/PLN quote unavailable; conversion and cost alerts are paused.');
      }

      overlay.update({
        total,
        currentRatePerMin,
        multiplier: ledgerState.multiplier,
        matched: matchedRates.matched,
        totalPeople: matchedRates.total,
        elapsedMin: ledgerState.elapsedMin,
        currency: displayCurrency,
        mock,
        unmatched,
        alertLevel,
        alertThresholdsUsd: currentSettings.alertThresholdsUsd,
        availabilityMessage: messages.join(' '),
        ratesAvailable: true,
        started: ledgerState.started,
        estimated: matchedRates.estimated,
        fallback: matchedRates.fallback,
        unknown: matchedRates.unknown,
        ended,
      });
      notifyToolbar(alertLevel, !ended);
    }

    function tick() {
      const pageMeetingCode = meetingCode();
      if (!pageMeetingCode) {
        if (currentMeetingCode) {
          saveRealLedger(true);
          currentMeetingCode = null;
          realLedger = MCM.cost.createLedger();
          mockLedger = MCM.cost.createLedger();
          mockWallStart = Date.now();
          calendarAttendees = null;
        }
        finishedMeeting = null;
        lastMatchedRates = emptyMatchSummary();
        overlay.setActive(false);
        notifyToolbar('idle');
        return;
      }

      overlay.setActive(true);
      if (pageMeetingCode !== currentMeetingCode) {
        currentMeetingCode = pageMeetingCode;
        realLedger = MCM.cost.createLedger();
        mockLedger = MCM.cost.createLedger();
        mockWallStart = Date.now();
        lastLedgerSave = 0;
        calendarAttendees = null;
        calendarWarned = false;
        finishedMeeting = null;
        lastMatchedRates = emptyMatchSummary();
        refreshCalendar();
      }

      const mock = !!currentSettings.mockMode;
      const rates = mock ? mockRates : realRates;
      const index = mock ? mockIndex : realIndex;
      const mockSpeed = Number(currentSettings.mockSpeedX) > 0
        ? Number(currentSettings.mockSpeedX)
        : 1;
      const mockNowMs = (Date.now() - mockWallStart) * mockSpeed;
      const rosterElapsedMin = mockNowMs / 60000;
      const ledger = mock ? mockLedger : realLedger;
      const ledgerNowMs = mock ? mockNowMs : Date.now();

      if (MCM.scrape.isMeetingEnded()) {
        if (!rates) {
          renderUnavailable([], mock);
          return;
        }
        if (
          !finishedMeeting ||
          finishedMeeting.code !== pageMeetingCode ||
          finishedMeeting.mock !== mock
        ) {
          const ledgerState = ledger.update({
            nowMs: ledgerNowMs,
            ratePerMinute: 0,
            hasPresence: false,
            settings: currentSettings,
          });
          finishedMeeting = {
            code: pageMeetingCode,
            mock,
            ledgerState,
            matchedRates: lastMatchedRates,
          };
          if (!mock) saveRealLedger(true);
        }
        renderCost({ ...finishedMeeting, rates, ended: true });
        return;
      }

      if (finishedMeeting?.code === pageMeetingCode) {
        // A Rejoin removes the post-call heading. Resume from "now" without
        // charging or timing the interval spent on the exit screen.
        realLedger.rebase(Date.now(), currentSettings);
        mockLedger.rebase(mockNowMs, currentSettings);
        finishedMeeting = null;
      }

      const names = mock
        ? MCM.mock.rosterAt(rosterElapsedMin)
        : MCM.scrape.getParticipants();

      if (!rates) {
        renderUnavailable(names, mock);
        return;
      }

      let matchedRates;
      if (!mock && calendarAttendees?.length) {
        matchedRates = MCM.match.matchByCalendar(
          names,
          calendarAttendees,
          rates,
          index,
          { overrides },
        );
      } else {
        matchedRates = MCM.match.matchParticipants(names, rates, index, { overrides });
      }
      lastMatchedRates = matchedRates;

      const keys = [...index.keys()];
      const unmatched = matchedRates.details
        .filter((detail) => !detail.isMatch)
        .map((detail) => ({
          name: detail.name,
          suggestions: suggestionsFor(detail, keys),
        }))
        .filter((entry) => entry.suggestions.length);

      const ledgerState = ledger.update({
        nowMs: ledgerNowMs,
        ratePerMinute: matchedRates.ratePerMinuteTotal,
        hasPresence: names.length > 0,
        settings: currentSettings,
      });
      if (!mock) saveRealLedger();

      renderCost({
        ledgerState,
        matchedRates,
        rates,
        mock,
        unmatched,
      });
    }

    setInterval(tick, TICK_MS);
    MCM.scrape.onChange(tick);
    refreshFx();
    setInterval(refreshFx, FX_REFRESH_MS);
    refreshCalendar();
    setInterval(refreshCalendar, CALENDAR_REFRESH_MS);
    tick();

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'toggle-overlay') overlay.toggle();
    });
    window.addEventListener('keydown', (event) => {
      if (event.altKey && event.shiftKey && (event.key === 'C' || event.key === 'c')) {
        overlay.toggle();
      }
    });
    window.addEventListener('beforeunload', () => saveRealLedger(true));

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const [key, { newValue }] of Object.entries(changes)) {
        currentSettings[key] = newValue;
      }
      currentSettings.alertThresholdsUsd = MCM.settings.alertThresholds(
        currentSettings.alertThresholdsUsd,
      );
      if ('overlayEnabled' in changes) {
        overlay.setVisible(currentSettings.overlayEnabled !== false);
      }
      if ('customSelector' in changes) {
        MCM.scrape.setCustomSelector(currentSettings.customSelector);
      }
      if ('mockMode' in changes && changes.mockMode.newValue) {
        mockWallStart = Date.now();
        mockLedger = MCM.cost.createLedger();
      }
      if ('calendarEnabled' in changes) {
        calendarWarned = false;
        if (changes.calendarEnabled.newValue) refreshCalendar();
        else calendarAttendees = null;
      }
      tick();
    });
  }

  main();
})();
