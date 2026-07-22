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

  Note: `src/utils/voyage.js` (the shared voyage-code stepping helper)
  and `src/features/date-step-buttons.js` / `voyage-step-buttons.js`
  (the [-]/[+] step buttons) are also in this array now — `voyage.js`
  loads early alongside the other utils (since both step-buttons files
  and `vessel-correction.js` depend on it), and the two step-buttons
  feature files load near the end with the rest of the features.

  **Block 2 — every other site (Rename Toggle + force-tab-links bundle)**:
  - `"matches": ["<all_urls>"]` with `"exclude_matches": ["https://www.tradetech.net/*"]`
    — runs everywhere EXCEPT Tradetech, so the standalone Rename ON/OFF
    button doesn't collide with Tradetech's own set of buttons.
  - `"js"` — `utils/button.js`, `features/rename-toggle.js`,
    `rename-toggle-init.js`, and `features/force-tab-links.js`.
  - `"world": "MAIN"` — **required** for `force-tab-links.js` to work at
    all. Without it, a content script runs in an ISOLATED world with its
    own copy of `window`, completely separate from the page's real
    `window` — wrapping `window.open` there has zero effect on the
    page's own calls. `"world": "MAIN"` puts the script directly in the
    page's own JS context instead, so its `window.open` override is the
    SAME `window.open` the page itself calls.
    > **Bug fix note:** this file existed on disk and shipped in a
    > commit, but was never actually added to this block's `"js"` array
    > (nor was `"world": "MAIN"` set) — so it silently never ran on ANY
    > site. The symptom was popups still opening chrome-less on sites
    > like `ss.shipmentlink.com` even though the fix was "in the repo."
    > Always double check a new file is BOTH on disk AND listed in the
    > right `manifest.json` block before assuming it's live.
  - `"all_frames": true` — also added so a popup triggered from inside
    an iframe on the page (not just the top-level frame) still gets
    intercepted.
  - `"run_at": "document_start"` — needs to wrap `window.open` before
    the page's own scripts get a chance to run and call it; `rename-
    toggle.js`/`button.js`/`rename-toggle-init.js` don't care about
    timing this precisely, so sharing the earlier `run_at` with them is
    harmless (they just create a button once the DOM settles either way).

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

### banner.js — `showBanner` / `removeBanner` + everything built on top

**The base layer:**
- **`showBanner({ title, message })`** — first calls `removeBanner()` to
  guarantee only one banner ever exists at a time (prevents stacking
  duplicates). Builds a `<div id="tt-banner">` with a title line and a
  message line, styles it inline via `cssText` (fixed position, top-right
  at `top: 52px` — shifted down from the original `16px` to leave room
  for the notification hide/show toggle above it — yellow background,
  monospace, drop-shadow "sticker" look), and appends it to `<body>`.
- **`removeBanner()`** — `document.getElementById("tt-banner")?.remove()`
  — optional chaining means this is safe to call even if no banner
  currently exists (no error, just does nothing).

**Warning registry** (`activeWarnings`, `setWarning`, `renderWarnings`,
`showCombinedBanner`) — lets multiple independent features (SP001
mismatch, missing vessel dates, missing port dates) each own one
warning slot by key, without stomping on each other:
```js
setWarning("sp001-mismatch", { title, message })  // problem found
setWarning("sp001-mismatch", null)                // problem cleared
```
`renderWarnings()` shows nothing if `activeWarnings` is empty, the
single warning directly if there's exactly one, or `showCombinedBanner()`
(one banner, each issue as its own block) if there are two or more.

**Success banner** (`showTemporaryBanner`, `#tt-success-banner`, green) —
a one-off confirmation (e.g. "Snapshot saved") that auto-clears after
`durationMs` (default 3000ms) via `successBannerTimer`. Its top position
(`getSuccessBannerTop()`) is computed from the WARNING banner's actual
`getBoundingClientRect()` each time it's shown, so it always stacks
directly below it — the calc treats a `display:none` warning banner
(hidden via the notifications toggle) the same as an absent one,
falling back to a fixed `52px` rather than reading a zero-size rect.

**Info banner** (`setInfoBanner`, `#tt-info-banner`, blue, centered) —
a *persistent* status indicator, not a one-off. Used by
`validation.js` for "⚓ Basing on: [vessel name]". Deliberately
`pointer-events: none` and semi-transparent (`rgba` background/border,
no drop shadow) — if it ever visually overlaps a real form field, the
field always wins, both visually (content shows through) and
functionally (clicks/typing pass straight through the banner). Text
inside has a `text-shadow` halo (repeated blur using the banner's own
background color) so it stays legible even where transparency lets
page content show through underneath it.

**Suggestion banner** (`setSuggestionBanner`, `#tt-suggestion-banner`,
purple, right side) — used by `vessel-recommendation.js`. Same
stacking pattern as the success banner (positioned via
`getSuggestionBannerTop()`, same hidden-warning-banner fallback), kept
as a fully separate element/color from the info banner so "here's what
I'm computing from" (info, centered) and "here's what I'm suggesting"
(suggestion, right side) never visually blend into one thing.

**Notification hide/show toggle** (`createNotificationToggle`,
`toggleNotificationVisibility`, `applyNotificationVisibility`) — a
single always-present small button, fixed `top: 16px; right: 16px`
(above the whole banner stack), that hides/shows all four banner types
at once. State (`notificationsHidden`) persists via `localStorage`
across reloads. Crucially this does NOT stop banners from updating —
`applyNotificationVisibility()` is called at the end of every single
banner-creation function (`showBanner`, `setInfoBanner`,
`setSuggestionBanner`, `showTemporaryBanner`, `showCombinedBanner` — 5
call sites, all funneling through the same one function), so content
keeps refreshing normally underneath while hidden, and clicking "Show"
always reveals current, not stale, information.

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

### voyage.js — `VoyageUtils`
One function: `step(code, delta)`. Bumps a voyage code by `delta`,
handling ANY number of digit runs in the string, not just a single
trailing number:
```js
step(code, delta) {
    if (!code) return code;
    return code.replace(/\d+/g, (digits) => {
        const width = digits.length;
        let num = parseInt(digits, 10) + delta;
        if (num < 0) num = 0;
        return String(num).padStart(width, "0");
    });
}
```
`code.replace(/\d+/g, ...)` finds every run of digits anywhere in the
string and replaces each independently — so `"2698-102"` stepped by
`-1` becomes `"2697-101"` (both numbers step together), `"A102"`
stepped by `-1` becomes `"A101"` (a letter prefix is left alone,
only the digit run changes), and non-numeric codes like `"TBN"` pass
through completely unchanged (no digit runs to replace). Each run's
original zero-padded WIDTH is preserved via `padStart` — `"099"`
stepped by `+1` becomes `"100"` only if that changes the width; a
narrower result gets re-padded back to the original width so leading
zeros aren't lost. Numbers are floored at `0` (never go negative).
Used by both `vessel-correction.js`'s "Fix Vessel Dates" bump and
`voyage-step-buttons.js`'s [-]/[+] buttons — a single shared
implementation instead of two separate ones that could drift apart.

### toolbar.js — `Toolbar`
Replaces individual `createButton()` calls for every Tradetech-page
feature button (7 of them used to float independently around the
page — Fix Vessel Dates, Direction toggle, Snapshot/Cascade, Scan &
Save, Rearrange Vessels, Upload Proof — now they all live inside one
collapsible panel). `rename-toggle.js` does NOT use this — it's a
separate content script bundle (all sites except Tradetech) and
keeps its own independent `createButton()` call.
- **`Toolbar.register({ id, label, onClick })`** — called from a
  feature's `init()` instead of `createButton()`. Adds the action to
  an internal `_actions` array and re-renders. Guards against
  duplicate registration by `id` (same defensive reasoning as
  `createButton`'s multi-frame guard).
- **`Toolbar.updateLabel(id, newLabel)`** — for toggle-style buttons
  (e.g. Direction: ON/OFF) to update their own text after a click,
  without needing to re-register.
- **`_ensurePanel()`** — builds the actual panel `<div>` once (header
  + list container), restoring saved collapsed state and position
  from `localStorage` (`tt-toolbar-collapsed`, `tt-toolbar-pos`) —
  same persistence pattern as `createButton`'s per-button position.
- **`_wireDragAndCollapse()`** — same drag-vs-click distinction as
  `createButton` (4px movement threshold), but a click toggles
  collapsed/expanded instead of firing an action, and a drag moves
  the whole panel instead of one button.
- **`_render()`** — clears and rebuilds the action list every time
  `register()` or `updateLabel()` is called, from the current
  `_actions` array. Simple and correct rather than optimized —
  there are at most ~7 actions, so full re-render is cheap.

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
     `_port_name` field and the port name field of the **truly adjacent
     row above it** (the last row with a smaller row number — not
     necessarily the physically nearest DOM element, since rows can be
     reordered/deleted/re-added), and — only if that represents a
     genuine category transition (not `OTHER`, not the same category as
     the port above) — highlights it and returns immediately, skipping
     the generic scan entirely.
     > **Bug fix note:** this "adjacent row" lookup used to be
     > `portNameFields.find(row < rowNum)`, which — since the array is
     > sorted ascending — always returned **SP001**, regardless of what
     > row was actually adjacent. It worked by coincidence whenever
     > SP001 happened to match the true adjacent port's category, but
     > broke visibly after reordering ports or deleting-then-re-adding
     > a port (which shifts row numbers around). Fixed to grab the
     > **last** row before `rowNum` (`.filter(...).pop()`) instead.
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
- Voyage-code bumping now goes through the shared **`VoyageUtils.step()`**
  helper (see `utils/voyage.js` below) instead of this file's own
  parse/build pair. The old `parseVoyageCode`/`buildVoyageCode` methods
  only handled a SINGLE number plus an optional trailing letter (e.g.
  `"0042A"`) and silently did nothing for any code with more than one
  number in it (e.g. `"2698-102"`) — a real, previously-unnoticed bug,
  since multi-number voyage codes are common. `VoyageUtils.step()` fixes
  this by stepping every digit run in the string, so it's removed here.
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
  7. For each corrected vessel, bumps its voyage code by
     `VoyageUtils.step(vessel.voyageField.value, voyageIncrement)` and,
     if the returned code actually differs, writes it via
     `setFieldValue` and mirrors the new value onto the hidden `PV_`
     duplicate field too (directly via `.value`, not `setFieldValue`,
     since it's a hidden mirror field with no listeners that need
     notifying). This now correctly handles multi-number voyage codes
     like `"2698-102"` (see `utils/voyage.js` below), which the old
     single-number logic silently skipped.
  8. Wraps all the field writes in the `syncing` guard, then calls
     `SP001DateValidation.validate()` at the end since vessel dates just
     changed.
- **`init()`** — creates the "🛠 Fix Vessel Dates" button at
  `top: 312px; left: 30px`.

### vessel-no-date.js — `DetectVesselNoDate`
Flags any vessel that has a name but no departure date.
- **`check()`** — for every `SV*_vessel_name` field with a value: finds
  the matching `SV*_depart_date` field, and if that date field is
  missing or empty, adds the vessel's name to a `missing` list and
  applies a red outline/background to the name field.
  > **Bug fix note:** this used to unconditionally clear EVERY vessel
  > field's outline/background at the top of the loop, on every run.
  > That silently wiped out styling other features apply to the SAME
  > fields — the blue "basing on" highlight (`validation.js`) and the
  > purple "suggested" highlight (`vessel-recommendation.js`) — any
  > time this feature happened to run afterward. Fixed to only clear
  > a field if it carries THIS feature's own `data-tt-vessel-no-date-
  > flagged` marker from a previous run, never touching fields it
  > never styled itself. Same pattern now used by `port-no-date.js`,
  > `validation.js`'s basing-on highlight, and
  > `vessel-recommendation.js`'s suggestion highlight — if you add a
  > new feature that colors a form field, copy this pattern rather
  > than writing a fresh "clear everything first" loop.
- After scanning everything, shows a banner listing all missing-date
  vessels if any were found, or removes the banner if the list is empty.
- Runs once via `init()` and again any time a vessel name or vessel
  departure date field changes (`handle()`).

### port-no-date.js — `DetectPortNoDate`
The port-side equivalent of `vessel-no-date.js` above — same
"only clear what I flagged myself" pattern, applied to
`SP*_port_name` fields instead of `SV*_vessel_name`.
- **`check()`** — for every `SP*_port_name` field with a value: finds
  the matching `SP*_arrival_date` AND `SP*_depart_date` fields. Only
  flags the port if **BOTH** are missing (a port with just one of the
  two set — e.g. a final port with no departure — is normal and
  shouldn't warn). Applies red outline/background, marks the field
  with `data-tt-port-no-date-flagged`.
- This is the feature whose ORIGINAL unfixed version (before the same
  marker-based fix was applied) was the actual root cause of a real
  "port-highlighting stopped working" bug report — it was
  unconditionally wiping `port-highlighting.js`'s orange highlight off
  SP001 every time it ran afterward in the feature list, since SP001
  usually does have valid dates and nothing ever restored the color.

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

### date-step-buttons.js — `DateStepButtons`
Adds small [-]/[+] buttons next to every `SP*_arrival_date` and
`SP*_depart_date` field for nudging a date by day instead of retyping
it. Click = ±1 day, Shift+click = ±7 days.
- **`addButtons()`** — one-time scan on `init()`; wraps every matching
  date field with a minus button, the field itself, then a plus
  button. Guards against double-wrapping via a `dataset.ttStepButtonsAdded`
  marker on the field (same "have I already touched this" pattern used
  elsewhere in the codebase).
- **`step(field, delta)`** — parses the field's current value with
  `DateUtils.parse()`, bails if unparseable, otherwise computes
  `DateUtils.addDays(current, delta)` and writes it back via
  `setFieldValue` (wrapped in the `syncing` guard — see below).
- **`keepArrivalBeforeDepart(field, newDate, deltaDays)`** /
  **`findCounterpartField(field)`** — the crossing-prevention logic.
  When stepping an arrival date past its row's departure date (or a
  departure date before its arrival date), the OTHER field on that same
  SP row is shifted by the SAME delta, so the existing gap between
  arrival and departure is preserved instead of letting one date cross
  over the other and produce a nonsensical (or negative) gap.
  `findCounterpartField()` locates the matching arrival/depart field on
  the same row by name substitution (`SP004_arrival_date` ↔
  `SP004_depart_date`), same pattern as `date-syncing.js`.
- Wraps its own writes in the `syncing` guard (`syncing = true` before,
  `false` after) specifically so `date-syncing.js`'s auto-copy
  (arrival → departure) doesn't fire and fight with the crossing-
  prevention logic's own explicit departure-field write. Also excludes
  Tradetech's hidden `PV_` duplicate fields via
  `:not([name^="PV_"])` in its selector, like every other feature that
  matches fields by name suffix.

### voyage-step-buttons.js — `VoyageStepButtons`
The same [-]/[+] step-button pattern as `date-step-buttons.js` above,
but for `SV*_start_voyage` fields, bumping the voyage code itself
instead of a date.
- **`SELECTOR`**: `'input[name$="_start_voyage"]:not([name^="PV_"])'`.
- **`step(field, delta)`** — reads the current value, calls
  `VoyageUtils.step(current, delta)` (see `utils/voyage.js` above),
  writes the result via `setFieldValue` if it actually changed, and
  manually mirrors the new value onto the matching hidden `PV_` field
  (`pvField.value = field.value`) in case `voyage-direction.js`'s
  reaction to the change altered the value further (e.g. appending a
  direction suffix) — reading the value back from the live field
  after the write, rather than using the value computed a moment
  earlier, keeps the mirror in sync with whatever it actually ended up
  being.
- **Deliberately does NOT use the `syncing` guard** (unlike
  `date-step-buttons.js`) — `voyage-direction.js` reacting to a voyage
  code change (appending N/S/E/W) is normal, wanted behavior here, not
  something to suppress.
- **Shift+click magnitude**: `makeStepButton()`'s click handler checks
  `e.shiftKey` and, if held, calls `getShiftMagnitude()` instead of
  stepping by `1`:
  ```js
  getShiftMagnitude() {
      const increment = VesselVoyageCorrection.getVoyageIncrement();
      return increment > 0 ? increment : 1;
  }
  ```
  Reads the SAME `voyage_increment_by` field "Fix Vessel Dates" uses,
  falling back to `1` if that field is missing, empty, zero, or
  negative — so Shift+click always does SOMETHING sensible rather than
  a no-op jump of `0`.

### force-tab-links.js — MAIN-world script (not in `FEATURES`, not Tradetech-specific)
Runs on every site EXCEPT Tradetech (see manifest.json's Block 2
above) — a small, self-contained IIFE, not a `FEATURES`-array feature
object, since it isn't Tradetech-specific and doesn't use the
`change`/`blur` event bus at all.
```js
(function () {
    const realOpen = window.open.bind(window);
    window.open = function (url, target, features, ...rest) {
        if (features) {
            return realOpen(url, "_blank", "", ...rest);
        }
        return realOpen(url, target, features, ...rest);
    };
})();
```
Some sites open links via `window.open(url, name, "toolbar=no,width=...")`
instead of a plain `<a href>` — Chrome honors that features string and
opens a small chrome-less popup window (no tab strip, no address bar,
no extension icons). This wraps the page's own `window.open` so ANY
call that passes a non-empty `features` string is redirected to open
as a normal background tab instead; a plain `window.open(url)` call
with no features string already opens as a tab in Chrome, so those are
left untouched. Must run with `"world": "MAIN"` (see manifest.json
notes above) to see and wrap the page's REAL `window.open` — an
isolated-world content script would only be wrapping its own private
copy, with zero effect on the page.

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

### vessel-recommendation.js — `VesselRecommendation`
Suggests up to 2 vessels near a "base date" — fully automatic (no
button), running on `init()` and on relevant field changes, PLUS
triggered directly by `ScheduleCascade.storeDiffs()` at the moment
fresh diffs are saved (that's a button click internal to a different
feature, not a field-change event this one would otherwise ever hear).
- **Two base-date cases**, decided by which port `PortHighlighting.
  currentHighlightField` currently points to:
  - **Case 1 (highlighted port is SP001)** — base date = today. If
    SP002's category (via `PortHighlighting.getPortCategory()`) is a
    DIFFERENT special category (USA/Japan/EU_UK) than SP001's,
    restrict to future-only (today → +7 days); otherwise allow both
    past and future (today ±7 days).
  - **Case 2 (highlighted port is anywhere else)** — base date =
    today minus the stored DEPART diff (from `ScheduleCascade.diffs`)
    of the row directly ABOVE the highlighted one. Always future-only.
    If no diff is stored yet for that row (Snapshot Diffs hasn't been
    clicked), quietly does nothing rather than showing an alarming
    "no data" banner on every keystroke.
- **Candidate selection** — every `SV*_depart_date` with a value in
  the computed window, sorted by absolute distance from the base
  date, top 2 kept. Each labeled `Past`/`Future`/`Today` — but
  `"Today"` is ONLY used when the base date genuinely IS today's real
  calendar date (Case 1). Case 2's base date is a calculated target,
  often NOT today, so an exact match there is labeled `"On base
  date"` instead — using "Today" there would be actively misleading,
  not just imprecise (this was a real reported bug: a Case 2 vessel
  8 days in the past was showing as "Today (07/06/26)"). The banner
  title always shows the actual base date too, so there's never
  ambiguity about what the labels are relative to.
- **Highlighting** — the top candidates' vessel name fields get a
  purple outline/background (`data-tt-suggested` marker, same
  "only clear what I flagged" pattern as `vessel-no-date.js`).
- Posts results via `setSuggestionBanner()` (right side, purple) —
  see `banner.js`'s notes above.

### rearrange-vessels.js — `RearrangeVessels`
Manual button ("🔀 Rearrange Vessels", now living in the shared
toolbar). Physically reorders the vessel table's `<tr>` ROWS by
departure date — not a values-swap. This was a deliberate design
choice: moving the actual DOM row means any hidden fields inside that
row (vessel IDs, etc. that this codebase doesn't necessarily know
about) travel with it automatically, since it's the same element just
relocated — a values-swap approach would risk a row visually showing
one vessel's name while secretly still carrying a different vessel's
hidden ID underneath.
- **`rearrange()`** — collects every `SV*_vessel_name` field (not
  `PV_`), pairs each with its parsed depart date (or `null`) and its
  `<tr>` via `.closest("tr")`. Stable sort: dated rows ascending
  first, undated rows pushed to the end in their ORIGINAL relative
  order (tie-broken by an `index` field captured before sorting).
- **The actual move**: `parent.appendChild(row.tr)` called in sorted
  order. `appendChild` on a node ALREADY in the DOM **moves** it
  rather than cloning/duplicating it — calling it once per row, in
  the desired final order, leaves the parent's children in exactly
  that order when done.
- Manual-only, never automatic — reordering rows is more invasive
  than anything else this extension does, so it's deliberately not
  wired to any field-change event.

---

## boundary.js — see "core/boundary.js" above (same file)

---

## service-relay/ — the local relay server (now modular)

Used to be one ~600-line `server.js`. Now split by responsibility —
`server.js` itself is just wiring (create the HTTP server, route to
the right handler, attach WebSocket, start the watcher), around 85
lines. Same overall purpose as before: Edge (where Tradetech is used)
and Chrome (where downloads land) can't share in-memory state
directly, so this sits between them on port 3737 — but it's grown
into a whole due-services/dashboard system on top of that original
service-code-relay purpose.

### config.js
`PORT` (3737), `WATCH_FOLDER` (`C:\Users\DELL\Downloads` —
machine-specific, edit here if this runs on a different computer),
`WATCH_EXTS`, `DATA_FOLDER` (`D:\Tradetech services`),
`HISTORY_FOLDER`, `DUE_SERVICES_FILE`, `ACTIVITY_LOG_FILE`,
`CURRENT_BATCH_FILE`. The one file to touch for any path change.

### relay-state.js
Just `{ currentServiceCode: "", renamingEnabled: true }` — a plain
mutable object (not getters/setters), exported once and shared by
reference. `relay-socket.js`, `routes/relay.js`,
`download-watcher.js`, and `merge-cleanup.js` all `require()` this
same object and read/write its properties directly.

### relay-socket.js
Owns the WebSocket server (`new WebSocket.Server({ server })` —
shares the HTTP server/port). On `connection`, sends
`{ type: "init", serviceCode, renamingEnabled }` immediately so a
fresh tab syncs without waiting for the next change. Handles
`type: "service"` / `"renaming"` (update `relay-state` + rebroadcast
to every other client) and `type: "merge-download"` (schedules
`runMergeCleanup()` after a 3s delay).

### download-watcher.js
The `chokidar.watch(WATCH_FOLDER, { awaitWriteFinish: {...} })`
logic. Skips already-renamed files (regex `/^.+-\d{6}(-\d+)?$/`) and
extensions not in `WATCH_EXTS`. Skips entirely if
`relayState.renamingEnabled` is false — this is the actual
enforcement point for the Rename Toggle. Otherwise builds
`{SERVICE}-{MMDDYY}.{ext}`, trying `-2`, `-3`, ... if that name's
taken, after a 300ms settle delay.

### merge-cleanup.js
`runMergeCleanup()` — triggered via the WebSocket `merge-download`
message. Deletes today's `screencapture-*` files, then collapses
numbered duplicate downloads down to one clean
`{SERVICE}-{MMDDYY}.{ext}` by keeping only the highest-numbered one.

### due-date-utils.js
Tradetech's `"DD-MON-YYYY"` format (e.g. `"11-JUL-2026"`) —
`parseTTDate()` / `formatTTDate()`. Used everywhere the due-services
system needs to compare or generate dates, including
`due-services-trim.js` and the mark-done/undo-done handlers.

### carrier-links.js
Just data — `{ CODE: { schedule: [...], routeMap: [...] } }` for
every carrier code seen in Kai's assigned services. Some carriers
have multiple links (different trade lanes); the dashboard renders
one link per array entry.

### due-services-store.js
The FULL scanned list, in memory + persisted to disk. Exposes
`getAll()`/`setAll()`/`findByRecord()` rather than a raw exported
array, since the whole list gets wholesale-replaced on every scan
(not just mutated). **`save()`** writes `due-services.json`
(overwritten every time) AND `history/due-services-YYYY-MM-DD.json`
— **one file per calendar day**, overwritten if you rescan again the
same day (this used to be one file per SCAN, piling up fast — fixed
to stop that). **`loadFromDisk()`** runs once on server startup so
the dashboard isn't empty after a restart.

### activity-log-store.js
Append-only log of `{ record, service, at: ISOString }` — one entry
per "Mark Done" click. Powers the dashboard's daily-throughput chart
and streak counter. Deliberately separate from `due-services-store`
since this needs to track real EVENTS over time, not current state.

### current-batch-store.js
Owns the **persisted** weekly batch state — a full Mon-Fri week
computed once via `computeWeeklyPlan()` (see `due-services-trim.js`
below), stored as 5 per-day RECORD ID lists (`dayRecordLists`), and
worked through sequentially: whichever day-slot you're on
(`state.dayIndex`) is what the dashboard shows, and completing every
item in it auto-advances to the next day.
- **`startNewWeek(allServices, asOfDayIndex = null)`** — computes a
  fresh `computeWeeklyPlan()`, stores its per-day record IDs, and
  persists `backlogCount` alongside them (not just used once and
  discarded) so the workload chart can describe the exact same plan
  later without recomputing anything. `asOfDayIndex` (0=Monday..4=Friday),
  when given, is threaded into `computeWeeklyPlan()` as the domino-
  balance anchor AND used as the state's starting `dayIndex` — this is
  what the dashboard's Recalculate weekday-picker drives (see below).
- **`getCurrentBatch(allServices)`** — loads the stored state (via
  `ensureCurrentWeekState`, which starts a fresh week only when the
  stored `weekStart` no longer matches the real current week),
  auto-advances past any day-slot that's now fully done
  (`advancePastDone`), and returns the batch for whichever day it lands
  on (`buildBatchForDay` — that day's own items plus every still-undone
  leftover from earlier days, so nothing gets silently dropped).
- **`goToDay` / `advanceToNextBatch` / `goToPreviousBatch`** — explicit
  navigation, all funneling through `goToDay()`, which does NOT
  auto-skip done days (navigating is an explicit choice, unlike
  auto-advance).
- **`getStoredWeeklyBreakdown(allServices)`** — rebuilds the SAME
  Mon-Fri workload breakdown the dashboard's chart displays, but reads
  it straight from the PERSISTED `dayRecordLists`/`dayIndex` instead of
  independently recomputing `computeWeeklyPlan("today")`.
  > **Bug fix note:** the chart used to call `computeWeeklyPlan(all, 0)`
  > fresh every time it loaded, completely separate from whatever
  > anchor day the actual current batch was really built with. Once
  > Recalculate could be told to use a chosen weekday as its anchor,
  > that meant the chart and the real batch could disagree — the real
  > batch would reflect the chosen anchor, but the chart would still
  > show a plain real-today split next to it. Reading from the same
  > persisted state the batch itself uses keeps the two permanently in
  > sync, whatever anchor produced that state.
- **`recalculateWeek(allServices, asOfDayIndex = null)`** — the manual
  "Recalculate" button's handler. Always rebuilds from scratch
  (unlike `ensureCurrentWeekState`, which only recomputes when the
  week has genuinely changed) — same effect as deleting
  `current-batch.json` by hand. `asOfDayIndex` is the dashboard's
  weekday-picker value (`null`/omitted = real today, unchanged
  default behavior).

### due-services-trim.js
`computeWeeklyPlan(services, weekOffset = 0, asOfDayIndex = null)` —
the actual "how is this week's work split across Mon-Fri" business
logic, called by `current-batch-store.js` whenever a new weekly plan
needs computing (not live on every dashboard load):
1. Groups services by due date into the current week's 5 weekday
   slots, nearest-due-first within each slot.
2. Computes each day's TARGET share of the week's total workload, then
   balances the whole week domino-style: every item across every
   still-available day (today onward — you can't redistribute onto a
   day that's already passed) is pooled together, nearest-due-first,
   and each day's slot is filled from the front of that pool in order.
   A slow day (e.g. nothing due Monday) pulls tomorrow's work forward
   to fill its share, instead of leaving itself empty while a later
   day (which merely happens to have more of its OWN items) stays
   overloaded.
   > This pooling approach replaced an earlier "each day keeps up to
   > its own target from its own items, shortfalls topped up from a
   > surplus pool in day order" version — the earlier version could
   > still hand a day items that weren't actually its nearest-due ones
   > if an earlier day's surplus got pooled before a later day's more
   > urgent items did. Pooling ALL available items first, sorted
   > nearest-due, and filling day slots front-to-back from that single
   > pool guarantees the nearest-due items always land in the earliest
   > possible day slot.
3. **`weekOffset`** (Next/Previous Week preview buttons) — any nonzero
   value previews a hypothetical week rather than the real current
   one. A preview always treats that week's Monday as "today" (whole
   week balanced together) and never rolls in backlog, since "overdue
   right now" is only meaningful for the actual current day.
4. **`asOfDayIndex`** (0=Monday..4=Friday) — lets the real current
   week's (`weekOffset === 0` only) domino-balance anchor be a CHOSEN
   weekday instead of whatever the real calendar day happens to be
   (the dashboard's Recalculate weekday-picker). Backlog (services
   overdue from BEFORE this week's Monday) still always comes from the
   REAL current date regardless of this override — an anchor override
   changes "which day are we balancing as if it were today," not
   "what's actually overdue right now."

### routes/relay.js
`GET /service` → `{ code }`, `GET /renaming` → `{ enabled }` — thin
read-only wrappers around `relay-state.js`.

### routes/files.js
`GET /find-file?service=X` — regex-matches today's proof file for a
service code in `WATCH_FOLDER`. `GET /file?name=X` —
`path.basename(name)` first (prevents path traversal), then streams
the file back. Both used by `upload-proof.js`.

### routes/due-services.js
The biggest route file — POST/GET `/due-services`, mark-done,
undo-done, current-batch, next-batch, recalculate-week, history,
activity, weekly-plan. A few things worth knowing:
- **`handleRecalculateWeek`** is `async` now — reads an optional JSON
  body `{ dayIndex: 0-4 }` (the dashboard's weekday-picker) via
  `readBody(req)`, wrapped in try/catch so a missing or invalid body
  just falls back to `null` (today, for real — original behavior)
  rather than erroring. Threads `dayIndex` straight through to
  `currentBatchStore.recalculateWeek(all, dayIndex)`.
- **`handleGetWeeklyPlan`** — for the real current week (`?offset=0` or
  omitted) now reads `currentBatchStore.getStoredWeeklyBreakdown(all)`
  (the persisted state) instead of calling `computeWeeklyPlan` fresh,
  so the chart always matches whatever anchor the real batch is
  currently using. Any other `?offset=N` (Next/Previous Week preview)
  still calls `computeWeeklyPlan(all, weekOffset)` fresh each time,
  since there's no persisted state for a hypothetical week —
  unaffected by this change. `server.js`'s route match for this
  endpoint had to change from an exact `===` check to `.startsWith(...)`
  to allow the `?offset=N` query string through at all.
- **`handlePostDueServices`** — merges the incoming FULL scan with
  whatever's already stored, specifically to preserve `done`
  overrides: if a service was marked done locally and Tradetech's
  real date hasn't caught up to the local target yet, the local
  override survives the merge; once Tradetech's real date matches or
  passes it, the override is dropped and the real data is trusted
  again. Nothing is ever trimmed from STORAGE here — trimming only
  happens for the dashboard's batch VIEW, via
  `current-batch-store.js`, kept deliberately separate after an
  earlier version accidentally combined the two and silently
  discarded 226 of 286 real services.
- **`handleMarkDone`** — saves a `_preDoneSnapshot` on the entry
  (previous `nextUpdateDate` + `done` state) the FIRST time an item
  is marked done, so `handleUndoDone` can restore it exactly. Only
  snapshots once — clicking Mark Done again on an already-done item
  won't overwrite a real undo point.
- **`handleGetHistory`** — reads `history/due-services-YYYY-MM-DD.json`
  directly (one file per day, see `due-services-store.js` above),
  builds exactly 30 points (today back 29 days), emitting
  `{ noScan: true }` placeholders for days with no file — this is
  what gives the dashboard's trend chart genuine gaps instead of
  silently compressing the timeline.
- **`handleGetActivity`** — aggregates `activity-log-store.js`'s raw
  events into daily counts, plus a streak (consecutive days with ≥1
  done, counting backwards from today). Weekends are explicitly
  skipped in the streak count — they neither extend nor break it, so
  a Friday→Monday run of activity still counts as unbroken.

### routes/dashboard.js
Serves `dashboard/index.html`, `style.css`, `dashboard.js` straight
from disk on every request (not cached in memory at startup) — a
deliberate choice so editing the dashboard's look/behavior just needs
a browser refresh, no server restart.

### dashboard/ (the actual dashboard UI)
Dark/ASCII terminal aesthetic. `dashboard.js` fetches `/due-services`
(full list, for the charts), `/due-services/current-batch` (the
persisted batch, drives the default filtered table view — "Show All"
toggles to everything), `/due-services/history`, `/due-services/activity`,
and `/due-services/weekly-plan` (workload chart, supports `?offset=N`
for the Next/Previous Week preview buttons) on load. Filters apply on
**Enter**, not live per-keystroke (an earlier live-filter version
caused the input to lose focus every character, since `render()`
rebuilds the whole table via `innerHTML` including the filter inputs
themselves). Clicking a service name copies it to clipboard.
"Mark Done" (green) swaps to "Undo" (amber) once a row is done.

**Recalculate weekday-picker** — `index.html` has a `#recalcDaySelect`
dropdown right before the Recalculate button ("Today (auto)" plus
Monday–Friday). `recalculateWeek()` in `dashboard.js` reads it, builds
a `dayIndex` (`null` for "auto"), shows a confirm dialog naming the
chosen anchor day, and POSTs `{ dayIndex }` as the request body to
`/due-services/recalculate-week`. `RECALC_DAY_NAMES` maps 0-4 to
weekday names for that confirm-dialog text.

**Dependencies** (`service-relay/package.json`): `ws`, `chokidar`. Run
`npm install` inside `service-relay/` after cloning, before first run.

---

## Note on this document

An earlier version of this file referenced an `our_memory.md` "project
journal" — that file isn't present in the current repository, so
anything not obvious from the code itself should be captured directly
in this file or in `Readme.txt` going forward, rather than assuming a
separate journal exists.