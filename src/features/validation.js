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
        if (!spDate) { removeBanner(); return; } // nothing entered yet, no warning needed

        const match = this.findMatchingSVDate(spDate);

        if (match) {
            console.log(`✅ SP001 matches ${match}`);
            removeBanner();
        } else {
            console.warn(`⚠ No SV departure matches ${spDate}`);
            showBanner({
                title:   "🚢 Vessel date mismatch",
                message: `No SV vessel found for ${spDate}`
            });
        }
    },

    // Compares SP001's date against every SV*_depart_date field.
    // Uses DateUtils.normalize() so "06/25/26" and "062526" are
    // treated as equal. Returns the matching field's name, or null.
    findMatchingSVDate(spDate) {
    const normalizedSP = DateUtils.normalize(spDate);

    // name^="SV"  → starts with "SV"
    // name$="_depart_date" → ends with "_depart_date"
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
        // Nothing extra needed on load; validate() is called
        // after syncing in the date-syncing feature instead.
    },

    // Only re-runs validation when an SV departure date or one of
    // SP001's own date fields changes — everything else is ignored
    // even though this listens to every field change globally.
    handle(event) {
        const { name } = event.target;
        const isSVDate  = name?.startsWith("SV") && name?.endsWith("_depart_date");
        const isSP001   = name === "SP001_depart_date" || name === "SP001_arrival_date";

        if (isSVDate || isSP001) {
            this.validate();
        }
    },
    handleBlur(event)
    {
        const { name } = event.target;
        const isSVDate  = name?.startsWith("SV") && name?.endsWith("_depart_date");
        const isSP001   = name === "SP001_depart_date" || name === "SP001_arrival_date";

        if (isSVDate || isSP001) {
            this.validate();
        }
    }
};
