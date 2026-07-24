import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ApiError,
  EventCostRequest,
  EventCostResponse,
  MatchedAttendee,
  UnresolvedAttendee,
} from "@workation/shared";

/** Fixed average number of working hours in a month, per employee. */
const MONTHLY_HOURS = 160;

/**
 * Salary ranges are a mix: a top-level value is either a flat monthly salary
 * (business roles) or a nested map of seniority -> salary (e.g. RN Dev).
 */
export type SalaryRanges = Record<string, number | Record<string, number>>;

/** Minimal per-attendee record used for costing (name for display, role for pricing). */
export interface AttendeeRecord {
  name: string;
  role: string[] | null;
}

/** Data the cost calculation runs against. Injectable so it can be unit-tested. */
export interface EventCostDeps {
  employeesByEmail: Map<string, AttendeeRecord>;
  salaryRanges: SalaryRanges;
}

interface Employee {
  Email: string;
  Name: string | null;
  "Last name": string | null;
  "Surname / Name": string | null;
  "Role / Seniority Level": string[] | null;
  [key: string]: unknown;
}

function displayName(employee: Employee): string {
  const surnameName = employee["Surname / Name"];
  if (typeof surnameName === "string" && surnameName.trim() !== "") {
    return surnameName;
  }
  const parts = [employee.Name, employee["Last name"]].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  if (parts.length > 0) return parts.join(" ");
  return employee.Email;
}

// The db/ folder sits next to src/ and dist/, so "../db" resolves correctly
// both under tsx (src/) in dev and under the tsup build (dist/) in production.
const dbDir = join(dirname(fileURLToPath(import.meta.url)), "..", "db");

function loadDefaultDeps(): EventCostDeps {
  const { employees } = JSON.parse(
    readFileSync(join(dbDir, "current-employees.json"), "utf8"),
  ) as { employees: Employee[] };

  const salaryRanges = JSON.parse(
    readFileSync(join(dbDir, "salary-ranges.json"), "utf8"),
  ) as SalaryRanges;

  // Index employees by a normalized email for O(1), case-insensitive matching.
  const employeesByEmail = new Map<string, AttendeeRecord>();
  for (const employee of employees) {
    if (typeof employee.Email === "string") {
      employeesByEmail.set(employee.Email.trim().toLowerCase(), {
        name: displayName(employee),
        role: employee["Role / Seniority Level"] ?? null,
      });
    }
  }

  return { employeesByEmail, salaryRanges };
}

/** Real data loaded once from db/*.json; used when no deps are injected. */
const defaultDeps: EventCostDeps = loadDefaultDeps();

/**
 * Resolve an employee's monthly salary from their "Role / Seniority Level".
 *
 * The tokens can be a single flat business role (["Account Manager"]), or a
 * role plus a seniority in EITHER order (["RN Dev","Expert"] or
 * ["Senior 2","RN Dev"]). Returns null when no salary is known for the role
 * (e.g. execs, some managers, or a null/empty role).
 */
export function resolveMonthlySalary(
  role: string[] | null,
  ranges: SalaryRanges,
): number | null {
  if (!role || role.length === 0) return null;

  if (role.length === 1) {
    const only = role[0];
    if (only === undefined) return null;
    const value = ranges[only];
    return typeof value === "number" ? value : null;
  }

  // Two+ tokens, order not guaranteed. A token is either a flat role, or a
  // role group whose seniority is another token in the same array.
  for (const token of role) {
    const value = ranges[token];
    if (typeof value === "number") return value; // flat role inside a multi-token array
    if (value && typeof value === "object") {
      for (const other of role) {
        if (other === token) continue;
        const salary = value[other];
        if (typeof salary === "number") return salary;
      }
    }
  }
  return null;
}

/** Round to 2 decimal places (PLN grosze), tolerating float artifacts. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface EventCostResult {
  status: number;
  body: EventCostResponse | ApiError;
}

/**
 * Compute the total cost of an event from an attendee email list and a
 * duration. Never throws on data problems: unmatched emails, un-priceable
 * roles, duplicates, and invalid entries are all reported in the response.
 *
 * `deps` defaults to the real employee/salary data; tests inject their own.
 */
export function computeEventCost(
  rawBody: unknown,
  deps: EventCostDeps = defaultDeps,
): EventCostResult {
  const body = (rawBody ?? {}) as Partial<EventCostRequest>;
  const { emails, durationSeconds } = body;

  if (!Array.isArray(emails)) {
    return {
      status: 400,
      body: { error: "`emails` must be an array of strings" },
    };
  }
  if (
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0
  ) {
    return {
      status: 400,
      body: { error: "`durationSeconds` must be a finite number >= 0" },
    };
  }

  const invalidEmails: string[] = [];
  const duplicatesIgnored: string[] = [];
  const seen = new Set<string>();
  const uniqueEmails: string[] = [];

  for (const raw of emails) {
    if (typeof raw !== "string" || raw.trim() === "") {
      invalidEmails.push(String(raw));
      continue;
    }
    const normalized = raw.trim().toLowerCase();
    if (seen.has(normalized)) {
      duplicatesIgnored.push(normalized);
      continue;
    }
    seen.add(normalized);
    uniqueEmails.push(normalized);
  }

  const matched: MatchedAttendee[] = [];
  const unmatchedEmails: string[] = [];
  const unresolvedSalary: UnresolvedAttendee[] = [];
  const hours = durationSeconds / 3600;
  let totalCost = 0;

  for (const email of uniqueEmails) {
    const employee = deps.employeesByEmail.get(email);
    if (!employee) {
      unmatchedEmails.push(email);
      continue;
    }

    const monthlySalary = resolveMonthlySalary(employee.role, deps.salaryRanges);
    if (monthlySalary === null) {
      unresolvedSalary.push({ email, name: employee.name, role: employee.role });
      continue;
    }

    const cost = round2((monthlySalary / MONTHLY_HOURS) * hours);
    totalCost += cost;
    matched.push({
      email,
      name: employee.name,
      role: employee.role ?? [],
      monthlySalary,
      cost,
    });
  }

  return {
    status: 200,
    body: {
      totalCost: round2(totalCost),
      currency: "PLN",
      durationSeconds,
      attendeeCount: uniqueEmails.length,
      matched,
      unmatchedEmails,
      unresolvedSalary,
      duplicatesIgnored,
      invalidEmails,
    },
  };
}
