# 💸 Meeting Cost Meter

A Chrome extension that shows a **live, escalating money counter** on top of Google Meet.
It maps everyone in the call to a Callstack employee, derives a per-minute cost from their
salary band + seniority, sums it across the room, and ticks it up in real time — with a
penalty multiplier that accelerates the longer the meeting runs. The goal: make long
meetings *feel* expensive so people wrap up sooner.

## How it works

```
Notion/CSV + salary PDFs                     Chrome (no token or raw salary bands)
┌──────────────────────────────┐  rates.json  ┌────────────────────────────────┐
│ ingest/ — run locally once    │ ───────────► │ extension/ — MV3, vanilla JS    │
│ parse → classify → round rate │  name→rate   │ scrape → match → ledger → UI    │
└──────────────────────────────┘              └────────────────────────────────┘
```

Two stages, deliberately split for privacy:

1. **`ingest/` (build-time bake).** A Node script queries the *Current Employees* Notion
   database (or CSV), downloads/reads the available *Salary ranges* PDFs, and writes a minimal
   `extension/data/rates.json` — just **normalized name keys → a rounded per-minute rate**,
   plus coverage metadata and an optional explicitly configured company fallback. No token,
   raw salary bands, or PDFs reach the browser.
2. **`extension/` (the Chrome extension).** Dependency-free content scripts that scrape the
   Meet participant list, match names to baked rates, run the escalating-cost math, and draw
   an **aggregate-only** overlay (total, rate/min, elapsed, headcount — never individual
   salaries).

## Prerequisites

- Node.js ≥ 22
- Google Chrome
- Either a Notion integration token **or** a CSV export of the employee DB + the salary
  PDFs on disk (see below — no token needed)

## 1. Bake the data (`ingest/`)

```bash
npm install
```

Two interchangeable sources, picked by `dataSource` in `ingest/config.json` (or forced with
`npm run ingest -- --local` / `-- --notion`):

**`"local"` (default) — no Notion token.** For when you can't get an integration
token (permission issue): any regular Notion member can still export the data.

1. In Notion, open *Current Employees* → `•••` → *Export* → CSV. Save it as
   `ingest/data/employees.csv` (the CSV column names are mapped in
   `config.local.csvColumns`).
2. Download the salary PDFs and list them in `config.local.pdfs`. Delivery is required at
   `ingest/data/salary-delivery.pdf`; Business is picked up automatically from
   `ingest/data/salary-business.pdf` when available.
3. `ingest/data/` is gitignored — real employee data never gets committed.

The supplied employee export has no contract-type column. The checked-in decision is therefore
`"contractType": "average"`: each matched band uses the midpoint between its B2B and CoE
versions and the UI marks those rates as estimates. For exact per-person rates, add the real
CSV/Notion property name to `csvColumns.contractType` or `properties.contractType`; recognized
values include `B2B`, `CoE`, `Contract of Employment`, and `UoP`.

**`"notion"` — live API.** Create an internal integration at
<https://www.notion.so/my-integrations>, **share both pages with it** (*List of employees*
and *Salary ranges*), then:

```bash
cp .env.example .env      # paste your NOTION_TOKEN
```

**Look at the salary PDFs first** — the parser is tuned to a layout it can only guess at until
you see the real files:

```bash
npm run ingest:dump-pdf
```

This prints every extracted line (with what the parser thinks each row means). If roles,
levels, or amounts look wrong, adjust `ingest/config.json` (currency, `period`
monthly/annual, `levelTokens`, `teamToSection`, `labelAliases`) and the heuristics in
`ingest/parse-salary.js`. Then bake:

```bash
npm run ingest
```

This writes `extension/data/rates.json` and logs how many employees matched a band. A person
without a salary band has no rate and is excluded from the cost with a visible “partial
estimate” warning. To use a defensible company-wide fallback, set `fallbackAnnualGross` to an
explicit approved figure; the ingest never derives a fallback from only the employees that
happened to match.

> `extension/data/rates.json` is **gitignored** — it's derived salary data. Don't commit it.

### The cost model

| Setting (`ingest/config.json`)      | Meaning                                        | Default |
| ----------------------------------- | ---------------------------------------------- | ------- |
| `period`                            | Are PDF amounts `monthly` or `annual`?         | monthly |
| `bandPoint`                         | Which point in the band: `min`/`mid`/`max`     | mid     |
| `hoursPerYear`                      | Working hours/year for the hourly conversion   | 2016    |
| `overheadMultiplier`                | Employer overhead (benefits/taxes); 1.0 = none | 1.0     |
| `rateRoundingSignificantDigits`     | Rounding to blunt salary precision             | 2       |
| `contractType`                      | Missing per-person contract assumption         | average |
| `fallbackAnnualGross`               | Approved fallback for unknown bands; null=none  | null    |

`ratePerMinute = (bandPoint × 12? × overhead) / (hoursPerYear × 60)`.

## 2. Load the extension

1. Go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder.
3. Join a Google Meet call. The overlay appears top-right.

Real mode requires the locally generated `extension/data/rates.json`. If it is absent or
unreadable, the overlay says **Real rates unavailable** and does not calculate a cost. Demo
rates are loaded only when **Mock mode** is explicitly enabled, so fake values cannot silently
appear in a real meeting.

- **Toggle overlay:** click the toolbar icon, or press `Alt+Shift+C` (e.g. before a
  screen-share).
- **Currency:** use the PLN/USD button in the overlay. Conversion uses the latest official
  NBP table-A USD midpoint, cached locally; no hard-coded exchange rate is used.
- **Settings:** right-click the icon → *Options* to tune escalation, matching, mock mode, and
  the USD cost-alert thresholds.

### Mock mode (demo without any real data)

Options → **Mock mode** runs the whole pipeline on fake data: a simulated roster (people
join at minute 2/4/6…, one steps out and comes back), the committed fake rates, and an
accelerated clock (default 60× — an hour of "meeting" per real minute). It works on any
Meet conference-code page, while home routes such as `/landing` stay idle. The overlay shows
a **MOCK** badge so the numbers can't be mistaken for real ones. There is also a standalone
demo page in `extension/demo/` with interactive time controls.

### When a name isn't recognized

Meet gives us display names, not emails, so matching can miss (nicknames, initials). Three
layers soften this:

1. **Suggestions** — unmatched names get a "did you mean …?" chip in the overlay; one click
   stores the fix in `chrome.storage.local` and it auto-applies in every later meeting.
2. **Custom selector** — if Meet's markup changes and *nothing* is detected, paste a CSS
   selector in Options (find one via `window.__MCM.scrape.debugDump()`) instead of rebuilding.
3. **Manual box** — as a last resort the overlay accepts a comma-separated roster.

### Exact matching via Google Calendar (optional)

The reliable identity key is the **email**, and the meeting's calendar event has all invitee
emails. Enable *Use Google Calendar for exact matching* in Options after a one-time setup:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an
   **OAuth client ID** of type *Chrome extension*, using your unpacked extension's ID.
2. Enable the **Google Calendar API** for the project.
3. Paste the client ID into `oauth2.client_id` in `extension/manifest.json` and reload.

The extension then resolves the current Meet code to its calendar event
(`chrome.identity` + `calendar.readonly`), matches invitee emails exactly against the baked
email keys, and uses DOM scraping only for *presence* (who is actually in the room). If
scraping returns nobody, nobody is billed: Calendar invitees are never treated as proof of
attendance. Ad-hoc meetings with no event use name matching automatically.

### The escalation ("bump")

```
multiplier m(t) = 1                       for t ≤ grace period
                = 1 + α·(t − grace)       after, capped at maxMultiplier
increment       = roster_rate/min × ∫m(t)dt
total           = sum of all roster-period increments
```

Defaults: grace `30 min`, `α = 0.05/min`, cap `×4` → ×1.75 at 45 min, ×2.5 at 60 min. All
adjustable on the Options page. Timing starts only after a participant roster is detected.
When someone joins or leaves, the new room rate affects only future seconds; earlier cost is
never recalculated or reset. Meet's post-call screen freezes the final cost and elapsed time
and stops any red alert blinking; Rejoin resumes without charging the time spent outside the
call. The ledger is saved locally so a page reload keeps the total.

### Cost colors

The overlay background and toolbar icon are green by default, yellow above `$10`, orange above
`$20`, and red above `$30`; red blinks. All three strictly-greater-than thresholds live in one
`alertThresholdsUsd` setting and are editable together in Options. Threshold comparisons are
always in USD even while the overlay displays PLN.

## Known limitations

- **Name matching by default.** Without the Calendar setup, matching is display-name-based
  (diacritics/word-order handled, plus overrides/suggestions above). Unknown rates are excluded
  and clearly marked; only an explicitly configured company fallback can estimate them.
- **Meet DOM is fragile.** `extension/content/scrape.js` tries several selector strategies and
  fails soft (warning in the console when it finds nobody). When Meet changes its markup, run
  `window.__MCM.scrape.debugDump()` and set a custom selector in Options;
  `test/fixtures/meet-people-panel.html` is a reference snapshot.
- **The Business salary PDF is not present locally.** The optional path is already configured,
  but Business-team rates stay unknown until `ingest/data/salary-business.pdf` is supplied (or
  the Notion source exposes that attachment). No Business bands are invented.
- **Contract type is currently an assumption.** The available employee CSV has no contract
  type, so matched rates use the B2B/CoE midpoint and are labeled as estimates.
- **Calendar OAuth still needs a real client ID.** Calendar matching remains disabled by
  default until the placeholder in `extension/manifest.json` is replaced.
- **Controlled live-Meet validation is still required before wider use.** Unit tests cover
  parsing, matching, ledger integration, currency conversion, and thresholds, but Meet DOM
  changes can only be confirmed in a real call.
- **PDF parsing is heuristic** and must be tuned to the real layout (see step 1).

## Testing

```bash
npm test        # node:test — cost engine, name matching, PDF parser, rate building
```

Tests run with no external dependencies: the pure logic is exercised directly (ingest) or
loaded into a fake-DOM VM sandbox (`test/load-mcm.js`) for the extension's content scripts.

## Layout

```
ingest/     notion.js · pdf.js · parse-salary.js · build-rates.js · index.js · dump-pdf-text.js · config.json
extension/  manifest.json · shared/settings.js · content/{scrape,match,cost,currency,overlay,main}.js · background/ · options/ · data/
test/       *.test.js · fixtures/
```

## Privacy

This tool reads compensation data. Keep it internal: `rates.json` stays out of git and
per-person rates are rounded, but the generated file still contains employee identity keys and
rate proxies so the browser can match locally. The overlay shows only aggregate numbers. Treat
the baked file and any packaged extension containing it as confidential.
