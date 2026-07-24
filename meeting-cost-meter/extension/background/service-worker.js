// Service worker: shared settings, toolbar state, NBP exchange-rate caching,
// and optional Google Calendar identity lookup.

importScripts('../shared/settings.js');

const MCM = self.__MCM;
const DEFAULTS = MCM.settings.DEFAULTS;
const FX_CACHE_KEY = 'mcm_fx_usd_pln';
const FX_FRESH_MS = 12 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set({
    ...DEFAULTS,
    ...existing,
    alertThresholdsUsd: MCM.settings.alertThresholds(existing.alertThresholdsUsd),
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab?.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'toggle-overlay' }).catch(() => {
      /* content script not present on this tab */
    });
  }
});

// --- Toolbar alert state --------------------------------------------------

function toolbarIcon(color, darkText = false) {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const images = {};
  for (const size of [16, 32]) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = darkText ? '#202124' : '#ffffff';
    ctx.font = `700 ${Math.round(size * 0.68)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', size / 2, size / 2 + size * 0.03);
    images[size] = ctx.getImageData(0, 0, size, size);
  }
  return images;
}

async function setToolbarAlert(tabId, level, blinkOn) {
  if (tabId == null) return;
  const knownLevel = Object.hasOwn(MCM.settings.ALERT_COLORS, level)
    ? level
    : 'unavailable';
  const visible = knownLevel !== 'red' || blinkOn !== false;
  const color = visible
    ? MCM.settings.ALERT_COLORS[knownLevel]
    : MCM.settings.ALERT_COLORS.unavailable;
  const icon = toolbarIcon(color, knownLevel === 'yellow');
  const title =
    knownLevel === 'idle'
      ? 'Meeting Cost — no active meeting'
      : knownLevel === 'unavailable'
      ? 'Meeting Cost — rates or FX unavailable'
      : `Meeting Cost — ${knownLevel} alert`;
  const showBadge = visible && knownLevel !== 'idle' && knownLevel !== 'unavailable';

  const actions = [
    chrome.action.setBadgeBackgroundColor({ tabId, color }),
    chrome.action.setBadgeText({ tabId, text: showBadge ? '$' : '' }),
    chrome.action.setTitle({ tabId, title }),
  ];
  if (icon) actions.push(chrome.action.setIcon({ tabId, imageData: icon }));
  await Promise.all(actions).catch(() => {});
}

// --- NBP USD/PLN quote ----------------------------------------------------

async function getUsdPlnRate() {
  const { [FX_CACHE_KEY]: cached } = await chrome.storage.local.get(FX_CACHE_KEY);
  const age = Date.now() - Number(cached?.fetchedAt);
  if (Number(cached?.plnPerUsd) > 0 && age >= 0 && age < FX_FRESH_MS) {
    return { ...cached, cached: true };
  }

  try {
    const res = await fetch(
      'https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json',
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`NBP API ${res.status}`);
    const body = await res.json();
    const quote = body?.rates?.[body.rates.length - 1];
    const plnPerUsd = Number(quote?.mid);
    if (!(plnPerUsd > 0)) throw new Error('NBP API returned no USD midpoint');
    const fresh = {
      plnPerUsd,
      effectiveDate: quote.effectiveDate || '',
      fetchedAt: Date.now(),
    };
    await chrome.storage.local.set({ [FX_CACHE_KEY]: fresh });
    return { ...fresh, cached: false };
  } catch (error) {
    // A stale official quote is preferable to an invented hard-coded value.
    if (Number(cached?.plnPerUsd) > 0) return { ...cached, cached: true, stale: true };
    throw error;
  }
}

// --- Calendar lookup -------------------------------------------------------

function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(token);
    });
  });
}

// Meet codes look like "abc-defg-hjk"; conference URIs may or may not keep the
// dashes, so compare dash-free.
const stripCode = (s) => String(s || '').replace(/-/g, '').toLowerCase();

function eventMatchesCode(event, code) {
  if (stripCode(event.hangoutLink).includes(code)) return true;
  return (event.conferenceData?.entryPoints || []).some((p) => stripCode(p.uri).includes(code));
}

/**
 * Find the calendar event whose conference link contains this Meet code and
 * return its human attendees. Looks at a ±4h window on the primary calendar,
 * which covers "happening now" plus meetings that run long.
 */
async function getCalendarAttendees(meetCode) {
  const code = stripCode(meetCode);
  if (!code || code === 'unknown' || code.length < 6) return { attendees: [], eventFound: false };
  const clientId = chrome.runtime.getManifest().oauth2?.client_id || '';
  if (!clientId || clientId.startsWith('REPLACE_WITH_')) {
    throw new Error('Calendar OAuth client ID is not configured');
  }

  const token = await getAuthToken();
  const now = Date.now();
  const params = new URLSearchParams({
    timeMin: new Date(now - 4 * 3600e3).toISOString(),
    timeMax: new Date(now + 4 * 3600e3).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    // Token went stale — drop it from the cache; the next call re-auths.
    await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
    throw new Error('Calendar auth expired — try again');
  }
  if (!res.ok) throw new Error(`Calendar API ${res.status}`);
  const data = await res.json();

  const event = (data.items || []).find((ev) => eventMatchesCode(ev, code));
  if (!event) return { attendees: [], eventFound: false };

  const attendees = (event.attendees || [])
    .filter((a) => a.email && !a.resource) // drop meeting rooms
    .map((a) => ({
      email: a.email,
      displayName: a.displayName || '',
      responseStatus: a.responseStatus || '',
    }));
  return { attendees, eventFound: true, summary: event.summary || '' };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'mcm-alert-state') {
    setToolbarAlert(_sender.tab?.id, msg.level, msg.blinkOn);
    return;
  }
  if (msg?.type === 'mcm-fx-rate') {
    getUsdPlnRate()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === 'mcm-calendar-attendees') {
    getCalendarAttendees(msg.code)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err?.message || err) }));
    return true; // async response
  }
});
