# Installing the full version on a new computer

This is a from-scratch setup guide — everything a fresh Windows, macOS, or Linux machine needs to run the full extension (Chrome extension + local relay server + dashboard). If you just want the extension alone with no server, see [`data-entry-helper-community`](https://github.com/Te1k41/data-entry-helper-community) instead — it needs none of the server-side steps below.

## 1. Prerequisites

- **Node.js**, matching `service-relay/package.json`'s `engines` field: `^22.22.2 || ^24.15.0 || >=26.0.0`. Check your version with `node --version`; install/update from [nodejs.org](https://nodejs.org) if needed.
- **Google Chrome** (or another Chromium-based browser that supports Manifest V3 unpacked extensions).
- **Git** (optional — you can also download the repo as a ZIP from GitHub's "Code" button instead).

## 2. Get the code

```sh
git clone https://github.com/Te1k41/data-entry-helper.git
cd data-entry-helper
```

(Or download and unzip the repo from GitHub if you're not using git.)

## 3. Set up and start the relay server

```sh
cd service-relay
npm install
node server.js
```

**Always run `npm install` fresh on this machine** — never copy a `service-relay/node_modules/` folder from another computer. One dependency (`pdf-parse`, via `@napi-rs/canvas`) ships a native binary that's specific to your OS; a `node_modules` built on Windows won't work on macOS/Linux and vice versa.

You should see:
```
🚀 Service relay running on http://localhost:3737
🔌 WebSocket ready on ws://localhost:3737
👀 Watching Downloads folder: <your Downloads folder>
```

Leave this running in its own terminal window — the extension talks to it over `localhost:3737` while you work. Closing the terminal (or Ctrl+C) stops the relay; the extension keeps working with relay-dependent features disabled until you start it again.

## 4. Load the extension in Chrome

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the `data-entry-helper` folder you cloned/unzipped in step 2 — the folder containing `manifest.json` at its root (not the `service-relay/` subfolder).

Chrome loads the extension immediately.

## 5. First-time configuration

Open **http://localhost:3737/settings-page** in a browser tab (with the server from step 3 still running) and set:
- **Your Tradetech username** ("Assigned To" name) — used by Scan & Save's automated search.
- **Watch folder** / **data folder**, if you want something other than the defaults (`~/Downloads` and `~/Documents/Tradetech Services`, resolved automatically per-OS — usually fine to leave as-is).

Settings are saved per-machine (`service-relay/settings.json`, not committed to git), so you only need to do this once per computer.

## 6. Verify it's working

- Visit **http://localhost:3737/dashboard** — should load the due-services dashboard.
- Open a `tradetech.net` schedule page — a small **🧰 Tools** panel should appear (default position: top-left), and relay-dependent buttons (Scan & Save, Upload Proof, Live Check, etc.) should be clickable, not grayed out.

## Ongoing use

- **Content-script edits need a manual extension reload** — after pulling new code (`git pull`) or editing a `src/` file yourself, go to `chrome://extensions` and click the reload icon on this extension's card. Chrome does not hot-reload unpacked extension source automatically.
- **The relay server needs to be running** for Scan & Save, Upload Proof, Live Check, rename-toggle, and Schedule preview tools to work — everything else in the extension works with it stopped, just with those specific buttons grayed out.
- To make the relay start automatically at login instead of running it manually each time, set up your OS's normal "run this program at startup" mechanism (Windows: a shortcut in the Startup folder, or Task Scheduler if your account allows it; macOS: a Login Item; Linux: a systemd user service or your desktop environment's autostart) pointing at `node server.js` inside `service-relay/`. There's no script for this checked into the repo — it's a one-time setup specific to your machine.

For repo internals, cross-platform dev notes, and the community-build process, see [`DEVELOPMENT.md`](DEVELOPMENT.md).
