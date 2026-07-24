# CallCost — Chrome extension + backend for Google Meet cost tracking

> ## ⚠️ Amendment — 2026-07-24: request auth added (`@callstack.com`-only)
>
> The "Future work" item below — Google Sign-In + org restriction — is now implemented,
> earlier than originally planned, because the backend was reachable by anyone who could
> hit its port. **`POST /api/event-cost` now requires a valid Google OAuth access token for
> a verified `@callstack.com` account; unauthenticated or non-Callstack requests get
> `401`/`403` with no cost data.**
>
> **How, without Google Workspace admin access:** the extension already obtains an OAuth
> access token via `chrome.identity` (for the Calendar API). It now also requests the
> `userinfo.email` scope and forwards that same token as `Authorization: Bearer <token>` on
> every `/api/event-cost` call. The backend (`apps/server/src/auth.ts`) validates the token
> against Google's public `https://oauth2.googleapis.com/tokeninfo` endpoint — checking the
> `aud` claim matches CallCost's own OAuth client ID (so a token minted for a *different*
> app can't be replayed here), `email_verified === true`, and the email's domain is exactly
> `callstack.com`. This is pure server-side verification against Google's identity data; it
> needs no `admin.google.com` access, domain-wide delegation, or Workspace API. A successful
> verification is cached in memory for 60s per token to avoid hammering Google's endpoint
> given the extension polls every few seconds.
>
> **Also added:** CORS on the server is now locked to the extension's fixed origin
> (`chrome-extension://nblafpggejpkjeelebiigcdghkceknea`, stable because the manifest pins a
> `key`) instead of the previous open `cors()`. `GET /api/health` remains public (standard
> for a liveness check).
>
> **Setup:** `apps/server/.env` needs `GOOGLE_OAUTH_CLIENT_ID` set to the **same** value as
> `apps/extension/.env`'s — see `apps/server/.env.example`.

> ## ⚠️ Amendment — 2026-07-24: attendee source changed to the Google Calendar API
>
> The sections below describe getting attendees by scraping the **Google Meet** DOM
> (display **names**, fuzzy-matched) with the extension shipping **no network/host
> permissions**. We have since changed that part of the design. **The rest of the PRD
> — the Notion salary ingest, the cost model, escalation, and the aggregate-only
> overlay — is unchanged and still valid.**
>
> **What changed:** attendees (and the scheduled meeting length) are now read from the
> **Google Calendar API** via `events.get`, using OAuth (`chrome.identity`).
>
> **Why:** the Calendar API returns exact attendee **emails** — a clean, reliable join
> key to the employee DB's `Email` field — plus the full guest list regardless of what's
> rendered, and the event's scheduled `start`/`end`. This removes the PRD's biggest
> weakness (names-only fuzzy matching + a company-average fallback for unmatched people).
>
> **Trade-off / what this overrides:**
> - Overrides *"Decisions made with the user #1"* (build-time bake, no token/network in
>   the browser) and the *"Key constraint"* (names-only). The extension now has
>   `identity` permission, a `https://www.googleapis.com/*` host permission, and an
>   `oauth2` block — see [apps/extension/manifest.config.ts](../apps/extension/manifest.config.ts).
> - `content/scrape.js` + `content/match.js` (Meet DOM scraping + name matching) are
>   **not** the current approach. Implemented instead:
>   [src/content/calendar.ts](../apps/extension/src/content/calendar.ts) (reads the event
>   ID from the Calendar popup) and [src/background.ts](../apps/extension/src/background.ts)
>   (OAuth + `events.get`).
> - Salary data (`rates.json` from Notion) is still baked at build time and still the
>   privacy-sensitive artifact — only the *attendee/timing* source moved to the network.
>
> **Setup notes:** the extension ID is pinned via a `key` in the manifest
> (`nblafpggejpkjeelebiigcdghkceknea`) so OAuth works for the whole team; the matching
> Google Cloud OAuth client must register that ID. Scope: `calendar.events.readonly`.
>
> **Still open:**
> - **Duration is the *scheduled* length** (`timing.durationSeconds`), not live elapsed
>   time. Live elapsed (the better fit for a running meter) is a future iteration and
>   would come from the Meet side, not Calendar.
> - `events.get` currently queries the `primary` calendar; events living on another
>   calendar may 404 and need handling.
> - OAuth consent must be **Internal**, or teammates added as **test users**, to authorize.

## Context

We want a Chrome extension that shames long Google Meet meetings into ending sooner by
showing a **live, escalating money counter**. It reads who is in the call, maps each
attendee to a Callstack employee by **email**, looks up that person's salary band +
seniority, derives a per-minute cost, sums it across everyone present, and ticks it up in
real time — with a penalty multiplier that accelerates the longer the meeting runs.

Data source: **static JSON files checked into the repo**, not a live Notion API call.
- `apps/server/db/current-employees.json` — **already present.** An export of the "Current
  Employees" Notion database (226 rows): `Name`, `Last name`, `Email`, `Team`,
  `Role / Seniority Level`, plus some fields we don't need (`Manager`, `HRBP`, `GitHub`,
  `Project`, …). Shape confirmed by inspection (see below).
- `apps/server/db/salary-ranges.json` (name TBD) — **not delivered yet.** Will contain the
  salary band table that used to live in two Notion-attached PDFs. Schema proposed below;
  update this doc once the real file lands if it differs.

We originally planned to hit the Notion API directly (`NOTION_TOKEN`, `@notionhq/client`,
PDF parsing via `pdfjs-dist`). **That's off the table** — API access isn't available — so
the backend reads local JSON instead. This makes the backend considerably thinner: no
external calls, no token, no scheduled refresh against a third party, no PDF parsing.

### Decisions made with the user
1. **Data architecture = static JSON files, loaded once.** `apps/server/db/*.json` is read
   at startup and combined into an in-memory rate table. No Notion API, no PDF parsing, no
   external network calls from the backend at all (for v1).
2. **Matching = exact, by email.** The Chrome extension scrapes participant **email
   addresses** directly out of the Google Meet DOM. Email is a clean, unique key, so there is
   no fuzzy name matching, diacritic normalization, or name-order handling to build or
   maintain.
3. **All business logic lives server-side.** Rate lookup, summing, and the escalating-penalty
   math all happen in the backend. The extension is a thin client: scrape emails, poll the
   API, render whatever comes back. It performs zero cost computation itself.
4. **Cost model = escalating penalty.** Linear base cost plus a time-based multiplier that
   kicks in after a threshold, so the counter visibly accelerates.
5. **Overlay = aggregate only.** Show total cost, current rate/min, elapsed time, and
   headcount — never individual salaries/bands on screen.
6. **Data files are committed to the repo as-is** (not gitignored) — the team has access and
   this is treated like any other repo data, not a secret to keep out of history.
7. **Auth is explicitly future work, not in scope now.** Eventually the extension will
   authenticate via Google Sign-In and the backend will only accept requests from
   authenticated `@callstack.com` Google Workspace accounts. Building that is **out of scope
   for the current milestone** — track it, don't implement it yet (see "Future work" below).

### Team split
This is built by a team split along the existing monorepo boundary:
- **Backend team** owns `apps/server` — data loading, rate calculation, escalation math, the
  `/api/*` routes. This PRD is their primary spec.
- **Frontend team** owns `apps/extension` — Meet DOM scraping, polling, and the overlay UI.
- **Shared contract** — `packages/shared` is the one thing both teams import and must keep
  in lockstep: route paths + request/response TypeScript types. Treat changes to it as an
  API change that needs both sides' sign-off, not a unilateral edit.

---

## Repo layout (existing pnpm monorepo)

The workspace already exists (`workation-2026-group-11`, pnpm workspaces, TypeScript
throughout) with a placeholder "hello world" API. This PRD describes what replaces that
placeholder — no new top-level structure needs to be invented.

```
workation_2026/                  # pnpm workspace root
  package.json                   # dev / dev:server / dev:extension / build / typecheck
  pnpm-workspace.yaml             # packages: apps/*, packages/*
  tsconfig.base.json
  docs/
    PRD.md
  packages/
    shared/                      # @workation/shared — the API contract, imported by both apps
      src/index.ts                # API_ROUTES + request/response types (source of truth)
  apps/
    server/                      # ← backend team's app
      package.json                # deps: express, cors, @workation/shared — nothing else needed
      tsup.config.ts               # build (bundles @workation/shared, no separate build step needed)
      db/
        current-employees.json    # ✅ already present — raw employee export (226 rows)
        salary-ranges.json         # ⏳ pending — salary band table (schema proposed below)
      src/
        index.ts                  # express app entry — currently a placeholder health/messages demo
        config.ts                 # overheadMultiplier, hoursPerYear, bandPoint, T0, alpha, mMax, port
        data/
          employees.ts             # load + normalize db/current-employees.json
          salaryRanges.ts          # load + normalize db/salary-ranges.json
        rates/
          buildRates.ts           # combine employees + bands -> Map<email, ratePerMinute>
          store.ts                # in-memory rate table, built once at startup
        cost/
          escalation.ts           # pure functions: multiplier(t), computeCost(...)
        routes/
          cost.ts                 # POST /api/cost
      test/
        escalation.test.ts
        buildRates.test.ts
    extension/                    # ← frontend team's app (Vite + @crxjs/vite-plugin)
      manifest.config.ts          # MV3 manifest — needs content_scripts + host_permissions added
      src/
        popup/                    # existing baseline enable/disable toggle UI
        content/
          scrape.ts               # participant *email* scraping (+ MutationObserver)
          poll.ts                 # tracks meetingStartedAt, polls server /api/cost
          overlay.ts / overlay.css # Shadow-DOM floating panel (aggregate-only UI)
        options/
          index.html / options.ts # backend base URL + overlay on/off
```

---

## `db/current-employees.json` — confirmed shape

```jsonc
{
  "source": {
    "database": "Current Employees",
    "page": "List of employees 🧑‍💻",
    "pageUrl": "https://app.notion.com/...",
    "dataSourceId": "953ae54d-8b98-4a5b-8823-6a19e346817e",
    "exportedAt": "2026-07-24"
  },
  "count": 226,
  "employees": [
    {
      "id": "0163472b-d02b-4c23-9ade-46ffe9b14f08",
      "Name": "Adam",
      "Last name": "Trzciński",
      "Surname / Name": "Trzciński Adam",
      "Email": "adam.trzcinski@callstack.com",
      "Team": ["Technical Delivery"],
      "Role / Seniority Level": ["RN Dev", "Expert"],
      "alternatively called": "Adamos"
      // + Manager, HRBP, GitHub, Project, userDefined:ID, Twitter Username, url, createdTime — unused
    }
  ]
}
```

Field notes relevant to rate-building:
- `count` (226) matches `employees.length` — good sanity check to assert on load.
- `Team` values observed: `CEO`, `Finance & Administration Team`, `Incubator`,
  `Marketing Team`, `People & Culture Team`, `Project Delivery`, `Sales`,
  `Technical Delivery`, `Technology Team`. This is what decides which salary-range
  **section** to look a person up in (delivery-ish vs. business-ish teams) — same split the
  old Notion PRD described.
- `Role / Seniority Level` is an array, 1 or 2 items: delivery rows are usually
  `["RN Dev", "Senior 1"]`-shaped (role + level); business rows are often a single title
  (`["Head of Sales"]`, `["CEO"]`) with no separate level. Level tokens seen:
  `Expert`, `Senior 1`, `Senior 2`, `Mid 2`, etc. — split `{ roleFamily, level }` with a
  small classifier (known level tokens vs. everything else = role family), same approach as
  before.
- **`Email` is not always a bare address** — at least one record has it as
  `"Ada Gawrysiak <ada.gawrysiak@callstack.com>"` (display-name + angle-bracket form). The
  loader must extract the email out of that format as a fallback, not assume every value is
  a plain address. Normalize with `trim().toLowerCase()` either way.

## `db/salary-ranges.json` — proposed shape (pending real file)

Until the real file arrives, build and test against this shape; update this section (and
`data/salaryRanges.ts`) once it's delivered if the actual structure differs:

```jsonc
{
  "ranges": [
    {
      "section": "delivery",       // "delivery" | "business" — matches the Team-based split above
      "roleFamily": "RN Dev",
      "level": "Senior 1",
      "min": 12000,
      "max": 15000,
      "currency": "PLN",
      "period": "month"            // "month" | "year"
    }
  ]
}
```

---

## The shared contract — `packages/shared/src/index.ts`

Currently holds a placeholder `health`/`messages` demo contract. It gets replaced with the
real one, e.g.:

```ts
export const API_ROUTES = {
  health: "/api/health",
  cost: "/api/cost",
} as const;

export interface HealthResponse {
  status: "ok";
  peopleCount: number;
}

export interface EscalationOverride {
  T0?: number;
  alpha?: number;
  mMax?: number;
}

export interface CostRequest {
  emails: string[];            // scraped participant emails
  meetingStartedAt: string;    // ISO timestamp, sent on every poll
  escalation?: EscalationOverride;
}

export interface CostResponse {
  currency: string;
  elapsedSeconds: number;
  headcount: { matched: number; total: number };
  ratePerMinuteBase: number;
  multiplier: number;
  currentRatePerMinute: number;
  totalCost: number;
}

export interface ApiError {
  error: string;
}
```

Both apps import these from `@workation/shared` — the server to type its route handlers,
the extension to type its `fetch` calls. Whoever changes a route or a field shape updates
this file and pings the other team, since it's the only place the two apps are coupled.

---

## Backend — `apps/server`

### 1. Load employees — `src/data/employees.ts`
- Read `db/current-employees.json` (`fs.readFileSync` + `JSON.parse`, or a JSON import).
  Assert `employees.length === count` as a basic integrity check.
- Per row extract: `Name`, `Last name`, `Email` (handling the `Name <email>` form above),
  `Team`, `Role / Seniority Level`.
- **Parse role + seniority** out of the `Role / Seniority Level` array into
  `{ roleFamily, level }` as described above.
- `Team` decides `section`: `Technical Delivery` / `Technology Team` / `Project Delivery` →
  `"delivery"`; `CEO` / `Sales` / `Marketing Team` / `People & Culture Team` /
  `Finance & Administration Team` / `Incubator` → `"business"`. Keep this mapping in
  `config.ts` so it's a one-line change if a team name doesn't fit.

### 2. Load salary ranges — `src/data/salaryRanges.ts`
- Read `db/salary-ranges.json` the same way. Build a lookup keyed by
  `(section, roleFamily, level)` → `{ min, max, currency, period }`.
- No PDF parsing, no signed URLs, no fetch — this only exists because the old plan needed to
  parse PDFs; now it's just `JSON.parse`.

### 3. Combine + compute rate — `src/rates/buildRates.ts`
- For each employee, look up their band by `(section, roleFamily, level)`; normalize label
  mismatches with a maintained map in `config.ts`; **log any employee whose band isn't
  found** (they fall back to the average at request time).
- Rate math (all assumptions live in `src/config.ts`):
    - `annualGross = bandPoint(min, max)` where `bandPoint` default = **midpoint** (min/mid/max
      configurable). If the range is monthly (`period: "month"`), `annualGross = monthly * 12`.
    - `costPerYear = annualGross * overheadMultiplier` (default `1.0`; bump to ~1.25–1.4 to
      model employer overhead).
    - `ratePerMinute = costPerYear / (hoursPerYear * 60)` (default `hoursPerYear = 2016`
      ≈ 8h × 21 days × 12).
    - **Round** `ratePerMinute` (e.g. to 2 significant figures) to blunt salary precision.
- Key each rate by **normalized email** (`trim().toLowerCase()`) — a single clean map,
  `ratesByEmail`. No name variants, nicknames, or token-set matching needed.
- Compute `defaultRatePerMinute` = mean of all employee rates (used for unmatched
  attendees).

### 4. In-memory store — `src/rates/store.ts`
- Since the data is static (checked-in JSON, not a live external source), this is simpler
  than a refresh-on-a-timer cache: `src/index.ts` builds the rate table **once** at startup
  (steps 1–3) before `app.listen`, and every request reads from that in-memory object.
- No scheduled refresh needed for v1. If the JSON files change, restart the server (a
  file-watcher / hot-reload can be added later if that becomes annoying — not needed now).

### 5. Cost engine — `src/cost/escalation.ts`
Pure, unit-testable functions — the single source of truth for cost math (nothing
client-side duplicates this):
- `base = Σ ratePerMinute` over matched participant emails, plus
  `(total − matched) * defaultRatePerMinute` for anyone not found in `ratesByEmail`.
- `elapsedMinutes = max(0, (now − meetingStartedAt) / 60000)`.
- Penalty multiplier: `multiplier(t) = 1` for `t ≤ T0`, else `1 + α·(t − T0)`, capped at
  `mMax`. Defaults: `T0 = 30 min`, `α = 0.05/min`, `mMax = 4` (⇒ ×1.75 at 45 min, ×2.5 at
  60 min).
- `currentRatePerMinute = base · multiplier(t)`.
- `totalCost = base · t · multiplier(t)`.
- `T0`, `α`, `mMax` default from `config.ts` but may be overridden per-request via the
  optional `escalation` field on `CostRequest` — this only tunes the formula's *parameters*,
  so it stays consistent with "no business logic in the frontend."

### Routes — `src/routes/cost.ts` (types from `@workation/shared`)
```
GET  /api/health   -> HealthResponse
POST /api/cost     body: CostRequest   -> CostResponse
```
- 400 + `ApiError` on missing/malformed `emails` or `meetingStartedAt`.
- `cors()` already wired in `src/index.ts` for the extension's origin. No auth in v1 — see
  "Future work" below.

---

## Extension — `apps/extension` (owned by the frontend team, summarized for context)

- `manifest.config.ts` needs `content_scripts` matching `https://meet.google.com/*` and
  `host_permissions` for the server's origin (dev: `http://localhost:3000/*`).
- `src/content/scrape.ts` scrapes participant **email addresses** (not names) from the Meet
  DOM with layered selector fallbacks + `MutationObserver`.
- `src/content/poll.ts` tracks `meetingStartedAt`, POSTs `CostRequest` to
  `${serverUrl}${API_ROUTES.cost}` every few seconds, passes the `CostResponse` straight to
  the overlay — no math performed client-side.
- `src/content/overlay.ts` renders a Shadow-DOM, aggregate-only panel (total cost, rate/min,
  elapsed timer, `matched/total` headcount, escalation badge). Never renders per-person data,
  because the server never sends it any.

---

## Privacy & sensitivity notes
- The extension only ever receives per-request aggregates (`CostResponse`) — no per-person
  rate, band, or raw salary crosses the wire, even though the source data files are committed
  to the repo.
- Rounding rates (done server-side, in `buildRates.ts`) still blunts precision on anything
  that *is* exposed, as defense in depth.
- **`/api/event-cost` now requires a verified `@callstack.com` Google account** (see the
  2026-07-24 auth amendment at the top of this doc) — `apps/server/src/auth.ts`. `/api/health`
  is intentionally still public.

## Future work (explicitly out of scope right now)
- Hot-reloading `db/*.json` without a server restart, if that turns out to matter.

## Open items to resolve during implementation
- **`db/salary-ranges.json` doesn't exist yet** — the schema above is a proposal. Confirm it
  against the real file the moment it lands and adjust `data/salaryRanges.ts` accordingly.
- **Role/level ↔ salary-range label mismatches**: log at startup; unresolved people fall back
  to the average rate.
- **Meet selectors for email**: verify against a live People panel which attribute/tooltip
  actually exposes participant email addresses (frontend team).

---

## Verification (backend)

```bash
pnpm install
pnpm dev:server
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/cost \
  -H 'content-type: application/json' \
  -d '{"emails":["adam.trzcinski@callstack.com"],"meetingStartedAt":"2026-07-24T10:00:00.000Z"}'
pnpm --filter server test
```
- Assert all 226 people load without error, a sane `currency`, and a plausible rate range;
  spot-check 2–3 known people by hand (dev only). Review the "band not found" log.
- Assert `/api/cost` returns an increasing `totalCost` as `meetingStartedAt` moves further
  into the past, and that `multiplier` escalates past `T0`.

**Unit tests** (`apps/server/test/`)
- `escalation.test.ts`: base sum, `multiplier(t)` at t=0/T0/45/60, cap at `mMax`,
  elapsed→total.
- `buildRates.test.ts`: email-key lookup (including the `Name <email>` form), unmatched-
  fallback to `defaultRatePerMinute`, mean calculation.

---

## Suggested task order (backend)
1. Replace the placeholder `API_ROUTES`/types in `packages/shared/src/index.ts` with the real
   `health`/`cost` contract above — coordinate with the frontend team before merging, since
   it's shared.
2. `src/config.ts` — escalation defaults, rate-math constants, team→section mapping.
3. `src/data/employees.ts` — load + normalize `db/current-employees.json`. Verify count and
   the `Name <email>` edge case.
4. `src/data/salaryRanges.ts` — load + normalize `db/salary-ranges.json` once it lands (build
   against the proposed schema + a hand-written sample in the meantime).
5. `src/rates/buildRates.ts` + `src/rates/store.ts` — combine + rate math + email-keyed map,
   built once at startup. Review band-not-found log.
6. `src/cost/escalation.ts` + unit tests — pure math, testable without any data files.
7. `src/routes/cost.ts`, update `src/index.ts` to wire it up (replace the placeholder
   `messages` demo route), verify with `curl`.
