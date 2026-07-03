// ─────────────────────────────────────────────────────
//  FEATURE: Voyage Direction Suffix
//  Auto-appends a compass-direction letter (N/S/E/W) to
//  voyage codes when the `service` field ends in a matching
//  direction suffix (e.g. "ABC-N"). Toggleable via an
//  on-page button; resets to ON every page load.
// ─────────────────────────────────────────────────────
const VDirection = {

    enabled: true,  // toggle state lives directly on the feature object

    init() {
        createButton({
            id:      "tt-voyage-direction-toggle",
            label:   "🧭 Direction: ON",
            top:     "350px",
            left:    "30px",
            onClick: () => {
                this.enabled = !this.enabled;
                const btn = document.getElementById("tt-voyage-direction-toggle");
                if (btn) btn.textContent = `🧭 Direction: ${this.enabled ? "ON" : "OFF"}`;
                console.log(`🧭 Voyage direction auto-suffix: ${this.enabled ? "ON" : "OFF"}`);
            }
        });
    },

    handle(event) {
        if (!this.enabled) return;  // skip everything if toggled off

        const target = event.target;
        const { name, value } = target;

        // Only act on real SV*_start_voyage fields, not PV_ duplicates.
        if (!name.match(/^SV\d+_start_voyage$/) || name.startsWith("PV_")) return;

        const serviceField = document.querySelector('input[name="service"]');
        if (!serviceField) return;

        // Look for a trailing compass direction on the service code, e.g. "ABC-N".
        const serviceMatch = serviceField.value.match(/-([NSEW])$/i);
        if (!serviceMatch) return; // not a directional service — do nothing

        const direction = serviceMatch[1].toUpperCase();

        if (!value.trim()) return;           // nothing typed yet
        if (/[A-Za-z]$/.test(value)) return; // already has a letter suffix — don't double up

        setFieldValue(target, value + direction);
    },

    // Reserved for future use — not currently needed.
    handleBlur(event) {}
};
