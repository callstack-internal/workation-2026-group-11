/**
 * Shared API contract between the server and the Chrome extension.
 * Keeping request/response shapes here guarantees both apps stay in sync.
 */

export const API_ROUTES = {
  health: "/api/health",
  messages: "/api/messages",
  eventCost: "/api/event-cost",
} as const;

export interface HealthResponse {
  status: "ok";
  uptimeSeconds: number;
  timestamp: string;
}

export interface Message {
  id: string;
  text: string;
  createdAt: string;
}

export interface CreateMessageRequest {
  text: string;
}

export interface MessagesResponse {
  messages: Message[];
}

export interface ApiError {
  error: string;
}

/**
 * Event-cost estimation.
 *
 * Cost of an event = sum over matched attendees of
 *   (monthlySalary / MONTHLY_HOURS) * (durationSeconds / 3600)
 * where MONTHLY_HOURS is a fixed 160 working hours per month.
 */
export interface EventCostRequest {
  /** Attendee emails. Matched case-insensitively against the employee list. */
  emails: string[];
  /** Event duration in seconds. Must be a finite number >= 0. */
  durationSeconds: number;
}

/** An attendee we could match to an employee AND resolve a salary for. */
export interface MatchedAttendee {
  email: string;
  name: string;
  /** The employee's "Role / Seniority Level" tokens, e.g. ["RN Dev", "Expert"]. */
  role: string[];
  monthlySalary: number;
  /** This attendee's contribution to the total cost, in PLN, rounded to 2 dp. */
  cost: number;
}

/** An attendee we matched to an employee but could NOT price (no salary for their role). */
export interface UnresolvedAttendee {
  email: string;
  name: string;
  role: string[] | null;
}

export interface EventCostResponse {
  /** Total event cost in PLN, rounded to 2 dp. Sum of matched attendees only. */
  totalCost: number;
  currency: "PLN";
  durationSeconds: number;
  /** Number of unique, valid attendee emails considered. */
  attendeeCount: number;
  matched: MatchedAttendee[];
  /** Emails not found in the employee list. */
  unmatchedEmails: string[];
  /** Employees found but with no salary for their role (e.g. execs, some managers). */
  unresolvedSalary: UnresolvedAttendee[];
  /** Emails that appeared more than once and were counted only once. */
  duplicatesIgnored: string[];
  /** Entries that were not usable emails (non-string or empty after trimming). */
  invalidEmails: string[];
}
