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
        if (!spDate) { setWarning("sp001-mismatch", null); return; }

        const match = this.findMatchingSVDate(spDate);

        if (match) {
            console.log(`✅ SP001 matches ${match}`);
            setWarning("sp001-mismatch", null);
        } else {
            console.warn(`⚠ No SV departure matches ${spDate}`);
            setWarning("sp001-mismatch", {
                title:   "🚢 Vessel date mismatch",
                message: `No SV vessel found for ${spDate}`
            });
        }
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
        // Nothing extra needed on load; validateSP001Date is called
        // after syncing in the date-syncing feature
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
