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
//    - ONLY the Lloyds code (lloyds_codeD) written, and through
//      setFieldValue() (a real change event) rather than a plain
//      assignment — deliberately DOES re-trigger Tradetech's own
//      lookup here, unlike insert-port.js's port_code relocation,
//      because we WANT Tradetech to fill in the vessel name itself
//      from the code, exactly as if it had been typed by hand into a
//      blank row. The hidden lloyds_code + its PV_ shadow are still a
//      plain copy (no listener depends on a real event there).
//    - start_voyage bumped by voyage_increment_by (same increment
//      logic as the [-][+] voyage step buttons — see
//      VoyageUtils.getIncrement() / VoyageUtils.step() in
//      src/utils/voyage.js)
//    - NO depart_date at all — left completely blank
//  Deliberately does NOT wrap the voyage write in the `syncing`
//  guard — a duplicated voyage number should behave exactly like one
//  typed by hand, including voyage-direction.js appending a compass
//  letter if applicable (same reasoning voyage-step-buttons.js already
//  documents for its own plain-click case).
//
//  🗑 Delete — the inverse: clears that row's vessel name, Lloyds
//  code, voyage number, departure date, and One-off checkbox back to
//  blank/unchecked — no confirm prompt (see ↩ Restore below). Doesn't
//  touch Skipped Ports — still out of scope, unrelated to a vessel row.
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
        mirrorPvShadow(codeField, values.code);
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
        if (!isOnScheduleForm()) return;

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
        // source every time — see duplicate()'s `chain` parameter. Stores
        // the target FIELD alongside the value (not just the value) so
        // duplicate() can check the actual screen state before trusting
        // it — confirmed real bug: deleting the row this chained into
        // used to leave the chain still remembering that voyage number,
        // so the NEXT duplicate kept incrementing from a row that no
        // longer exists on screen instead of restarting from the source.
        let lastChain = { value: null, field: null };

        btn.addEventListener("click", (e) => {
            e.preventDefault();

            const doDuplicate = () => this.duplicate(field, {
                get: () => lastChain,
                set: (next) => { lastChain = next; }
            });

            // If a Lloyds code was just typed, Tradetech fills vessel_name
            // asynchronously (plain .value assignment, no "change" event) —
            // clicking Duplicate before that lands would copy a still-blank
            // name. Only wait when there's actually a code to look up a name
            // for; a genuinely empty row (no code either) should still hit
            // duplicate()'s own "Nothing to duplicate" banner immediately.
            const rowMatch = field.name.match(/^SV(\d+)_vessel_name$/);
            const codeField = rowMatch ? vesselCodeField(rowMatch[1]) : null;
            if (codeField && codeField.value.trim() && !field.value.trim()) {
                waitForFieldValue(field, doDuplicate);
            } else {
                doDuplicate();
            }
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
        if (!target.codeField) {
            showTemporaryBanner({ title: "⧉ Duplicate failed", message: `SV${target.row} has no Lloyds code field.` });
            return;
        }

        const targetVoyageField = document.querySelector(`input[name="SV${target.row}_start_voyage"]:not([name^="PV_"])`);

        // Capture the target row's old (blank) values BEFORE writing,
        // so Restore can put this row back exactly how it was.
        const oldTargetName   = target.nameField.value;
        const oldTargetVoyage = targetVoyageField ? targetVoyageField.value : null;
        const oldTargetCode   = readVesselCode(target.row);
        const previousChain = chain.get();

        // Only trust the remembered chain value if the row it landed in
        // still actually shows it RIGHT NOW — if that row was since
        // deleted (or edited), the memory is stale and shouldn't drive
        // another increment; treat this click as a fresh start instead.
        const chainStillOnScreen = previousChain.field && previousChain.field.value === previousChain.value;
        const previousLastVoyage = chainStillOnScreen ? previousChain.value : null;

        VesselActionHistory.push({
            label: `Duplicate → SV${target.row} ("${vesselName}")`,
            restore: () => {
                setFieldValue(target.nameField, oldTargetName);
                mirrorPvShadow(target.nameField, target.nameField.value);

                writeVesselCode(target.row, oldTargetCode);

                if (targetVoyageField) {
                    setFieldValue(targetVoyageField, oldTargetVoyage);
                    mirrorPvShadow(targetVoyageField, targetVoyageField.value);
                }

                // Roll the voyage chain back too, so the next click on
                // this same button continues from before this (now-
                // undone) duplicate, not from its result.
                chain.set(previousChain);
            }
        });

        // Only write the Lloyds code — through setFieldValue() (a real
        // change event), not a plain assignment, specifically so
        // Tradetech's own lookup fires and fills in the vessel name
        // itself, exactly as if the code had been typed into a blank
        // row by hand. We used to paste the name ourselves because the
        // code was written plain (no event) to avoid re-triggering that
        // same lookup — not needed here, Tradetech doing it is the
        // actual source of truth for what that code's vessel is called.
        setFieldValue(target.codeField, sourceCodeField.value);

        // Tradetech's own lookup above fills target.nameField.value
        // directly (plain assignment, no change event — same bypass
        // insert-port.js documents for port_name-after-port_code), so
        // nothing that reacts to SV*_vessel_name changing (vessel
        // recommendation, no-date detection, SP001 validation) would
        // ever hear about the new name otherwise.
        waitForFieldValue(target.nameField, () => {
            VesselRecommendation.suggest();
            DetectVesselNoDate.check();
            SP001DateValidation.validate();
        });

        // The hidden lloyds_code has no listener depending on a real
        // event to fire — plain-copy it and its PV_ shadow same as
        // insert-port.js does for port_code ("relocating already-valid
        // data").
        const sourceCode = readVesselCode(sourceRow);
        const hiddenCodeField = VesselRow.field(target.row, "lloyds_code");
        if (hiddenCodeField && sourceCode.code !== null) {
            hiddenCodeField.value = sourceCode.code;
            mirrorPvShadow(hiddenCodeField, sourceCode.code);
        }

        console.log(`⧉ Duplicated ${sourceNameField.name} → SV${target.row}: code ${sourceCodeField.value} (name auto-filled by Tradetech)`);

        if (sourceVoyageField && targetVoyageField) {
            const increment = VoyageUtils.getIncrement();

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
                mirrorPvShadow(targetVoyageField, targetVoyageField.value);

                console.log(`🔢 ${targetVoyageField.name} → ${targetVoyageField.value}`);

                chain.set({ value: newCode, field: targetVoyageField });
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
        const oneOffField = document.querySelector(`input[name="SV${row}_one-off"]`);

        // Capture everything BEFORE clearing it, so Restore can put it
        // all back exactly as it was.
        const oldName    = nameField.value;
        const oldCode    = readVesselCode(row);
        const oldVoyage  = voyageField ? voyageField.value : null;
        const oldDate    = dateField ? dateField.value : null;
        const oldOneOff  = oneOffField ? oneOffField.checked : null;

        VesselActionHistory.push({
            label: `Delete SV${row} ("${vesselName}")`,
            restore: () => {
                setFieldValue(nameField, oldName);
                mirrorPvShadow(nameField, nameField.value);

                writeVesselCode(row, oldCode);

                if (voyageField) {
                    setFieldValue(voyageField, oldVoyage);
                    mirrorPvShadow(voyageField, voyageField.value);
                }

                // Same as the forward delete — depart_date's own inline
                // onchange handles its PV_ shadow and day-of-week field.
                if (dateField) setFieldValue(dateField, oldDate);

                if (oneOffField && oldOneOff !== null) {
                    oneOffField.checked = oldOneOff;
                    oneOffField.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
        });

        setFieldValue(nameField, "");
        mirrorPvShadow(nameField, "");

        writeVesselCode(row, { codeD: "", code: "" });

        if (voyageField) {
            setFieldValue(voyageField, "");
            mirrorPvShadow(voyageField, "");
        }

        // depart_date's own inline onchange (dateformat/dowFunc) handles
        // its PV_ shadow and the day-of-week field itself — same as
        // date-step-buttons.js relies on, no manual mirroring needed here.
        if (dateField) setFieldValue(dateField, "");

        // A cleared row shouldn't still claim to be a "one-off" exception —
        // that only means something in relation to an actual vessel
        // occupying the row (see live-check.js's checkDuplicateImos()).
        if (oneOffField) {
            oneOffField.checked = false;
            oneOffField.dispatchEvent(new Event("change", { bubbles: true }));
        }

        console.log(`🗑 Cleared vessel row SV${row} (was "${vesselName}")`);

        showTemporaryBanner({
            title:   "🗑 Vessel Deleted",
            message: `SV${row} cleared (was "${vesselName}")`
        });
    },

    handle(_event) {}
};
