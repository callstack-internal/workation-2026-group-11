// Message contract between the Calendar content script and the background
// service worker.

import type { EventCostResponse } from "@workation/shared";

export interface Attendee {
  email: string;
  responseStatus?: string;
  organizer: boolean;
  resource: boolean;
}

export interface GetAttendeesRequest {
  type: "getAttendees";
  eventId: string;
}

export interface EventTiming {
  /** ISO start (dateTime for timed events, date for all-day). */
  start?: string;
  /** ISO end. */
  end?: string;
  /** Scheduled length in seconds (end - start). Undefined if not derivable. */
  durationSeconds?: number;
  /** True for all-day events (no specific time). */
  allDay: boolean;
}

/**
 * Result of asking the backend to price the event. Kept separate from the
 * attendees fetch so a costing failure never hides the attendee data.
 */
export type CostResult =
  | { ok: true; data: EventCostResponse }
  | { ok: false; error: string };

export type AttendeesResponse =
  | {
      ok: true;
      attendees: Attendee[];
      summary?: string;
      timing: EventTiming;
      /** Absent when the event has no usable duration (e.g. all-day). */
      cost?: CostResult;
    }
  | { ok: false; error: string };
