# CallCost

A Google Chrome extension that will calculate the cost of your Google Meet
calls. This repository currently contains the **baseline UI** only — a clean
popup with an eye toggle to enable/disable the plugin. No Google Meet or cost
logic is wired up yet.

## What's here

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 extension definition |
| `popup.html` | The popup window shown when the toolbar icon is clicked |
| `popup.css` | Styling for the popup |
| `popup.js` | Toggle logic + state persistence (`chrome.storage`) |
| `icons/` | Toolbar / store icons (16, 32, 48, 128 px) |

## Features (baseline)

- Polished popup window that opens from the toolbar icon.
- A single **eye toggle**: press it to enable (open eye) or disable (crossed
  eye) the plugin.
- The enabled/disabled state is **remembered** between sessions via
  `chrome.storage`, and reflected on the toolbar icon (an `off` badge when
  paused).

## Load the extension locally in Chrome

1. Open Chrome and go to **`chrome://extensions`**
   (or **Menu → Extensions → Manage Extensions**).
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select this project folder (the one containing `manifest.json`).
5. CallCost now appears in your extensions list. Click the **puzzle-piece**
   icon in the toolbar and **pin** CallCost so its icon is always visible.
6. Click the CallCost icon to open the popup, then press the eye to toggle
   the plugin on/off.

### Applying changes while developing

After editing any file, return to `chrome://extensions` and click the
**reload** (↻) icon on the CallCost card. Reopen the popup to see your changes.
(HTML/CSS/JS changes to the popup take effect the next time you open it; a
reload is only strictly required for `manifest.json` changes.)

## Roadmap

- Detect active Google Meet tabs.
- Track participants and call duration.
- Compute an estimated cost from configurable hourly rates.
