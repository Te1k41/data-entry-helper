// ─────────────────────────────────────────────────────
//  FEATURES: Duplicate Vessel / Delete Vessel
//  Two small per-row action buttons injected right next to every
//  vessel name field (SV*_vessel_name) on tradetech.net. Live in one
//  file since both need the exact same row-scanning logic and sit in
//  the same inline button group.
//
//  Row IDENTITY (is that the SAME vessel as another row?) is keyed by
//  Lloyds code (SV{row}_lloyds_codeD), NOT vessel name. This mirrors
//  the port side (insert-port.js), which already keys off port_code.
//
//  Row OCCUPANCY (is this row available as a destination/deletable?)
//  is different: a row counts as empty only if BOTH code AND name are
//  blank. Code-only would treat a "VESSEL TO BE ANNOUNCED" placeholder
//  (name filled, no Lloyds code — see vessel-to-be-announced.js) as an
//  empty row, letting Duplicate silently overwrite it and Delete
//  silently no-op on it.
//
//  ⧉ Duplicate — copies the vessel into the next empty SV row (blank
//  rows already exist further down the page — "empty" now means no
//  Lloyds code, not no name), with:
//    - the SAME vessel name AND Lloyds code (lloyds_codeD, the hidden
//      lloyds_code, and its PV_ shadow — plain copy, no re-validation,
//      same reasoning insert-port.js documents for port_code: this is
//      relocating already-valid data, not creating new data)
//    - start_voyage bumped by voyage_increment_by (same increment
//      logic as "🛠 Fix Vessel Dates" and the [-][+] voyage step
//      buttons — see VesselVoyageCorrection.getVoyageIncrement() /
//      VoyageUtils.step() in src/utils/voyage.js)
//    - NO depart_date at all — left completely blank, unlike Fix
//      Vessel Dates which always assigns one
//  Deliberately does NOT wrap the name/voyage writes in the `syncing`
//  guard — a duplicated voyage number should behave exactly like one
//  typed by hand, including voyage-direction.js appending a compass
//  letter if applicable (same reasoning voyage-step-buttons.js already
//  documents for its own plain-click case). The Lloyds code copy is a
//  plain, event-free assignment either way (see above), so it's not
//  affected by this.
//
//  🗑 Delete — the inverse: clears that row's vessel name, Lloyds
//  code, voyage number, and departure date back to blank — no confirm
//  prompt (see ↩ Restore below). Doesn't touch One-off or Skipped
//  Ports — out of scope, this session's vessel features only ever
//  operate on name/code/voyage/date.
// ─────────────────────────────────────────────────────

function vesselCodeField(row) {
    return VesselRow.field(row, "lloyds_codeD");
}

// Reads a row's Lloyds code trio (visible codeD, hidden code, hidden
// PV_ shadow of the hidden one) — there's no PV_ shadow of codeD
// itself (confirmed live), only of the plain lloyds_code field.
function readVesselCode(row) {
    return {
        codeD: vesselCodeField(row)?.value ?? null,
        code:  VesselRow.field(row, "lloyds_code")?.value ?? null
    };
}

function writeVesselCode(row, values) {
    const codeDField = vesselCodeField(row);
    if (codeDField && values.codeD !== null) codeDField.value = values.codeD;

    const codeField = VesselRow.field(row, "lloyds_code");
    if (codeField && values.code !== null) {
        codeField.value = values.code;
        const pvCode = document.querySelector(`input[name="PV_${codeField.name}"]`);
        if (pvCode) pvCode.value = values.code;
    }
}

// ─────────────────────────────────────────────────────
//  ↩ Restore — a real undo STACK for Duplicate/Delete, not just a
//  single last-action toggle. Neither action goes through a real
//  keystroke (setFieldValue writes .value directly), so neither one
//  is ever in the browser's own native Ctrl+Z history — this is the
//  only way back once Delete's confirm prompt was removed.
//  Each entry's `restore` closure re-does exactly the same writes
//  (setFieldValue + PV_ mirroring) the original action used, just with
//  the OLD values captured before that action ran.
// ─────────────────────────────────────────────────────
const VesselActionHistory = {
    _stack: [],

    push(entry) {
        this._stack.push(entry);
    },

    undo() {
        const entry = this._stack.pop();
        if (!entry) {
            showTemporaryBanner({ title: "↩ Nothing to restore", message: "No vessel action to undo." });
            return;
        }

        entry.restore();
        console.log(`↩ Restored: ${entry.label}`);
        showTemporaryBanner({ title: "↩ Restored", message: entry.label });
    },

    init() {
        Toolbar.register({
            id:      "tt-vessel-restore",
            label:   "↩ Restore Vessel",
            title:   "Undo the most recent vessel duplicate or delete action",
            group:   "vessel",
            onClick: () => this.undo()
        });
    },

    handle(_event) {}
};

const DuplicateVessel = {
    SELECTOR: 'input[name^="SV"][name$="_vessel_name"]:not([name^="PV_"])',

    init() {
        this.addButtons();
    },

    addButtons() {
        document.querySelectorAll(this.SELECTOR).forEach(field => {
            if (field.dataset.ttDuplicateAdded) return; // never double-inject
            field.dataset.ttDuplicateAdded = "1";
            this.wrapField(field);
        });
    },

    wrapField(field) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "⧉";
        btn.title = "Duplicate: copy this vessel into the next empty row, voyage number chained forward each click";

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

        // Per-button voyage chain state: null until this row's vessel has
        // been duplicated at least once this page-session. Lets repeated
        // clicks on the SAME original row chain the voyage forward
        // (201 -> 202 -> 203) instead of recomputing from the unchanged
        // source every time — see duplicate()'s `chain` parameter.
        let lastVoyage = null;

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            this.duplicate(field, {
                get: () => lastVoyage,
                set: (value) => { lastVoyage = value; }
            });
        });

        insertActionButtonAfter(field, btn);
    },

    // Every SV row, in ascending row order — used both to find the
    // source voyage field and to find the first empty destination row.
    // "Empty" is decided by Lloyds code (codeField), not name — see the
    // file header. nameField is still kept here purely for the
    // human-readable label in banners/logs.
    allRows() {
        return Array.from(document.querySelectorAll(this.SELECTOR))
            .map(nameField => {
                const match = nameField.name.match(/^SV(\d+)_vessel_name$/);
                if (!match) return null;
                const row = match[1];
                return { row, nameField, codeField: vesselCodeField(row) };
            })
            .filter(Boolean)
            .sort((a, b) => parseInt(a.row, 10) - parseInt(b.row, 10));
    },

    // A row counts as empty only if BOTH its Lloyds code and its name
    // are blank. Code-only would wrongly call a "VESSEL TO BE ANNOUNCED"
    // row (vessel-to-be-announced.js's backtick shortcut — name filled,
    // no Lloyds code) empty and silently overwrite it.
    findEmptyRow() {
        return this.allRows().find(r => (!r.codeField || !r.codeField.value.trim()) && !r.nameField.value.trim());
    },

    duplicate(sourceNameField, chain) {
        const rowMatch = sourceNameField.name.match(/^SV(\d+)_vessel_name$/);
        const sourceRow = rowMatch ? rowMatch[1] : null;
        const sourceCodeField = sourceRow ? vesselCodeField(sourceRow) : null;

        if (!sourceCodeField || !sourceCodeField.value.trim()) {
            showTemporaryBanner({ title: "⧉ Nothing to duplicate", message: "This vessel row has no Lloyds code." });
            return;
        }

        const vesselName = sourceNameField.value.trim();
        const sourceVoyageField = document.querySelector(`input[name="SV${sourceRow}_start_voyage"]:not([name^="PV_"])`);

        const target = this.findEmptyRow();
        if (!target) {
            showTemporaryBanner({ title: "⧉ Duplicate failed", message: "No empty vessel row available." });
            return;
        }

        const targetVoyageField = document.querySelector(`input[name="SV${target.row}_start_voyage"]:not([name^="PV_"])`);

        // Capture the target row's old (blank) values BEFORE writing,
        // so Restore can put this row back exactly how it was.
        const oldTargetName   = target.nameField.value;
        const oldTargetVoyage = targetVoyageField ? targetVoyageField.value : null;
        const oldTargetCode   = readVesselCode(target.row);
        const previousLastVoyage = chain.get();

        VesselActionHistory.push({
            label: `Duplicate → SV${target.row} ("${vesselName}")`,
            restore: () => {
                setFieldValue(target.nameField, oldTargetName);
                const pvName = document.querySelector(`input[name="PV_${target.nameField.name}"]`);
                if (pvName) pvName.value = target.nameField.value;

                writeVesselCode(target.row, oldTargetCode);

                if (targetVoyageField) {
                    setFieldValue(targetVoyageField, oldTargetVoyage);
                    const pvVoyage = document.querySelector(`input[name="PV_${targetVoyageField.name}"]`);
                    if (pvVoyage) pvVoyage.value = targetVoyageField.value;
                }

                // Roll the voyage chain back too, so the next click on
                // this same button continues from before this (now-
                // undone) duplicate, not from its result.
                chain.set(previousLastVoyage);
            }
        });

        setFieldValue(target.nameField, vesselName);

        // Tradetech keeps a hidden PV_ duplicate of vessel_name too
        // (confirmed live: PV_SV001_vessel_name) — mirror it directly,
        // same as the voyage field below.
        const pvNameField = document.querySelector(`input[name="PV_${target.nameField.name}"]`);
        if (pvNameField) pvNameField.value = target.nameField.value;

        // Lloyds code is the row's real identity now — copy it too,
        // plain (no re-validation), same reasoning as port_code in
        // insert-port.js.
        writeVesselCode(target.row, readVesselCode(sourceRow));

        console.log(`⧉ Duplicated ${sourceNameField.name} → ${target.nameField.name}: "${vesselName}" (code ${sourceCodeField.value})`);

        if (sourceVoyageField && targetVoyageField) {
            const increment = VesselVoyageCorrection.getVoyageIncrement();

            // increment > 0: chain forward from the LAST voyage this same
            // button produced (not the source's unchanged DOM value), so
            // repeated clicks on one original row give 201 -> 202 -> 203
            // instead of 202 every time. increment <= 0: always reuse the
            // source's own value unchanged ("keep the voyage number of
            // the duplicate") — never stepped, regardless of click count.
            // Deliberately a different policy than getShiftMagnitude()'s
            // non-positive fallback (voyage-step-buttons.js) — that one's
            // for a manual step button where doing nothing would be bad
            // UX; here the spec for <=0 is "copy, don't step."
            const baseVoyage = (increment > 0 && previousLastVoyage !== null)
                ? previousLastVoyage
                : sourceVoyageField.value;

            if (baseVoyage.trim()) {
                const newCode = increment > 0 ? VoyageUtils.step(baseVoyage, increment) : baseVoyage;

                setFieldValue(targetVoyageField, newCode);

                // Mirror into the hidden PV_ duplicate, same as every other
                // feature that writes a voyage code.
                const pvField = document.querySelector(`input[name="PV_${targetVoyageField.name}"]`);
                if (pvField) pvField.value = targetVoyageField.value;

                console.log(`🔢 ${targetVoyageField.name} → ${targetVoyageField.value}`);

                chain.set(newCode);
            }
        }

        // Deliberately nothing written to SV{target.row}_depart_date —
        // left blank, per spec.

        showTemporaryBanner({
            title:   "⧉ Vessel Duplicated",
            message: `${vesselName} → row ${target.row}, no dates set`
        });
    },

    handle(_event) {}
};

const DeleteVessel = {
    SELECTOR: 'input[name^="SV"][name$="_vessel_name"]:not([name^="PV_"])',

    init() {
        this.addButtons();
    },

    addButtons() {
        document.querySelectorAll(this.SELECTOR).forEach(field => {
            if (field.dataset.ttDeleteAdded) return; // never double-inject
            field.dataset.ttDeleteAdded = "1";
            this.wrapField(field);
        });
    },

    wrapField(field) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "🗑";
        btn.title = "Delete: clear this vessel's name, voyage number, and departure date";

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
            this.deleteVessel(field);
        });

        insertActionButtonAfter(field, btn);
    },

    deleteVessel(nameField) {
        const rowMatch = nameField.name.match(/^SV(\d+)_vessel_name$/);
        if (!rowMatch) return;
        const row = rowMatch[1];

        // "Nothing to delete" means BOTH Lloyds code and name are blank —
        // code-only would silently no-op on a "VESSEL TO BE ANNOUNCED"
        // placeholder row (name filled, no Lloyds code), same blind spot
        // findEmptyRow() above had to fix.
        const codeField = vesselCodeField(row);
        if ((!codeField || !codeField.value.trim()) && !nameField.value.trim()) return;

        const vesselName = nameField.value.trim();
        const voyageField = document.querySelector(`input[name="SV${row}_start_voyage"]:not([name^="PV_"])`);
        const dateField   = document.querySelector(`input[name="SV${row}_depart_date"]:not([name^="PV_"])`);

        // Capture everything BEFORE clearing it, so Restore can put it
        // all back exactly as it was.
        const oldName   = nameField.value;
        const oldCode   = readVesselCode(row);
        const oldVoyage = voyageField ? voyageField.value : null;
        const oldDate   = dateField ? dateField.value : null;

        VesselActionHistory.push({
            label: `Delete SV${row} ("${vesselName}")`,
            restore: () => {
                setFieldValue(nameField, oldName);
                const pvName = document.querySelector(`input[name="PV_${nameField.name}"]`);
                if (pvName) pvName.value = nameField.value;

                writeVesselCode(row, oldCode);

                if (voyageField) {
                    setFieldValue(voyageField, oldVoyage);
                    const pvVoyage = document.querySelector(`input[name="PV_${voyageField.name}"]`);
                    if (pvVoyage) pvVoyage.value = voyageField.value;
                }

                // Same as the forward delete — depart_date's own inline
                // onchange handles its PV_ shadow and day-of-week field.
                if (dateField) setFieldValue(dateField, oldDate);
            }
        });

        setFieldValue(nameField, "");
        const pvNameField = document.querySelector(`input[name="PV_${nameField.name}"]`);
        if (pvNameField) pvNameField.value = "";

        writeVesselCode(row, { codeD: "", code: "" });

        if (voyageField) {
            setFieldValue(voyageField, "");
            const pvVoyageField = document.querySelector(`input[name="PV_${voyageField.name}"]`);
            if (pvVoyageField) pvVoyageField.value = "";
        }

        // depart_date's own inline onchange (dateformat/dowFunc) handles
        // its PV_ shadow and the day-of-week field itself — same as
        // date-step-buttons.js relies on, no manual mirroring needed here.
        if (dateField) setFieldValue(dateField, "");

        console.log(`🗑 Cleared vessel row SV${row} (was "${vesselName}")`);

        showTemporaryBanner({
            title:   "🗑 Vessel Deleted",
            message: `SV${row} cleared (was "${vesselName}")`
        });
    },

    handle(_event) {}
};
