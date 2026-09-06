# Data Entry Helper — Community Version

This Chrome extension helps with Tradetech schedule data entry. It provides in-page validation, date syncing and step controls, vessel and port helpers, highlighting, notes, keyboard navigation, and full-page capture tools. See [FEATURES.md](FEATURES.md) for the complete feature-by-feature guide.

## Install in Chrome

1. Download or copy this entire `community-version` folder to your computer.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select this folder—the folder containing `manifest.json`.

Chrome will load the extension immediately. Keep this folder in place while the extension is installed.

## No server required

This is a self-contained edition with no local server involved at all — not just optional, genuinely not included. Validation, highlighting, date syncing, notes, navigation, vessel and port helpers, and full-page capture all work normally.

A handful of workstation-specific features from the full version depend on a local relay server that only makes sense on the original developer's own machine, so they're left out of this build entirely rather than shipped as disabled buttons:

- Scan & Save (automated due-service scanning)
- Upload Proof
- Full Live Check (proof/DOM-scrape comparison — the local duplicate-IMO consistency check is still included, since that part never needed a server)
- Rename toggle (server-side downloaded-file renaming)
- Schedule preview tools
- Quiet background integrations (schedule snapshot sharing, service-code sharing, merge-download cleanup, Yang Ming schedule-table capture)

See [FEATURES.md](FEATURES.md) for exactly what's included instead.
