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
║              H E L P E R   —   Chrome/Edge Extension                 ║
║            Tradetech Shipping Form Automation v2.0                   ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

# Data Entry Helper

A Chrome/Edge extension that automates repetitive data entry tasks on
the Tradetech shipping form. Built to save time, reduce typos, and
catch date mismatches before they become problems.

---

## Table of Contents

```
┌─────────────────────────────────────┐
│  1. What It Does                    │
│  2. File Structure                  │
│  3. How To Install                  │
│  4. How To Use                      │
│  5. On-Page Buttons                 │
│  6. How To Add A New Feature        │
│  7. How To Modify Existing Features │
│  8. What To Maintain                │
│  9. What To Watch For               │
│ 10. Service Relay System            │
└─────────────────────────────────────┘
```

---

## 1. What It Does

```
┌────────────────────────────────────────────────────────────────┐
│  FEATURE                     WHAT IT DOES                      │
├────────────────────────────────────────────────────────────────┤
│  Notes Date Replacement      Replaces old dates in the notes   │
│                               textarea with today's date        │
├────────────────────────────────────────────────────────────────┤
│  SP001 Date Validation       Warns you when SP001's departure  │
│                               date doesn't match any vessel     │
│                               departure date                    │
├────────────────────────────────────────────────────────────────┤
│  ETA ↔ ETD Date Syncing      Copies arrival dates to departure │
│                               fields automatically. SP001 syncs │
│                               in reverse (depart → arrival)     │
├────────────────────────────────────────────────────────────────┤
│  Port Category Highlighting  Highlights the port where the     │
│                               shipping region changes           │
│                               (e.g. Asia → USA)                 │
├────────────────────────────────────────────────────────────────┤
│  Vessel Voyage Correction    Button that fixes lagging vessel  │
│                               dates and updates voyage codes    │
├────────────────────────────────────────────────────────────────┤
│  Missing Vessel Date Alert   Highlights vessels that have a    │
│                               name but no departure date, and   │
│                               banners the list                  │
├────────────────────────────────────────────────────────────────┤
│  Vessel "TBA" Shortcut       Typing a backtick (`) in a vessel │
│                               name fills "VESSEL TO BE          │
│                               ANNOUNCED" and sets voyage "TBN"  │
├────────────────────────────────────────────────────────────────┤
│  Voyage Direction Suffix     Auto-appends N/S/E/W to voyage    │
│                               codes when the service is         │
│                               directional. Toggleable on/off    │
├────────────────────────────────────────────────────────────────┤
│  Resize Toggle Off           Auto-disables the image resize    │
│                               switch on mergeimagesonline.com   │
├────────────────────────────────────────────────────────────────┤
│  Service Relay Send          Sends the service code to the     │
│                               local relay server so downloaded  │
│                               file renaming can use it          │
├────────────────────────────────────────────────────────────────┤
│  Schedule Cascade            Snapshot port date intervals, then│
│                               reapply them anchored to a new    │
│                               SP001 date                        │
└────────────────────────────────────────────────────────────────┘
```

Plus a background script that renames downloaded files as
`{SERVICE_CODE}-{MMDDYY}.{ext}` using the service code sent by the
relay feature above.

For a line-by-line explanation of every file, see `CODE_NOTES.md`.

---

## 2. File Structure

```
extension/
│
├── manifest.json                    ← Chrome config, load order lives here
├── README.md / Readme.txt           ← this file
├── CODE_NOTES.md                    ← detailed per-file/per-feature notes
├── wheel.svg                        ← custom icon (word-masked ship wheel)
│
├── service-relay/
│   ├── server.js                    ← local Node.js relay server (port 3737)
│   └── start-hidden.vbs             ← launches server silently on Windows startup
│
└── src/
    │
    ├── background.js                ← renames downloads using service code + today's date
    ├── main.js                      ← registers all features, runs bootstrap
    │
    ├── utils/                       ← Shared helpers, no features here
    │   ├── date.js                  ← All date math (parse, format, compare)
    │   ├── dom.js                   ← Writing values into form fields
    │   ├── banner.js                ← Show/hide the warning banner
    │   └── button.js                ← Create styled, draggable buttons
    │
    ├── core/                        ← Shared logic used by multiple features
    │   └── boundary.js              ← Port repeat detection (sync boundary)
    │
    └── features/                    ← One file per feature
        ├── notes.js                 ← Notes date replacement
        ├── validation.js            ← SP001 date validation
        ├── date-syncing.js          ← ETA ↔ ETD syncing
        ├── port-highlighting.js     ← Port category highlighting
        ├── vessel-correction.js     ← Fix vessel dates button
        ├── vessel-no-date.js        ← Missing vessel date detection
        ├── vessel-to-be-announced.js← Backtick → TBA vessel shortcut
        ├── voyage-direction.js      ← Direction suffix toggle
        ├── resize-toggle.js         ← mergeimagesonline.com resize switch
        ├── service-relay-send.js    ← Sends service code to relay
        └── schedule-cascade.js      ← Snapshot/cascade port date diffs
```

> Rule of thumb:
> utils    → things that do one job and know nothing about the form
> core     → things shared between features that know about the form
> features → things that do one specific thing on the page
> main.js  → the only file that knows about all features

---

## 3. How To Install

```
┌─────────────────────────────────────────────────────┐
│  1. Open Chrome or Edge                             │
│  2. Go to chrome://extensions (or edge://extensions)│
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
relay server is running — see section 10.

---

## 4. How To Use

### Warning Banner (SP001 Date Validation)
Appears automatically in the top-right corner when SP001's departure
date doesn't match any vessel departure date. It disappears on its own
once you fix the date.

```
┌──────────────────────────────────────┐
│  🚢 Vessel date mismatch             │
│  No SV vessel found for 07/04/26     │
└──────────────────────────────────────┘
```

The same banner slot is reused by the Missing Vessel Date Alert and by
Schedule Cascade for its own success/warning messages — only one banner
shows at a time.

### Date Syncing
Just fill in any arrival date field. The matching departure field
updates automatically. SP001 is the exception — filling in its
*departure* date automatically fills its *arrival* date instead. No
button needed for either direction.

### Port Highlighting
Runs automatically. The port where your shipping region changes gets
an orange outline. Nothing to click.

### Missing Vessel Date Alert
Runs automatically. Any vessel with a name but no departure date gets a
red outline, and a banner lists every vessel missing a date.

### Vessel "TBA" Shortcut
Type a single backtick (`` ` ``) into any vessel name field to instantly
fill in "VESSEL TO BE ANNOUNCED" and set that vessel's voyage code to
"TBN" (only if the voyage field was empty). Clearing a TBA vessel name
also clears its "TBN" voyage code.

### Resize Toggle Off
Runs automatically on mergeimagesonline.com — turns off the image
resize switch if it's on when the page loads.

### Service Relay Send
Runs automatically whenever the `service` field is filled in or
changed — sends the code to the local relay server so downloads can be
renamed correctly. Requires the relay server to be running (section 10).

---

## 5. On-Page Buttons

```
┌──────────────────────┬──────────┬──────┬──────────────────────────┐
│  BUTTON               │  TOP     │ LEFT │ FEATURE FILE             │
├──────────────────────┼──────────┼──────┼──────────────────────────┤
│  🛠 Fix Vessel Dates  │  312px   │ 30px │ vessel-correction.js     │
│  🧭 Direction: ON/OFF │  350px   │ 30px │ voyage-direction.js      │
│  📸 Snapshot Diffs    │  390px   │ 30px │ schedule-cascade.js      │
│  🌊 Cascade Dates     │  430px   │ 30px │ schedule-cascade.js      │
└──────────────────────┴──────────┴──────┴──────────────────────────┘
```

All buttons are draggable — click and hold to reposition, release to
drop. New positions are remembered per-button (stored in localStorage)
across page reloads. A quick click (no drag) triggers the button's
action as normal.

### 🛠 Fix Vessel Dates
Click when vessel dates are lagging behind SP001. Finds the vessel with
the latest ("furthest") date as an anchor, then pushes every lagging
vessel forward in weekly (7-day) increments from that anchor, updating
each vessel's voyage code by the configured increment along the way.

### 🧭 Direction: ON/OFF
Toggles whether voyage codes automatically get a compass-direction
letter (N/S/E/W) appended when the `service` field ends in a matching
direction suffix (e.g. `ABC-N`). Starts ON by default each page load.

### 📸 Snapshot Diffs
Reads every port row's `_arrival_date_diff` / `_depart_date_diff` field
(day-offsets from SP001, as calculated by Tradetech) and stores them in
memory. Also runs automatically once on page load.

### 🌊 Cascade Dates
Requires a snapshot to exist first. Recalculates every stored port's
arrival/departure dates as `SP001_arrival_date + stored diff`, and
writes them all in. Useful when a shipment's whole schedule shifts but
the relative spacing between ports stays the same.

---

## 6. How To Add A New Feature

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
    VesselTBA,
    VDirection,
    ResizeToggleOff,
    ServiceRelaySend,
    ScheduleCascade,
    YourFeatureName,        // ← add here
];
```

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
  "src/features/your-feature-name.js",   ← add here, BEFORE main.js
  "src/main.js"
]
```

That's it. No other wiring needed.

> Load order rule:
> If your feature uses DateUtils           → it must go after date.js
> If your feature uses showBanner          → it must go after banner.js
> If your feature uses createButton        → it must go after button.js
> If your feature uses PortSyncBoundary     → it must go after boundary.js
> If your feature writes to fields          → use setFieldValue (dom.js)
> main.js always goes last

---

## 7. How To Modify Existing Features

### Change the banner style
Open `src/utils/banner.js` — all styling is in one `cssText` block.
Edit colors, font size, padding there. It affects every banner
across the whole extension (including Missing Vessel Dates and
Schedule Cascade messages).

### Change the button style
Open `src/utils/button.js` — same pattern. One `cssText` block
controls all buttons. The hover effect is the two `mouseenter` /
`mouseleave` listeners below it. Drag behavior lives in the same file.

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

### Change the vessel date increment interval
The "Fix Vessel Dates" button currently adds 7 days per step.
Open `src/features/vessel-correction.js` and find:

```js
const newDate = DateUtils.addDays(baseDate, (index + 1) * 7);
//                                                         ↑
//                                                   change this
```

### Change the vessel "TBA" shortcut trigger key
Open `src/features/vessel-to-be-announced.js` and find:

```js
if (value.trim() === "`") {
```

Change `` "`" `` to whatever character you'd rather type.

### Change button positions
Open the relevant feature file and edit the `top` / `left` values
passed to `createButton(...)`. Note: if a user has already dragged a
button, their saved localStorage position will override this default
until they clear it.

---

## 8. What To Maintain

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
│                            on. Update if Tradetech or         │
│                            mergeimagesonline.com change       │
│                            their URL structure.               │
├──────────────────────────────────────────────────────────────┤
│  Field name selectors      Every querySelector uses a field  │
│                            name like SP001_depart_date. If   │
│                            Tradetech renames their fields,   │
│                            these break silently.             │
├──────────────────────────────────────────────────────────────┤
│  Relay server (port 3737)  Must stay running for download    │
│                            renaming and service code sync    │
│                            to work. See section 10.           │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. What To Watch For

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
🛠 Fix Vessel Dates button added
📦 Diffs stored: {...}
```

If any of these are missing — that feature isn't running.

### Known issue: extension loads multiple times
`all_frames: true` in manifest.json means the content script injects
into every iframe on the page, not just the top-level document. If
Tradetech's page has nested iframes, you'll see the load banner and
init logs fire 2-3 times. This is cosmetic (each feature still guards
against duplicate buttons/banners) but noisy in the console. Fix would
be narrowing `matches` or setting `all_frames: false` if Tradetech
doesn't actually need iframe injection — not yet done, still open.

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

---

## 10. Service Relay System

**Problem:** Edge (where Tradetech is used) and Chrome (where downloads
land) are separate browsers and can't share data directly.

**Solution:** A local Node.js server on port 3737 acts as a middleman.

```
Edge extension    → POST /service   (sends service code on change/load)
Chrome background → GET  /service   (reads code before renaming download)
```

**Server file:** `service-relay/server.js`

**Auto-start:** A Windows Task Scheduler entry runs `start-hidden.vbs`
on login, which launches `node server.js` silently with no visible
terminal window.

**Download rename format:** `{SERVICE_CODE}-{MMDDYY}.{ext}`
Example: `MEDEX-E-063026.png`

**If downloads aren't getting renamed:** check that the relay server is
actually running — background.js will log
`❌ Could not reach relay server` in the extension's service worker
console (find it via `chrome://extensions` → the "service worker" link
on the extension's card) if it can't connect.

---

```
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   Built with patience, console.log, and a lot of     ║
║   "yall trippin dawg" moments.                       ║
║                                                      ║
║   When in doubt: refresh the extension first.        ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```
