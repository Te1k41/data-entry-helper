// ─────────────────────────────────────────────────────
//  FEATURE: SP001 Date Validation
//  Warns the user (via the shared banner) when SP001's
//  departure date doesn't match any SV vessel's departure
//  date, AND blocks the Save button in that same situation —
//  a record shouldn't save with its first port not actually
//  basing on any vessel. Blank SP001 is left alone (nothing to
//  check yet, same as the warning itself), only a non-blank
//  date with no match blocks. Intercepted in the capture phase
//  (like keyboard-navigation.js does for keys) so this runs
//  BEFORE Tradetech's own Save click handler.
// ─────────────────────────────────────────────────────
const SP001DateValidation = {

    SAVE_BUTTON_SELECTOR: 'input[type="button"][value="Save"]',

    // Re-derives the same mismatch check validate() uses rather than
    // trusting whatever the last-rendered warning said, so this can
    // never fall out of sync with what's actually on screen right now.
    handleSaveClick(event) {
        const button = event.target.closest(this.SAVE_BUTTON_SELECTOR);
        if (!button) return;

        const sp001 = document.querySelector('input[name="SP001_depart_date"]');
        if (!sp001) return; // not a page with SP001 on it

        const spDate = sp001.value.trim();
        if (!spDate) return; // nothing to check yet — same as validate()'s own early return

        if (!this.findMatchingSVDate(spDate)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            alert(`Can't save: SP001's departure date (${spDate}) doesn't match any vessel's departure date.\n\nFix the mismatch (see the warning banner) before saving.`);
        }
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

        document.addEventListener("click", (event) => this.handleSaveClick(event), true);
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
