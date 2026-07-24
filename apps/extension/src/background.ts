// CallCost — background service worker
//
// Handles Google OAuth (via chrome.identity) and calls the Calendar API.
// Content scripts can't do either directly, so they message us with an event
// ID and we return the attendee list.

import { API_ROUTES, type EventCostResponse } from "@workation/shared";
import { SERVER_URL } from "./config";
import type {
  Attendee,
  AttendeeListStatus,
  AttendeesResponse,
  CostResult,
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
  event: {
    summary?: string;
    attendees?: Attendee[];
    start?: EventDateTime;
    end?: EventDateTime;
    guestsCanSeeOtherGuests?: boolean;
  };
  // The token that ended up working — reused to authenticate the cost
  // request so we don't need a second chrome.identity round trip.
  token: string;
}> {
  let token = await getToken(true);
  const url = `${API_BASE}/calendars/${encodeURIComponent(
    calendarId
  )}/events/${encodeURIComponent(eventId)}`;

  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 401) {
    // Token expired/revoked — drop it and retry once with a fresh one.
    await removeCachedToken(token);
    token = await getToken(true);
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return { event: await res.json(), token };
}

/**
 * Ask the CallCost backend to price the event from its attendees and duration.
 * Resources (meeting rooms) are excluded — they aren't people with a salary.
 *
 * The access token is forwarded as a Bearer credential so the backend can
 * verify (via Google) that the caller is a real @callstack.com account
 * before it does any pricing work.
 */
async function fetchCost(
  attendees: Attendee[],
  durationSeconds: number,
  token: string
): Promise<EventCostResponse> {
  const emails = attendees.filter((a) => !a.resource).map((a) => a.email);
  const res = await fetch(`${SERVER_URL}${API_ROUTES.eventCost}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ emails, durationSeconds }),
  });
  if (!res.ok) {
    throw new Error(`Cost API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<EventCostResponse>;
}

async function priceEvent(
  attendees: Attendee[],
  timing: EventTiming,
  token: string
): Promise<CostResult | undefined> {
  if (timing.durationSeconds == null) return undefined; // all-day / no duration
  try {
    const data = await fetchCost(attendees, timing.durationSeconds, token);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

chrome.runtime.onMessage.addListener((msg: GetAttendeesRequest, _sender, sendResponse) => {
  if (msg?.type !== "getAttendees") return;

  fetchEvent(msg.eventId)
    .then(async ({ event, token }) => {
      // `guestsCanSeeOtherGuests` is present (false) only when the organizer
      // hid the guest list; otherwise it's omitted and defaults to visible.
      const status: AttendeeListStatus =
        event.guestsCanSeeOtherGuests === false
          ? "guest_list_hidden"
          : "complete";

      // When the guest list is hidden the API returns only the requesting
      // user, which isn't the real list — empty it so nothing downstream
      // counts a bogus attendee, and skip pricing (there's nothing to price).
      const attendees: Attendee[] =
        status === "guest_list_hidden"
          ? []
          : (event.attendees ?? []).map((a) => ({
              email: a.email,
              responseStatus: a.responseStatus,
              organizer: !!a.organizer,
              resource: !!a.resource,
            }));
      const timing = computeTiming(event.start, event.end);
      const response: AttendeesResponse = {
        ok: true,
        status,
        attendees,
        summary: event.summary,
        timing,
        cost:
          status === "complete" ? await priceEvent(attendees, timing, token) : undefined,
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
