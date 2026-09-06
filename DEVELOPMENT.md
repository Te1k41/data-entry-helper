# Development guide

How to set this repo up and work on it. For a from-scratch "new computer, get the full version running" walkthrough, see [`INSTALL.md`](INSTALL.md) instead — this doc assumes that's already done and covers repo internals. For what individual features actually do, see `CODE_NOTES.md`. For session-to-session context on what's currently in progress, see `SESSION_HANDOFF.md`.

## Repo structure

- `src/` + `manifest.json` — the Chrome extension (Manifest V3) that automates Tradetech schedule data entry. Content scripts run on `tradetech.net`, `mergeimagesonline.com`, `yangming.com`, and (for the rename toggle / full-page capture / highlighter) elsewhere.
- `service-relay/` — a local Node server (default `http://localhost:3737`) the extension talks to for everything that needs local filesystem access or persistence: proof-file lookup/upload, due-service scanning/history, downloaded-file renaming, a dashboard UI. Entirely optional — the extension degrades gracefully with the relay-dependent controls disabled/hidden when it isn't running (see `src/utils/relay-socket-client.js`).
- `community-version/` (generated, gitignored) — the extension-only distribution for end users who don't want to run the relay server. Built with `scripts/build-community.js`, see below.

## Cross-platform dev setup

This repo is worked on from Windows, macOS, and Linux. A few things matter for that to keep working:

- **Always run `npm install` fresh inside `service-relay/` on whichever machine you're on** — never copy `node_modules/` between machines. `pdf-parse` pulls in `@napi-rs/canvas`, a native (prebuilt, per-OS) binding; a `node_modules` populated on one OS and copied to another will fail to load it (you'll see a "Cannot load @napi-rs/canvas... Failed to load native binding" warning at server startup). `service-relay/node_modules/` is gitignored specifically so this can't happen by accident via git.
- `service-relay/package.json` declares `"engines": { "node": "..." }` matching `jsdom@30`'s real minimum — check it if `npm install` complains about your Node version.
- `service-relay/settings-store.js` stores `watchFolder`/`dataFolder` **per `process.platform`** in `settings.json` (itself gitignored, machine-specific) — opening this repo on a different OS never clobbers the other OS's paths. Defaults come from `os.homedir()` (`~/Downloads`, `~/Documents/Tradetech Services`) and work correctly out of the box on Windows, macOS, and Linux alike; override them at `http://localhost:3737/settings-page` once the server is running.
- `service-relay/routes/files.js` already branches three ways (`win32`/`darwin`/`linux`) for finding which process holds a file open and for opening a file with the OS's native viewer — extend that file, not a new one, if you need more OS-specific file handling.
- `service-relay/atomic-write.js` retries a bounded few times on `EPERM`/`EBUSY` before giving up, since Windows can transiently refuse to replace a file that's momentarily open elsewhere (antivirus, another process). If you add a new persisted store, write through this helper (`writeFileAtomicSync`), not a bare `fs.writeFileSync`.

## Running it locally

1. `cd service-relay && npm install`
2. `node server.js` — starts the relay on `http://localhost:3737` and its dashboard at `http://localhost:3737/dashboard`.
3. In Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the repo root (the folder containing `manifest.json`).
4. **Content-script edits need a manual extension reload** (the reload icon on the extension's card in `chrome://extensions`) before they take effect — Chrome does not hot-reload unpacked extension source.

To develop/test the no-relay community experience instead, run `node scripts/build-community.js` and load *that* output folder unpacked, with the relay server simply not running.

## The community-build script

`node scripts/build-community.js [outDir]` (default `outDir`: `community-version/`) rebuilds and verifies the standalone community edition from the current source and documentation templates, excluding relay/personal files by convention and deriving its manifest and feature registry.

See [docs/community-build-guide.md](docs/community-build-guide.md) for the file-exclusion naming convention, the hook-array pattern for adding a new relay-dependent feature correctly, and the full verification-check list.

## Background on the current mainline

The bulk of what's in `src/`/`service-relay/` right now (relay-optional graceful degradation, atomic writes, the bounded shared request-body reader, canonical port/vessel row adapters, IMO-based vessel identity matching in Live Check, dashboard output-escaping) was developed and verified in a separate sandbox copy before being promoted into this repo. If a file named `main-vs-fix-comparison.txt` still exists alongside this repo (one level up, not part of the repo itself), it has the full file-by-file rationale for that promotion.
