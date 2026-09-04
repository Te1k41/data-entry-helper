// ─────────────────────────────────────────────────────
//  FEATURE: Live Check
//  Fact-checks vessel names, voyage numbers, and dates that
//  have ALREADY been typed into the current Tradetech record
//  against real data pulled from the relay's /fill-test/run
//  endpoint (DOM-scraped operator tables when available,
//  OCR proof extraction otherwise — see
//  service-relay/routes/fill-test.js).
//
//  A field that's already typed in is NEVER overwritten: a
//  disagreement is only flagged via the shared setWarning()
//  banner registry (same convention as SP001DateValidation),
//  PLUS a red outline directly on the field (same visual
//  pattern as the blue "basing on" / purple "suggested"
//  highlights elsewhere in this codebase).
//
//  A field that's genuinely EMPTY, for a vessel we already
//  have confidently-matched real proof/DOM-scrape data for,
//  DOES get filled in (via setFieldValue(), same as every
//  other write-capable feature) -- explicitly requested. This
//  is narrower than the auto-fill this project deliberately
//  moved away from elsewhere: it only ever writes into a blank
//  field, never overwrites something a human already typed.
//
//  Every SV* row on the page is checked. Order matters:
//    1. Find the vessel, primarily by NAME (voyage number alone
//       is real-world confirmed to repeat across different
//       vessels, so it's not used to locate the candidate on its
//       own -- only to disambiguate when one name has several
//       voyages). If the name doesn't resolve but the voyage
//       number matches exactly one vessel in the whole pool,
//       that's flagged as a NAME mismatch instead of going silent.
//    2. Once identity is confirmed, check/fill the departure date.
//    3. Only once the date checks out, also check the voyage
//       number -- for every operator, not just one. Voyage
//       comparison only ever looks at the numeric core (see
//       coreVoyage()), so a carrier whose format doesn't fit that
//       assumption just shows up as a flagged mismatch rather than
//       needing to be special-cased in advance.
//
//  Real bug this guards against: earlier this session, test
//  HTML for one service (MD3-E) got keyed/compared as if it
//  were another service (PR5) — a real, easy mixup. Before
//  comparing anything, this feature checks that the relay's
//  returned `service` matches the CURRENTLY OPEN record's own
//  "service" field, and refuses to compare (shows one clear
//  warning instead) if they don't match.
//
//  Scope is deliberately narrow: only SV*_depart_date fields
//  are checked/highlighted against relay data, at the matched
//  vessel's date at SP001's own port. SP001_port_code is read
//  to figure out WHICH port that is, but no SP* field is
//  itself flagged -- only SV*_depart_date.
//
//  One more check, independent of relay data entirely: when
//  the same real ship (same SV*_lloyds_code/IMO) appears in
//  more than one SV row, exactly one of those rows should be
//  left unticked SV*_one-off (the field vessel-correction.js
//  already reads/excludes on) -- the rest mark it as an
//  exception call, not a second regular rotation slot. Any
//  other count gets flagged and the offending checkboxes
//  highlighted.
// ─────────────────────────────────────────────────────
const LiveCheck = {

    RELAY_URL:      "http://localhost:3737/fill-test/run",
    POLL_INTERVAL_MS: 20000, // steady-state cadence, once real vessel data exists for this service
    WAITING_POLL_MS:  4000,  // faster cadence while NO usable vessel data exists yet -- e.g. right after typing in a service that hasn't had its proof/DOM-scrape downloaded yet

    _fillData:     null,
    _activeFields: new Set(), // fields currently red-highlighted
    _pollTimer:    null,
    _waitingTimer: null, // set only while in the faster "waiting for first data" cadence; null once real vessel data has arrived
    _relayConnected: null,

    // IDs the clerk has dismissed via "I know what I'm doing" -- in-memory
    // only, never persisted, so a tab refresh (a fresh content-script load)
    // clears it and the check starts flagging again. Deliberate: this is
    // an acknowledgment for THIS sitting at the record, not a permanent
    // "never check this again" setting.
    _dismissed: new Set(),

    // Separate from the SHARED `syncing` flag (declared in main.js) --
    // that one is set by many DIFFERENT write-capable features (date-
    // syncing.js, date-step-buttons.js's +/- buttons, vessel-correction.js,
    // ...) whenever ANY of them is mid-write, to stop each other from
    // cascading into loops. Confirmed real: date-step-buttons.js wraps
    // every non-SP001 date write inside the shared sync guard, so if this feature
    // also bailed on the shared flag, it would never notice a +/- click on
    // an SV*_depart_date field at all. This flag is true ONLY while THIS
    // feature's own applyFills() is writing -- it's what handle()/
    // handleInput() actually need to guard against (their own write
    // re-triggering themselves), not every other feature's writes too.
    _ownWriteInProgress: false,

    MISMATCH_HIGHLIGHT: {
        outline:         "2px solid #b00020",
        backgroundColor: "#ffd6d6"
    },

    applyMismatchHighlight(field) {
        if (!field) return;
        field.style.outline         = this.MISMATCH_HIGHLIGHT.outline;
        field.style.backgroundColor = this.MISMATCH_HIGHLIGHT.backgroundColor;
        field.dataset.ttLiveCheckMismatch = "1";
    },

    clearMismatchHighlight(field) {
        if (!field) return;
        field.style.outline = "";
        field.style.backgroundColor = "";
        delete field.dataset.ttLiveCheckMismatch;
    },

    init() {
        Toolbar.register({
            id:      "tt-live-check-refresh",
            label:   "🔍 Live Check",
            title:   "Refresh proof comparison data and highlight current mismatches",
            group:   "proof",
            requiresRelay: true,
            onClick: () => this.fetchFillData() // manual override -- the automatic poll below is what makes this "live"
        });
        onRelayConnectionStatusChange((state) => this.setRelayState(state === "connected"));

        // Delegated on document, not on #tt-banner itself -- banner.js
        // tears down and rebuilds that element on every render, so a
        // listener attached directly to it wouldn't survive the next
        // compareAll() pass.
        document.addEventListener("click", (event) => this.handleDismissClick(event));

        // main.js only delegates "change" (fires on blur/commit, not while
        // actively typing) to every feature's handle() -- there's no
        // shared "input" dispatch, and adding one there would make EVERY
        // feature re-run per keystroke, not just this one. So this feature
        // listens for its own "input" directly, scoped to just the fields
        // it already cares about, debounced so a burst of keystrokes
        // collapses into one recompute instead of one per character.
        document.addEventListener("input", (event) => this.handleInput(event));
    },

    setRelayState(connected) {
        if (this._relayConnected === connected) return;
        this._relayConnected = connected;
        clearInterval(this._pollTimer);
        clearInterval(this._waitingTimer);
        this._pollTimer = null;
        this._waitingTimer = null;

        if (connected) {
            this.fetchFillData();
            this._pollTimer = setInterval(() => this.fetchFillData(), this.POLL_INTERVAL_MS);
        } else {
            this._fillData = null;
            this.compareAll(); // retains relay-independent duplicate-IMO checks
        }
    },

    handleDismissClick(event) {
        const button = event.target.closest("[data-tt-live-check-dismiss]");
        if (!button) return;
        this._dismissed.add(button.dataset.ttLiveCheckDismiss);
        this.compareAll();
    },

    INPUT_DEBOUNCE_MS: 400,

    handleInput(event) {
        if (this._ownWriteInProgress) return; // our own setFieldValue() writes also fire "input" -- ignore those, but not other features'

        const { name } = event.target;
        if (!name) return;

        // Service is still only refetched on "change" (see handle() below)
        // -- typing it character by character shouldn't hit the relay on
        // every keystroke, only once the field is committed.
        if (name === "service") return;

        if (this.RELEVANT_PATTERN.test(name)) {
            clearTimeout(this._inputDebounceTimer);
            this._inputDebounceTimer = setTimeout(() => this.compareAll(), this.INPUT_DEBOUNCE_MS);
        }
    },

    _fetchSeq: 0, // bumped on every call -- a response is only applied if it's still the LATEST request, so an older poll/manual/service-change fetch that happens to resolve after a newer one can't clobber fresher data with stale data
    _fetchInFlight: false, // true from the moment a request starts until it finishes/aborts
    FETCH_TIMEOUT_MS: 15000, // /fill-test/run can trigger a slow on-demand OCR extraction server-side when no DOM-scrape exists yet -- this caps how long ANY single attempt is allowed to block the next one

    // Real bug this guards against: WAITING_POLL_MS's 4s retry (below) had
    // no protection against a slow response -- if /fill-test/run's
    // on-demand OCR fallback took longer than 4s (plausible, it's a real
    // Tesseract/PaddleOCR subprocess call), every tick fired ANOTHER
    // concurrent extraction on top of the still-running one, stacking
    // without bound and exhausting CPU/RAM. _fetchInFlight makes every
    // tick that finds a request already running a no-op instead of piling
    // on; the AbortController timeout below makes sure a single hung
    // request can't lock this guard forever either.
    async fetchFillData() {
        if (!this._relayConnected) return;
        if (this._fetchInFlight) {
            console.log("⏳ Live Check: previous /fill-test/run request still in flight -- skipping this tick instead of stacking another");
            return;
        }
        this._fetchInFlight = true;

        const seq = ++this._fetchSeq;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);

        try {
            const res = await fetch(this.RELAY_URL, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    "{}",
                signal:  controller.signal,
            });
            if (seq !== this._fetchSeq) return; // a newer request has since started -- this one is stale
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                if (seq !== this._fetchSeq) return;
                console.warn(`⚠ Live Check: /fill-test/run returned ${res.status} — ${body.error || "(no message)"}`);
                this._fillData = null;
                this.compareAll();
                this.enterWaitingMode(); // e.g. 409 "no guideline currently captured" -- keep checking fast until one is
                return;
            }
            const data = await res.json();
            if (seq !== this._fetchSeq) return;
            this._fillData = data;
            console.log(`🔍 Live Check: loaded fill data for service ${this._fillData.service || "(blank)"} — ${this._fillData.vessels?.length || 0} OCR/DOM vessel(s), source ${this._fillData.proofSource || "?"}`);
            this.compareAll();

            if (Array.isArray(data.vessels) && data.vessels.length) {
                this.exitWaitingMode(); // real data is in -- back to the normal cadence
            } else {
                this.enterWaitingMode(); // guideline exists but no proof/DOM-scrape yet -- keep checking fast until one lands
            }
        } catch (err) {
            if (seq !== this._fetchSeq) return;
            if (err.name === "AbortError") {
                console.warn(`⚠ Live Check: /fill-test/run took longer than ${this.FETCH_TIMEOUT_MS / 1000}s -- aborted (relay OCR extraction may be slow or stuck)`);
            }
            this._fillData = null;
            this.compareAll();
            this.enterWaitingMode();
        } finally {
            clearTimeout(timeoutId);
            this._fetchInFlight = false;
        }
    },

    // Entered right after a service is typed in (or on any fetch that
    // comes back with no usable vessels[]) -- switches from the normal
    // 20s cadence to a faster one so the very first real proof/DOM-scrape
    // for this service fires the check within seconds of landing, not up
    // to 20s later. Idempotent: calling it again while already waiting is
    // a no-op, so a burst of fetches with the same empty result doesn't
    // stack multiple timers.
    enterWaitingMode() {
        if (!this._relayConnected || this._waitingTimer) return;
        console.log(`⏳ Live Check: no vessel data yet for this service — checking every ${this.WAITING_POLL_MS / 1000}s until it's downloaded`);
        clearInterval(this._pollTimer);
        this._waitingTimer = setInterval(() => this.fetchFillData(), this.WAITING_POLL_MS);
    },

    // Drops back to the normal 20s cadence once real vessel data has
    // arrived -- the fast cadence's whole purpose was just to catch that
    // first arrival quickly, not to keep polling aggressively forever.
    exitWaitingMode() {
        if (!this._waitingTimer) return;
        clearInterval(this._waitingTimer);
        this._waitingTimer = null;
        console.log("✅ Live Check: vessel data arrived — back to the normal 20s poll");
        clearInterval(this._pollTimer);
        this._pollTimer = setInterval(() => this.fetchFillData(), this.POLL_INTERVAL_MS);
    },

    // ── small client-side mirrors of fill-calc.js's identity rules ──
    // Duplicated on purpose, same as this codebase's other small
    // per-file helpers (e.g. getPortCategory in port-highlighting.js)
    // rather than importing across the extension/relay boundary.

    // Confirmed real (MD3-E): Yang Ming's "Comn. Voy." column carries an
    // alliance-partner prefix Tradetech never types in -- "GT634E" in the
    // DOM-scrape vs Tradetech's own "634E" for the exact same voyage. A
    // trailing direction letter is also just the whole service's own
    // direction (constant across every vessel on one page, e.g. every
    // MD3-E voyage ends in "E"), not something that tells two different
    // vessels' voyages apart. So both ends are stripped -- compare only
    // the numeric core, zero-padding differences included.
    coreVoyage(value) {
        const upper = String(value || "").trim().toUpperCase();
        const digits = upper.replace(/^[^0-9]+/, "").replace(/[^0-9]+$/, "");
        return digits.replace(/^0+(?=\d)/, "");
    },

    voyagesMatch(a, b) {
        const left = String(a || "").trim().toUpperCase();
        const right = String(b || "").trim().toUpperCase();
        if (!left || !right) return false;
        return this.coreVoyage(left) === this.coreVoyage(right);
    },

    identityWords(value) {
        return new Set(String(value || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
    },

    vesselNamesMatch(a, b) {
        const left = this.identityWords(a), right = this.identityWords(b);
        if (!left.size || !right.size) return false;
        const isSubset = (small, big) => { for (const w of small) if (!big.has(w)) return false; return true; };
        return isSubset(left, right) || isSubset(right, left);
    },

    // Normalizes an IMO/Lloyds code the same way fill-calc.js's
    // normalizeImo() does server-side (7 digits, else not usable as an
    // identity key) -- mirrored client-side like coreVoyage()/
    // vesselNamesMatch() above, same reasoning as the file header.
    normalizedImo(value) {
        const trimmed = String(value || "").trim();
        return /^\d{7}$/.test(trimmed) ? trimmed : null;
    },

    // Name is the primary identity key (voyage numbers repeat across
    // different vessels, confirmed real, so voyage alone was never a safe
    // way to find the right candidate). When the same name appears more
    // than once in the pool (a vessel with several voyages), the typed
    // voyage number disambiguates WHICH sailing.
    //
    // Exact IMO/Lloyds code match is checked FIRST, ahead of name --
    // it's the same canonical identity duplicate-vessel.js keys rows on
    // (SV{row}_lloyds_codeD), and unlike a name it can't collide on a
    // typo or an alliance-partner naming variant. Only trusted when it
    // resolves to exactly one pool vessel.
    //
    // When neither resolves, fall back to voyage alone -- but only trust
    // it when it's unambiguous across the WHOLE pool, and treat it as a
    // NAME problem (nameOk: false), not a full match: this is what
    // actually catches "right voyage, wrong vessel name typed" instead
    // of just going silent.
    //
    // Returns { vessel, nameOk } or null (no confident identity at all).
    matchVessel(typed) {
        const pool = this._fillData?.vessels || [];
        if (!typed.name && !typed.voyage && !typed.imo) return null;

        if (typed.imo) {
            const byImo = pool.filter(v => this.normalizedImo(v.imo) === typed.imo);
            if (byImo.length === 1) return { vessel: byImo[0], nameOk: true };
        }

        const byName = typed.name ? pool.filter(v => this.vesselNamesMatch(v.vessel, typed.name)) : [];
        if (byName.length === 1) return { vessel: byName[0], nameOk: true };

        if (byName.length > 1 && typed.voyage) {
            const byBoth = byName.filter(v => this.voyagesMatch(v.voyage, typed.voyage));
            if (byBoth.length === 1) return { vessel: byBoth[0], nameOk: true };
        }

        // Voyage-only fallback only when the name matched NOBODY at all
        // (byName.length === 0) -- if it matched several candidates that
        // the voyage number then failed to narrow to one, that's a real
        // ambiguity, not a "name is wrong" situation, and searching the
        // WHOLE pool at that point could latch onto a completely
        // unrelated vessel that just happens to share the voyage number.
        // Not operator-gated -- coreVoyage() only ever looks at the
        // numeric core, so a format this doesn't fit just surfaces as a
        // flagged mismatch instead of silently guessing wrong.
        if (byName.length === 0 && typed.voyage) {
            const byVoyage = pool.filter(v => this.voyagesMatch(v.voyage, typed.voyage));
            if (byVoyage.length === 1) return { vessel: byVoyage[0], nameOk: false };
        }

        return null; // ambiguous or not found -- stay quiet rather than guess
    },

    // ── reading the page ──

    readSvRow(n) {
        const nameField = VesselRow.field(n, "vessel_name");
        const codeField = VesselRow.field(n, "lloyds_codeD");
        const name = nameField?.value.trim() || "";
        const imo  = this.normalizedImo(codeField?.value);
        // A row with neither a name NOR a resolvable code is genuinely
        // empty -- nothing to check. A code-only row (name not typed yet)
        // stays visible: matchVessel() can still resolve it by IMO alone.
        if (!name && !imo) return null;

        const voyageField  = VesselRow.field(n, "start_voyage");
        const departField  = VesselRow.field(n, "depart_date");
        return {
            n, nameField, name, imo,
            voyageField, voyage: voyageField?.value.trim() || "",
            departField, departDate: departField?.value.trim() || "",
        };
    },

    allSvRows() {
        const rows = [];
        document.querySelectorAll('input[name^="SV"][name$="_vessel_name"]').forEach(field => {
            const match = field.name.match(/^SV(\d+)_vessel_name$/);
            if (!match) return;
            const row = this.readSvRow(match[1]);
            if (row) rows.push(row);
        });
        return rows;
    },

    // ── comparing ──

    // Same physical ship (same lloyds_code/IMO) shouldn't hold two REGULAR
    // rotation slots at once -- a repeat occurrence should be ticked
    // SV*_one-off (the field vessel-correction.js already reads/excludes
    // on, same convention reused here) to mark it as the exception, not
    // the normal recurring entry. Pure page-internal consistency check --
    // doesn't touch relay data at all.
    checkDuplicateImos(add) {
        const groups = new Map(); // imo -> [{ n, oneOffField, checked }]
        // Keyed on lloyds_codeD, NOT the hidden lloyds_code -- same
        // canonical identity field duplicate-vessel.js uses
        // (vesselCodeField()), so a code typed/duplicated just now is
        // seen immediately rather than waiting on Tradetech's own sync
        // into the hidden mirror field.
        document.querySelectorAll('input[name^="SV"][name$="_lloyds_codeD"]').forEach(field => {
            const match = field.name.match(/^SV(\d+)_lloyds_codeD$/);
            if (!match) return;
            const imo = field.value.trim();
            if (!/^\d{7}$/.test(imo)) return;

            const n = match[1];
            const oneOffField = document.querySelector(`input[name="SV${n}_one-off"]`);
            if (!groups.has(imo)) groups.set(imo, []);
            groups.get(imo).push({ n, oneOffField, checked: Boolean(oneOffField?.checked) });
        });

        for (const [imo, rows] of groups) {
            if (rows.length < 2) continue;

            const notOneOff = rows.filter(r => !r.checked);
            if (notOneOff.length === 1) continue; // exactly one regular entry -- correct

            const rowList = rows.map(r => `SV${r.n}`).join(", ");
            if (notOneOff.length === 0) {
                add(`dup-imo-${imo}`, rows.map(r => r.oneOffField), `IMO ${imo} (${rowList}): all ${rows.length} ticked One-off — exactly one should stay unticked`);
            } else {
                const offenders = notOneOff.map(r => `SV${r.n}`).join(", ");
                add(`dup-imo-${imo}`, notOneOff.map(r => r.oneOffField), `IMO ${imo} (${rowList}): ${offenders} not ticked One-off — only one of ${rows.length} should be unticked`);
            }
        }
    },

    DISMISS_BUTTON_STYLE: "margin-left:6px;font-size:9px;padding:0 3px;cursor:pointer;background:#fff;color:#000;border:1px solid #000;border-radius:0;",

    // One line of banner text plus its own "I know what I'm doing" button
    // -- clicking it (handleDismissClick(), delegated on document since
    // banner.js rebuilds this element every render) adds item.id to
    // _dismissed and re-runs compareAll(), which drops it from both the
    // banner and the red highlight until the tab reloads.
    renderItemLine(item) {
        return `${item.line}<button data-tt-live-check-dismiss="${item.id}" style="${this.DISMISS_BUTTON_STYLE}">I know what I'm doing</button>`;
    },

    // Every mismatch collapses into ONE setWarning key with one short line
    // each -- not a separate title+message block per field. With several
    // vessels on a record, one block per issue would stack into a huge
    // card; a red outline on the actual field (below) already points at
    // exactly where each problem is, so the banner text only needs to be
    // a compact list.
    compareAll() {
        const items = []; // { id, fields: Field[], line } -- mismatches
        const fills = [];  // { row, date }                -- field is EMPTY and we have a real value for it
        const add = (id, fieldOrFields, line) => {
            const fields = Array.isArray(fieldOrFields) ? fieldOrFields.filter(Boolean) : (fieldOrFields ? [fieldOrFields] : []);
            items.push({ id, fields, line });
        };

        // Pure page-internal consistency check -- doesn't need relay data
        // at all, so it runs regardless of whether fill data loaded.
        this.checkDuplicateImos(add);

        // Checked independently of whether vessels[] happens to be
        // non-empty -- a service that genuinely has zero DOM-scraped/OCR
        // vessels yet would otherwise skip this safety check entirely
        // (silently, no "paused" warning at all) instead of just skipping
        // the (empty) vessel loop below it.
        if (this._fillData) {
            const pageServiceField = document.querySelector('input[name="service"]');
            const pageService = pageServiceField?.value.trim() || "";
            const dataService = String(this._fillData.service || "").trim();

            if (pageService && dataService && pageService.toUpperCase() !== dataService.toUpperCase()) {
                add("service-mismatch", pageServiceField, `⛔ Live Check paused — relay has ${dataService}, page shows ${pageService}`);
            } else if (Array.isArray(this._fillData.vessels) && this._fillData.vessels.length) {
                for (const row of this.allSvRows()) {
                    const result = this.matchVessel(row);
                    if (!result) continue;
                    const match = result.vessel;

                    if (!result.nameOk) {
                        add(`sv${row.n}-name`, row.nameField, `SV${row.n} name: "${row.name}" ≠ "${match.vessel || "(blank)"}" (voyage ${match.voyage})`);
                        continue; // identity itself is in question -- don't check/fill dates against a possibly-wrong vessel
                    }

                    const datesOk = this.compareDates(row, match, add, fills);

                    // Voyage numbers are only inspected once the name match
                    // is confirmed AND the date checks out. Applies to every
                    // operator -- coreVoyage() reduces to the numeric core
                    // only, so a format it doesn't fit just surfaces as a
                    // flagged (dismissible) mismatch rather than needing an
                    // operator allowlist here.
                    if (datesOk) {
                        this.compareVoyage(row, match, add);
                    }
                }
            }
        }

        // A dismissed id is dropped entirely -- no banner line, no
        // highlight -- until the tab reloads (see _dismissed above).
        const visibleItems = items.filter(item => !this._dismissed.has(item.id));

        // Clear the highlight on any field no longer flagged, apply it to
        // whatever's flagged now -- and show the whole list as one banner.
        const nextFields = new Set(visibleItems.flatMap(item => item.fields));
        for (const field of this._activeFields) {
            if (!nextFields.has(field)) this.clearMismatchHighlight(field);
        }
        for (const field of nextFields) this.applyMismatchHighlight(field);
        this._activeFields = nextFields;

        setWarning("live-check", visibleItems.length ? {
            title:   `🚢 Live Check — ${visibleItems.length} issue${visibleItems.length > 1 ? "s" : ""}`,
            message: visibleItems.map(item => this.renderItemLine(item)).join("<br>"),
        } : null);

        // Filling happens LAST, after warnings/highlights are settled --
        // setFieldValue() dispatches real "input"/"change" events, which
        // would otherwise re-enter compareAll() (via handle()/handleInput()
        // below) mid-loop. Their `if (this._ownWriteInProgress) return`
        // guard is what actually stops that reentrancy; doing the writes
        // last just keeps this pass's own bookkeeping simple.
        if (fills.length) this.applyFills(fills);
    },

    // Every SV*_depart_date is checked against its matched vessel's date at
    // the SAME PORT SP001 represents -- SP001_port_code (read straight off
    // the page) resolved within that vessel's own port list, not blindly
    // "rotation index 0", since that's the actual reference point SP001
    // already is for the whole record (same anchor SP001DateValidation
    // uses). Falls back to rotation index 0 only when SP001's port code
    // isn't typed in yet at all -- if it IS typed but doesn't resolve to
    // any port in this vessel's own list, that's a real unknown, not
    // "assume it's the first port": silently comparing/auto-filling
    // against the wrong port would be worse than not checking this row.
    // And specifically the DEPARTURE (etd) date, not an eta fallback --
    // "SP001 port's departure date" is the explicit benchmark, not
    // whichever of the two happens to be present.
    resolveSp001Port(match) {
        const ports = match.ports || [];
        const sp001Code = document.querySelector('input[name="SP001_port_code"]')?.value.trim().toUpperCase();
        if (sp001Code) {
            return ports.find(p => p.portCode && p.portCode.trim().toUpperCase() === sp001Code) || null;
        }
        return ports.find(p => p.rotationIndex === 0) || null;
    },

    // An EMPTY field gets filled with real proof/DOM-scrape data we're
    // already confident belongs to it (name-matched) -- explicitly
    // requested, and narrower than the auto-fill this project deliberately
    // avoided elsewhere: it only ever writes into a BLANK field, never
    // overwrites something already typed (that case is a mismatch to flag,
    // not fill).
    //
    // Returns true when the date is confirmed correct (matched, or just
    // filled from the same source) -- false on a mismatch, or when there's
    // no real data to check against at all. compareVoyage() below only
    // runs when this returns true.
    compareDates(row, match, add, fills) {
        const sp001Port = this.resolveSp001Port(match);
        if (!sp001Port || !sp001Port.hasData || !sp001Port.etd) return false;

        if (!row.departDate) {
            // row.departField can be null (name field exists, its matching
            // depart_date field doesn't) -- guard here rather than let
            // applyFills() hit setFieldValue(null, ...) later.
            if (row.departField) fills.push({ row, date: sp001Port.etd });
            return true;
        }

        if (DateUtils.normalize(row.departDate) !== DateUtils.normalize(sp001Port.etd)) {
            add(`sv${row.n}-depart-date`, row.departField, `SV${row.n} depart: ${row.departDate} ≠ ${sp001Port.etd} (${match.vessel || "vessel"} @ SP001)`);
            return false;
        }
        return true;
    },

    // Voyage number check -- secondary to name+date, runs for every
    // operator. Uses coreVoyage() (leading/trailing letters stripped,
    // numeric core only) already relied on elsewhere in this file.
    compareVoyage(row, match, add) {
        if (row.voyage && match.voyage && !this.voyagesMatch(row.voyage, match.voyage)) {
            add(`sv${row.n}-voyage`, row.voyageField, `SV${row.n} voyage: "${row.voyage}" ≠ "${match.voyage}" (${row.name})`);
        }
    },

    // One syncing guard around the whole batch (not per-field) and ONE
    // confirmation banner listing everything filled -- several separate
    // banners firing in a row would just overwrite each other anyway
    // (showTemporaryBanner owns a single element), and per-field toasts
    // are exactly the "big notif card" noise this feature already avoids
    // for mismatches.
    applyFills(fills) {
        const applied = [];
        // Sets BOTH: the shared `syncing` flag so OTHER features (date-
        // syncing.js, etc.) correctly ignore these writes, and our own
        // _ownWriteInProgress so THIS feature's handle()/handleInput()
        // ignore the resulting events too -- see _ownWriteInProgress above
        // for why these can't just be the same flag.
        beginSync();
        this._ownWriteInProgress = true;
        try {
            for (const { row, date } of fills) {
                // Per-item try/catch -- one bad write must never silently
                // swallow the rest of the batch (a thrown error inside a
                // for-loop stops iteration entirely, not just that item).
                try {
                    setFieldValue(row.departField, date);
                    console.log(`✏️ Live Check: filled empty SV${row.n}_depart_date with ${date} from proof data`);
                    applied.push({ row, date });
                } catch (err) {
                    console.error(`❌ Live Check: fill failed for SV${row.n} —`, err);
                }
            }
        } finally {
            endSync();
            this._ownWriteInProgress = false;
        }
        if (!applied.length) return;
        showTemporaryBanner({
            title:   `✏️ Live Check filled ${applied.length} date${applied.length > 1 ? "s" : ""}`,
            message: applied.map(({ row, date }) => `SV${row.n}: ${date}`).join("<br>"),
        });
    },

    // ── module interface ──

    // SP001_port_code is only ever READ (in resolveSp001Port) to figure out
    // which port position SV*_depart_date should be checked against -- no
    // SP* field is itself flagged or highlighted. SV*_lloyds_code and
    // SV*_one-off are read for the duplicate-IMO check (checkDuplicateImos)
    // in addition to being possible highlight targets there.
    RELEVANT_PATTERN: /^SV\d+_(vessel_name|lloyds_codeD|start_voyage|depart_date|one-off)$|^SP001_port_code$/,

    handle(event) {
        // Guards against OUR OWN applyFills() writes re-entering compareAll()
        // mid-batch -- deliberately NOT the shared `syncing` flag (see
        // _ownWriteInProgress above): that one is also set by unrelated
        // write-capable features (date-step-buttons.js's +/- buttons,
        // vessel-correction.js, date-syncing.js's cascades), and this
        // feature needs to react to THEIR writes, not just its own.
        if (this._ownWriteInProgress) return;

        const { name } = event.target;
        if (!name) return;

        if (name === "service") {
            this.fetchFillData(); // a different record may now be open -- refresh, don't just recompare stale data
            return;
        }

        if (this.RELEVANT_PATTERN.test(name)) {
            this.compareAll();
        }
    },
};
