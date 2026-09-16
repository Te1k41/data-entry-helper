// ─────────────────────────────────────────────────────
//  FEATURE: SP001 Date Validation
//  Warns the user (via the shared banner) when SP001's
//  departure date doesn't match any SV vessel's departure
//  date, AND blocks Save in that same situation — a record
//  shouldn't save with its first port not actually basing on
//  any vessel. Blank SP001 is left alone (nothing to check yet,
//  same as the warning itself), only a non-blank date with no
//  match blocks.
//
//  The Save BUTTON lives in a different frame than this form
//  (confirmed live: onclick="parent.fr1.doSave()") — a "click"
//  listener in THIS frame never sees a click that happened in a
//  sibling frame's document, so that approach silently never
//  fired. Wrapping window.doSave itself instead works regardless
//  of which frame's button triggered it, since that's the one
//  function every path to actually saving calls through.
// ─────────────────────────────────────────────────────
const SP001DateValidation = {

    // Re-derives the same mismatch check validate() uses rather than
    // trusting whatever the last-rendered warning said, so this can
    // never fall out of sync with what's actually on screen right now.
    // Returns a message string if Save should be blocked, else null.
    saveBlockReason() {
        const sp001 = document.querySelector('input[name="SP001_depart_date"]');
        if (!sp001) return null; // not a page with SP001 on it

        const spDate = sp001.value.trim();
        if (!spDate) return null; // nothing to check yet — same as validate()'s own early return

        if (this.findMatchingSVDate(spDate)) return null;

        return `Can't save: SP001's departure date (${spDate}) doesn't match any vessel's departure date.\n\nFix the mismatch (see the warning banner) before saving.`;
    },

    // doSave is declared inline by Tradetech's own page script, so it
    // should already exist by document_idle — poll briefly just in
    // case, same 100ms/50-attempt shape as awr-flag.js's
    // waitForNameThenRescan(). _ttWrapped guards against wrapping our
    // own wrapper twice if this ever ran more than once.
    wrapDoSave() {
        if (typeof window.doSave === "function" && !window.doSave._ttWrapped) {
            const original = window.doSave;
            const self = this;
            const wrapped = function (...args) {
                const reason = self.saveBlockReason();
                if (reason) {
                    alert(reason);
                    return;
                }
                return original.apply(this, args);
            };
            wrapped._ttWrapped = true;
            window.doSave = wrapped;
            return;
        }

        let attempts = 0;
        const maxAttempts = 50; // 5s ceiling
        const timer = setInterval(() => {
            attempts++;
            if (typeof window.doSave === "function") {
                clearInterval(timer);
                this.wrapDoSave();
                return;
            }
            if (attempts >= maxAttempts) clearInterval(timer);
        }, 100);
    },

    validate() {
        const sp001 = document.querySelector('input[name="SP001_depart_date"]');
        if (!sp001) return;

        const spDate = sp001.value.trim();
        if (!spDate) {
            setWarning("sp001-mismatch", null);
            setInfoBanner(null);
            this.clearBasingHighlight();
            return;
        }

        const match = this.findMatchingSVDate(spDate);

        if (match) {
            console.log(`✅ SP001 matches ${match}`);
            setWarning("sp001-mismatch", null);

            const nameField = this.getVesselNameFieldForField(match);
            const vesselName = nameField?.value.trim();

            if (vesselName) {
                const voyageField = this.getVoyageFieldForField(match);
                const voyage = voyageField?.value.trim();
                const message = voyage ? `${vesselName} — ${voyage}` : vesselName;

                setInfoBanner({
                    title:   "⚓ Basing on",
                    message
                });
                this.applyBasingHighlight(nameField);
            } else {
                setInfoBanner(null);
                this.clearBasingHighlight();
            }
        } else {
            console.warn(`⚠ No SV departure matches ${spDate}`);
            setWarning("sp001-mismatch", {
                title:   "🚢 Vessel date mismatch",
                message: `No SV vessel found for ${spDate}`
            });
            setInfoBanner(null);
            this.clearBasingHighlight();
        }
    },

    BASING_HIGHLIGHT: {
        outline:         "2px solid #1e5f9e",
        backgroundColor: "#dceeff"
    },

    // Clears the blue highlight from whichever field currently has it
    // (tracked via a data attribute, same safe pattern used by
    // vessel-no-date.js / port-no-date.js — only ever touches a field
    // THIS feature previously marked, never a blanket reset of every
    // vessel field).
    clearBasingHighlight() {
        const previous = document.querySelector('input[data-tt-basing-on]');
        if (previous) {
            previous.style.outline = "";
            previous.style.backgroundColor = "";
            delete previous.dataset.ttBasingOn;
        }
    },

    applyBasingHighlight(field) {
        const previous = document.querySelector('input[data-tt-basing-on]');
        if (previous && previous !== field) {
            previous.style.outline = "";
            previous.style.backgroundColor = "";
            delete previous.dataset.ttBasingOn;
        }

        field.style.outline         = this.BASING_HIGHLIGHT.outline;
        field.style.backgroundColor = this.BASING_HIGHLIGHT.backgroundColor;
        field.dataset.ttBasingOn    = "1";
    },

    // Given a matched field name like "SV003_depart_date", finds that
    // same row's vessel name FIELD ("SV003_vessel_name") — the actual
    // element, not just its value, so it can be styled.
    getVesselNameFieldForField(fieldName) {
        const rowMatch = fieldName.match(/^SV(\d+)_depart_date$/);
        if (!rowMatch) return null;

        return VesselRow.field(rowMatch[1], "vessel_name");
    },

    // Same row lookup, but for the voyage number field instead.
    getVoyageFieldForField(fieldName) {
        const rowMatch = fieldName.match(/^SV(\d+)_depart_date$/);
        if (!rowMatch) return null;

        return VesselRow.field(rowMatch[1], "start_voyage");
    },

    findMatchingSVDate(spDate) {
    const normalizedSP = DateUtils.normalize(spDate);
    const svFields = document.querySelectorAll(
        'input[name^="SV"][name$="_depart_date"]'
    );

    console.log(`🔍 Checking ${svFields.length} SV dates against ${normalizedSP}`);

    for (const field of svFields) {
        const rowMatch = field.name.match(/^SV(\d+)_depart_date$/);
        if (!rowMatch) continue;

        // Only a row that actually has a vessel counts as a match -- a
        // stale date left behind in an otherwise-blank row (e.g. after
        // typing then clearing a vessel name) would otherwise silently
        // pass validation for a vessel that isn't really there.
        const nameField = VesselRow.field(rowMatch[1], "vessel_name");
        if (!nameField || !nameField.value.trim()) continue;

        const normalizedSV = DateUtils.normalize(field.value);
        if (normalizedSV && normalizedSV === normalizedSP) {
            console.log(`✅ Match found: ${field.name}`);
            return field.name;
        }
    }

    return null;
},

    // --- Module interface ---

    init() {
        // Run once immediately on load too — otherwise a service opened
        // with pre-filled dates (no edit made yet) never shows the
        // mismatch warning or the "Basing on" banner until you happen
        // to touch a date field yourself.
        this.validate();

        this.wrapDoSave();
    },

    handle(event) {
        const { name } = event.target;
        const isSVDate  = name?.startsWith("SV") && name?.endsWith("_depart_date");
        const isSP001   = name === "SP001_depart_date" || name === "SP001_arrival_date";

        if (isSVDate || isSP001) {
            this.validate();
        }
    }
};
