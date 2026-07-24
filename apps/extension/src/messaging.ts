// Message contract between the Calendar content script and the background
// service worker.

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

export type AttendeesResponse =
  | {
      ok: true;
      attendees: Attendee[];
      summary?: string;
      timing: EventTiming;
    }
  | { ok: false; error: string };
