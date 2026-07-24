// CallCost — Google Calendar content script
//
// When the Calendar event popup opens, pull the event ID out of the DOM and
// ask the background worker to fetch the event from the Calendar API. The API
// always returns the full attendee list, regardless of what's rendered on
// screen (long guest lists are collapsed and not fully in the DOM).

import type { AttendeesResponse, GetAttendeesRequest } from "../messaging";
import { emitCost } from "./costBridge";

// The popup's RSVP buttons/containers carry a `jslog` attribute whose `2:[...]`
// array starts with the event ID, e.g.:
//   35389; 2:["b8r1n4raufi02b04tljuiqt000_20260731T110000Z","me@x.com",...]
const EVENT_ID_RE = /2:\["([^"]+)"/;

function findEventDialog(): { dialog: HTMLElement; eventId: string } | null {
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
  for (const dialog of dialogs) {
    for (const el of dialog.querySelectorAll("[jslog]")) {
      const match = (el.getAttribute("jslog") ?? "").match(EVENT_ID_RE);
      if (match?.[1]) return { dialog, eventId: match[1] };
    }
  }
  return null;
}

let lastEventId = "";

function scan(): void {
  const found = findEventDialog();
  if (!found) {
    lastEventId = ""; // popup closed — allow the next open to log again
    return;
  }
  if (found.eventId === lastEventId) return;
  lastEventId = found.eventId;
  const eventId = found.eventId;

  emitCost({ status: "loading", eventId });

  const request: GetAttendeesRequest = {
    type: "getAttendees",
    eventId,
  };

  chrome.runtime.sendMessage(request, (resp: AttendeesResponse) => {
    if (chrome.runtime.lastError) {
      console.error("[CallCost]", chrome.runtime.lastError.message);
      emitCost({ status: "error", eventId, message: chrome.runtime.lastError.message ?? "Messaging error" });
      return;
    }
    if (!resp?.ok) {
      console.error("[CallCost] Failed:", resp?.error);
      emitCost({ status: "error", eventId, message: resp?.error ?? "Fetch failed" });
      return;
    }
    if (resp.cost?.ok) {
      emitCost({ status: "ok", eventId, result: resp.cost.data });
    } else {
      emitCost({ status: "error", eventId, message: resp.cost?.error ?? "No cost available" });
    }

    // Exclude anyone who declined; keep accepted, tentative, and
    // not-yet-responded (needsAction / unset).
    const emails = resp.attendees
      .filter((a) => a.responseStatus !== "declined")
      .map((a) => a.email);
    const { durationSeconds, allDay } = resp.timing;
    // Human-readable label for the log only; durationSeconds is the value
    // downstream logic should use.
    const label = allDay
      ? "all-day"
      : durationSeconds != null
        ? `${durationSeconds}s (${Math.round(durationSeconds / 60)} min)`
        : "unknown";
    console.log(
      `[CallCost] "${resp.summary}" — ${emails.length} attendee(s), ${label}:`,
      emails
    );
  });
}

let debounce: ReturnType<typeof setTimeout> | null = null;
const observer = new MutationObserver(() => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(scan, 150);
});
observer.observe(document.body, { childList: true, subtree: true });

console.log("[CallCost] Calendar content script loaded (v0.1.0).");
