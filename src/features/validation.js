// ─────────────────────────────────────────────────────
//  FEATURE: SP001 Date Validation
//  Warns the user (via the shared banner) when SP001's
//  departure date doesn't match any SV vessel's departure
//  date. validate() is intentionally NOT called on init —
//  it's triggered by date-syncing.js and vessel-correction.js
//  after they finish writing their own field updates.
// ─────────────────────────────────────────────────────
const SP001DateValidation = {

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
            previous.style.outline         = "";
            previous.style.backgroundColor = "";
            delete previous.dataset.ttBasingOn;
        }
    },

    applyBasingHighlight(field) {
        const previous = document.querySelector('input[data-tt-basing-on]');
        if (previous && previous !== field) {
            previous.style.outline         = "";
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

        return document.querySelector(`input[name="SV${rowMatch[1]}_vessel_name"]`);
    },

    // Same row lookup, but for the voyage number field instead.
    getVoyageFieldForField(fieldName) {
        const rowMatch = fieldName.match(/^SV(\d+)_depart_date$/);
        if (!rowMatch) return null;

        return document.querySelector(`input[name="SV${rowMatch[1]}_start_voyage"]`);
    },

    findMatchingSVDate(spDate) {
    const normalizedSP = DateUtils.normalize(spDate);
    const svFields = document.querySelectorAll(
        'input[name^="SV"][name$="_depart_date"]'
    );

    console.log(`🔍 Checking ${svFields.length} SV dates against ${normalizedSP}`);

    for (const field of svFields) {
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