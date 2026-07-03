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
- `"permissions": ["downloads"]` — grants access to the `chrome.downloads`
  API, needed so `background.js` can listen for and rename downloads.
- `"host_permissions": ["http://localhost:3737/*"]` — allows the extension
  (background script) to make network requests to the local relay server
  without a CORS-related permission prompt.
- `"content_scripts"` — defines code that gets injected directly into
  matching web pages:
  - `"matches"` — the extension only activates on `tradetech.net` and
    `mergeimagesonline.com`. If Tradetech changes domains, this must be
    updated or nothing will load.
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
    (and everything else) fires once per frame.
  - `"run_at": "document_idle"` — waits until the page is basically done
    loading (DOM parsed, most resources fetched) before injecting, so
    form fields actually exist when `init()` runs.

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

## background.js — download renaming

Runs in its own isolated worker context (not on the Tradetech page), so
it can't see page DOM — it can only use `chrome.*` APIs and `fetch`.

```js
let lastServiceCode = "";
```
Caches the most recently fetched service code in memory. Reset every
time the service worker restarts (MV3 workers are short-lived).

```js
async function fetchServiceCode() {
    try {
        const res = await fetch("http://localhost:3737/service");
        const data = await res.json();
        lastServiceCode = data.code || "";
        ...
    } catch (err) {
        console.error("❌ Could not reach relay server:", err);
    }
}
```
`GET`s the current service code from the local relay server
(`server.js`). Falls back to `""` if the server responds without a
`code` field. Errors (relay not running) are caught and logged rather
than crashing the listener.

```js
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    fetchServiceCode().then(() => {
        const today = new Date();
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");
        const yy = String(today.getFullYear()).slice(-2);
        const dateStr = `${mm}${dd}${yy}`;

        const extension = downloadItem.filename.split(".").pop();
        const newFilename = `${lastServiceCode}-${dateStr}.${extension}`;

        suggest({ filename: newFilename });
    });

    return true;
});
```
Chrome fires `onDeterminingFilename` right before saving any download,
and gives the listener a chance to override the filename via `suggest()`.
- Builds today's date as `MMDDYY` inline (note: this duplicates logic
  that already exists in `DateUtils.todayMMDDYY()` in `date.js` — but
  `date.js` isn't loaded into the background worker context, since it's
  only listed in `content_scripts`, so it has to be reimplemented here).
- Grabs the file extension by splitting on `.` and taking the last piece.
- Builds the new name as `{SERVICE_CODE}-{MMDDYY}.{ext}`.
- **`return true` is critical** — it tells Chrome "I'm going to call
  `suggest()` asynchronously, wait for me" (because `fetchServiceCode()`
  is a `Promise`). Without it, Chrome would proceed with the default
  filename immediately since the listener returns before `suggest()` is
  ever called.

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
The Tradetech-side half of the download-renaming system (paired with
`background.js`).
- **`sendServiceCode()`** — reads the `service` field's value and
  `POST`s it as JSON (`{ code: value }`) to
  `http://localhost:3737/service`. Logs success or a connection failure
  (relay server not running).
- **`init()`** — sends the current value once on page load.
- **`handle(event)`** — re-sends any time the `service` field itself
  changes.

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

## server.js — the local relay server

A standalone Node.js HTTP server (run separately from the browser, not
part of the extension bundle itself) that exists purely because Edge
(where Tradetech is used) and Chrome (where downloads land) can't share
in-memory state directly.

- `let currentServiceCode = ""` — the entire "database": one string, held
  in memory, lost on server restart.
- CORS headers (`Access-Control-Allow-Origin: *`, etc.) are set on every
  response so any browser extension context can call this server without
  being blocked by cross-origin restrictions.
- Handles `OPTIONS` preflight requests by responding `204 No Content`
  immediately (required by CORS for non-simple requests like POST with a
  JSON body).
- `POST /service` — reads the request body as a stream (`req.on("data"...)`,
  concatenating chunks, then `req.on("end"...)` once the body is fully
  received), parses it as JSON, and stores the `code` field into
  `currentServiceCode`. Responds with `{ success: true }` on success, or
  `400 Invalid request` if the JSON is malformed.
- `GET /service` — returns the current stored code as
  `{ code: currentServiceCode }`.
- Anything else → `404 Not found`.
- Listens on port `3737` (matches the `host_permissions` entry in
  `manifest.json` and the URL used in `background.js` and
  `service-relay-send.js`).
- Per the memory notes, this is launched silently on Windows startup via
  a `start-hidden.vbs` script through Task Scheduler, so it's always
  running in the background without a visible terminal window.

---

## our_memory.md — project journal

Not code — a running log of context, decisions, and TODOs kept between
work sessions. Source of truth for anything not obvious from the code
itself (e.g. why the relay server exists, workflow steps, debugging
history). Kept up to date as the extension evolves.
