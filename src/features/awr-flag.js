// ─────────────────────────────────────────────────────
//  FEATURE: AWR (All Water Route) Auto-Flag
//  Flagged AWR = Yes only if the schedule calls a US port
//  (West or East coast) AND transits the Panama Canal (an
//  exact "PANAMA CANAL, PANAMA" port stop) — both conditions
//  required together. Auto-clicks "Yes" the moment both are
//  found, and auto-clicks back to "No" the moment either one
//  stops holding — this one keeps enforcing itself even past
//  a manual click, unlike the Yes-side below. If the user
//  manually re-selects "Yes" while unqualified, that override
//  is respected (not immediately re-fought) but flagged with a
//  warning banner so it's not a silent mistake.
// ─────────────────────────────────────────────────────
const AwrFlag = {
    PANAMA_CANAL_NAME: "PANAMA CANAL, PANAMA",

    userTouchedRadio: false,        // set once the user clicks the allWater radio themselves — stops further auto-clicking of "Yes" while qualified
    userOverrodeUnqualified: false, // set once the user manually re-selects "Yes" while NOT qualified — stops the auto-revert-to-No fight
    _autoClicking: false,           // guard so our own .click() doesn't get recorded as "the user touched it"

    init() {
        this.run();
    },

    getPortNameFields() {
        return Array.from(document.querySelectorAll('input[type="text"][name^="SP"][name$="_port_name"]'));
    },

    hasPanamaCanal(fields) {
        return fields.some(f => f.value.trim().toUpperCase() === this.PANAMA_CANAL_NAME);
    },

    // "USA" must be one of the last 3 whitespace-separated tokens (each
    // stripped of punctuation before comparing) — tolerates real-world
    // trailing formatting like "(USA)" or "USA," without false-matching
    // "USA" merely appearing inside an unrelated word/port name.
    hasUSPort(fields) {
        return fields.some(f => {
            const tokens = f.value.trim().toUpperCase().split(/\s+/).slice(-3);
            return tokens.some(t => t.replace(/[^A-Z]/g, "") === "USA");
        });
    },

    getRadios() {
        return {
            yes: document.querySelector('input[name="allWater"][value="Yes"]'),
            no:  document.querySelector('input[name="allWater"][value="No"]')
        };
    },

    highlightNo(no) {
        no.style.outline = "2px solid #e67e00";
        no.style.backgroundColor = "#fff8e1";
    },

    clearNoHighlight(no) {
        no.style.outline = "";
        no.style.backgroundColor = "";
    },

    run() {
        const { yes, no } = this.getRadios();
        if (!yes || !no) return; // not a page with the AWR radios

        const fields = this.getPortNameFields();
        const qualifies = this.hasUSPort(fields) && this.hasPanamaCanal(fields);

        if (qualifies) {
            this.clearNoHighlight(no);
            this.userOverrodeUnqualified = false; // fresh start next time it stops qualifying

            if (!yes.checked && !this.userTouchedRadio) {
                this._autoClicking = true;
                try {
                    yes.click(); // real click — fires change, unchecks No natively, matches Tradetech's own OS_allWater sync
                } finally {
                    this._autoClicking = false;
                }
                showTemporaryBanner({
                    title:   "🚩 AWR flagged",
                    message: "US port call and Panama Canal transit detected — set to Yes"
                });
            }
            return;
        }

        // Doesn't qualify right now.
        if (!yes.checked) {
            this.clearNoHighlight(no);
            return;
        }

        if (this.userOverrodeUnqualified) {
            // User deliberately kept/re-picked "Yes" after we already
            // auto-reverted it once — respect that instead of fighting
            // them again, just keep nudging with the highlight.
            this.highlightNo(no);
            return;
        }

        this._autoClicking = true;
        try {
            no.click(); // real click — fires change, matches Tradetech's own OS_allWater sync
        } finally {
            this._autoClicking = false;
        }
        showTemporaryBanner({
            title:   "🚩 AWR unflagged",
            message: "No longer both a US port call and Panama Canal transit — set to No"
        });
    },

    handle(event) {
        const { name } = event.target;
        if (!name) return;

        if (name === "allWater") {
            if (!this._autoClicking) {
                this.userTouchedRadio = true;

                if (event.target.value === "Yes" && event.target.checked) {
                    const fields = this.getPortNameFields();
                    const qualifies = this.hasUSPort(fields) && this.hasPanamaCanal(fields);
                    if (!qualifies) {
                        this.userOverrodeUnqualified = true;
                        showTemporaryBanner({
                            title:   "⚠️ AWR requirements not met",
                            message: "Set to Yes without both a US port call and Panama Canal transit"
                        });
                    }
                }
            }
            this.run(); // refresh the No-highlight cue either way
            return;
        }

        if (/^SP\d+_port_name$/.test(name) || /^SP\d+_port_code$/.test(name)) {
            this.run();

            const codeMatch = name.match(/^SP(\d+)_port_code$/);
            if (codeMatch) this.waitForNameThenRescan(codeMatch[1]);
        }
    },

    // Same polling workaround as port-highlighting.js's identically-named
    // method: Tradetech auto-fills SPnnn_port_name asynchronously after a
    // port_code change, by setting .value directly (no "change" event),
    // so poll briefly until it's populated, then re-scan.
    waitForNameThenRescan(row) {
        clearInterval(this._recheckTimer);

        const codeField = document.querySelector(`input[name="SP${row}_port_code"]`);
        if (!codeField || !codeField.value.trim()) return;

        const nameField = document.querySelector(`input[name="SP${row}_port_name"]`);
        if (!nameField) return;

        let attempts = 0;
        const maxAttempts = 50; // 5s ceiling

        this._recheckTimer = setInterval(() => {
            attempts++;
            if (nameField.value.trim()) {
                clearInterval(this._recheckTimer);
                this.run();
                return;
            }
            if (attempts >= maxAttempts) clearInterval(this._recheckTimer);
        }, 100);
    }
};
