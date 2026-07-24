// Service worker: seeds default settings, routes toolbar clicks to the content
// script, and resolves the current Meet's calendar event to invitee emails
// (the Calendar-API exact-match path — content scripts can't use
// chrome.identity, so the OAuth + fetch happen here).

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

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set({ ...DEFAULTS, ...existing });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab?.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'toggle-overlay' }).catch(() => {
      /* content script not present on this tab */
    });
  }
});

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
  if (msg?.type === 'mcm-calendar-attendees') {
    getCalendarAttendees(msg.code)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err?.message || err) }));
    return true; // async response
  }
});
