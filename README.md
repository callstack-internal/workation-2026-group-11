# CallCost

A Google Chrome extension that calculates the cost of your Google Meet calls,
built as a pnpm monorepo with a supporting backend API.

- **`apps/extension`** — Chrome (Manifest V3) extension, built with Vite, that
  connects to the server. This is where the CallCost UI lives (a clean popup
  with an eye toggle to enable/disable the plugin).
- **`apps/server`** — Express + TypeScript API.
- **`packages/shared`** — TypeScript types shared as the API contract between
  both apps.

## Structure

```
.
├── apps/
│   ├── server/      # Express API (tsx dev, tsup build)
│   └── extension/   # Chrome MV3 extension (Vite + @crxjs/vite-plugin)
└── packages/
    └── shared/      # Shared API types (@workation/shared)
```

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`corepack enable` or `npm i -g pnpm`)

## Install

```bash
pnpm install
```

## Develop

Run both apps together:

```bash
pnpm dev
```

Or individually:

```bash
pnpm dev:server      # http://localhost:3000
pnpm dev:extension   # Vite dev server on http://localhost:5173
```

### Load the extension in Chrome

1. Start the server: `pnpm dev:server`.
2. Build (or dev) the extension: `pnpm dev:extension` (or `pnpm --filter extension build`).
3. Open `chrome://extensions`, enable **Developer mode**.
4. Click **Load unpacked** and select `apps/extension/dist`.
5. Open the extension popup — the badge should read **connected**, and you can send messages to the server.

### Applying changes while developing

After editing extension files, return to `chrome://extensions` and click the
**reload** (↻) icon on the extension card. Reopen the popup to see your changes.
(HTML/CSS/JS changes to the popup take effect the next time you open it; a
reload is only strictly required for `manifest.json` changes.)

## Build

```bash
pnpm build            # builds both apps
pnpm --filter server build
pnpm --filter extension build
```

## API

| Method | Route            | Description              |
| ------ | ---------------- | ------------------------ |
| GET    | `/api/health`    | Health/uptime check      |
| GET    | `/api/messages`  | List messages            |
| POST   | `/api/messages`  | Create a message         |

The server keeps messages in memory; swap the in-memory store in
`apps/server/src/index.ts` for a database when needed.

## Configuration

- Server port: `PORT` env var (default `3000`).
- Server URL used by the extension: `apps/extension/src/config.ts` and the
  `host_permissions` entry in `apps/extension/manifest.config.ts`. Update both
  when deploying the server elsewhere.

## Features (baseline)

- Polished popup window that opens from the toolbar icon.
- A single **eye toggle**: press it to enable (open eye) or disable (crossed
  eye) the plugin.
- The enabled/disabled state is **remembered** between sessions via
  `chrome.storage`, and reflected on the toolbar icon (an `off` badge when
  paused).

## Roadmap

- Detect active Google Meet tabs.
- Track participants and call duration.
- Compute an estimated cost from configurable hourly rates.
