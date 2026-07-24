# CallCost — Workshop Handoff (Group 11)

## 1. Problem and intended outcome

**What problem did you work on, and who experiences it?**

Meetings are expensive, but their cost is invisible. Nobody in a calendar invite sees
what an hour with eight people actually costs the company, so long/oversized meetings get
booked without a second thought. Everyone at Callstack experiences it — the person
organizing the meeting, and every attendee whose time is spent in it.

**Why is it worth solving?**

A recurring 10-person hour-long meeting quietly burns real money every week in salary
time. Making that number visible *at the moment the meeting is booked or opened* creates a
small, well-timed nudge to shrink the guest list, shorten the slot, or drop the meeting
entirely. The cost is low-effort to surface but the behavioral impact (fewer/shorter
meetings) compounds across the whole org.

**What outcome did you aim for during the workshop?**

The smallest useful result: open a real Google Calendar event and see an estimated PLN
cost — derived from the actual attendees' salaries and the scheduled duration — rendered
inline in the event dialog. Reached: the injected "… to be burned" cost row shows a real
number end-to-end.

## 2. What we tried

**How did you approach the problem?**

We built **CallCost**, a Chrome Manifest V3 extension plus a small Express/TypeScript
backend, in a pnpm monorepo (`apps/extension`, `apps/server`, shared types in
`packages/shared`). The whole thing was built with heavy AI assistance (Claude Code) —
scaffolding the monorepo, writing the content scripts, the cost engine, unit tests, and
the docs.

The working design:
- A content script on `calendar.google.com` detects when an event dialog opens and pulls
  the event ID out of the DOM (`jslog` attribute).
- The background service worker authenticates with **Google OAuth via
  `chrome.identity`** and calls the **Google Calendar API** (`events.get`) to get the
  real attendee **emails** and the scheduled start/end.
- It POSTs the emails + duration to the backend, which matches each email against a
  226-row employee export, looks up a monthly salary by role/seniority, and returns an
  aggregate cost: `(monthlySalary / 160h) × durationHours`, summed across matched
  attendees.
- A second content script injects a native-looking "Estimated cost" row into the event
  dialog and renders the total, with an eye-toggle in the popup to show/hide it.

**Did your approach change during the workshop?**

Yes — significantly. The original PRD (and the parallel `meeting-cost-meter/` prototype)
planned to **scrape the Google Meet DOM for participant display names** and fuzzy-match
them against baked salary data, shipping **no network permissions** for privacy. We
pivoted to the **Calendar API + OAuth + exact email matching** instead, because emails are
a clean, reliable join key to the employee database and the API returns the full guest
list and scheduled duration regardless of what the DOM renders. This deliberately
reintroduced an OAuth token and a network permission in exchange for far better matching.
(`meeting-cost-meter/` remains in the repo as the earlier name-based approach we moved
away from.)

## 3. What worked

**What produced a useful result?**

- **Calendar API + email matching.** Exact email keys eliminated the whole class of
  fuzzy-name problems (nicknames, diacritics, name order). Matching against the 226-row
  export is O(1) and case-insensitive.
- **Splitting the extension into two content scripts** bridged by a `CustomEvent`
  ("data" script fetches; "UI" script renders) kept the DOM injection cleanly separated
  from the API/OAuth logic.
- **Styling the cost row to mirror Google's own metadata rows** (reusing Calendar's CSS
  classes + a `payments` material icon) made it look native, with an anchor-fallback
  chain (Notifications → organizer → date/time row) so it appears even on events without
  reminders. The badge is **tiered by cost** — green (< 500 PLN), yellow (< 1500), red
  (≥ 1500, with a pulsing "on fire" animation) — so the visual alarm scales with the spend.
- **Server-side auth that needs no Workspace admin.** `/api/event-cost` is gated by a
  middleware that verifies the extension's OAuth token against Google's public `tokeninfo`
  endpoint and only serves **verified `@callstack.com`** accounts (checking the token's
  `aud` matches our client ID, and failing closed if Google is unreachable).
- **A pure, injectable cost engine** (`eventCost.ts`) with unit tests — salary resolution
  handles role/seniority tokens in either order, and the response explicitly reports
  unmatched emails, unresolved salaries, duplicates, and invalid entries instead of
  throwing.
- **AI (Claude Code) did the bulk of the mechanical build** — monorepo scaffolding,
  shared TS contract, content scripts, cost math, tests, and docs — fast enough to fit a
  workshop.

**Why do you think it worked?**

A team that wants to reproduce it needs: a clean unique identity key (email, from the
Calendar API — not scraped names), a **pinned extension ID** (via a `key` in the manifest)
so a **single team-wide Google OAuth client** works for everyone, a small typed API
contract shared between client and server so the two never drift, and a cost engine kept
pure and separately testable from all the DOM/OAuth glue.

## 4. What did not work

**What failed, produced a weak result, or took more effort than expected?**

- **Meet DOM scraping / name matching (the original plan).** Fragile selectors and
  names-only matching with an average-rate fallback — abandoned in favor of Calendar +
  emails.
- **Hidden guest lists.** When an organizer hides the guest list, the Calendar API returns
  only the requesting user, so there's no real attendee list and nothing to price. We
  detect this (`guestsCanSeeOtherGuests === false`) and show a meme instead of a bogus
  number.
- **`events.get` queries the `primary` calendar only** — events living on another calendar
  can 404. Not yet handled.
- **Salary coverage gaps.** Some roles (execs, some managers) have no salary band, so those
  attendees are reported as "unresolved" and excluded from the total — the number is a
  lower bound, not a full cost.
- **OAuth setup friction.** The Google Cloud OAuth client must register the exact pinned
  extension ID, consent must be Internal (or teammates added as test users), and the
  Calendar API must be enabled — easy to get wrong.
- **Duration is the *scheduled* length, not live elapsed time** — fine for a
  calendar-booking nudge, but not a live in-call meter.

**What did you learn or change because of it?**

The biggest lesson: **pick your identity key first.** Moving from scraped names to
Calendar emails removed most of the accidental complexity (fuzzy matching, fallbacks,
DOM fragility) in one decision. We also learned the privacy posture is a real trade-off,
not a given — we consciously traded "no network/no token" for accuracy, and kept the
privacy guarantee where it matters most: the browser only ever receives an **aggregate**
cost, never per-person salaries.

## 5. AI contribution and human judgment

**What did AI help with?**

Scaffolding the monorepo and build tooling (Vite + @crxjs, tsup, pnpm workspaces); writing
the content scripts, background OAuth/Calendar logic, and the DOM-injection UI; the
backend cost engine and its unit tests; debugging Calendar's DOM (finding the event ID in
the `jslog` attribute, choosing anchor rows); and drafting/maintaining the README and PRD
amendment.

**What still needed human judgment or manual work?**

- **Defining the problem** and the framing (a cost *nudge*, aggregate-only).
- **The pivot decision** — choosing Calendar+email over Meet+names, and accepting the
  OAuth/network trade-off.
- **The privacy design** — aggregate-only responses, rounding, keeping salaries server-side.
- **All the Google Cloud / OAuth setup** — creating the OAuth client, pinning the extension
  ID, consent screen, enabling the API. AI can't click through the console.
- **Validating correctness** against real people and real salary data — spot-checking that
  matched costs are plausible.
- **Handling the sensitive salary data** — deciding what's committed vs. kept out.

**What should never run without human review or approval?**

- Anything touching **salary / compensation data** — schema changes, what's exposed in a
  response, what's committed to the repo.
- Changes to the **auth gate** — the allowed email domain, the token-verification logic, or
  the fail-closed behavior on `/api/event-cost`.
- **OAuth scope and consent** changes (widening beyond `calendar.events.readonly`).
- **Publishing/distributing** the extension or pointing it at a non-local backend.
- Removing the **aggregate-only** guarantee (i.e. ever sending per-person figures to the
  browser).

## 6. Result and evidence

**What exists now?**

A working prototype: the **CallCost** MV3 extension + Express backend in this monorepo.
Loaded unpacked in Chrome, it injects a live "Estimated cost" row into the Google Calendar
event dialog, computed from real attendees (via the Calendar API) and the event's
scheduled duration. Demoed end-to-end against a real event showing a real PLN total.
Includes an eye-toggle to show/hide, cost-tiered badges (green/yellow/red), a
hidden-guest-list fallback, a backend auth gate restricting `/api/event-cost` to verified
`@callstack.com` accounts, and server-side unit tests for the cost engine.

**Evidence / links:**

- Repository: `callstack-internal/workation-2026-group-11` (this repo).
- Key code: [manifest.config.ts](../apps/extension/manifest.config.ts),
  [background.ts](../apps/extension/src/background.ts) (OAuth + Calendar API),
  [calendar.ts](../apps/extension/src/content/calendar.ts) (event detection),
  [content.ts](../apps/extension/src/content/content.ts) (cost-row UI),
  [eventCost.ts](../apps/server/src/eventCost.ts) (cost engine) +
  [eventCost.test.ts](../apps/server/src/eventCost.test.ts).
- Docs: [README.md](../README.md), [docs/PRD.md](PRD.md) (see the 2026-07-24 amendment).
- Earlier alternative approach kept for reference: [meeting-cost-meter/](../meeting-cost-meter/).
- Setup notes to run it:
  1. `pnpm install`, then `pnpm dev:server` (backend on `http://localhost:3000`).
  2. Set the **same** `GOOGLE_OAUTH_CLIENT_ID` in both `apps/extension/.env` and
     `apps/server/.env` (Google Cloud OAuth client of type *Chrome extension*, registered
     against extension ID `nblafpggejpkjeelebiigcdghkceknea`, Calendar API enabled, consent
     Internal / you as a test user). The server uses it to verify inbound tokens, so a
     mismatch means every request is rejected.
  3. `pnpm --filter extension build`, load `apps/extension/dist` unpacked at
     `chrome://extensions`.
  4. Open a Google Calendar event → the cost row appears.
- Suggested attachment for the final handoff: a screenshot of the injected cost row on a
  real event (and the hidden-guest-list meme state).

**Current status:**

- [ ]  Useful insight or validated learning
- [ ]  Early prototype
- [ ]  Works with manual support
- [x]  Ready for another group or owner to test
- [ ]  Ready to adopt in day-to-day work

## 7. Recommended next steps

| Next step | Owner | When / priority | Done when |
| --- | --- | --- | --- |
| Handle events on non-primary calendars (avoid `events.get` 404s) | Group 11 (TBD) | Now | Opening an event owned by another calendar prices correctly instead of erroring |
| Fill salary-band gaps (execs/managers) or define an explicit "unpriced" policy | Group 11 (TBD) | Now | No silently-dropped attendees; totals are complete or clearly labeled as partial |
| Deploy the backend off localhost and point the extension at it | Group 11 (TBD) | Next | Extension works without each user running the server locally |
| Streamline OAuth onboarding (docs or Internal consent for the whole org) | Group 11 (TBD) | Next | A new teammate can authorize without manual Cloud Console steps |
| Optional: live in-call elapsed cost (Meet side) instead of scheduled duration | Group 11 (TBD) | Later | A running meter reflects actual elapsed time, not the booked slot |
