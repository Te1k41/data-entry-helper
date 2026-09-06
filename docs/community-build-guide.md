# Building the community edition

The full extension and the community edition share one `src/` tree. Relay functionality lives in separate companion files, so the community build can exclude it by filename and derive its manifest and feature registry from the files that remain. Local fixes therefore reach both editions through the same source files; there is no second toolbar, Live Check, background worker, or manifest to keep synchronized by hand.

## Which files ship

`scripts/build-community.js` uses `isExcludedSrcPath()` for both copied files and manifest entries. Paths below are relative to `src/`:

- **Relay convention:** every filename ending in `-relay.js` is excluded, at any depth. This includes `background-relay.js`, `utils/toolbar-relay.js`, and `features/live-check-relay.js` as well as the fully relay-dependent features.
- **`LEGACY_RELAY_FILES`:** `utils/relay-socket-client.js` keeps its established shared-transport name. `utils/button.js` is a generic legacy helper, but its only actual `createButton()` caller is the relay rename toggle. Both are intentionally excluded without renaming them. The local toolbar builds its own buttons; it does not call this helper. Reassess this carve-out if a new local feature starts using `createButton()`.
- **`PERSONAL_EXCLUSIONS`:** `features/tradetech-stars.js` has zero relay dependencies. It is excluded for a personal/cosmetic reason unrelated to the server. It must **never** be named `*-relay.js`, because that would misdescribe the reason it is excluded.

The derived manifest filters each `content_scripts[].js` list using this same predicate and removes blocks that become empty. That removes the Yang Ming scraper block and the rename-toggle block, including its legacy button helper. The display name becomes `Data Entry Helper — Community Version`; other manifest settings, including the background worker path, remain derived from the full manifest.

Only two shipped source files are transformed: `src/background.js` loses the exact standalone `importScripts("background-relay.js");` line, and `src/main.js` loses excluded identifiers from its `FEATURES` array. All other shipped files must match `src/` byte for byte. README and FEATURES come from `docs/community-readme-template.md` and `docs/community-features-template.md`; edit those templates, not generated copies.

## Adding a companion with hooks

These are classic scripts in a shared global scope, with no bundler or ES modules. Load the base first and its companion immediately afterward in the same manifest block. The base owns local behavior and an initially empty hook array. The companion declares its own object and registers bound callbacks at file scope. Removing the companion then leaves a useful local feature with empty hooks.

The real examples are `src/utils/toolbar.js` with `src/utils/toolbar-relay.js`, and `src/features/live-check.js` with `src/features/live-check-relay.js`. Toolbar owns `_ensureHooks` and `_broadcastHooks`; its companion owns the socket. Live Check owns `_extraComparisons`, the duplicate-IMO check, highlights, dismissal and guarded writes; its companion contributes proof comparisons. The base Live Check explicitly calls `compareAll()` during `init()` so local checks also run when no companion exists.

Here is a worked example for a new mixed feature. Put this in `src/features/schedule-hints.js` and add `ScheduleHints` to the real `main.js` `FEATURES` array:

```js
const ScheduleHints = {
    _panel: null,
    _ensureHooks: [],
    _extraHints: [],

    _ensurePanel() {
        this._ensureHooks.forEach(hook => hook());
        if (this._panel) return;
        this._panel = document.createElement("div");
        this._panel.id = "tt-schedule-hints";
        document.body.appendChild(this._panel);
    },

    render() {
        this._ensurePanel();
        const hints = ["Check the current schedule fields before saving."];
        this._extraHints.forEach(addHints => addHints(hints));
        this._panel.textContent = hints.join(" ");
    },

    init() { this.render(); },
};

// Illustrates an early render before the next manifest script has executed.
ScheduleHints.render();
```

Put the companion in `src/features/schedule-hints-relay.js`:

```js
const ScheduleHintsRelay = {
    _started: false,
    _connected: false,
    _socketClient: null,
    _unsubscribe: null,

    connect() {
        if (this._started) return;
        // subscribe() calls back synchronously and render() re-enters this hook.
        this._started = true;
        this._unsubscribe = onRelayConnectionStatusChange(state => {
            this._connected = state === "connected";
            ScheduleHints.render();
        });
        this._socketClient = connectRelaySocket({});
    },

    addHints(hints) {
        if (this._connected) hints.push("The optional local relay is connected.");
    },
};

ScheduleHints._ensureHooks.push(() => ScheduleHintsRelay.connect());
ScheduleHints._extraHints.push(hints => ScheduleHintsRelay.addHints(hints));
```

List the two paths in that order, before `src/main.js`, in the Tradetech manifest block. The full block already loads `src/utils/relay-socket-client.js` before features. Register only the base object in `FEATURES`; the companion registers itself through the file-scope hooks. These callbacks preserve the companion's `this` binding.

**Ordering pitfall:** invoke the ensure hooks on every lifecycle call, *before* any run-once guard. Toolbar's own bottom-of-file `Toolbar.register(...)` calls `_ensurePanel()` while `toolbar.js` is still executing, before `toolbar-relay.js` has populated `_ensureHooks`. If the hook loop were below `if (this._panel) return`, it would run with an empty array on that first call and never run again. Putting it above that guard allows later renders to connect. The companion must be idempotent; its connection guard must also be set before subscribing, because status subscriptions call back synchronously. The example above demonstrates both safeguards, and its later `init()` gives the newly registered hooks another lifecycle call.

The background companion has a related import-order constraint: `importScripts()` executes immediately, before the base worker resumes. Its capture hook is registered through `globalThis.fpcExtraCaptures`; the base preserves the existing array when it resumes. The community transform removes the import and leaves an empty capture-hook array, so PNG capture still works.

## Run and verify

From the repo root:

```sh
node scripts/build-community.js
```

An optional output directory is resolved relative to the repo root, as before:

```sh
node scripts/build-community.js community-preview
```

The selected output directory is replaced on each run. Do not put hand-maintained files in it. The builder rejects paths overlapping the repo root or its source inputs. It prints `✓` for successful checks, `✗` for failures, and ends with `BUILD PASSED` or `BUILD FAILED`. A failure exits with status 1. Counts describe the current source tree and are not fixed historical targets.

The checks are:

- **`stripBackgroundRelayImport`:** the exact standalone relay import must occur once. Missing, changed or duplicate import lines fail the build rather than leaving an active relay dependency in the output.
- **`generatedMain` / `parseFeatures`:** keep the real registry order and remove only identifiers whose unique declaration is confirmed to belong to an excluded source file. Unknown or ambiguous declarations, expressions/spreads, duplicate identifiers and unsupported removal layouts fail loudly. Follow the current flat, top-level declaration style and one bare registry identifier per line.
- **`checkSyntax`:** runs `node --check` on every output `.js` file, including the background worker and dynamically injected capture script.
- **`checkManifest`:** verifies valid JSON, the specified derivation from the real manifest, and existence of all referenced content scripts and the background service worker.
- **`checkFeatureReferencesResolve`:** parses the generated `FEATURES` array and requires a unique declaring file loaded *before* `main.js` in every manifest bundle using it. Merely having a file somewhere on disk is insufficient.
- **`checkParity`:** every included file must match source bytes, except the exact background import removal and the exact excluded registry-entry removal. Unexpected additional source files also fail.
- **`checkExclusionsApplied`:** every source file matching the shared exclusion predicate must be absent from the output, and no output filename may itself match that predicate.
- **`checkNoServerRelayDependency`:** checks shipped JavaScript for non-comment `service-relay/` references using the existing line-based check. Comments explaining the split are allowed. This is a static check, not a general proof that arbitrary future code has no network dependencies.

After a successful build, load the output folder through Chrome's **Load unpacked** and check local behavior with no relay running. In particular, verify the toolbar, initial duplicate-IMO warnings and full-page PNG capture. CLI checks do not exercise Chrome's service-worker lifecycle or browser event timing.

## New-feature decision checklist

- **No relay ties:** use an ordinary filename. It ships unchanged in both editions. Register a local feature in `FEATURES` when it needs the normal bootstrap/event dispatch.
- **Pure relay feature with no local value:** use `*-relay.js` from day one and initialize it outside the `FEATURES` array, following the `RenameToggle.init()` call in `src/rename-toggle-init-relay.js`. If it needs event handlers, wire those explicitly in the relay file. Existing older relay entries in `FEATURES` are handled by the build transform, but new features should use the split convention directly.
- **Mixed local and relay value:** split a base and companion using the hook pattern above. Keep an explicit local initial check in the base. Test the base by temporarily removing only its companion from the full manifest and reloading, then restore that manifest entry before committing. Also build and test the complete community output.
- **Excluded for another reason:** add it to `PERSONAL_EXCLUSIONS` with an honest comment. Never use the relay suffix to disguise a personal/cosmetic exclusion.
