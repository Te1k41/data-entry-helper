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

This community version works without installing or running a local server. Validation, highlighting, date syncing, notes, navigation, vessel and port helpers, and full-page capture continue to work normally.

A few workstation-specific features depend on an optional local relay server that is not included or required here:

- Scan & Save
- Upload Proof
- Live Check
- Rename toggle
- Schedule preview tools

When the relay is unavailable, those features are hidden or shown disabled/grayed out with a **Requires the optional local relay server** tooltip. They do not prevent the rest of the extension from working.
