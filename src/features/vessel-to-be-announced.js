// ─────────────────────────────────────────────────────
//  FEATURE: Vessel "TBA" Shortcut
//  Typing a single backtick (`) into a vessel name field
//  fills in "VESSEL TO BE ANNOUNCED" and sets that vessel's
//  voyage code to "TBN" (only if it was empty). Clearing a
//  TBA vessel's name also clears a "TBN" voyage code, so a
//  removed placeholder doesn't leave a stale TBN behind.
// ─────────────────────────────────────────────────────
const VesselTBA = {

    init() {},

    handle(event) {
    const target = event.target;
    const { name, value } = target;

    // Only act on real SV*_vessel_name fields, not Tradetech's
    // hidden PV_ duplicates.
    if (!name.match(/^SV\d+_vessel_name$/) || name.startsWith("PV_")) return;

    const voyageFieldName = name.replace("_vessel_name", "_start_voyage");
    const voyageField     = document.querySelector(`input[name="${voyageFieldName}"]`);

    // Backtick shortcut → fill in TBA values.
    if (value.trim() === "`") {
        setFieldValue(target, "VESSEL TO BE ANNOUNCED");
        if (voyageField && !voyageField.value.trim()) {
            setFieldValue(voyageField, "TBN");
        }
        return;
    }

    // Vessel name cleared out → clear the voyage field too, but
    // only if it still says "TBN" (don't touch a real voyage code).
    if (!value.trim()) {
        if (voyageField && voyageField.value.trim() === "TBN") {
            setFieldValue(voyageField, "");
        }
        return;
    }
    },

    // Reserved for future use — not currently needed.
    handleBlur(event) {
    }
};
