import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventCostResponse } from "@workation/shared";
import {
  computeEventCost,
  type EventCostDeps,
  type EventCostResult,
  resolveMonthlySalary,
  type SalaryRanges,
} from "./eventCost.js";

// Synthetic salary table mirroring the real mixed shape:
// nested (role -> seniority -> salary) and flat (business role -> salary).
const RANGES: SalaryRanges = {
  "RN Dev": { Expert: 38500, "Senior 1": 26000, "Mid 1": 16500 },
  "Account Manager": 19900,
  "Office Coordinator": 8000,
};

// Deterministic attendee data, independent of the real 226-row db snapshot.
function deps(): EventCostDeps {
  return {
    salaryRanges: RANGES,
    employeesByEmail: new Map([
      ["expert@x.com", { name: "Ada Expert", role: ["RN Dev", "Expert"] }],
      // seniority listed before the role, to prove order independence:
      ["senior@x.com", { name: "Sam Senior", role: ["Senior 1", "RN Dev"] }],
      ["am@x.com", { name: "Bob Manager", role: ["Account Manager"] }],
      ["ceo@x.com", { name: "Carol Chief", role: ["CEO"] }], // role has no salary
      ["norole@x.com", { name: "Dan NoRole", role: null }], // null role
    ]),
  };
}

/** Assert a 200 result and return the typed response body. */
function ok(result: EventCostResult): EventCostResponse {
  assert.equal(result.status, 200);
  return result.body as EventCostResponse;
}

describe("resolveMonthlySalary", () => {
  it("returns null for a null or empty role", () => {
    assert.equal(resolveMonthlySalary(null, RANGES), null);
    assert.equal(resolveMonthlySalary([], RANGES), null);
  });

  it("resolves a flat single-token business role", () => {
    assert.equal(resolveMonthlySalary(["Account Manager"], RANGES), 19900);
    assert.equal(resolveMonthlySalary(["Office Coordinator"], RANGES), 8000);
  });

  it("returns null for an unknown single role", () => {
    assert.equal(resolveMonthlySalary(["CEO"], RANGES), null);
  });

  it("returns null when a single token is a role group that still needs a seniority", () => {
    assert.equal(resolveMonthlySalary(["RN Dev"], RANGES), null);
  });

  it("resolves nested role + seniority regardless of token order", () => {
    assert.equal(resolveMonthlySalary(["RN Dev", "Expert"], RANGES), 38500);
    assert.equal(resolveMonthlySalary(["Expert", "RN Dev"], RANGES), 38500);
    assert.equal(resolveMonthlySalary(["Senior 1", "RN Dev"], RANGES), 26000);
  });

  it("returns null when the seniority token is missing from the group", () => {
    assert.equal(resolveMonthlySalary(["RN Dev", "Principal"], RANGES), null);
  });

  it("uses a flat role when one appears inside a multi-token array", () => {
    assert.equal(resolveMonthlySalary(["Account Manager", "RN Dev"], RANGES), 19900);
  });
});

describe("computeEventCost — validation", () => {
  it("rejects a missing emails field", () => {
    const r = computeEventCost({ durationSeconds: 3600 }, deps());
    assert.equal(r.status, 400);
    assert.match((r.body as { error: string }).error, /emails/);
  });

  it("rejects emails that is not an array", () => {
    const r = computeEventCost({ emails: "a@x.com", durationSeconds: 3600 }, deps());
    assert.equal(r.status, 400);
  });

  it("rejects a missing / non-numeric / negative durationSeconds", () => {
    assert.equal(computeEventCost({ emails: [] }, deps()).status, 400);
    assert.equal(
      computeEventCost({ emails: [], durationSeconds: "x" }, deps()).status,
      400,
    );
    assert.equal(
      computeEventCost({ emails: [], durationSeconds: -1 }, deps()).status,
      400,
    );
    assert.equal(
      computeEventCost({ emails: [], durationSeconds: Number.NaN }, deps()).status,
      400,
    );
  });

  it("rejects a completely empty body", () => {
    assert.equal(computeEventCost({}, deps()).status, 400);
    assert.equal(computeEventCost(null, deps()).status, 400);
  });
});

describe("computeEventCost — costing", () => {
  it("prices one attendee for one hour (38500 / 160 = 240.63)", () => {
    const body = ok(
      computeEventCost({ emails: ["expert@x.com"], durationSeconds: 3600 }, deps()),
    );
    assert.equal(body.totalCost, 240.63);
    assert.equal(body.currency, "PLN");
    assert.equal(body.attendeeCount, 1);
    assert.equal(body.matched.length, 1);
    assert.deepEqual(body.matched[0], {
      email: "expert@x.com",
      name: "Ada Expert",
      role: ["RN Dev", "Expert"],
      monthlySalary: 38500,
      cost: 240.63,
    });
  });

  it("matches the prompt's worked example (30000 / 160 * 1h = 187.5)", () => {
    const local: EventCostDeps = {
      salaryRanges: { "Some Role": 30000 },
      employeesByEmail: new Map([
        ["p@x.com", { name: "P", role: ["Some Role"] }],
      ]),
    };
    const body = ok(
      computeEventCost({ emails: ["p@x.com"], durationSeconds: 3600 }, local),
    );
    assert.equal(body.totalCost, 187.5);
  });

  it("scales with duration and returns 0 cost for a 0-second event", () => {
    const half = ok(
      computeEventCost({ emails: ["expert@x.com"], durationSeconds: 1800 }, deps()),
    );
    assert.equal(half.totalCost, 120.31); // 240.625 * 0.5 = 120.3125 -> 120.31

    const zero = ok(
      computeEventCost({ emails: ["expert@x.com"], durationSeconds: 0 }, deps()),
    );
    assert.equal(zero.totalCost, 0);
    assert.equal(zero.matched[0]?.cost, 0);
  });

  it("sums multiple matched attendees", () => {
    const body = ok(
      computeEventCost(
        { emails: ["expert@x.com", "am@x.com"], durationSeconds: 3600 },
        deps(),
      ),
    );
    // 240.63 + (19900/160=124.375 -> 124.38) = 365.01
    assert.equal(body.matched.length, 2);
    assert.equal(body.totalCost, 365.01);
  });

  it("resolves reversed-order roles (seniority before role)", () => {
    const body = ok(
      computeEventCost({ emails: ["senior@x.com"], durationSeconds: 3600 }, deps()),
    );
    assert.equal(body.matched[0]?.monthlySalary, 26000);
    assert.equal(body.totalCost, 162.5); // 26000 / 160
  });
});

describe("computeEventCost — edge cases", () => {
  it("normalizes case and whitespace before matching", () => {
    const body = ok(
      computeEventCost(
        { emails: ["  EXPERT@X.com "], durationSeconds: 3600 },
        deps(),
      ),
    );
    assert.equal(body.matched.length, 1);
    assert.equal(body.matched[0]?.email, "expert@x.com");
  });

  it("dedupes repeated emails (counts each person once)", () => {
    const body = ok(
      computeEventCost(
        { emails: ["expert@x.com", "EXPERT@x.com", " expert@x.com "], durationSeconds: 3600 },
        deps(),
      ),
    );
    assert.equal(body.attendeeCount, 1);
    assert.equal(body.matched.length, 1);
    assert.equal(body.totalCost, 240.63);
    assert.equal(body.duplicatesIgnored.length, 2);
  });

  it("reports emails not found in the employee list", () => {
    const body = ok(
      computeEventCost({ emails: ["ghost@x.com"], durationSeconds: 3600 }, deps()),
    );
    assert.equal(body.matched.length, 0);
    assert.equal(body.totalCost, 0);
    assert.deepEqual(body.unmatchedEmails, ["ghost@x.com"]);
  });

  it("reports employees whose role has no salary (and null roles)", () => {
    const body = ok(
      computeEventCost(
        { emails: ["ceo@x.com", "norole@x.com"], durationSeconds: 3600 },
        deps(),
      ),
    );
    assert.equal(body.matched.length, 0);
    assert.equal(body.totalCost, 0);
    assert.equal(body.unresolvedSalary.length, 2);
    const ceo = body.unresolvedSalary.find((u) => u.email === "ceo@x.com");
    assert.deepEqual(ceo?.role, ["CEO"]);
    const noRole = body.unresolvedSalary.find((u) => u.email === "norole@x.com");
    assert.equal(noRole?.role, null);
  });

  it("collects invalid (empty / non-string) email entries", () => {
    const body = ok(
      computeEventCost(
        // non-string entries are intentional; the endpoint receives untrusted JSON.
        { emails: ["", "   ", 123, null] as unknown as string[], durationSeconds: 3600 },
        deps(),
      ),
    );
    assert.equal(body.attendeeCount, 0);
    assert.equal(body.totalCost, 0);
    assert.equal(body.invalidEmails.length, 4);
  });

  it("handles a mixed request so the total counts only matched attendees", () => {
    const body = ok(
      computeEventCost(
        {
          emails: [
            "expert@x.com", // matched 240.63
            "am@x.com", // matched 124.38
            "ceo@x.com", // unresolved salary
            "norole@x.com", // unresolved salary (null role)
            "ghost@x.com", // unmatched
            "expert@x.com", // duplicate
            "", // invalid
          ],
          durationSeconds: 3600,
        },
        deps(),
      ),
    );
    assert.equal(body.matched.length, 2);
    assert.equal(body.totalCost, 365.01);
    assert.equal(body.unresolvedSalary.length, 2);
    assert.deepEqual(body.unmatchedEmails, ["ghost@x.com"]);
    assert.equal(body.duplicatesIgnored.length, 1);
    assert.equal(body.invalidEmails.length, 1);
    assert.equal(body.attendeeCount, 5); // expert, am, ceo, norole, ghost
  });
});

describe("computeEventCost — real db wiring", () => {
  it("prices a known employee using the bundled data (no injected deps)", () => {
    // adam.trzcinski is RN Dev / Expert (38500) in current-employees.json.
    const body = ok(
      computeEventCost({
        emails: ["adam.trzcinski@callstack.com"],
        durationSeconds: 3600,
      }),
    );
    assert.equal(body.matched.length, 1);
    assert.equal(body.matched[0]?.monthlySalary, 38500);
    assert.equal(body.totalCost, 240.63);
  });
});
