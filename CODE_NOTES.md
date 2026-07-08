# Data Entry Helper — Detailed Code Notes

This document walks through every file in the extension, explaining what
each piece of code does and why. Written as a reference for future-you
(or anyone else who has to maintain this).

---

## manifest.json

Chrome Extension Manifest V3 config file. Chrome reads this first to know
what the extension is allowed to do and what code to run where.

- `"manifest_version": 3` — required, MV3 is the current Chrome extension format.
- `"name"` / `"version"` — display name and version shown in `chrome://extensions`.
- `"background": { "service_worker": "src/background.js" }` — registers
  `background.js` as the extension's background service worker. This runs
  independently of any web page, in its own context, and stays alive only
  while needed (MV3 service workers are event-driven, not persistent).
- `"permissions": ["downloads", "storage"]` — `downloads` grants access
  to the `chrome.downloads` API (background.js's now-mostly-no-op
  `onDeterminingFilename` listener needs the permission to register at
  all); `storage` grants `chrome.storage.local`, which `upload-proof.js`
  uses to pass the chosen filename from the main page to the Support
  Document popup (two separate documents, so it can't just use a JS
  variable).
- `"host_permissions": ["http://localhost:3737/*"]` — allows the extension
  to make network/WebSocket requests to the local relay server without a
  CORS-related permission prompt.
- `"content_scripts"` is an **array of two separate injection rules**:

  **Block 1 — Tradetech + mergeimagesonline** (the main bundle):
  - `"matches"` — `https://www.tradetech.net/*` and
    `https://mergeimagesonline.com/*`. If either site changes domains,
    this must be updated or nothing will load there.
  - `"js"` — **the load order array**. Files are executed top-to-bottom in
    this exact order, and later files can reference `const`s/functions
    defined in earlier files (because they share the same page's global
    scope). This is why `date.js` loads before any feature that uses
    `DateUtils`, and why `main.js` is always last (it references every
    feature object).
  - `"all_frames": true` — content scripts are injected into every iframe
    on the page, not just the top-level document. This is a **known
    source of the "loads 3x" bug** noted in memory — if Tradetech's page
    has nested iframes, `console.log("🚀 ETA-to-ETD Extension Loaded")`
    (and everything else) fires once per frame. It's also *load-bearing*
    for `upload-proof.js`, since the Support Document popup and the
    `FILE1` input it needs to reach live in their own frame/window
    context that this script must also run in.
  - `"run_at": "document_idle"` — waits until the page is basically done
    loading (DOM parsed, most resources fetched) before injecting, so
    form fields actually exist when `init()` runs.

  **Block 2 — every other site (Rename Toggle bundle)**:
  - `"matches": ["<all_urls>"]` with `"exclude_matches": ["https://www.tradetech.net/*"]`
    — runs everywhere EXCEPT Tradetech, so the standalone Rename ON/OFF
    button doesn't collide with Tradetech's own set of buttons.
  - `"js"` — just `utils/button.js`, `features/rename-toggle.js`, and
    `rename-toggle-init.js`. Deliberately minimal — this bundle only
    needs `createButton` and the WebSocket relay connection, nothing
    from the Tradetech-specific feature set.
  - No `all_frames` key here (defaults to top frame only) and no
    `run_at` override (defaults to `document_idle`).

---

## Readme.txt

Human-facing documentation. Not executed — pure reference material for
installing, using, and extending the extension. (Being replaced/updated
alongside this file — see updated version.)

---

## main.js — the bootstrap

```js
let syncing = false;
```
A **global re-entrancy guard**. When one feature programmatically sets a
field's value (via `setFieldValue`, which dispatches synthetic `change`
events), that synthetic event would normally trigger the `change`
listener again, which could trigger another field update, forever. Every
feature that writes to a field wraps the write in
`syncing = true; ... ; syncing = false;` and other features check
`if (syncing) return;` at the top of their `handle()` to break the loop.

```js
console.log("🚀 ETA-to-ETD Extension Loaded");
```
Confirms the script actually ran — first line to look for in DevTools
when debugging "is the extension even loading."

```js
const FEATURES = [ ... ];
```
The **feature registry**. Every feature object must be listed here or it
will never run, even if its file is loaded via manifest.json. Order in
this array doesn't matter functionally (unlike manifest.json's load
order) since these are just object references, but it's kept roughly in
the order features were built for readability.

```js
FEATURES.forEach(feature => feature.init());
```
Runs every feature's one-time setup (creating buttons, doing an initial
page scan, etc.) once, when the content script first loads.

```js
document.addEventListener("change", (event) => {
    FEATURES.forEach(feature => feature.handle(event));
}, true);
```
A single **delegated event listener** on `document` (not on individual
fields) using the capture phase (`true` as the third argument — fires
during the capture pass, before the event reaches its target, which
means it can't be stopped by `stopPropagation()` on the target). Every
time ANY field on the page fires a `change` event, every feature's
`handle(event)` gets called and each feature decides for itself (usually
by checking `event.target.name`) whether it cares.

```js
document.addEventListener("blur", (event) => {
    FEATURES.forEach(feature => {
        if (feature.handleBlur) feature.handleBlur(event);
    });
}, true);
```
Same delegation pattern but for `blur` (focus leaving a field), and only
called on features that actually define a `handleBlur` method (optional
interface — most features don't need it).

---

## src/background.js — relay state sync

Runs in its own isolated worker context (not on the Tradetech page), so
it can't see page DOM — it can only use `chrome.*` APIs, `fetch`, and
`WebSocket`. **Renaming itself moved server-side** (see `server.js`
below) — this file no longer builds filenames at all; it just keeps
a local in-memory mirror of relay state via WebSocket in case anything
in the extension ever needs to read it.

```js
let lastServiceCode  = "";
let renamingEnabled  = true;
let ws               = null;
```
In-memory mirror of relay state. Reset every time the service worker
restarts (MV3 workers are short-lived, so this isn't persisted).

```js
function connectWebSocket() {
    ws = new WebSocket("ws://localhost:3737");
    ws.addEventListener("open",  () => console.log("🔌 Background connected to relay"));
    ws.addEventListener("message", (event) => { /* parses type: init/service/renaming */ });
    ws.addEventListener("close", () => setTimeout(connectWebSocket, 3000));
    ws.addEventListener("error", () => console.error("❌ WebSocket error — will retry"));
}
connectWebSocket();
```
Opens a persistent WebSocket to the relay server and keeps `ws`
updated with whatever the server broadcasts:
- `type: "init"` (sent once on connect) — seeds `lastServiceCode` and
  `renamingEnabled` from the server's current state.
- `type: "service"` — updates `lastServiceCode` whenever any tab
  changes the service code.
- `type: "renaming"` — updates `renamingEnabled` whenever the Rename
  Toggle button is flipped from any tab.
- On `close`, reconnects automatically after 3 seconds — this is what
  makes every relay-connected feature in this extension self-healing
  if the local server is restarted.

```js
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    // server-side watcher handles renaming now
    suggest({ filename: downloadItem.filename });
    return true;
});
```
Still registered (Chrome requires *something* to answer this event if
`"downloads"` permission is granted), but it's now a no-op that just
confirms the original filename — actual renaming happens after the
fact via `chokidar` watching the Downloads folder in `server.js`.
`return true` is kept for consistency even though `suggest()` is
called synchronously now.

---

## Utils

### date.js — `DateUtils`
Central place for all date parsing/formatting math. Nothing in here
touches the DOM.

- **`normalize(dateStr)`** — strips every non-digit character
  (`\D` = "not a digit", `g` = all occurrences) so `"06/25/26"` and
  `"062526"` both collapse to `"062526"`. Used to compare two dates
  written in different formats without caring about slashes.
- **`todayMMDDYY()`** — builds today's date as `MM/DD/YY` using
  `padStart(2, "0")` to guarantee two digits (so `June` → `06` not `6`),
  and `.slice(-2)` on the full year to get just the last two digits.
- **`parse(str)`** — converts a string into a real JS `Date` object.
  Tries two regex shapes: `MM/DD/YY` (slashes) and `MMDDYY` (bare
  digits). Constructs the date as UTC midnight (`T00:00:00Z`) to avoid
  timezone drift shifting the day by one when displayed later. Returns
  `null` if neither pattern matches (defensive — callers must check).
- **`format(date)`** — the inverse of `parse`: takes a `Date` and turns
  it back into `MM/DD/YY`, reading UTC components (`getUTCMonth`,
  `getUTCDate`, `getUTCFullYear`) to match how `parse()` constructed it.
- **`addDays(date, n)`** — clones the date (`new Date(date)`, so the
  original isn't mutated) and shifts it forward `n` days using
  `setUTCDate`, which correctly rolls over into the next month/year.

### dom.js — `setFieldValue`
```js
function setFieldValue(input, value) {
    input.value = value;
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}
```
Setting `.value` directly on an `<input>` does **not** fire any events —
Tradetech's own JS (validation, calculations, diff fields, etc.) would
never know the field changed. This function sets the value and then
manually dispatches both `input` and `change` events with `bubbles: true`
so they propagate up to `document` and trigger both Tradetech's own
listeners and this extension's own delegated listener in `main.js`. This
is the **only** approved way any feature should write into a field.

### banner.js — `showBanner` / `removeBanner`
- **`showBanner({ title, message })`** — first calls `removeBanner()` to
  guarantee only one banner ever exists at a time (prevents stacking
  duplicates). Builds a `<div id="tt-banner">` with a title line and a
  message line, styles it inline via `cssText` (fixed position, top-right,
  yellow background, monospace, drop-shadow "sticker" look), and appends
  it to `<body>`.
- **`removeBanner()`** — `document.getElementById("tt-banner")?.remove()`
  — optional chaining means this is safe to call even if no banner
  currently exists (no error, just does nothing).

### button.js — `createButton`
```js
function createButton(options) {
    if (document.getElementById(options.id)) return;
    ...
}
```
Guard clause at the top prevents creating duplicate buttons if `init()`
somehow runs twice (e.g. the multi-frame injection bug).
- Builds a `<button>`, applies the shared "sticker" style (white bg,
  black border, drop shadow) via `cssText`.
- Adds `mouseenter`/`mouseleave` listeners that shrink the shadow and
  nudge the button 2px down-right to simulate a physical "press" — purely
  cosmetic hover feedback.
- Appends the button to `<body>`, then checks `localStorage` for a saved
  position under key `btn-pos-{id}` and applies it if found — this is
  how buttons "remember" where the user dragged them to, persisting
  across page reloads (localStorage survives navigation, unlike JS
  variables).
- **Drag-to-reposition logic**: tracks `mousedown` on the button
  (records starting mouse position and starting button position),
  `mousemove` on the whole `document` (updates button position live
  while dragging), and `mouseup` on `document` (ends the drag).
  - `didDrag` distinguishes a genuine drag from a simple click — if the
    mouse moved more than 4px in either direction, it's treated as a
    drag, not a click.
  - If it *was* just a click (`!didDrag`), the button's `onClick()`
    callback fires as normal.
  - If it *was* a drag, the new position is saved to `localStorage` so
    it persists, and `onClick()` is **not** fired (so dragging a button
    doesn't accidentally trigger its action).

---

## core/boundary.js — `PortSyncBoundary`

Shared logic used by both `date-syncing.js` and `port-highlighting.js` to
figure out where a shipping route "loops back" on itself.

- **`getStopRow()`** — scans every `SP*_port_code` field top-to-bottom
  (skipping Tradetech's hidden `PV_` duplicate fields), remembers the
  very first non-empty port code it sees (`firstPort`), and keeps
  scanning until that same code appears again. When it repeats, it
  returns the **row number of the repeat** (e.g. if the route is
  HKG → SHA → HKG, it returns `3`, the row where HKG comes back). If the
  first port never repeats, returns `null` (no boundary — the whole
  route is scanned normally).
- **`shouldBlock(spRow)`** — used by date-syncing to decide whether a
  given SP row is "past" the boundary and should be skipped for
  auto-sync. Returns `true` only if a stop row exists AND the given row
  number is greater than it.

This exists because some routes are round-trip / repeating loops, and
syncing dates blindly past the loop-back point would apply arrival dates
to the wrong leg of the journey.

---

## Features

### notes.js — `NotesDateReplacement`
Runs once on load (`init()`, no `handle()` logic — `handle()` is present
but empty to satisfy the shared feature interface).
- Finds the `<textarea name="notes">` field.
- Computes today's date in both slash (`06/25/26`) and bare (`062526`)
  form.
- Uses two regexes to find **any** existing 6-digit run or
  `DD/DD/DD`-shaped date anywhere in the notes text and replaces every
  occurrence with today's date, in whichever format it was already in.
- Only writes back (`pvNotes.value = updated`) if something actually
  changed, to avoid unnecessary writes.
- Note: this writes `.value` directly instead of going through
  `setFieldValue` — this is intentional here since it happens at page
  load before any listeners typically care, but means no `change` event
  fires for this particular update.

### validation.js — `SP001DateValidation`
The engine behind the mismatch warning banner.
- **`validate()`** — reads `SP001_depart_date`. If empty, clears any
  existing banner and stops. Otherwise calls `findMatchingSVDate()`; if a
  match is found, clears the banner (green path); if not, shows the
  mismatch banner with the offending date.
- **`findMatchingSVDate(spDate)`** — normalizes SP001's date (strips
  slashes) and compares it against every `SV*_depart_date` field
  (matched via the attribute-selector regex-like pattern
  `input[name^="SV"][name$="_depart_date"]`, meaning "name starts with SV
  and ends with _depart_date"). Returns the **field name** of the first
  vessel whose date matches, or `null` if none do.
- **`handle(event)`** — only re-runs validation when the changed field is
  either an SV departure date or one of SP001's own date fields —
  everything else is ignored, keeping this feature cheap even though it
  listens globally.
- Note: `init()` intentionally does nothing — validation is deliberately
  triggered by `date-syncing.js` and `vessel-correction.js` after they
  finish their own writes, not on initial page load.

### date-syncing.js — `DateSyncing`
The core auto-fill feature: arrival dates propagate to departure dates.
- Bails immediately if `syncing` is already `true` (loop guard) or if the
  changed field isn't a named `<input>`.
- **Special case: `SP001_depart_date`** — this is the *reverse* direction
  from every other row (departure → arrival, not arrival → departure),
  because SP001 is the starting leg of the whole shipment. Copies the
  value into `SP001_arrival_date` via `setFieldValue` (wrapped in the
  `syncing` guard), then re-runs `SP001DateValidation.validate()`
  afterward since SP001's dates just changed.
- **Every other row**: only proceeds if the field name ends in
  `_arrival_date`. Extracts the row number (e.g. `SP004` → `4`) and asks
  `PortSyncBoundary.shouldBlock(spRow)` — if this row is past the
  route's loop-back boundary, syncing is skipped entirely (prevents
  writing dates onto the "return leg" of a repeating route using the
  wrong leg's arrival date).
- Otherwise builds the matching `_depart_date` field name by string
  substitution, finds that field, and copies the value over.
  Additionally, if the row that changed was specifically
  `SP001_arrival_date`, re-validates afterward (since SP001's arrival
  indirectly affects the validation banner too).

### port-highlighting.js — `PortHighlighting`
The most complex feature — highlights the port row where the shipment's
"region" changes (e.g. leaving Asia and entering the USA).
- **`EU_COUNTRIES`** — a `Set` of country names used to detect ports
  ending in an EU country name → categorized as `EU_UK`. Needs manual
  updates if EU membership changes.
- **`CATEGORY_RANK`** — priority ordering for categories when multiple
  category-change candidates exist on the same route (`USA`/`CANADA` = 1,
  `JAPAN`/`EU_UK` = 2). Lower number wins.
- **`PRIORITY_PORT_KEYS`** — `["us", "eu"]`. These correspond to
  Tradetech fields like `first_us_port` / `first_eu_port`, which (if
  present and filled in) take priority over the generic scan below.
- **`HIGHLIGHT_STYLE`** — the actual CSS applied to the winning field
  (orange outline + light yellow background).
- **`getPortCategory(portName)`** — classifies a port name string by
  checking its ending: `"...USA"` → `USA`, `"...CANADA"` → `CANADA`,
  `"...JAPAN"`/`"...JAP"` → `JAPAN`, `"...UNITED KINGDOM"` or ends in any
  `EU_COUNTRIES` name → `EU_UK`. Anything else → `"OTHER"`.
- **`isDirectionalService()`** — reads the `service` field and checks if
  it ends in a compass suffix (`-N`, `-S`, `-E`, `-W`, case-insensitive)
  via regex. This flag decides whether the algorithm biases toward the
  **first** category-change candidate or the **last** one further down.
- **`applyHighlight` / `clearAllHighlights`** — simple style set/reset
  helpers so re-running the scan doesn't leave stale highlights on old
  fields.
- **`run()` — the main scan**, step by step:
  1. Collects all `SP*_port_name` fields, clears any existing highlights.
  2. Asks `PortSyncBoundary.getStopRow()` and, if a boundary exists,
     trims the field list down to only rows at or before that boundary
     (ignores the repeated "return leg" ports).
  3. Checks `isDirectionalService()`. If directional AND the boundary's
     stop row is also the very last row with any content, the last row
     is excluded from scanning — because in a directional service that
     repeats its first port right at the end, that repeat isn't a real
     "region change," it's just the loop closing.
  4. **Priority pass**: for each key in `PRIORITY_PORT_KEYS` (`us`,
     `eu`), reads the corresponding `first_xx_port` field's code, finds
     the SP row whose `_port_code` matches that value, gets that row's
     `_port_name` field and the port name field immediately above it,
     and — only if that represents a genuine category transition (not
     `OTHER`, not the same category as the port above) — highlights it
     and returns immediately, skipping the generic scan entirely.
  5. **Generic scan** (only reached if no priority match): walks every
     consecutive pair of port fields, computes both categories, and
     collects every pair where the category actually changes (and the
     new category isn't `OTHER`) into a `candidates` array along with its
     rank.
  6. Picks the candidate(s) with the best (lowest) rank. If several tie
     for best rank, picks the **first** one if `biasFirst` (directional
     service) or the **last** one otherwise.
  7. **Fallback**: if no candidates were found at all, just highlights
     `SP001` (the very first port row) so *something* is always
     highlighted.
- **`handle(event)`** — re-runs the whole scan whenever a port name,
  port code, the `service` field, or a `first_us_port`/`first_eu_port`
  field changes.

### vessel-correction.js — `VesselVoyageCorrection`
Powers the "🛠 Fix Vessel Dates" button.
- **`getVoyageIncrement()`** — reads the `voyage_increment_by` field (if
  present) as an integer; defaults to `1` if missing or not a valid
  number.
- **`parseVoyageCode(code)`** — splits a voyage code like `"0042A"` into
  its numeric part (`42`), any trailing letter suffix (`"A"`), and the
  original numeric width (`4`, so it can be re-padded back to `"0043A"`
  later without losing leading zeros).
- **`buildVoyageCode(parsed, newNum)`** — reassembles a voyage code from
  a parsed object and a new number, re-padding to the original width.
- **`fixVesselDates()`** — the button's main action:
  1. Requires `SP001_depart_date` to be set and parseable; alerts and
     bails otherwise.
  2. Reads the voyage increment setting.
  3. Collects every `SV*_depart_date` field that has a valid, parseable
     date, along with its matching `*_start_voyage` field (again
     excluding `PV_` duplicates).
  4. Filters those down to vessels whose date is **before** SP001's date
     ("lagging" vessels) and sorts them earliest-first.
  5. Finds the single vessel with the **latest** date among *all*
     vessels (`furthestVessel`) — this becomes the anchor/base date that
     lagging vessels get pushed forward from.
  6. For each lagging vessel, in order, sets its new date to
     `baseDate + (index+1) * 7 days` — i.e. each lagging vessel gets
     pushed to a new date one week later than the previous one,
     cascading forward from the furthest vessel.
  7. For each corrected vessel, also increments its voyage code by the
     configured increment, and if a hidden `PV_` duplicate of that
     voyage field exists, mirrors the new value there too (directly via
     `.value`, not `setFieldValue`, since it's a hidden mirror field with
     no listeners that need notifying).
  8. Wraps all the field writes in the `syncing` guard, then calls
     `SP001DateValidation.validate()` at the end since vessel dates just
     changed.
- **`init()`** — creates the "🛠 Fix Vessel Dates" button at
  `top: 312px; left: 30px`.

### vessel-no-date.js — `DetectVesselNoDate`
Flags any vessel that has a name but no departure date.
- **`check()`** — for every `SV*_vessel_name` field with a value: clears
  any previous red highlight, finds the matching `SV*_depart_date`
  field, and if that date field is missing or empty, adds the vessel's
  name to a `missing` list and applies a red outline/background to the
  name field.
- After scanning everything, shows a banner listing all missing-date
  vessels if any were found, or removes the banner if the list is empty.
- Runs once via `init()` and again any time a vessel name or vessel
  departure date field changes (`handle()`).

### vessel-to-be-announced.js — `VesselTBA`
A typing shortcut for placeholder vessels.
- **`handle(event)`** — only acts on `SV*_vessel_name` fields (excluding
  `PV_` duplicates):
  - If the user types a single backtick (`` ` ``) into the field, it's
    replaced with `"VESSEL TO BE ANNOUNCED"`, and if the matching
    `*_start_voyage` field is currently empty, it's auto-filled with
    `"TBN"`.
  - If the vessel name is cleared out entirely, and the voyage field
    currently reads `"TBN"`, the voyage field is cleared too (so a
    removed placeholder doesn't leave a stale `TBN` behind).
- `handleBlur` exists but is empty — reserved for future use, satisfies
  the optional interface without doing anything currently.

### voyage-direction.js — `VDirection`
Auto-appends a compass-direction letter to voyage codes, toggleable.
- **`enabled`** — a boolean flag stored on the feature object itself
  (persists for the page session, resets on reload — not saved to
  storage).
- **`init()`** — creates the "🧭 Direction: ON" toggle button at
  `top: 350px`. Clicking it flips `enabled` and updates the button's own
  label text to reflect the new state.
- **`handle(event)`** — if disabled, does nothing. Otherwise: only acts
  on `SV*_start_voyage` fields (excluding `PV_`). Reads the `service`
  field, extracts a trailing compass direction (`-N/-S/-E/-W`) via
  regex; if the service isn't directional, does nothing. If the voyage
  value is empty, or already ends in a letter (meaning a suffix is
  already present), does nothing. Otherwise appends the direction letter
  onto the end of the voyage code via `setFieldValue`.

### resize-toggle.js — `ResizeToggleOff`
Only relevant on `mergeimagesonline.com` (per manifest matches).
- **`init()`** — finds the `#resize-switch` toggle element; if it's
  currently checked (on), simulates a click to turn it off. Logs either
  way. No `handle()` logic needed — this is a one-time, load-time action.

### service-relay-send.js — `ServiceRelaySend`
The Tradetech-side half of the relay system — now WebSocket-based
rather than a one-shot HTTP `POST`.
- **`connect()`** — opens `ws://localhost:3737`. On `open`, immediately
  calls `sendServiceCode()` so a fresh connection (including a
  reconnect) always announces the current value. On `close`, schedules
  a reconnect attempt after 3 seconds — this is what makes the feature
  self-healing if the relay server restarts.
- **`sendServiceCode()`** — reads the `service` field's value; if it's
  non-empty and the socket is open, sends
  `{ type: "service", code: value }` over the WebSocket. Silently does
  nothing if the field is missing/empty or the socket isn't ready yet
  (rather than queuing — the next real change or reconnect will send it).
- **`init()`** — calls `connect()`, then also sends the current value
  once after a 1-second delay (belt-and-suspenders in case the `open`
  handler's immediate send races with the socket still connecting).
- **`handle(event)`** — re-sends any time the `service` field itself
  changes.

### merge-download-signal.js — `MergeDownloadSignal`
Tells the relay server to run its merge cleanup pass after a merged
image is downloaded from mergeimagesonline.com.
- **`ws` / `connect()`** — same self-reconnecting WebSocket pattern as
  `ServiceRelaySend`, but with its own independent connection (each
  relay-connected feature keeps its own socket rather than sharing one).
- **`signal()`** — if the socket is open, sends
  `{ type: "merge-download" }` to the server, which schedules
  `runMergeCleanup()` after a 3-second delay (see `server.js` below).
- **`init()`** — connects immediately, and adds a `click` listener on
  `document` that watches for clicks on any `<button>` whose text is
  exactly `"Download Merged Image"`. When found, waits 2 seconds (to
  give the browser time to actually finish writing the file to disk)
  before calling `signal()`.
- Note: this file defines `init()` twice — the second definition
  (which does the real work: connect + click listener) silently
  overwrites the first (connect-only) one, since object literals just
  keep the last key. Harmless here since the two versions don't
  conflict, but worth cleaning up if this file is touched again.
- **`handle()`** — intentionally empty; entirely click-driven.

### upload-proof.js — `UploadProof`
Automates finding, staging, and submitting the day's proof-of-delivery
file into Tradetech's Support Document popup. The **same script and
the same feature object** runs in two different contexts and branches
on which one it's in:

- **`init()`** — checks for `input[name="FILE1"]`. That field only
  exists inside the Support Document **popup**, not the main page, so
  its presence is the signal for which role to play:
  - Popup found → calls `tryAutoFill(fileInput)` and returns.
  - Not found (main page) → creates the "📤 Upload Proof" button.
- **`findSupportDocsButton()`** — Tradetech's Support Document button
  can live in a different frame than whichever frame this content
  script instance happens to be running in (`onclick="parent.fr1.supportDocs()"`
  is the tell). Tries, in order: (1) the current frame, (2) a
  known dynamically-written frame named `"fr2"`, (3) `window.top`'s own
  document, (4) every remaining frame under `window.top` as a fallback
  — each wrapped in its own `try/catch` since cross-origin or
  not-yet-loaded frames throw when accessed.
- **`startUpload()`** (main page) — reads the `service` field, asks the
  relay's `/find-file` endpoint for matching proof files, picks the
  most recent (`files.sort().pop()`), stores the chosen filename in
  `chrome.storage.local` under `pendingUpload` (this is how the value
  crosses from the main page's script instance into the popup's —
  they're separate documents and can't share a JS variable), then
  finds and clicks the Support Document button to open the popup.
- **`tryAutoFill(fileInput)`** (popup) — reads `pendingUpload` back out
  of `chrome.storage.local`; if there isn't one, this popup opened for
  some other reason and the feature backs off entirely. Otherwise
  fetches the actual file bytes from the relay's `/file` endpoint,
  wraps them in a `File` via `DataTransfer` (the only way to
  programmatically set `<input type="file">`'s `.files`), dispatches a
  `change` event so Tradetech's own JS notices the file, clears
  `pendingUpload` so a stale value can't leak into a future unrelated
  popup open, then **auto-submits immediately**:
  ```js
  const submitBtn = document.querySelector('input[type="submit"][value="Upload"]');
  if (submitBtn) {
      submitBtn.click();
      showTemporaryBanner({ title: "✅ Upload submitted", message: pendingUpload });
  } else {
      showBanner({ title: "⚠ Upload proof staged, not submitted", message: ... });
  }
  ```
  No confirmation click is required — the green banner (auto-clearing,
  via `showTemporaryBanner` from `banner.js`) is purely informational.
  If the submit button can't be found, a persistent warning banner is
  shown instead of silently doing nothing, so a broken selector doesn't
  go unnoticed. (Earlier versions of this feature staged the file and
  then waited for the user to click a "Confirm Upload" button in a
  banner before submitting — that step was removed in favor of
  submitting immediately.)
- **`handle()` / `handleBlur()`** — both empty; entirely button/popup
  driven, no auto-trigger on field changes.

### keyboard-navigation.js — `KeyboardFieldNav`
Lets arrow keys and Tab move between SP*/SV* fields like a spreadsheet,
instead of relying on Tradetech's own (unreliable) tab order.
- Runs off its **own `keydown` listener** registered in `init()` (in
  the capture phase), not the shared `change`/`blur` bus in `main.js`
  — it needs to intercept the key before the browser's default caret
  movement or tab order happens.
- **`onKeyDown(event)`** — bails unless the target is a named
  `<input>` matching `/^(SP|SV)(\d+)_(.+)$/` (and isn't a hidden `PV_`
  duplicate), then dispatches on `event.key`:
  - `ArrowUp` / `ArrowDown` → `moveVertical()` — same field name,
    adjacent row number, zero-padding preserved via the original row
    string's width.
  - `ArrowLeft` → only if `caretAtStart(target)` (cursor at position 0
    with nothing selected) → `moveHorizontal(..., -1, ...)`.
  - `ArrowRight` → only if `caretAtEnd(target)` → `moveHorizontal(..., 1, ...)`.
    This guard is what lets arrow keys still move the text cursor
    normally *inside* a field's value — the feature only takes over
    once you're already at the edge.
  - `Tab` → `handleTab()`.
- **`handleTab()`** — only applies to `SP` rows (the arrival/depart
  pair). Forces an explicit cycle rather than trusting the browser's
  tab order (which doesn't reliably land where expected, since hidden
  `PV_` fields can sit in between rows):
  ```
  Tab       on arrival_date (row N)   → depart_date   (row N)
  Tab       on depart_date  (row N)   → arrival_date  (row N+1)
  Shift+Tab on depart_date  (row N)   → arrival_date  (row N)
  Shift+Tab on arrival_date (row N)   → depart_date   (row N-1)
  ```
  Every other field is left alone — normal browser tab order applies.
- **`focusField(field, event)`** — the shared landing helper: calls
  `event.preventDefault()`, then `.focus()` and `.select()` — every
  jump goes through this, which is why landing on a field also selects
  its full text (like landing on a spreadsheet cell), so typing
  immediately overwrites it.
- **`moveHorizontal()`** — doesn't use a hardcoded field order. Instead
  `getRowFieldsInVisualOrder()` collects every field in that row and
  sorts them by `getBoundingClientRect().left` — actual left-to-right
  position on the page — so this keeps working even if Tradetech
  reorders columns later.
- **`handle(_event)`** — empty; this feature's real logic lives in its
  own `keydown` listener, not the shared `change` bus. Present only to
  satisfy the `FEATURES` interface in `main.js`.

### rename-toggle.js — `RenameToggle` (all-sites bundle, not in `FEATURES`)
A standalone ON/OFF button for the relay's automatic download-renaming,
injected on every site except Tradetech (see the second
`content_scripts` block in `manifest.json`). Bootstrapped directly by
`rename-toggle-init.js` (`RenameToggle.init();`) rather than through
the `FEATURES` array in `main.js`, since it belongs to a completely
separate content script injection.
- **`connect()`** — same self-reconnecting WebSocket pattern as the
  other relay features. On `message`, handles `type: "init"` (seeds
  `enabled` from the server's current `renamingEnabled` state) and
  `type: "renaming"` (updates `enabled` whenever ANY tab/browser flips
  the toggle — this is what keeps the button's label in sync
  everywhere at once).
- **`init()`** — connects, then waits for the socket's `open` event,
  then waits an *additional* 200ms before creating the button — this
  delay gives the server's `init` message (sent immediately on
  connect) time to arrive and set the correct initial `enabled` state
  before the button's label is first rendered, so it doesn't flash the
  wrong state on load.
- **`createToggleButton()`** — creates the "📁 Rename: ON/OFF" button.
  Clicking it flips `enabled` locally, immediately updates its own
  label, and — if the socket is open — broadcasts
  `{ type: "renaming", enabled }` so the server (and every other
  connected tab/browser) picks up the change too.
- **`handle()` / `handleBlur()`** — both empty; this feature doesn't
  belong to the Tradetech `FEATURES` array at all, so these exist only
  in case something ever calls them defensively.

### schedule-cascade.js — `ScheduleCascade`
Lets the user "snapshot" the current spacing between ports, then
reapply that spacing anchored to a new SP001 date — useful when an
entire shipment's schedule shifts but the relative gaps between ports
stay the same.
- **`diffs`** — an in-memory object keyed by SP row number, storing
  `{ arrival: n, depart: n }` day-offsets relative to SP001's arrival
  date.
- **`init()`** — takes an initial snapshot on load, and creates two
  buttons: "📸 Snapshot Diffs" (re-snapshots on demand, shows a
  confirmation banner with the count of stored intervals) and
  "🌊 Cascade Dates" (applies the stored diffs).
- **`storeDiffs()`** — reads every `SP*_arrival_date_diff` and
  `SP*_depart_date_diff` field (these are presumably Tradetech-computed
  fields showing day-offsets). Empty fields are skipped entirely (not
  stored as `0` — this distinction matters because "not stored" means
  "don't touch this row" during cascade, versus "stored as 0" which
  would mean "set exactly to SP001's date").
- **`cascade()`** — requires `SP001_arrival_date` to be set and
  parseable, and requires at least one diff to have been snapshotted
  previously (shows an appropriate warning banner via `showBanner` if
  either precondition fails). For every stored row/diff pair, computes
  `SP001_date + diff` and writes it into the matching arrival/departure
  field (independently — a row can have just an arrival diff, just a
  depart diff, or both), then shows a success banner.
- **`handle()`** — intentionally empty; this feature is entirely
  button-driven, never auto-triggered by field changes.

---

## boundary.js — see "core/boundary.js" above (same file)

---

## service-relay/server.js — the local relay server

A standalone Node.js server (run separately from the browser, not part
of the extension bundle itself), built on `http`, `ws`, and `chokidar`.
It exists because Edge (where Tradetech is used) and Chrome (where
downloads land) can't share in-memory state directly — and it's grown
from a simple service-code relay into doing the actual download
renaming and cleanup work itself.

- **State** — `currentServiceCode` (string) and `renamingEnabled`
  (bool), both held in memory only and lost on restart. `PORT = 3737`.
- **`WATCH_FOLDER`** — hardcoded to `C:\Users\DELL\Downloads`. This is
  machine-specific; it must be updated if this ever runs on a different
  computer or user account.
- **`WATCH_EXTS`** — `.jpg .jpeg .png .xlsx .xls .pdf`; only files with
  these extensions are auto-renamed by the watcher.

**HTTP endpoints** (all with permissive CORS headers, and `OPTIONS`
preflight answered with a bare `204`):
- `GET /service` → `{ code: currentServiceCode }`
- `GET /renaming` → `{ enabled: renamingEnabled }`
- `GET /find-file?service=X` — builds today's `MMDDYY`, escapes `X` for
  regex safety, and matches filenames like `X-070326.png` or
  `X-070326-2.png` in `WATCH_FOLDER`. Returns `{ files: [...] }`. Used
  by `upload-proof.js` to find today's proof file for a service code.
- `GET /file?name=X` — `path.basename(name)` strips any directory
  components first (prevents path traversal), then streams the file's
  raw bytes back with `res.writeHead` + `fs.createReadStream(...).pipe(res)`.
  Used by `upload-proof.js` to fetch the actual file to stage into
  Tradetech's upload input.
- Anything else → `404 Not found`.

**WebSocket** (`new WebSocket.Server({ server })` — shares the same
HTTP server/port rather than binding a second port):
- On `connection`, immediately sends `{ type: "init", serviceCode, renamingEnabled }`
  so a freshly-connected tab/browser can sync to current state without
  waiting for the next change.
- `type: "service"` messages update `currentServiceCode` and are
  re-broadcast to every other connected client via `broadcast()`.
- `type: "renaming"` messages update `renamingEnabled` and are likewise
  rebroadcast — this is what keeps the Rename Toggle button's label in
  sync across every open tab/browser.
- `type: "merge-download"` doesn't update any state directly — it just
  schedules `runMergeCleanup()` after a 3-second delay (giving the
  browser time to finish writing the download to disk first).
- `broadcast(data)` — a small helper that `JSON.stringify`s once and
  sends to every client whose `readyState === WebSocket.OPEN`.

**`runMergeCleanup()`** — triggered by `MergeDownloadSignal`:
1. Deletes any file in `WATCH_FOLDER` starting with `"screencapture-"`
   whose birth time is today (compares year/month/date individually
   rather than a raw timestamp diff, so it's not sensitive to time of
   day).
2. Builds a regex for `{currentServiceCode}-{today}-{N}.{ext}` and
   collects every numbered duplicate matching it.
3. If any exist, sorts them by number, keeps only the highest-numbered
   one, deletes the rest, then renames the survivor to the clean
   `{SERVICE}-{MMDDYY}.{ext}` form (deleting any pre-existing file at
   that clean path first, so the rename doesn't fail).

**File watcher** — `chokidar.watch(WATCH_FOLDER, { depth: 0, ignoreInitial: true, awaitWriteFinish: {...} })`:
- `awaitWriteFinish` waits for a file to stop growing (500ms stability
  window, polled every 100ms) before firing `add` — prevents renaming a
  half-downloaded file mid-write.
- On `add`: skips files whose name already looks renamed (matches
  `/^.+-\d{6}(-\d+)?$/`, i.e. already ends in a 6-digit date, optionally
  with a `-N` suffix) and skips extensions not in `WATCH_EXTS`.
- If `renamingEnabled` is `false` (Rename Toggle switched off), logs and
  skips — this is the actual enforcement point for that toggle.
- Otherwise, after a 300ms delay, builds `{SERVICE}-{MMDDYY}.{ext}`, and
  if that name is already taken, tries `-2`, `-3`, etc. until it finds
  a free one, then renames via `fs.rename`.
- A separate `watcher.on("error", ...)` handler logs watcher errors
  without crashing the whole server — the HTTP/WebSocket side keeps
  working even if the filesystem watch itself hiccups.

Listens on port `3737` (matches the `host_permissions` entry in
`manifest.json` and the URL used everywhere else). Per the notes below,
this is launched silently on Windows startup via `start-hidden.vbs`
through Task Scheduler, so it's always running in the background
without a visible terminal window.

**Dependencies** (`service-relay/package.json`): `ws`, `chokidar`. Run
`npm install` inside `service-relay/` after cloning, before first run.

---

## Note on this document

An earlier version of this file referenced an `our_memory.md` "project
journal" — that file isn't present in the current repository, so
anything not obvious from the code itself should be captured directly
in this file or in `Readme.txt` going forward, rather than assuming a
separate journal exists.