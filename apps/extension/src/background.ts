// CallCost — background service worker
//
// Handles Google OAuth (via chrome.identity) and calls the Calendar API.
// Content scripts can't do either directly, so they message us with an event
// ID and we return the attendee list.

import type {
  Attendee,
  AttendeesResponse,
  EventTiming,
  GetAttendeesRequest,
} from "./messaging";

const API_BASE = "https://www.googleapis.com/calendar/v3";

// Calendar returns start/end as { dateTime } for timed events or { date } for
// all-day events.
interface EventDateTime {
  dateTime?: string;
  date?: string;
}

function computeTiming(
  start?: EventDateTime,
  end?: EventDateTime
): EventTiming {
  const allDay = !start?.dateTime && !!start?.date;
  const startIso = start?.dateTime ?? start?.date;
  const endIso = end?.dateTime ?? end?.date;

  let durationSeconds: number | undefined;
  if (startIso && endIso) {
    const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
    if (Number.isFinite(ms) && ms >= 0) durationSeconds = Math.round(ms / 1000);
  }

  return { start: startIso, end: endIso, durationSeconds, allDay };
}

function getToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message ?? "No token"));
      } else {
        resolve(token);
      }
    });
  });
}

function removeCachedToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function fetchEvent(
  eventId: string,
  calendarId = "primary"
): Promise<{
  summary?: string;
  attendees?: Attendee[];
  start?: EventDateTime;
  end?: EventDateTime;
}> {
  const token = await getToken(true);
  const url = `${API_BASE}/calendars/${encodeURIComponent(
    calendarId
  )}/events/${encodeURIComponent(eventId)}`;

  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 401) {
    // Token expired/revoked — drop it and retry once with a fresh one.
    await removeCachedToken(token);
    const fresh = await getToken(true);
    res = await fetch(url, { headers: { Authorization: `Bearer ${fresh}` } });
  }

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

chrome.runtime.onMessage.addListener((msg: GetAttendeesRequest, _sender, sendResponse) => {
  if (msg?.type !== "getAttendees") return;

  fetchEvent(msg.eventId)
    .then((event) => {
      const attendees: Attendee[] = (event.attendees ?? []).map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus,
        organizer: !!a.organizer,
        resource: !!a.resource,
      }));
      const response: AttendeesResponse = {
        ok: true,
        attendees,
        summary: event.summary,
        timing: computeTiming(event.start, event.end),
      };
      sendResponse(response);
    })
    .catch((err: unknown) => {
      const response: AttendeesResponse = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      sendResponse(response);
    });

  return true; // keep the message channel open for the async response
});
