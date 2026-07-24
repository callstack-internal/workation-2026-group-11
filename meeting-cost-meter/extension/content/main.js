// Orchestrator content script. Loaded last, after scrape/match/cost/overlay have
// registered themselves on window.__MCM.
(function () {
  const MCM = window.__MCM;
  if (!MCM || !MCM.scrape || !MCM.match || !MCM.cost || !MCM.overlay) {
    console.error('[MCM] namespace incomplete — check content script order in manifest.json');
    return;
  }

  const TICK_MS = 1000;
  const MAX_MEETING_MS = 8 * 60 * 60 * 1000; // reset a stale stored start after 8h
  const CALENDAR_REFRESH_MS = 10 * 60 * 1000;
  const OVERRIDES_KEY = 'mcm_overrides';

  async function loadRatesFile(files) {
    for (const file of files) {
      try {
        const res = await fetch(chrome.runtime.getURL(file));
        if (res.ok) {
          const json = await res.json();
          if (json.people) return json;
        }
      } catch (_) {
        /* try next */
      }
    }
    return { currency: 'USD', defaultRatePerMinute: 1, people: [] };
  }

  async function loadSettings() {
    const defaults = {
      ...MCM.cost.DEFAULTS,
      overlayEnabled: true,
      mockMode: false,
      mockSpeedX: 60,
      calendarEnabled: false,
      customSelector: '',
    };
    try {
      const stored = await chrome.storage.sync.get(defaults);
      return { ...defaults, ...stored };
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
    return location.pathname.replace(/\//g, '') || 'unknown';
  }

  // Persist the start time so a page reload doesn't reset the meter.
  async function getMeetingStart() {
    const code = meetingCode();
    const key = 'mcm_start';
    try {
      const { [key]: saved } = await chrome.storage.local.get(key);
      const now = Date.now();
      if (saved && saved.code === code && now - saved.ts < MAX_MEETING_MS) return saved.ts;
      await chrome.storage.local.set({ [key]: { code, ts: now } });
      return now;
    } catch {
      return Date.now();
    }
  }

  async function main() {
    const [realRates, mockRates, settings, startTs, savedOverrides] = await Promise.all([
      loadRatesFile(['data/rates.json', 'data/rates.mock.json']),
      loadRatesFile(['data/rates.mock.json']),
      loadSettings(),
      getMeetingStart(),
      loadOverrides(),
    ]);
    const realIndex = MCM.match.buildIndex(realRates);
    const mockIndex = MCM.match.buildIndex(mockRates);
    let currentSettings = settings;
    let overrides = savedOverrides;
    let mockStart = Date.now(); // mock meetings always start "now"
    let calendarAttendees = null; // [{email, displayName, responseStatus}] | null
    let calendarWarned = false;
    const suggestionCache = new Map(); // normalized display name -> suggestions

    MCM.scrape.setCustomSelector(currentSettings.customSelector);

    const overlay = MCM.overlay.createOverlay({
      currency: realRates.currency,
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

    function suggestionsFor(detail, keys) {
      const norm = MCM.match.normalizeName(detail.name);
      if (!suggestionCache.has(norm)) {
        suggestionCache.set(norm, MCM.match.suggestFor(detail.name, keys, { floor: 0.5 }));
      }
      return suggestionCache.get(norm);
    }

    async function refreshCalendar() {
      if (!currentSettings.calendarEnabled || currentSettings.mockMode) return;
      try {
        const res = await chrome.runtime.sendMessage({ type: 'mcm-calendar-attendees', code: meetingCode() });
        if (res?.error) throw new Error(res.error);
        calendarAttendees = res?.eventFound ? res.attendees : null;
        if (res && !res.eventFound && !calendarWarned) {
          calendarWarned = true;
          console.info('[MCM] no calendar event found for this Meet — using name matching.');
        }
      } catch (err) {
        calendarAttendees = null;
        if (!calendarWarned) {
          calendarWarned = true;
          console.warn(`[MCM] Calendar lookup failed (${err.message}) — falling back to name matching. Check the OAuth client id in manifest.json.`);
        }
      }
    }

    function tick() {
      const mock = !!currentSettings.mockMode;
      const rates = mock ? mockRates : realRates;
      const index = mock ? mockIndex : realIndex;

      let elapsedMin;
      if (mock) {
        const speed = Number(currentSettings.mockSpeedX) > 0 ? Number(currentSettings.mockSpeedX) : 1;
        elapsedMin = ((Date.now() - mockStart) / 60000) * speed;
      } else {
        elapsedMin = (Date.now() - startTs) / 60000;
      }

      const names = mock ? MCM.mock.rosterAt(elapsedMin) : MCM.scrape.getParticipants();

      let m;
      if (!mock && calendarAttendees && calendarAttendees.length) {
        m = MCM.match.matchByCalendar(names, calendarAttendees, rates, index, { overrides });
      } else {
        m = MCM.match.matchParticipants(names, rates, index, { overrides });
      }

      const keys = [...index.keys()];
      const unmatched = m.details
        .filter((d) => !d.isMatch)
        .map((d) => ({ name: d.name, suggestions: suggestionsFor(d, keys) }))
        .filter((u) => u.suggestions.length);

      const c = MCM.cost.compute(m.ratePerMinuteTotal, elapsedMin, currentSettings);
      overlay.update({
        total: c.total,
        currentRatePerMin: c.currentRatePerMin,
        multiplier: c.multiplier,
        matched: m.matched,
        totalPeople: m.total,
        elapsedMin,
        currency: rates.currency,
        mock,
        unmatched,
      });
    }

    setInterval(tick, TICK_MS);
    MCM.scrape.onChange(tick);
    refreshCalendar();
    setInterval(refreshCalendar, CALENDAR_REFRESH_MS);
    tick();

    // Toolbar click (from background) and hotkey both toggle the overlay.
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'toggle-overlay') overlay.toggle();
    });
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) overlay.toggle();
    });

    // React to settings changes from the options page without a reload.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const [k, { newValue }] of Object.entries(changes)) currentSettings[k] = newValue;
      if ('overlayEnabled' in changes) overlay.setVisible(currentSettings.overlayEnabled !== false);
      if ('customSelector' in changes) MCM.scrape.setCustomSelector(currentSettings.customSelector);
      if ('mockMode' in changes && changes.mockMode.newValue) mockStart = Date.now(); // restart the demo
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
