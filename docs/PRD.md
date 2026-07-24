# Meeting Cost Meter — Chrome extension for Google Meet

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
attendee to a Callstack employee, looks up that person's salary band + seniority, derives a
per-minute cost, sums it across everyone present, and ticks it up in real time — with a
penalty multiplier that accelerates the longer the meeting runs.

Two data sources live in Notion:
- **Employees** — the "Current Employees" database (226 rows) under the *List of employees*
  page. Queryable via the Notion API. Data source id `953ae54d-8b98-4a5b-8823-6a19e346817e`
  (database id `33003504530b47efa768e7a928ccfea9`).
- **Salary ranges** — two **PDF attachments** on the *Salary ranges* page
  (id `4c1b7bcf25574daeacc1029c47042718`): `Salary_Ranges_2026_Delivery_.pdf` and
  `Salary_Ranges_2026_Business.pdf`. The API only returns a signed download URL; the numbers
  must be parsed out of the PDFs.

### Decisions made with the user
1. **Data architecture = build-time bake.** A Node ingest script (using `@notionhq/client`)
   turns the employee DB + salary PDFs into a small local JSON the extension bundles. No
   Notion token and no per-person salary ship in the browser.
2. **Cost model = escalating penalty.** Linear base cost plus a time-based multiplier that
   kicks in after a threshold, so the counter visibly accelerates.
3. **Overlay = aggregate only.** Show total cost, current rate/min, elapsed time, and
   headcount — never individual salaries/bands on screen.

### Key constraint
The Google Meet DOM exposes attendee **display names**, not emails. So live matching is
**name-based** (normalized), with a company-average fallback for anyone we can't match — not
the clean email key that the employee DB would otherwise allow.

---

## Architecture overview

```
Notion (token, PDFs)                        Chrome (no token, no salaries)
┌───────────────────────────┐               ┌──────────────────────────────────┐
│  ingest/ (Node, run once)  │  rates.json   │  extension/ (MV3, vanilla JS)      │
│  @notionhq/client + pdfjs  │ ────────────► │  content script on meet.google.com │
│  employees + salary PDFs   │  (name→rate)  │  scrape → match → cost → overlay   │
└───────────────────────────┘               └──────────────────────────────────┘
```

- **ingest/** runs on a developer machine with `NOTION_TOKEN` in env. Output = a minimal
  `rates.json` (normalized name variants → per-minute rate + a default/average rate).
- **extension/** is dependency-free vanilla JS/TS. It bundles `rates.json`, needs **no**
  network/host permissions, and does all cost + escalation math client-side.

This split is why the choice is privacy-preserving: bands, raw salaries, PDFs, and the token
never leave the ingest step. Only a single rounded rate-per-minute per person is shipped.

---

## Repo layout

```
workshop/
  package.json                 # deps: @notionhq/client, pdfjs-dist (ingest only); devtool esbuild if TS
  .env.example                 # NOTION_TOKEN=...
  .gitignore                   # ignore extension/data/rates.json (contains derived salary info)
  ingest/
    config.json                # hoursPerYear, overheadMultiplier, bandPoint, currency, label maps
    notion.js                  # @notionhq/client: query employees, read salary page blocks
    pdf.js                     # download + parse the two salary PDFs -> salary band table
    build-rates.js             # combine employees + bands -> rates.json (+ round rates)
    dump-pdf-text.js           # dev helper: print raw PDF text to design the row parser
    index.js                   # orchestrator: run all of the above
  extension/
    manifest.json              # MV3
    content/
      scrape.js                # resilient Meet participant scraping (+ MutationObserver)
      match.js                 # name normalization + matching against rates.json
      cost.js                  # rate sum + escalation engine
      overlay.js               # Shadow-DOM floating panel (aggregate-only UI)
      overlay.css
    background/service-worker.js  # minimal: settings storage / message routing
    options/ (options.html + options.js)
    data/rates.json            # baked output (gitignored)
    data/rates.mock.json       # committed demo data (fake names/rates) for testing
    assets/icons/
  test/
    match.test.js  cost.test.js  pdf.test.js
    fixtures/ (meet-people-panel.html, salary-sample.txt, rates.mock.json)
  README.md
```

Use **plain JS** (or TS compiled with esbuild) — the extension has no runtime npm deps, so it
can be loaded unpacked with no build step. `@notionhq/client` and `pdfjs-dist` are used only
by the Node ingest scripts.

---

## Component 1 — `ingest/` (build-time bake)

Run with `NOTION_TOKEN` set. Produces `extension/data/rates.json`.

### 1a. Query employees — `ingest/notion.js`
- `new Client({ auth: process.env.NOTION_TOKEN, notionVersion: '2025-09-03' })`.
- Query the data source (`953ae54d-8b98-4a5b-8823-6a19e346817e`), paginate on
  `has_more`/`next_cursor` until all 226 rows are pulled.
- Per row extract: `Name`, `Last name`, `Surname / Name` (title), `Email`,
  `alternatively called`, `Team` (multi_select), `Role / Seniority Level` (multi_select).
- **Parse role + seniority** out of the `Role / Seniority Level` array. Delivery rows look
  like `["RN Dev","Senior 1"]`, `["QA Automation Eng.","Senior"]`, `["RN Dev","Expert"]`;
  business rows are often a single job title (`["Senior Content Marketer"]`). Split into
  `{ roleFamily, level }` using a small classifier: known level tokens
  (`Junior/Mid/Senior 1/Senior 2/Expert/…`) vs. everything else = role family.
- `Team` decides which salary PDF to look in: `*Delivery*`/`Technology Team` → Delivery PDF;
  Sales/Marketing/People & Culture/Finance/CEO → Business PDF.

### 1b. Parse salary PDFs — `ingest/pdf.js`
- Read the salary page blocks: `notion.blocks.children.list({ block_id: '4c1b7bcf...' })`,
  find the `file`/`pdf` blocks, take the signed `file.url`, `fetch()` each PDF fresh (the URL
  expires ~1h — download every run, never cache the URL).
- Parse with `pdfjs-dist` (`getDocument` → `page.getTextContent()`, use item `transform`
  x/y to reconstruct rows/columns). Build a band table:
  `{ section: 'delivery'|'business', roleFamily, level } → { min, max, currency, period }`.
- **First implementation step is `dump-pdf-text.js`** to see the actual layout, because the
  columns, currency, and whether amounts are **monthly vs annual** are unknown until we read
  them. The row parser is written against that dump.

### 1c. Combine + compute rate — `ingest/build-rates.js`
- For each employee, look up their band by `(section, roleFamily, level)`. Normalize PDF
  labels ↔ employee tags with a maintained map in `config.json`; log any employee whose band
  isn't found (they fall back to the average at runtime).
- Rate math (all assumptions live in `ingest/config.json`, not in the extension):
    - `annualGross = bandPoint(min,max)` where `bandPoint` default = **midpoint** (min/mid/max
      configurable). If PDF amounts are monthly, `annualGross = monthly * 12`.
    - `costPerYear = annualGross * overheadMultiplier` (default `1.0`; bump to ~1.25–1.4 to
      model employer overhead).
    - `ratePerMinute = costPerYear / (hoursPerYear * 60)` (default `hoursPerYear = 2016`
      ≈ 8h × 21 days × 12).
    - **Round** `ratePerMinute` (e.g. to 2 significant figures) to blunt salary precision.
- Build normalized match keys per person: from `Name`+`Last name`, the `Surname / Name`
  title (surname-first), `alternatively called` (nickname), and email localpart. Normalize =
  lowercase, `NFD` diacritic strip (Polish ł/ń/ó/ż…), collapse punctuation, token-set.
- Emit `rates.json` (schema below). Also compute `defaultRatePerMinute` = mean of all
  employee rates (used for unmatched attendees).

### `rates.json` contract
```jsonc
{
  "generatedAt": "2026-07-24",
  "currency": "PLN",            // from PDF
  "defaultRatePerMinute": 0.95, // company average, for unmatched attendees
  "people": [
    { "keys": ["jan kowalski", "kowalski jan", "janek"], "ratePerMinute": 1.23 }
  ]
}
```
No names beyond match keys, no bands, no levels, no raw salary.

---

## Component 2 — `extension/` (MV3, aggregate-only overlay)

### `manifest.json`
- `manifest_version: 3`, `content_scripts` matching `https://meet.google.com/*`.
- Permissions: `storage` only. **No** host permissions (data is baked in).
- `web_accessible_resources`: `data/rates.json` (or import it into the content bundle).
- Optional `options_page` for settings; small toolbar `action` to toggle the overlay.

### `content/scrape.js` — participant scraping
- Read attendee display names from the People panel and/or video tiles. Meet markup is
  fragile, so isolate all selectors here with **layered fallbacks** (aria-labels,
  `[data-*]`, role=listitem) and degrade gracefully if none match.
- Strip `(You)`, presentation tiles, and duplicates. Re-scan via `MutationObserver` +
  a debounce so joins/leaves update the set. Expose `getParticipants(): string[]`.

### `content/match.js` — name → rate
- Normalize each attendee name the same way as ingest, match against `people[].keys`
  (exact normalized, then token-subset for "First Last" vs "Surname Name" order).
- Unmatched → `defaultRatePerMinute`, counted separately so the UI can show
  "8 people (6 matched)". Return `{ matched, total, ratePerMinuteTotal }`.

### `content/cost.js` — escalating cost engine
- `base = Σ ratePerMinute` over present participants (currency/min).
- Track meeting start (first participants seen; persist in `chrome.storage.session` so a
  reload doesn't reset it). `t = elapsed minutes`.
- Penalty multiplier: `m(t) = 1` for `t ≤ T0`, else `1 + α·(t − T0)`, capped at `mMax`.
  Defaults: `T0 = 30 min`, `α = 0.05/min`, `mMax = 4` (⇒ ×1.75 at 45 min, ×2.5 at 60 min).
- `displayedTotal = base · t · m(t)`; `currentRatePerMin = base · m(t)`.
- Tick every 1s (`setInterval`) recomputing from wall-clock elapsed (don't accumulate — avoids
  drift/tab-throttling errors). All of `T0, α, mMax` are user-configurable.

### `content/overlay.js` + `overlay.css` — UI (aggregate only)
- Floating draggable panel rendered in a **Shadow DOM** (isolates from Meet's CSS and keeps
  our styles from leaking). Shows: big **total cost**, **current rate/min**, **elapsed
  timer**, **headcount** (`matched/total`), and an **escalation badge** once `t > T0`
  (color green→amber→red + a "wrap it up" nudge at thresholds).
- No per-person figures. A hotkey / toolbar toggle hides it instantly (e.g. before a
  screen-share). Consider auto-hiding when a screen-share is detected.

### `options/` + `background/service-worker.js`
- Options page persists escalation params (`T0`, `α`, `mMax`), currency display, and overlay
  on/off to `chrome.storage.sync`. Service worker is minimal (settings broadcast / toggle
  relay). Rate math is fixed at bake time and not re-tunable client-side (keeps salaries out
  of the browser).

---

## Privacy & sensitivity notes
- `extension/data/rates.json` is derived salary data → **gitignored**; commit only
  `rates.mock.json` (fake) for demos. Don't publish the real file to a public repo.
- Overlay is aggregate-only and hideable; nothing salary-identifying renders on screen.
- Rounding rates reduces reverse-engineering precision from the shipped file.

## Open items resolved during implementation
- **PDF internals**: exact columns, currency, and monthly-vs-annual — confirmed by running
  `dump-pdf-text.js` first; the parser and `config.json` label maps are written against it.
- **Meet selectors**: verified against the live People panel; captured as an HTML fixture for
  regression.
- **Role/level ↔ PDF label mismatches**: logged during ingest; unresolved people fall back to
  the average rate.

---

## Verification

**Ingest**
```bash
cp .env.example .env   # add NOTION_TOKEN
node ingest/dump-pdf-text.js   # inspect PDF layout first
node ingest/index.js           # produces extension/data/rates.json
```
- Assert ~226 people, a sane `currency`, and plausible rate range; spot-check 2–3 known
  people by hand (dev only). Review the "band not found" log.

**Extension**
- `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
- Join a test Meet: confirm participants are scraped, `matched/total` is right, the total
  ticks up every second, the penalty badge appears after `T0`, and the Shadow-DOM overlay
  doesn't break Meet's layout. Toggle-hide works.
- **Mock mode** (point the build at `rates.mock.json`) so scraping/cost/escalation can be
  demoed without a live 8-person meeting or any real salary data — also drive it against the
  saved People-panel HTML fixture.

**Unit tests** (`test/`)
- `match.test.js`: diacritics, name-order, nickname, and unmatched-fallback cases.
- `cost.test.js`: base sum, `m(t)` at t=0/T0/45/60, cap at `mMax`, elapsed→total.
- `pdf.test.js`: row parser against `fixtures/salary-sample.txt`.

---

## Suggested task order
1. Scaffold repo (`package.json`, `.gitignore`, `.env.example`, `manifest.json`, mock data).
2. `ingest/notion.js` — query employees, parse role/seniority. Verify counts.
3. `dump-pdf-text.js` → design `ingest/pdf.js` band parser. Verify against a sample.
4. `build-rates.js` — combine + rate math + `rates.json`. Review band-not-found log.
5. Extension content pipeline against `rates.mock.json` + DOM fixture: `scrape → match →
   cost → overlay`. Get the ticker + escalation working.
6. Options page + settings persistence; overlay hide/toggle.
7. Swap in real `rates.json`, test on a live Meet, tune escalation defaults.
8. Unit tests + README (setup, ingest, load-unpacked, refresh).
