// ─────────────────────────────────────────────────────
//  FEATURE: Insert Port
//  Adds a tiny "➕" button right next to every port name field
//  (SP*_port_name) on tradetech.net. Clicking it inserts a blank port
//  row immediately AFTER that one, shifting every port after it down
//  by one row into a spare blank SP row further down the page (same
//  "spare rows already exist" setup vessel rows have).
//
//  A port row is a LOT richer than a vessel row (confirmed live):
//    port_code, port_name              — mutually validated pair
//    locationCode, locationName,
//      knownEntityLocationId           — a separate async-resolved
//                                         lookup trio, usually blank
//    port_key                          — plain, no validation
//    arrival_date, depart_date         — trigger Tradetech's own
//                                         dateformat()/setDays(),
//                                         which derives the readonly
//                                         _arrival_date_diff /
//                                         _depart_date_diff and the
//                                         disabled _dow fields
//  RN and line_number are NOT part of this — they identify the
//  physical row/DB record, not the port data sitting in it, so they
//  stay put while everything else shifts through them.
//
//  Since a shift RELOCATES already-valid data rather than creating
//  new data, every field except arrival_date/depart_date is copied by
//  a plain .value assignment (+ manually mirroring its PV_ shadow) —
//  deliberately NOT re-dispatching port_code/port_name's or
//  locationCode/locationName's own validation handlers, since a
//  synthetic event re-triggering Tradetech's async lookups could
//  resolve to a different value than what was already there (this
//  mirrors the async-resolution caution due-service-scanner-relay.js
//  documents for its own "Assigned To" id lookup). arrival_date/
//  depart_date DO go through setFieldValue — that's what makes
//  Tradetech itself correctly recompute the diff/dow fields for the
//  row's new position, even though the calendar date itself doesn't
//  change.
//
//  The whole shift runs inside the `syncing` guard so date-syncing.js
//  (which would otherwise auto-copy each shifted arrival_date into
//  that same row's depart_date, clobbering the real depart_date we're
//  about to write right after it) stays out of the way — the exact
//  same reason vessel-correction.js's bulk vessel-date rewrite does.
//
//  Row IDENTITY (which row is "the last one" for Insert's shift) is
//  keyed by port_code, NOT port_name. Same identity model
//  duplicate-vessel.js uses on the vessel side (Lloyds code there).
//
//  Delete's OCCUPANCY check is different: a row counts as "nothing to
//  delete" only if BOTH port_code AND port_name are blank — code-only
//  would silently no-op on a row that has a name (or other data) but
//  no code yet, same blind spot fixed on the vessel side.
// ─────────────────────────────────────────────────────

function portField(row, suffix) {
    return PortRow.field(row, suffix);
}

function portDateField(row, which) {
    return PortRow.field(row, `${which}_date`);
}

// Reads every field this feature cares about for one row into a plain
// object — used both to snapshot a row before touching it (for Restore)
// and to read the SOURCE row's values during a shift.
function readPortRow(row) {
    return PortRow.read(row);
}

// Writes a values object (from readPortRow, or all-blank for a clear)
// into the given row.
function writePortRow(row, values) {
    PortRow.write(row, values);
}

function blankPortRowValues(row) {
    return PortRow.blank(row);
}

// ─────────────────────────────────────────────────────
//  ↩ Restore — same real undo-stack pattern as VesselActionHistory
//  (duplicate-vessel.js), kept separate so undoing a port action never
//  gets mixed up with undoing a vessel action.
// ─────────────────────────────────────────────────────
const PortActionHistory = {
    _stack: [],

    push(entry) {
        this._stack.push(entry);
    },

    undo() {
        const entry = this._stack.pop();
        if (!entry) {
            showTemporaryBanner({ title: "↩ Nothing to restore", message: "No port action to undo." });
            return;
        }

        entry.restore();
        console.log(`↩ Restored: ${entry.label}`);
        showTemporaryBanner({ title: "↩ Restored", message: entry.label });
    },

    init() {
        Toolbar.register({
            id:      "tt-port-restore",
            label:   "↩ Restore Port",
            title:   "Undo the most recent port insert or delete action",
            group:   "port",
            onClick: () => this.undo()
        });
    },

    handle(_event) {}
};

const InsertPort = {
    SELECTOR: 'input[name^="SP"][name$="_port_name"]:not([name^="PV_"])',

    init() {
        this.addButtons();
    },

    addButtons() {
        document.querySelectorAll(this.SELECTOR).forEach(field => {
            if (field.dataset.ttInsertAdded) return; // never double-inject
            field.dataset.ttInsertAdded = "1";
            this.wrapField(field);
        });
    },

    wrapField(field) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "➕";
        btn.title = "Insert: add a blank port row right after this one, shifting everything after it down";

        btn.style.cssText = `
            display: inline-block !important;
            width: 18px !important;
            height: 18px !important;
            line-height: 14px !important;
            padding: 0 !important;
            margin-left: 4px !important;
            font-family: monospace !important;
            font-size: 11px !important;
            font-weight: bold !important;
            background: #ffffff !important;
            color: #000000 !important;
            border: 1px solid #000000 !important;
            border-radius: 0px !important;
            cursor: pointer !important;
            vertical-align: middle !important;
            box-sizing: border-box !important;
        `;

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            this.insertAfter(field);
        });

        insertActionButtonAfter(field, btn);
    },

    // rowStr keeps Tradetech's own zero-padding (e.g. "004", not "4") —
    // row numbers here are used to BUILD field-name strings later
    // (SP${row}_port_name), so losing the padding would silently query
    // for a field that doesn't exist (e.g. "SP5_port_name" instead of
    // the real "SP005_port_name") and look like there's no spare row
    // even when there obviously is one. Same issue keyboard-navigation.js
    // already had to solve for the exact same reason (its own `width`
    // handling).
    // "Filled" is decided by port_code, not port_name — see the file
    // header. nameField is still kept here purely for the button's
    // visual anchor point and human-readable labels.
    allRows() {
        return Array.from(document.querySelectorAll(this.SELECTOR))
            .map(nameField => {
                const match = nameField.name.match(/^SP(\d+)_port_name$/);
                if (!match) return null;
                const rowStr = match[1];
                return { rowStr, row: parseInt(rowStr, 10), nameField, codeField: portField(rowStr, "port_code") };
            })
            .filter(Boolean)
            .sort((a, b) => a.row - b.row);
    },

    // Highest row number with a non-empty port_code — the last "real"
    // port in the itinerary, regardless of gaps. Returns the whole row
    // entry (not just the number) so its zero-padding width is still
    // available to callers.
    findLastFilledRow() {
        const filled = this.allRows().filter(r => r.codeField && r.codeField.value.trim());
        return filled.length ? filled.reduce((max, r) => r.row > max.row ? r : max) : null;
    },

    insertAfter(afterField) {
        const rowMatch = afterField.name.match(/^SP(\d+)_port_name$/);
        if (!rowMatch) return;
        const width    = rowMatch[1].length;
        const pad      = n => String(n).padStart(width, "0");
        const afterRow = parseInt(rowMatch[1], 10);

        const lastFilledEntry = this.findLastFilledRow();
        const lastFilled = lastFilledEntry ? lastFilledEntry.row : null;

        if (lastFilled === null || lastFilled < afterRow) {
            // Nothing after this row is even filled — the row right
            // after it is already the blank slot; nothing to shift.
            showTemporaryBanner({ title: "➕ Nothing to insert", message: "Already an empty port row right after this one." });
            return;
        }

        const spareRow = lastFilled + 1;
        const spareField = portField(pad(spareRow), "port_code");
        if (!spareField || spareField.value.trim()) {
            showTemporaryBanner({ title: "➕ Insert failed", message: "No empty port row available to shift into." });
            return;
        }

        const insertionRow = afterRow + 1;

        // Snapshot every row this shift will touch (insertionRow through
        // spareRow) BEFORE changing anything, so Restore can put every
        // one of them back exactly as it was — this is simpler than
        // deriving a reverse-shift, and doesn't depend on ordering.
        const snapshot = [];
        for (let row = insertionRow; row <= spareRow; row++) {
            snapshot.push(readPortRow(pad(row)));
        }

        PortActionHistory.push({
            label: `Insert after SP${pad(afterRow)} (rows SP${pad(insertionRow)}–SP${pad(spareRow)} shifted)`,
            restore: () => {
                beginSync();
                try {
                    snapshot.forEach(values => writePortRow(values.row, values));
                } finally {
                    endSync();
                }
                ArrivalDepartOrderCheck.check();
            }
        });

        beginSync(); // keep date-syncing.js's arrival→depart auto-copy out of the way mid-shift
        try {
            // Descending order — copy row i's content into row i+1,
            // starting from the last filled row and working backward,
            // so nothing gets overwritten before it's been read.
            for (let row = lastFilled; row >= insertionRow; row--) {
                writePortRow(pad(row + 1), readPortRow(pad(row)));
            }
            writePortRow(pad(insertionRow), blankPortRowValues(pad(insertionRow)));
        } finally {
            endSync();
        }

        console.log(`➕ Inserted blank port row SP${pad(insertionRow)} (shifted SP${pad(insertionRow)}–SP${pad(lastFilled)} → SP${pad(insertionRow + 1)}–SP${pad(spareRow)})`);

        showTemporaryBanner({
            title:   "➕ Port Inserted",
            message: `New blank row at SP${pad(insertionRow)}`
        });

        ArrivalDepartOrderCheck.check(); // re-run once now that the shift is fully done, instead of mid-shift per field
    },

    handle(_event) {}
};

const DeletePort = {
    SELECTOR: 'input[name^="SP"][name$="_port_name"]:not([name^="PV_"])',

    init() {
        this.addButtons();
    },

    addButtons() {
        document.querySelectorAll(this.SELECTOR).forEach(field => {
            if (field.dataset.ttPortDeleteAdded) return; // never double-inject
            field.dataset.ttPortDeleteAdded = "1";
            this.wrapField(field);
        });
    },

    wrapField(field) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "🗑";
        btn.title = "Delete: remove this port, shifting everything after it up to fill the gap";

        btn.style.cssText = `
            display: inline-block !important;
            width: 18px !important;
            height: 18px !important;
            line-height: 14px !important;
            padding: 0 !important;
            margin-left: 4px !important;
            font-family: monospace !important;
            font-size: 11px !important;
            font-weight: bold !important;
            background: #ffffff !important;
            color: #000000 !important;
            border: 1px solid #000000 !important;
            border-radius: 0px !important;
            cursor: pointer !important;
            vertical-align: middle !important;
            box-sizing: border-box !important;
        `;

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            this.deletePort(field);
        });

        insertActionButtonAfter(field, btn);
    },

    deletePort(nameField) {
        const rowMatch = nameField.name.match(/^SP(\d+)_port_name$/);
        if (!rowMatch) return;
        const width      = rowMatch[1].length;
        const pad        = n => String(n).padStart(width, "0");
        const deleteRow  = parseInt(rowMatch[1], 10);

        const wasEmpty = PortRow.isEmpty(pad(deleteRow));
        const portName = nameField.value.trim();

        // Search the WHOLE table, not just rows after deleteRow — even
        // when the clicked row is itself empty, any filled row further
        // down still needs to shift up into it and every row after that.
        const lastFilled = InsertPort.findLastFilledRow();
        const lastFilledRow = lastFilled ? lastFilled.row : deleteRow;

        // Genuinely nothing to do only when the clicked row is empty AND
        // there's no filled row at/after it to pull up — PortRow's own
        // canonical occupancy check (code, name, OR either date) catches
        // a row with only a date filled in and no code/name yet, same
        // blind spot fixed on the vessel side in duplicate-vessel.js.
        if (wasEmpty && (!lastFilled || lastFilled.row <= deleteRow)) {
            showTemporaryBanner({ title: "🗑 Nothing to delete", message: "This port row is already empty." });
            return;
        }

        // Snapshot every row this shift will touch (deleteRow through
        // lastFilledRow) BEFORE changing anything, same reasoning as
        // Insert's own snapshot-then-restore — simpler than deriving a
        // reverse shift, and doesn't depend on ordering.
        const snapshot = [];
        for (let row = deleteRow; row <= lastFilledRow; row++) {
            snapshot.push(readPortRow(pad(row)));
        }

        const label = wasEmpty
            ? `Delete empty SP${pad(deleteRow)} — rows SP${pad(deleteRow + 1)}–SP${pad(lastFilledRow)} shifted up`
            : `Delete SP${pad(deleteRow)} ("${portName}") — rows SP${pad(deleteRow)}–SP${pad(lastFilledRow)} shifted back`;

        PortActionHistory.push({
            label,
            restore: () => {
                beginSync();
                try {
                    snapshot.forEach(values => writePortRow(values.row, values));
                } finally {
                    endSync();
                }
                ArrivalDepartOrderCheck.check();
            }
        });

        beginSync(); // same reason Insert's shift does — keep date-syncing.js out of the way mid-shift
        try {
            // Ascending order — copy row i's content into row i-1,
            // starting right after the deleted row and working forward,
            // so nothing gets overwritten before it's been read.
            for (let row = deleteRow + 1; row <= lastFilledRow; row++) {
                writePortRow(pad(row - 1), readPortRow(pad(row)));
            }
            writePortRow(pad(lastFilledRow), blankPortRowValues(pad(lastFilledRow)));
        } finally {
            endSync();
        }

        console.log(`🗑 Deleted port SP${pad(deleteRow)}${wasEmpty ? " (was empty)" : ` (was "${portName}")`} — shifted SP${pad(deleteRow + 1)}–SP${pad(lastFilledRow)} → SP${pad(deleteRow)}–SP${pad(lastFilledRow - 1)}`);

        showTemporaryBanner({
            title:   "🗑 Port Deleted",
            message: wasEmpty ? `Empty SP${pad(deleteRow)} removed — later ports shifted up` : `SP${pad(deleteRow)} removed (was "${portName}")`
        });

        ArrivalDepartOrderCheck.check();
    },

    handle(_event) {}
};
