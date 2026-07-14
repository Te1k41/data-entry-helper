```
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║    ██████╗  █████╗ ████████╗ █████╗     ███████╗███╗   ██╗████████╗  ║
║    ██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗    ██╔════╝████╗  ██║╚══██╔══╝  ║
║    ██║  ██║███████║   ██║   ███████║    █████╗  ██╔██╗ ██║   ██║     ║
║    ██║  ██║██╔══██║   ██║   ██╔══██║    ██╔══╝  ██║╚██╗██║   ██║     ║
║    ██████╔╝██║  ██║   ██║   ██║  ██║    ███████╗██║ ╚████║   ██║     ║
║    ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝    ╚══════╝╚═╝  ╚═══╝   ╚═╝     ║
║                                                                      ║
║              H E L P E R   —   Chrome Extension                      ║
║            Tradetech Shipping Form Automation v3.0                   ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

# Data Entry Helper

A Chrome extension that automates repetitive data entry tasks on the
Tradetech shipping form. Built to save time, reduce typos, and catch
date mismatches before they become problems.

---

## Table of Contents

```
┌─────────────────────────────────────┐
│  1. What It Does                    │
│  2. File Structure                  │
│  3. How To Install                  │
│  4. How To Use                      │
│  5. How To Add A New Feature        │
│  6. How To Modify Existing Features │
│  7. What To Maintain                │
│  8. What To Watch For               │
│  9. The Service Relay (Background)  │
│ 10. Due Services & The Dashboard    │
└─────────────────────────────────────┘
```

---

## 1. What It Does

```
┌─────────────────────────────────────────────────────────┐
│  FEATURE                    WHAT IT DOES                │
├─────────────────────────────────────────────────────────┤
│  Notes Date Replacement     Replaces old dates in the   │
│                             notes textarea with today   │
├─────────────────────────────────────────────────────────┤
│  SP001 Date Validation      Warns you when SP001's      │
│                             departure date doesn't      │
│                             match any vessel date       │
├─────────────────────────────────────────────────────────┤
│  ETA ↔ ETD Date Syncing     Copies arrival dates to     │
│                             departure fields            │
│                             automatically               │
├─────────────────────────────────────────────────────────┤
│  Port Category Highlighting Highlights the port where   │
│                             the shipping region         │
│                             changes (e.g Asia → USA)    │
├─────────────────────────────────────────────────────────┤
│  Vessel Voyage Correction   Button that fixes lagging   │
│                             vessel dates and updates    │
│                             voyage codes                │
├─────────────────────────────────────────────────────────┤
│  Missing Vessel Date Check  Highlights vessel names     │
│                             that have no departure      │
│                             date set                    │
├─────────────────────────────────────────────────────────┤
│  Vessel To Be Announced     Type ` in a vessel name to  │
│                             fill "VESSEL TO BE           │
│                             ANNOUNCED" + voyage "TBN"    │
├─────────────────────────────────────────────────────────┤
│  Voyage Direction Suffix    Auto-appends N/S/E/W to     │
│                             voyage codes based on the   │
│                             service code (toggleable)   │
├─────────────────────────────────────────────────────────┤
│  Schedule Cascade           Snapshot port date diffs,   │
│                             then recalculate every port │
│                             date from a new SP001 date  │
├─────────────────────────────────────────────────────────┤
│  Resize Toggle Off          Auto-disables the resize    │
│                             switch on                   │
│                             mergeimagesonline.com       │
├─────────────────────────────────────────────────────────┤
│  Service Relay Send         Sends the service code to   │
│                             the local relay server so   │
│                             downloads can be renamed    │
├─────────────────────────────────────────────────────────┤
│  Merge Download Signal      Tells the relay server to   │
│                             clean up duplicate/screen-  │
│                             capture files after a merge │
├─────────────────────────────────────────────────────────┤
│  Upload Proof               One click stages and        │
│                             submits today's proof file  │
│                             in the Support Doc popup     │
├─────────────────────────────────────────────────────────┤
│  Keyboard Field Navigation  Arrow keys + Tab move        │
│                             between SP/SV fields like    │
│                             a spreadsheet                │
├─────────────────────────────────────────────────────────┤
│  Rename Toggle              ON/OFF switch (any site,     │
│                             except Tradetech) for the    │
│                             relay's download renaming    │
└─────────────────────────────────────────────────────────┘
```

---

## 2. File Structure

```
extension/
│
├── manifest.json                    ← Chrome config, load order lives here
│                                       (TWO content_scripts blocks — see below)
└── src/
    │
    ├── utils/                       ← Shared helpers, no features here
    │   ├── date.js                  ← All date math (parse, format, compare)
    │   ├── dom.js                   ← Writing values into form fields
    │   ├── banner.js                ← Warning/success/info/suggestion banners,
    │   │                               the warning registry, and the
    │   │                               hide/show-all-notifications toggle
    │   ├── button.js                ← Create a single styled, draggable button
    │   └── toolbar.js                ← The collapsible "🧰 Tools" panel —
    │                                    every feature button lives inside
    │                                    THIS now, registered via
    │                                    Toolbar.register(), instead of each
    │                                    feature creating its own floating
    │                                    button with createButton()
    │
    ├── core/                        ← Shared logic used by multiple features
    │   └── boundary.js              ← Port repeat detection (sync boundary)
    │
    ├── features/                    ← One file per feature
    │   ├── notes.js                 ← Notes date replacement
    │   ├── validation.js            ← SP001 date validation + the "⚓ Basing
    │   │                               on: [vessel]" info banner
    │   ├── date-syncing.js          ← ETA ↔ ETD syncing
    │   ├── port-highlighting.js     ← Port category highlighting (exposes
    │   │                               .currentHighlightField for other
    │   │                               features to read)
    │   ├── port-no-date.js          ← Flags ports missing BOTH arrival and
    │   │                               departure dates
    │   ├── vessel-correction.js     ← Fix vessel dates button
    │   ├── vessel-no-date.js        ← Flags vessels missing a departure date
    │   ├── vessel-recommendation.js ← "Suggest Vessel" — automatic, reads
    │   │                               PortHighlighting's current selection +
    │   │                               ScheduleCascade's stored diffs
    │   ├── rearrange-vessels.js     ← Manually re-sorts vessel TABLE ROWS by
    │   │                               departure date (moves actual <tr>s)
    │   ├── vessel-to-be-announced.js← Backtick shortcut → TBA vessel/voyage
    │   ├── voyage-direction.js      ← Appends direction suffix to voyage codes
    │   ├── resize-toggle.js         ← Turns off resize switch (image merge site)
    │   ├── schedule-cascade.js      ← Snapshot + cascade port date diffs
    │   ├── keyboard-navigation.js   ← Spreadsheet-style arrow/tab navigation
    │   ├── service-relay-send.js    ← Sends service code to local relay server
    │   ├── merge-download-signal.js ← Signals relay to clean up merge downloads
    │   ├── upload-proof.js          ← Stages + auto-submits today's proof file
    │   ├── auto-nav-schedules.js    ← Auto-clicks "Data Input" → "Sailing
    │   │                               Schedules" once per tab session after login
    │   └── due-service-scanner.js   ← Auto-fills Assigned To, searches with NO
    │                                    date filter, posts every scanned
    │                                    service to the relay (server decides
    │                                    what to keep — see due-services-trim.js)
    │
    ├── background.js                ← Service worker. No longer does anything
    │                                    on its own — see Section 9, this file
    │                                    only exists because MV3 requires SOME
    │                                    service worker if "downloads" is used
    │
    └── main.js                      ← Registers every feature, runs bootstrap

├── features/rename-toggle.js        ← Rename ON/OFF button (SEPARATE
│                                        all-sites-except-Tradetech bundle —
│                                        still part of the main version)
└── rename-toggle-init.js            ← Bootstraps that second bundle

⚠ A trimmed "mini" build also exists (shared with coworkers) that
  removes every relay-dependent file above (service-relay-send.js,
  merge-download-signal.js, upload-proof.js, auto-nav-schedules.js,
  due-service-scanner.js, background.js, AND rename-toggle.js +
  rename-toggle-init.js since that whole bundle is relay-dependent
  too) and needs NO server at all — just the single Tradetech bundle.
  See mini-build/README.txt if you have that package.

service-relay/                       ← Separate local Node.js process, NOT
│                                       part of the Chrome extension bundle.
│                                       Was ONE giant server.js — now split
│                                       into small modules, each with one job:
│
├── server.js                        ← Just wiring: creates the HTTP server,
│                                        routes requests to the right handler,
│                                        attaches WebSocket, starts the watcher
├── config.js                        ← PORT, WATCH_FOLDER, DATA_FOLDER, etc —
│                                        the ONE place to edit machine-specific
│                                        paths
├── relay-state.js                   ← Shared serviceCode/renamingEnabled state
├── relay-socket.js                  ← WebSocket server + message handling
├── download-watcher.js              ← chokidar watcher + auto-rename logic
├── merge-cleanup.js                 ← Dedupes screenshot/numbered downloads
├── due-date-utils.js                ← Tradetech's "DD-MON-YYYY" date format
├── carrier-links.js                 ← Carrier code → schedule/route map URLs
├── due-services-store.js            ← In-memory + disk persistence for the
│                                        full scanned service list (one JSON
│                                        file PER CALENDAR DAY in history/,
│                                        overwritten on same-day rescans)
├── activity-log-store.js            ← Logs every "Mark Done" click with a
│                                        timestamp, for the dashboard's daily
│                                        throughput chart + streak counter
├── current-batch-store.js           ← Owns the persisted "current batch" —
│                                        computed once, shown as-is until
│                                        every item in it is marked done
├── due-services-trim.js             ← computeBatch() — the actual "which
│                                        services form the next batch" logic
│                                        (day-grouping + the 50-combined /
│                                        average / priority-fill rules)
├── routes/
│   ├── relay.js                     ← GET /service, /renaming
│   ├── files.js                     ← GET /find-file, /file (for Upload Proof)
│   ├── due-services.js              ← POST/GET /due-services, mark-done,
│   │                                    undo-done, current-batch, next-batch,
│   │                                    history, activity
│   └── dashboard.js                 ← Serves dashboard/index.html,
│                                        style.css, dashboard.js from disk
├── dashboard/
│   ├── index.html                   ← Dashboard page structure
│   ├── style.css                    ← Dark/ASCII terminal-style theme
│   └── dashboard.js                 ← All client-side logic: charts, sort/
│                                        filter, Mark Done/Undo, batch toggle
├── package.json                     ← Deps: ws, chokidar
└── start-hidden.vbs                 ← Runs server.js silently on login
                                        (Windows Task Scheduler)
```

> Rule of thumb:
> utils    → things that do one job and know nothing about the form
> core     → things shared between features that know about the form
> features → things that do one specific thing on the page
> main.js  → the only file that knows about all Tradetech features
> background.js → present only because MV3 needs it; does nothing itself now
>
> manifest.json still defines TWO content script bundles in the main
> version (the mini build only has the first one):
>   1. Tradetech + mergeimagesonline — everything above `main.js`
>   2. All other sites (except Tradetech) — button.js, rename-toggle.js,
>      rename-toggle-init.js, for the standalone rename ON/OFF switch
>
> service-relay is now split by RESPONSIBILITY, not thrown into one file:
> config/state → routes → stores → server.js just wires them together.
> If you're adding a new relay feature, it almost always means: one new
> function in a routes/ file, maybe a new store module, and one new line
> in server.js's routing — not touching everything at once.

---

## 3. How To Install

```
┌─────────────────────────────────────────────────────┐
│  1. Open Chrome (or Edge)                           │
│  2. Go to chrome://extensions                       │
│  3. Enable "Developer mode" (top right toggle)      │
│  4. Click "Load unpacked"                           │
│  5. Select the extension folder                     │
│  6. Open Tradetech — extension loads automatically  │
└─────────────────────────────────────────────────────┘
```

To reload after making changes:
```
chrome://extensions → click the ↺ refresh icon on the card
```

If you use the download-renaming feature, also make sure the local
relay server is running (see Section 9).

---

## 4. How To Use

### Warning Banner
Appears automatically in the top-right corner when SP001's departure
date doesn't match any vessel departure date, or when a vessel is
missing a departure date. It disappears on its own once you fix it.

```
┌──────────────────────────────────────┐
│  🚢 Vessel date mismatch             │
│  No SV vessel found for 07/04/26     │
└──────────────────────────────────────┘
```

### Date Syncing
Just fill in any arrival date field. The matching departure field
updates automatically. No button needed. SP001 also syncs in
reverse — its departure date fills its arrival date.

### Fix Vessel Dates Button
Appears on the left side of the page. Click it when vessel dates are
lagging behind SP001. It pushes them forward in weekly increments and
updates their voyage codes.

```
┌─────────────────────┐
│ 🛠 Fix Vessel Dates │   ← click me
└─────────────────────┘
```

### Port Highlighting
Runs automatically. The port where your shipping region changes gets
an orange outline. Nothing to click.

### Missing Vessel Date Check
Runs automatically. Any vessel name with no matching departure date
gets a red outline, and the warning banner lists which vessels are
missing dates.

### Vessel To Be Announced
Type a single backtick (`` ` ``) into a vessel name field. It fills
in "VESSEL TO BE ANNOUNCED" and sets the matching voyage field to
"TBN" (only if that voyage field is currently empty). Clearing the
vessel name clears a "TBN" voyage back out.

### Voyage Direction Toggle
```
┌────────────────────────┐
│ 🧭 Direction: ON       │   ← click to toggle ON/OFF
└────────────────────────┘
```
When ON, entering a voyage code on an SV row automatically appends
the service's direction suffix (N/S/E/W), read from the service
code, e.g. "ZX2-N" → voyage "104" becomes "104N".

### Schedule Cascade
```
┌────────────────────────┐        ┌────────────────────────┐
│ 📸 Snapshot Diffs      │        │ 🌊 Cascade Dates       │
└────────────────────────┘        └────────────────────────┘
```
1. Click 📸 Snapshot Diffs once your port date-diff fields are
   correct — it stores each port's offset from SP001 arrival.
2. Change the SP001 arrival date whenever the whole schedule shifts.
3. Click 🌊 Cascade Dates — every stored port date recalculates
   from the new SP001 arrival date automatically.

### Resize Toggle Off (mergeimagesonline.com)
Runs automatically on page load — turns off the resize switch if
it's on, so merged images keep their original size.

### Keyboard Field Navigation
No button — just start using arrow keys inside any SP*/SV* field:
```
↑ / ↓   same field, previous/next row
← / →   previous/next field in the row (by on-page position),
        only once the cursor is already at that edge of the text
Tab     cycles arrival_date ↔ depart_date within/across rows
```
Landing on a field also selects its full text, like a spreadsheet
cell, so you can just start typing to overwrite it.

### Upload Proof
```
┌──────────────────────┐
│ 📤 Upload Proof      │   ← click me
└──────────────────────┘
```
Click it once the service code is set. It asks the local relay
server for today's proof file matching that service code, opens
the Support Document popup, stages the file into the upload input,
and **submits it automatically** — no confirmation click needed.
A green banner confirms the filename that was submitted and clears
itself after a few seconds:
```
┌──────────────────────────────────────┐
│  ✅ Upload submitted                 │
│  MEDEX-E-070326.png                  │
└──────────────────────────────────────┘
```
If no matching file is found, or the relay server isn't reachable,
you'll get an alert instead of a silent failure.

### Rename Toggle (any site except Tradetech)
```
┌────────────────────────┐
│ 📁 Rename: ON          │   ← click to toggle ON/OFF
└────────────────────────┘
```
Appears on every site except Tradetech itself (so it doesn't clash
with the extension's Tradetech-side buttons). Toggling it broadcasts
the new state to the relay server over WebSocket, which turns its
automatic Downloads-folder renaming on or off — the button stays in
sync across every open tab/browser since they all get the same
broadcast.

---

## 5. How To Add A New Feature

Adding a feature is exactly 3 steps.

### Step 1 — Create the file

Create `src/features/your-feature-name.js` and use this template:

```js
// ─────────────────────────────────────────────────────
//  FEATURE: Your Feature Name
//  One sentence describing what this does
// ─────────────────────────────────────────────────────
const YourFeatureName = {

    init() {
        // Runs once on page load
        // Set up buttons, read initial values, etc.
    },

    handle(event) {
        // Runs every time any field changes
        // Check event.target.name to decide if you care

        const { name } = event.target;
        if (name !== "the_field_i_care_about") return;

        // your logic here
    }

    // Optional — only add if you need it:
    // handleBlur(event) { ... }
};
```

### Step 2 — Register it in main.js

Open `src/main.js` and add it to the FEATURES array:

```js
const FEATURES = [
    NotesDateReplacement,
    SP001DateValidation,
    DateSyncing,
    PortHighlighting,
    VesselVoyageCorrection,
    DetectVesselNoDate,
    DetectPortNoDate,
    VesselTBA,
    VDirection,
    ResizeToggleOff,
    ServiceRelaySend,
    ScheduleCascade,
    VesselRecommendation,
    RearrangeVessels,
    MergeDownloadSignal,
    UploadProof,
    KeyboardFieldNav,
    AutoNavSchedules,
    DueServiceScanner,
    YourFeatureName,        // ← add here
];
```

> Note: `RenameToggle` is NOT in this array — it belongs to the
> separate "all sites except Tradetech" content script bundle and
> is bootstrapped directly by `rename-toggle-init.js` instead.
>
> If you're adding a button, register it with `Toolbar.register({ id,
> label, onClick })` inside your feature's `init()` — NOT
> `createButton()` directly. Every feature button lives inside the
> single "🧰 Tools" panel now (see `utils/toolbar.js`), so a fresh
> `createButton()` call would create an orphaned floating button
> outside it.

### Step 3 — Add it to manifest.json

```json
"js": [
  "src/utils/date.js",
  "src/utils/banner.js",
  "src/utils/button.js",
  "src/utils/dom.js",
  "src/core/boundary.js",
  "src/features/notes.js",
  "src/features/validation.js",
  "src/features/date-syncing.js",
  "src/features/port-highlighting.js",
  "src/features/vessel-correction.js",
  "src/features/vessel-no-date.js",
  "src/features/vessel-to-be-announced.js",
  "src/features/voyage-direction.js",
  "src/features/resize-toggle.js",
  "src/features/service-relay-send.js",
  "src/features/schedule-cascade.js",
  "src/features/merge-download-signal.js",
  "src/features/upload-proof.js",
  "src/features/keyboard-navigation.js",
  "src/features/your-feature-name.js",   ← add here, BEFORE main.js
  "src/main.js"
]
```

This is the FIRST `content_scripts` block (matches Tradetech +
mergeimagesonline). There's a SECOND block in manifest.json for
`<all_urls>` (excluding Tradetech) that only loads
`src/utils/button.js`, `src/features/rename-toggle.js`, and
`src/rename-toggle-init.js` — that one is unrelated to the
FEATURES array above and doesn't need touching for a normal
Tradetech feature.

That's it. No other wiring needed.

> Load order rule:
> If your feature uses DateUtils   → it must go after date.js
> If your feature uses showBanner  → it must go after banner.js
> If your feature uses createButton → it must go after button.js
> If your feature uses PortSyncBoundary → it must go after boundary.js
> main.js always goes last

---

## 6. How To Modify Existing Features

### Change the banner style
Open `src/utils/banner.js` — all styling is in one `cssText` block.
Edit colors, font size, padding there. It affects every banner
across the whole extension.

### Change the button style
Open `src/utils/button.js` — same pattern. One `cssText` block
controls all buttons. The hover effect is the two `mouseenter` /
`mouseleave` listeners below it. Buttons are draggable — position
is saved per-button-id in localStorage.

### Change port highlighting colors
Open `src/features/port-highlighting.js` and find:

```js
HIGHLIGHT_STYLE: {
    outline: "2px solid #e67e00",
    backgroundColor: "#fff8e1"
},
```

Edit those two values.

### Add a new port region (e.g. Japan, Korea)
Open `src/features/port-highlighting.js` and find `CATEGORY_RANK`:

```js
CATEGORY_RANK: {
    USA: 1, CANADA: 1,
    JAPAN: 2, EU_UK: 2,
    KOREA: 3,    // ← add new region here with a priority number
},
```

Then add the detection logic in `getPortCategory()`:

```js
getPortCategory(portName) {
    ...
    if (name.endsWith("KOREA")) return "KOREA";  // ← add this
    ...
}
```

### Change the vessel date increment interval
The "Fix Vessel Dates" button currently adds 7 days per step.
Open `src/features/vessel-correction.js` and find:

```js
const newDate = DateUtils.addDays(baseDate, (index + 1) * 7);
//                                                         ↑
//                                                   change this
```

### Add a new priority port region (first_xx_port)
Open `src/features/port-highlighting.js` and find `PRIORITY_PORT_KEYS`:

```js
PRIORITY_PORT_KEYS: ["us", "eu"],
```

Add your new key:

```js
PRIORITY_PORT_KEYS: ["us", "eu", "jp"],
```

Tradetech must also have a `first_jp_port` field on the page for
this to do anything.

### Change the TBA shortcut key
Open `src/features/vessel-to-be-announced.js` and find the check:

```js
if (value.trim() === "`") {
```

Swap the backtick for whatever character you'd rather type.

### Change which download rename format is used
Renaming now happens on the relay server, not in the extension.
Open `service-relay/server.js` and find (it appears twice — in the
file-watcher `add` handler and in `runMergeCleanup()`):

```js
const newName = `${currentServiceCode}-${dateStr}${ext}`;
```

Edit the template string to change the naming pattern. Restart the
relay server after editing (see Section 9).

### Change the Upload Proof confirmation behavior
`src/features/upload-proof.js` currently auto-submits as soon as
the file is staged, showing a temporary success banner instead of
asking for confirmation. Find this block in `tryAutoFill()`:

```js
const submitBtn = document.querySelector('input[type="submit"][value="Upload"]');
if (submitBtn) {
    submitBtn.click();
    ...
```

If you ever want a manual confirm step back, wrap the `.click()` in
a button/banner the user has to click first instead of firing it
immediately.

---

## 7. What To Maintain

```
┌──────────────────────────────────────────────────────────────┐
│  THING TO MAINTAIN         WHY                               │
├──────────────────────────────────────────────────────────────┤
│  EU_COUNTRIES list         EU membership changes. Add or     │
│  (port-highlighting.js)    remove countries as needed.       │
├──────────────────────────────────────────────────────────────┤
│  manifest.json js array    Every new file must be listed     │
│                            here in the right order or it     │
│                            won't load.                       │
├──────────────────────────────────────────────────────────────┤
│  manifest.json matches     The URL pattern that decides      │
│                            which pages the extension runs    │
│                            on. Update if Tradetech changes   │
│                            their URL structure.              │
├──────────────────────────────────────────────────────────────┤
│  Field name selectors      Every querySelector uses a field  │
│                            name like SP001_depart_date. If   │
│                            Tradetech renames their fields,   │
│                            these break silently.             │
├──────────────────────────────────────────────────────────────┤
│  Relay server (port 3737)  Must stay running for download    │
│                            renaming to work across browsers. │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. What To Watch For

### After any Tradetech update — open DevTools and check for:

```
┌──────────────────────────────────────────────────────────────┐
│  RED ERROR                  WHAT IT MEANS                    │
├──────────────────────────────────────────────────────────────┤
│  Cannot read properties      A field Tradetech renamed or    │
│  of null                     removed. Find the querySelector │
│                              that broke and update the name. │
├──────────────────────────────────────────────────────────────┤
│  X is not defined            A file loaded out of order or   │
│                              wasn't added to manifest.json.  │
├──────────────────────────────────────────────────────────────┤
│  Cannot access 'X'           You used a variable before it   │
│  before initialization       was defined. Move the           │
│                              definition above the usage.     │
└──────────────────────────────────────────────────────────────┘
```

### Healthy console output looks like this:

```
🚀 ETA-to-ETD Extension Loaded
📅 Notes dates replaced with today: 06/29/26
🔁 First port SHA repeated at SP004
🔁 Scan limited to 4 ports (boundary at SP004)
🧭 Service: "ZX2" → directional: false
🟡 Highlighted: SP003_port_name (LOS ANGELES, CA USA)
✅ SP001 matches SV001_depart_date
⚓ Case 1: port1=USA, port2=EU_UK, futureOnly=true, base=07/14/26
```

If any of these are missing — that feature isn't running.

### The "styling clobber" bug pattern — watch for this specifically

This has bitten this codebase TWICE already (`port-no-date.js` wiping
out `port-highlighting.js`'s orange highlight, then the identical bug
in `vessel-no-date.js`). Any feature that styles a field
(`.style.outline`, `.style.backgroundColor`) MUST only clear styling
it PREVIOUSLY applied itself — never blindly reset every matching
field's style at the top of a loop, since another feature may have
already styled that same field for a different reason this same tick.

The fix pattern used everywhere now: mark styled fields with a
`data-tt-*` attribute when applying color, and only clear fields that
still carry YOUR OWN marker on the next run:
```js
if (field.dataset.ttMyFeatureFlagged) {
    field.style.outline = "";
    delete field.dataset.ttMyFeatureFlagged;
}
// ...then decide whether to re-apply, setting the marker again if so
```
If you're adding a new feature that colors form fields, copy this
pattern — don't write a fresh "clear everything first" loop.

### The syncing flag

`let syncing = false` in `main.js` prevents infinite loops.
If date syncing ever stops working and you don't see errors —
check if `syncing` is getting stuck on `true`. Add this to
the console to check:

```js
// paste in DevTools console
console.log(syncing);
```

If it says `true` when nothing is happening — reload the extension.

### The relay server

If service codes aren't syncing, or Upload Proof can't find a file,
check the console for:
```
🔌 [Feature]Send disconnected — reconnecting in 3s
❌ ServiceRelaySend WebSocket error
❌ find-file failed: ...
```
Any of these mean `server.js` isn't running, or something else is
on port 3737. Restart it — features will auto-reconnect on their
own once it's back up (each relay-connected feature retries every
3 seconds).
See Section 9 for how the relay is supposed to be running.

---

## 9. The Service Relay (Background)

Edge (where Tradetech lives) and Chrome (where downloads land) are
separate browser processes and can't share data directly. A local
Node.js server sits between them on port 3737. It used to be one
giant `server.js` — it's now split into small single-purpose
modules (see Section 2's file tree), but `server.js` itself is
still the front door: it wires everything together and starts
listening.

```
HTTP:
  GET  /service              → current service code
  GET  /renaming              → whether auto-rename is currently on
  GET  /find-file             → find today's proof file for a service
                                  code (Upload Proof)
  GET  /file                   → stream a specific file's raw bytes
                                  back (Upload Proof)
  POST /due-services            → extension posts a fresh scan (see
                                    Section 10)
  GET  /due-services             → dashboard reads the FULL stored list
  GET  /due-services/current-batch → dashboard's default view (a
                                       PERSISTED snapshot, not live)
  POST /due-services/next-batch     → manually force a new batch
  POST /due-services/mark-done      → dashboard's Mark Done button
  POST /due-services/undo-done      → undo the most recent mark-done
  GET  /due-services/history         → 30-day trend chart data
  GET  /due-services/activity        → daily "done" throughput + streak
  GET  /dashboard, /dashboard/*.css, *.js → serves the dashboard files

WebSocket (ws://localhost:3737):
  Broadcasts { type: "service" }, { type: "renaming" }, and
  { type: "init" } (on connect) to every open tab/extension so
  the service code and the Rename ON/OFF state stay in sync
  across Edge, Chrome, and every open Tradetech tab at once.
  { type: "merge-download" } from merge-download-signal.js
  triggers a 3-second-delayed cleanup pass.
```

**Automatic renaming** — `download-watcher.js`'s chokidar watcher
covers the Downloads folder (`WATCH_FOLDER` in `config.js`, currently
`C:\Users\DELL\Downloads`) for new files matching `WATCH_EXTS`, and
renames them to:
```
{SERVICE_CODE}-{MMDDYY}.{ext}
{SERVICE_CODE}-{MMDDYY}-2.{ext}, -3.{ext}, ... on repeat downloads
```
Example: `MEDEX-E-070326.png`. This is skipped entirely if the
Rename Toggle button has been switched OFF.

**Merge cleanup** (`merge-cleanup.js`) — triggered by the Merge
Download Signal feature after downloading a merged image: deletes
any of today's `screencapture-*` files, then collapses numbered
duplicate downloads (`SERVICE-070326-2.png`, `-3.png`, etc.) down
to a single clean `SERVICE-070326.png` by keeping only the
highest-numbered one and renaming it.

The server is meant to start automatically on login via
`service-relay/start-hidden.vbs` (Windows Task Scheduler), running
node silently with no visible terminal window. If downloads stop
getting renamed, or Upload Proof can't find a file, check that the
server process is still alive before checking anything in the
extension itself.

---

## 10. Due Services & The Dashboard

This is the newer half of the relay server — a full workflow for
tracking which services need updating, built on top of the same
port-3737 process.

### The flow

```
Login to Tradetech
  → auto-nav-schedules.js clicks "Data Input" → "Sailing Schedules"
  → due-service-scanner.js fills Assigned To, searches with NO date
    filter (every service assigned to you comes back — filtering by
    date turned out to silently return only the nearest day's worth,
    not "everything", so it's avoided entirely now)
  → parses the full results table, POSTs every row to the relay as-is
  → the SERVER (not the extension) decides what to keep — see
    due-services-trim.js's computeBatch()
```

**Why the server decides, not the extension:** the trimming/batching
rules are business logic that changes often — keeping it server-side
means tweaking it is a `node server.js` restart, not a whole
extension reload + new tab dance.

### The batch system (`current-batch-store.js`)

The dashboard's default view is a **persisted snapshot**, not a live
recalculation:
- The first time (or once the current batch is 100% marked done),
  `computeBatch()` runs and the result is saved to
  `current-batch.json`.
- Every dashboard load after that shows the SAME batch, refreshed
  only with live done/not-done status — it does not silently change
  underneath you while you're working through it.
- A manual **"Next Batch →"** button on the dashboard forces a new
  one early if you want to move on before finishing.

**`computeBatch()`'s actual rule:**
- Group services by due date, nearest first.
- If the nearest 2 days COMBINED have ≥ 50 services, take the
  AVERAGE of the two counts as the total, filled by PRIORITY — the
  nearest day first (up to its own size or the average, whichever's
  smaller), remainder from the second day.
- Otherwise, keep whole days starting from the nearest one, stopping
  BEFORE any day that would push the total over 40 (a day's services
  are never split across that cutoff).

### Storage (`D:\Tradetech services\`)

```
due-services.json          ← the FULL scanned list, always (nothing
                               is ever trimmed from storage — only
                               the dashboard's default VIEW is)
current-batch.json         ← the persisted batch (see above)
activity-log.json          ← one entry per "Mark Done" click, with a
                               timestamp — powers the daily throughput
                               chart + streak counter (skips weekends)
history/
  due-services-2026-07-10.json  ← ONE file per calendar day (same-day
                                    rescans overwrite, not pile up)
```

### The dashboard (`http://localhost:3737/dashboard`)

Dark/ASCII terminal-style. Sortable/filterable table (filters apply
on Enter, not live per keystroke — avoids losing focus mid-type),
click any service name to copy it to clipboard, "Mark Done" (green)
/ "Undo" (amber, appears once something's done) buttons, plus 4
chart panels: status breakdown, by-carrier, next-14-days histogram,
daily throughput with streak, and a 30-day trend line.

---

```
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   Built with patience, console.log,                  ║
║                                                      ║
║   When in doubt: refresh the extension first.        ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```