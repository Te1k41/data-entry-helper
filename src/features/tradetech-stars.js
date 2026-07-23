// ─────────────────────────────────────────────────────
//  FEATURE: Tradetech Stars
//  Decorative pass over the page — bigger twinkling stars on
//  top, a couple of subtle halftone-dot corner patches, and
//  the plain light-gray background bands turned plain white.
//  Deliberately does NOT touch anything functional: no input,
//  select, button, or textarea is ever touched, and no TEXT
//  color changes anywhere. Gray-to-white needs none: the
//  existing black text/links already read fine on white, same
//  as they did on light gray, so nothing about what you've
//  been using changes, only the background tone underneath it.
//
//  NOTE: a CSS filter:invert(1) dark-theme attempt was tried and
//  reverted here — applying `filter` to <html> makes it a new
//  containing block for every position:fixed descendant, which
//  would have broken the pinned positioning of Toolbar, every
//  banner type, and the notes sidebar (they'd scroll away with
//  the page instead of staying fixed). Real functional breakage,
//  not just cosmetic — do not reintroduce a page-level filter
//  without moving all position:fixed UI outside its subtree first.
//
//  Runs in every frame (Tradetech uses a frameset), but only on
//  tradetech.net itself — this file is shared with
//  mergeimagesonline.com via the same manifest.json block, and
//  that page doesn't need this.
// ─────────────────────────────────────────────────────
const TradetechStars = {
    init() {
        if (location.hostname !== "www.tradetech.net") return;
        if (document.getElementById("tt-stars")) return; // never double-inject

        this.recolorGrayToWhite();
        this.reinforceInputBoxes();
        this.neutralizeMandatoryFill();
        this.neutralizeAutofillFill();
        this.buildScrollbarStyle();
        this.addRequiredFieldStars();
        this.buildStars();
        this.buildHalftone();

        // Tradetech renders this page as a stack of frames, and each one
        // gets its own copy of this script (all_frames content script) with
        // its own independent darkModeOn — without this, clicking the toggle
        // in one frame's Tools panel left every other frame still white.
        // localStorage is shared per-origin across all of them, and the
        // "storage" event fires in every OTHER frame when one of them
        // writes to it, so one click now drives all frames together.
        // Constructed here, before the initial applyDarkMode() below, but
        // deliberately NOT armed (.observe()) until a full chunked sweep
        // finishes — see startDarkModeObserver()'s comment for why the
        // ordering here matters.
        this.startDarkModeObserver();

        this.darkModeOn = localStorage.getItem("tt-darkmode") === "1";
        if (this.darkModeOn) this.applyDarkMode();
        this.syncPageBackground();
        this.syncDecorationColor();
        this.syncInputShadow();

        this.buildDarkModeToggle();
        this.buildNativeViewToggle();
        this.listenForDarkModeSync();
    },

    listenForDarkModeSync() {
        window.addEventListener("storage", (e) => {
            if (e.key !== "tt-darkmode") return;
            const shouldBeDark = e.newValue === "1";
            if (shouldBeDark === this.darkModeOn) return;
            this.darkModeOn = shouldBeDark;
            if (this.darkModeOn) this.applyDarkMode();
            else this.removeDarkMode();
            this.syncPageBackground();
            this.syncDecorationColor();
            this.syncInputShadow();
            Toolbar.updateLabel("tt-darkmode-toggle", this.darkModeOn ? "☀️ Dark Mode: ON" : "🌙 Dark Mode: OFF");
        });
    },

    // Always on (not dark-mode-gated): recolorGrayToWhite() flattens the
    // light-gray table cells around fields to plain white, which also wiped
    // out the faint contrast that used to hint where an input box's edge
    // was. Give every input/select/textarea a visible mid-gray border so the
    // box itself stays readable in plain white mode too.
    reinforceInputBoxes() {
        document.querySelectorAll("input, select, textarea").forEach(el => {
            const style = getComputedStyle(el);
            ["Top", "Right", "Bottom", "Left"].forEach(side => {
                const rgb = this.parseRgb(style[`border${side}Color`]);
                const l = rgb ? this.rgbToHsl(...rgb)[2] : 100; // no parseable color = treat as invisible
                if (l <= 80) return;
                const prop = `border-${side.toLowerCase()}`;
                el.style.setProperty(`${prop}-color`, "#999999", "important");
                if (parseFloat(style[`border${side}Width`]) < 1) {
                    el.style.setProperty(`${prop}-width`, "1px", "important");
                    el.style.setProperty(`${prop}-style`, "solid", "important");
                }
            });
        });
    },

    // A small gold star next to every required (.mand) field — the
    // replacement for the native yellow fill we neutralize below. Drawn as
    // a fixed-position overlay instead of inserting into Tradetech's own
    // table cells, so it can't shift any native column width or row layout.
    //
    // Uses viewport coordinates (position:fixed + raw getBoundingClientRect
    // values) and recomputes on every scroll/resize, rather than computing
    // once with position:absolute + window.scrollX/Y. That absolute-based
    // math assumed the whole document is what scrolls — on a page like the
    // Rotation Schedule table, which can scroll in its own inner container,
    // the stars would be placed once at load and then never move again as
    // the real fields scrolled underneath them, drifting onto whatever
    // ended up in that same screen position (e.g. the Port code column).
    //
    // Skips any field that has another input/select/textarea sitting right
    // up against its right edge on the same row (e.g. a code field like
    // Alliance's "consortium" immediately followed by its description field,
    // no gap) — there's no room for a star there without it overlapping the
    // next box.
    addRequiredFieldStars() {
        if (document.getElementById("tt-required-stars")) return;

        const container = document.createElement("div");
        container.id = "tt-required-stars";
        container.style.cssText = `
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 0 !important;
            height: 0 !important;
            pointer-events: none !important;
        `;
        document.body.appendChild(container);

        const allFields = Array.from(document.querySelectorAll("input, select, textarea"));
        const tracked = [];

        document.querySelectorAll("input.mand, select.mand, textarea.mand").forEach(el => {
            const rect = el.getBoundingClientRect();

            const crowded = allFields.some(other => {
                if (other === el) return false;
                const r = other.getBoundingClientRect();
                return Math.abs(r.top - rect.top) < 4 && r.left >= rect.right && (r.left - rect.right) < 20;
            });
            if (crowded) return;

            const star = document.createElement("span");
            star.textContent = "★";
            star.style.cssText = `
                position: fixed !important;
                color: #e6a800 !important;
                font-size: 14px !important;
                line-height: 1 !important;
                z-index: 50 !important;
            `;
            container.appendChild(star);
            tracked.push({ el, star });
        });

        const reposition = () => {
            tracked.forEach(({ el, star }) => {
                const rect = el.getBoundingClientRect();
                const offscreen = rect.width === 0 && rect.height === 0;
                star.style.display = offscreen ? "none" : "";
                if (offscreen) return;
                star.style.top  = `${rect.top + rect.height / 2 - 8}px`;
                star.style.left = `${rect.right + 4}px`;
            });
        };
        reposition();
        // capture:true so this also fires for scrolling inside a nested
        // container, not just the window itself (plain scroll listeners on
        // window only catch window-level scrolling).
        window.addEventListener("scroll", reposition, true);
        window.addEventListener("resize", reposition);
    },

    // Mode-aware so it doesn't go invisible after a dark-mode toggle: a
    // plain black shadow (fine on the white/light background) reads as
    // nothing once the page behind it is already near-black.
    syncInputShadow() {
        const shadow = this.darkModeOn
            ? "2px 2px 4px rgba(255, 255, 255, 0.25)"
            : "2px 2px 3px rgba(0, 0, 0, 0.3)";
        document.querySelectorAll("input, select, textarea").forEach(el => {
            el.style.setProperty("box-shadow", shadow, "important");
        });
    },

    // Tradetech's own "mandatory field" indicator (.mand class on
    // input/select/textarea) is a static pale-yellow fill from their own
    // stylesheet — not one of our highlight features, and not re-applied by
    // any live JS loop, so a plain one-time neutralize is safe (no re-fire
    // to fight, unlike the dynamic highlight fills above).
    neutralizeMandatoryFill() {
        document.querySelectorAll("input.mand, select.mand, textarea.mand").forEach(el => {
            el.style.setProperty("background-color", "#ffffff", "important");
        });
    },

    // Chrome's autofill yellow can't be cleared with el.style — the browser
    // applies it via an internal UA layer that overrides normal inline/author
    // styles. The only reliable override is this widely-used trick: a huge
    // background-color transition delay means the yellow never has time to
    // actually paint before our transition "finishes" (never, in practice).
    // Both selector forms are needed: Edge/Chromium still recognize the old
    // -webkit- prefixed pseudo-class, but newer versions also expose the
    // standard unprefixed :autofill, and which one actually matches has
    // varied by browser version.
    neutralizeAutofillFill() {
        const style = document.createElement("style");
        style.textContent = `
            input:-webkit-autofill, input:autofill,
            input:-webkit-autofill:hover, input:autofill:hover,
            input:-webkit-autofill:focus, input:autofill:focus,
            input:-webkit-autofill:active, input:autofill:active {
                transition: background-color 9999s ease-in-out 0s !important;
                -webkit-text-fill-color: currentColor !important;
                caret-color: currentColor !important;
            }
        `;
        document.head.appendChild(style);
    },

    // Dark mode — opt-in via the 🌙 toggle button, OFF by default so nothing
    // changes unless clicked. Deliberately NOT a CSS `filter` (see note above):
    // instead this walks real elements and flips background-color/color
    // inline, per element, so position:fixed UI (Toolbar/banners/notes
    // sidebar) is completely unaffected — no containing-block created, no
    // layout risk. Anything with an id starting "tt-" (all of this
    // extension's own injected UI) is skipped so it's never touched.
    // Only backgrounds lighter than mid-gray get darkened, and only text
    // darker than mid-gray gets lightened — already-dark native elements
    // (e.g. the black section-header bands) are left exactly as they are.
    darkModeOn: false,

    rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        const d = max - min;
        if (d !== 0) {
            s = d / (1 - Math.abs(2 * l - 1));
            switch (max) {
                case r: h = 60 * (((g - b) / d) % 6); break;
                case g: h = 60 * ((b - r) / d + 2); break;
                case b: h = 60 * ((r - g) / d + 4); break;
            }
        }
        if (h < 0) h += 360;
        return [h, s * 100, l * 100];
    },

    hslToRgb(h, s, l) {
        s /= 100; l /= 100;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        let [r, g, b] = [0, 0, 0];
        if (h < 60)       [r, g, b] = [c, x, 0];
        else if (h < 120) [r, g, b] = [x, c, 0];
        else if (h < 180) [r, g, b] = [0, c, x];
        else if (h < 240) [r, g, b] = [0, x, c];
        else if (h < 300) [r, g, b] = [x, 0, c];
        else              [r, g, b] = [c, 0, x];
        return [(r + m) * 255, (g + m) * 255, (b + m) * 255].map(v => Math.round(v));
    },

    // Parses "rgb(a)(r, g, b[, a])" and returns null for transparent/unparseable.
    parseRgb(rgbString) {
        const m = rgbString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) return null;
        if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; // fully transparent
        return [+m[1], +m[2], +m[3]];
    },

    // clampMin/clampMax keep the result off pure black/white — softer on the
    // eyes than a literal 0/100 invert, still high-contrast, easier to read.
    invertLightness(rgbString, clampMin = 0, clampMax = 100) {
        const rgb = this.parseRgb(rgbString);
        if (!rgb) return null;
        const [h, s, l] = this.rgbToHsl(...rgb);
        const newL = Math.min(clampMax, Math.max(clampMin, 100 - l));
        const [r, g, b] = this.hslToRgb(h, s, newL);
        return `rgb(${r}, ${g}, ${b})`;
    },

    // Anything under ~48px is treated as an icon/glyph (not an uploaded photo)
    // and gets a plain filter:invert — safe here since the filter sits on a
    // single leaf <img>, never an ancestor of any position:fixed element.
    ICON_MAX_SIZE: 48,

    // Contrast target follows the visual-fatigue research: a text/bg
    // luminance contrast around 0.97 tested lowest-fatigue — higher than a
    // moderate/soft palette, but stopping short of literal 0/100 (pure
    // black/white causes its own halation glare). L8 background / L96 text
    // lands close to that 0.97 figure without hitting the literal extremes.
    //
    // Pure read — returns a plan describing what to write (or null for "do
    // nothing"), never touches the DOM itself. Cached per-element in
    // applyDarkMode()/darkifyElement() below so a SECOND light→dark toggle
    // doesn't have to re-run getComputedStyle + the HSL math again for
    // elements whose native (light-mode) appearance hasn't changed since
    // last time — that recomputation was the entire remaining cost once the
    // read/write split and candidate-narrowing were already in place.
    computeDarkPlan(el, style) {
        if (el.tagName === "IMG") {
            const w = el.naturalWidth || el.getBoundingClientRect().width;
            const h = el.naturalHeight || el.getBoundingClientRect().height;
            if (w > this.ICON_MAX_SIZE || h > this.ICON_MAX_SIZE) return null; // real photo, leave alone
            return { filter: "invert(1)" };
        }

        const plan = {};

        const bgRgb = this.parseRgb(style.backgroundColor);
        if (bgRgb) {
            const [h, s, l] = this.rgbToHsl(...bgRgb);
            if (l > 50) {
                plan.bg = this.invertLightness(style.backgroundColor, 8, 100);
            } else if (l < 5) {
                // already-dark native bands (e.g. the black header bars) —
                // lift off pure black so they don't look like flat dead
                // patches next to our own near-black page background.
                const [r2, g2, b2] = this.hslToRgb(h, s, 10);
                plan.bg = `rgb(${r2}, ${g2}, ${b2})`;
            }
        }

        const fgRgb = this.parseRgb(style.color);
        if (fgRgb) {
            const [h, s, l] = this.rgbToHsl(...fgRgb);
            if (l < 50) {
                plan.color = this.invertLightness(style.color, 0, 96);
            } else if (l > 97) {
                // pure white text — dim slightly to match the same softened
                // ceiling everything else uses, less glare, same idea.
                const [r2, g2, b2] = this.hslToRgb(h, s, 96);
                plan.color = `rgb(${r2}, ${g2}, ${b2})`;
            }
        }

        // Grid/box lines: give them a visible mid-gray so they read as a
        // thin separator against the new dark bg (a border's whole job is
        // separation, unlike backgrounds) — dimmer than before so it's a
        // line, not a glaring bright bar. Skip anything with real
        // saturation (e.g. the purple selected-row border) so meaningful
        // color-coding isn't wiped out.
        ["Top", "Right", "Bottom", "Left"].forEach(side => {
            const borderRgb = this.parseRgb(style[`border${side}Color`]);
            if (!borderRgb) return;
            const [, s] = this.rgbToHsl(...borderRgb);
            if (s > 15) return;
            plan[`border${side}`] = "rgb(85, 85, 85)";
        });

        return Object.keys(plan).length ? plan : null;
    },

    // Pure write — applies a plan computed above (or cached from before).
    applyDarkPlan(el, plan) {
        if (!plan) return;
        if (plan.filter) {
            el.dataset.ttOrigFilter = el.style.getPropertyValue("filter");
            el.style.setProperty("filter", plan.filter, "important");
            return;
        }
        if (plan.bg) {
            el.dataset.ttOrigBg = el.style.getPropertyValue("background-color");
            el.style.setProperty("background-color", plan.bg, "important");
        }
        if (plan.color) {
            el.dataset.ttOrigColor = el.style.getPropertyValue("color");
            el.style.setProperty("color", plan.color, "important");
        }
        ["Top", "Right", "Bottom", "Left"].forEach(side => {
            const value = plan[`border${side}`];
            if (!value) return;
            el.dataset[`ttOrigBorder${side}`] = el.style.getPropertyValue(`border-${side.toLowerCase()}-color`);
            el.style.setProperty(`border-${side.toLowerCase()}-color`, value, "important");
        });
    },

    // Elements can get reprocessed after already being darkened once — e.g.
    // port-highlighting.js / validation.js / vessel-recommendation.js each
    // set their own `outline` directly on a field, independent of dark
    // mode; that's a "style" attribute mutation our observer watches, so it
    // invalidates the cached plan and darkifyElement runs again. At that
    // point getComputedStyle(el) only describes OUR OWN previous writes,
    // not the field's true native appearance — computing a plan from that
    // produces wrong/no-op results (this is exactly what caused white text
    // on a background that silently lost its dark override: bg read as
    // "already dark enough," so nothing reapplied it, while a stale light
    // text color stayed). Temporarily stripping our own overrides before
    // reading gets the true native value; costs one extra reflow, but only
    // on this rare reprocessing path, never during the bulk sweep.
    NATIVE_PEEK_PROPS: ["background-color", "color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color"],

    nativeStyleFor(el) {
        const touched = ["Bg", "Color", "BorderTop", "BorderRight", "BorderBottom", "BorderLeft"]
            .some(k => `ttOrig${k}` in el.dataset);
        if (!touched) return getComputedStyle(el);

        const saved = this.NATIVE_PEEK_PROPS.map(p => el.style.getPropertyValue(p));
        this.NATIVE_PEEK_PROPS.forEach(p => el.style.removeProperty(p));

        const native = getComputedStyle(el);
        const snapshot = {
            backgroundColor: native.backgroundColor,
            color: native.color,
            borderTopColor: native.borderTopColor,
            borderRightColor: native.borderRightColor,
            borderBottomColor: native.borderBottomColor,
            borderLeftColor: native.borderLeftColor
        };

        this.NATIVE_PEEK_PROPS.forEach((p, i) => {
            if (saved[i]) el.style.setProperty(p, saved[i], "important");
        });

        return snapshot;
    },

    // Cache-aware single-element entry point — used by the MutationObserver
    // for one-off elements (new nodes, attribute changes). style is optional;
    // only fetched on a cache miss, and only via nativeStyleFor() (never a
    // plain getComputedStyle) since this path can hit already-processed
    // elements.
    darkifyElement(el, style) {
        if (el.closest('[id^="tt-"]')) return; // never touch our own injected UI
        if (!this._darkPlanCache) this._darkPlanCache = new WeakMap();

        let plan = this._darkPlanCache.get(el);
        if (plan === undefined) {
            plan = this.computeDarkPlan(el, style || this.nativeStyleFor(el));
            this._darkPlanCache.set(el, plan);
        }
        this.applyDarkPlan(el, plan);
    },

    // Measured with a PerformanceObserver on the real page: even after the
    // read/write split above, the full sweep is one ~150-200ms task on this
    // page's ~3000+ elements — long enough to feel like a stutter on click.
    // Spreading it across requestAnimationFrame chunks doesn't reduce the
    // total work, but no single chunk blocks the main thread long enough to
    // be felt, so the click itself stays responsive.
    DARK_CHUNK_SIZE: 400,

    // Every color-bearing element on this page falls into one of these
    // buckets (confirmed by inspecting the live page: only 8 CSS classes
    // exist total, plus 338 elements with an inline style attribute, plus a
    // few bare <th> bands with no class at all) — a plain wrapper <td>/
    // <tr>/<div> with neither a style nor class attribute never has its own
    // background or text color, so getComputedStyle() on it is pure waste.
    // Narrowing to this selector instead of "body *" is what actually cuts
    // the total work, rather than just spreading the same work across frames.
    DARK_CANDIDATE_SELECTOR: "[style], [class], th, input, select, textarea, button, a",

    applyDarkMode() {
        if (this._darkModeObserver) this._darkModeObserver.disconnect();
        if (!this._darkPlanCache) this._darkPlanCache = new WeakMap();
        const candidates = Array.from(document.querySelectorAll(this.DARK_CANDIDATE_SELECTOR))
            .filter(el => !el.closest('[id^="tt-"]'));
        this.applyDarkModeChunk(candidates, 0);
    },

    applyDarkModeChunk(candidates, index) {
        const end = Math.min(index + this.DARK_CHUNK_SIZE, candidates.length);

        // Read/decide phase — only for elements not already cached from a
        // previous toggle. A repeat light→dark toggle can skip this
        // entirely for every element whose native appearance is unchanged.
        // Uses nativeStyleFor() rather than a plain getComputedStyle() for
        // the same reason as the observer path below: on a normal first
        // pass over a fresh element this costs nothing extra (nativeStyleFor
        // short-circuits straight to getComputedStyle when there's no
        // data-tt-orig-* marker yet), but it stays correct in the same edge
        // case that caused the white-on-white bug — an element that's
        // already been touched once reaching this loop again.
        for (let i = index; i < end; i++) {
            const el = candidates[i];
            if (!this._darkPlanCache.has(el)) {
                this._darkPlanCache.set(el, this.computeDarkPlan(el, this.nativeStyleFor(el)));
            }
        }
        // Write phase.
        for (let i = index; i < end; i++) {
            const el = candidates[i];
            this.applyDarkPlan(el, this._darkPlanCache.get(el));
        }

        if (end < candidates.length) {
            requestAnimationFrame(() => this.applyDarkModeChunk(candidates, end));
        } else if (this._darkModeObserver) {
            this._darkModeObserver.observe(document.body, {
                childList: true, subtree: true, attributes: true, attributeFilter: ["style"]
            });
        }
    },

    // Runs fn with the dark-mode observer disconnected, then reconnects it —
    // darkifyElement() writes the "style" attribute, which is exactly what
    // the observer below watches, so without this every one of OUR OWN
    // writes would immediately queue another mutation and re-trigger the
    // observer on itself (worst case: the border-color branch always matches
    // its own freshly-written value, looping forever).
    withObserverPaused(fn) {
        if (this._darkModeObserver) this._darkModeObserver.disconnect();
        fn();
        if (this._darkModeObserver) {
            this._darkModeObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["style"]
            });
        }
    },

    // Tradetech rebuilds parts of the page itself — e.g. loading a schedule
    // fills the port-name fields in via its own script shortly after the
    // static page loads, not just in response to typing. That can happen
    // either as brand-new DOM nodes (caught by childList below) OR as the
    // SAME node with Tradetech overwriting its own "style" attribute
    // wholesale (caught by the attributes branch) — either way the field
    // reverts to plain white because it never went through our sweep.
    // Constructs the observer but does NOT arm it (.observe()) — arming
    // happens only once a full applyDarkMode() chunked sweep completes (see
    // applyDarkModeChunk) or via withObserverPaused's reconnect. Arming here
    // unconditionally used to race with the very first page-load sweep: if
    // that sweep needed more than one chunk, the observer would already be
    // live by chunk 2's turn (since this ran synchronously before any
    // requestAnimationFrame callback could fire) and see chunk 2's own
    // writes as an external change — invalidating the plan it had just
    // cached and reprocessing that element against its own already-dark
    // state. Constructing early but arming only at the true end of a sweep
    // (regardless of chunk count) avoids that self-triggering entirely.
    startDarkModeObserver() {
        if (this._darkModeObserver) return;
        this._darkModeObserver = new MutationObserver(mutations => {
            if (!this.darkModeOn) return;
            this.withObserverPaused(() => {
                mutations.forEach(m => {
                    if (m.type === "attributes") {
                        // Tradetech just overwrote this element's own style
                        // attribute — whatever plan we cached for it may no
                        // longer match its native appearance, so drop it and
                        // recompute fresh instead of reapplying a stale plan.
                        this._darkPlanCache?.delete(m.target);
                        this.darkifyElement(m.target);
                        return;
                    }
                    m.addedNodes.forEach(node => {
                        if (node.nodeType !== Node.ELEMENT_NODE) return;
                        this.darkifyElement(node);
                        node.querySelectorAll("*").forEach(child => this.darkifyElement(child));
                    });
                });
            });
        });
    },

    removeDarkMode() {
        this.withObserverPaused(() => {
            document.querySelectorAll("[data-tt-orig-bg]").forEach(el => {
                el.style.setProperty("background-color", el.dataset.ttOrigBg);
                if (!el.dataset.ttOrigBg) el.style.removeProperty("background-color");
                delete el.dataset.ttOrigBg;
            });
            document.querySelectorAll("[data-tt-orig-color]").forEach(el => {
                el.style.setProperty("color", el.dataset.ttOrigColor);
                if (!el.dataset.ttOrigColor) el.style.removeProperty("color");
                delete el.dataset.ttOrigColor;
            });
            document.querySelectorAll("[data-tt-orig-filter]").forEach(el => {
                el.style.setProperty("filter", el.dataset.ttOrigFilter);
                if (!el.dataset.ttOrigFilter) el.style.removeProperty("filter");
                delete el.dataset.ttOrigFilter;
            });
            ["Top", "Right", "Bottom", "Left"].forEach(side => {
                const attr = `data-tt-orig-border${side.toLowerCase()}`;
                document.querySelectorAll(`[${attr}]`).forEach(el => {
                    const prop = `border-${side.toLowerCase()}-color`;
                    const orig = el.dataset[`ttOrigBorder${side}`];
                    el.style.setProperty(prop, orig);
                    if (!orig) el.style.removeProperty(prop);
                    delete el.dataset[`ttOrigBorder${side}`];
                });
            });
        });
    },

    // Lives inside the shared Tools panel instead of its own floating button —
    // a separate floating circle duplicated once per Tradetech frame same as
    // the panel itself does, doubling the clutter for no reason.
    buildDarkModeToggle() {
        Toolbar.register({
            id: "tt-darkmode-toggle",
            label: this.darkModeOn ? "☀️ Dark Mode: ON" : "🌙 Dark Mode: OFF",
            onClick: () => {
                this.darkModeOn = !this.darkModeOn;
                localStorage.setItem("tt-darkmode", this.darkModeOn ? "1" : "0");
                if (this.darkModeOn) this.applyDarkMode();
                else this.removeDarkMode();
                this.syncPageBackground();
                this.syncDecorationColor();
                this.syncInputShadow();
                Toolbar.updateLabel("tt-darkmode-toggle", this.darkModeOn ? "☀️ Dark Mode: ON" : "🌙 Dark Mode: OFF");
            }
        });
    },

    NATIVE_STRIP_PROPS: [
        "background-color", "color", "box-shadow", "filter",
        "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
        "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
        "border-top-style", "border-right-style", "border-bottom-style", "border-left-style"
    ],
    OVERLAY_IDS: ["tt-stars", "tt-halftone-0", "tt-halftone-1", "tt-required-stars"],

    // A temporary "what does this look like with none of our styling"
    // view — every pass we run (recolor, borders, shadows, mandatory-fill,
    // dark mode) only ever writes inline style properties, never removes
    // Tradetech's own CSS, so stripping that fixed list of inline properties
    // is enough to fall back to their real page underneath. Toggling back
    // just re-runs the normal passes rather than trying to remember old
    // values — cheaper and it can't drift out of sync with whatever those
    // passes currently do.
    toggleNativeView() {
        this.nativeViewOn = !this.nativeViewOn;

        if (this.nativeViewOn) {
            if (this._darkModeObserver) this._darkModeObserver.disconnect();
            document.querySelectorAll("body *").forEach(el => {
                if (el.closest('[id^="tt-"]')) return;
                this.NATIVE_STRIP_PROPS.forEach(p => el.style.removeProperty(p));
            });
            document.documentElement.style.removeProperty("background-color");
            document.body.style.removeProperty("background-color");
            this.OVERLAY_IDS.forEach(id => {
                const n = document.getElementById(id);
                if (n) n.style.setProperty("display", "none", "important");
            });
        } else {
            this.recolorGrayToWhite();
            this.reinforceInputBoxes();
            this.neutralizeMandatoryFill();
            this.syncInputShadow();
            this.syncPageBackground();
            // applyDarkMode() re-observes itself once its chunks finish; if
            // dark mode is off there's nothing to re-darkify, so reconnect
            // here instead — otherwise the observer stays disconnected.
            if (this.darkModeOn) this.applyDarkMode();
            else if (this._darkModeObserver) {
                this._darkModeObserver.observe(document.body, {
                    childList: true, subtree: true, attributes: true, attributeFilter: ["style"]
                });
            }
            this.OVERLAY_IDS.forEach(id => {
                const n = document.getElementById(id);
                if (n) n.style.removeProperty("display");
            });
        }

        Toolbar.updateLabel("tt-native-toggle", this.nativeViewOn ? "🎨 Show Our Style" : "👁 Show Native Tradetech");
    },

    buildNativeViewToggle() {
        Toolbar.register({
            id: "tt-native-toggle",
            label: "👁 Show Native Tradetech",
            onClick: () => this.toggleNativeView()
        });
    },

    // <html>/<body> never get picked up by the "body *" sweep (it only walks
    // descendants), so without this the outer page stays white while every
    // box inside it goes dark.
    syncPageBackground() {
        const bg = this.darkModeOn ? "rgb(10, 10, 10)" : "";
        [document.documentElement, document.body].forEach(el => {
            if (bg) el.style.setProperty("background-color", bg, "important");
            else el.style.removeProperty("background-color");
        });
        document.documentElement.classList.toggle("tt-dark", this.darkModeOn);
    },

    // Scrollbar pseudo-elements can't be styled via inline JS (no el.style
    // equivalent), only via a real stylesheet — one rule set injected once,
    // toggled entirely by the "tt-dark" class syncPageBackground() flips.
    buildScrollbarStyle() {
        const style = document.createElement("style");
        style.textContent = `
            html { scrollbar-color: #b0b0b0 #f0f0f0; }
            ::-webkit-scrollbar { width: 12px; height: 12px; }
            ::-webkit-scrollbar-track { background: #f0f0f0; }
            ::-webkit-scrollbar-thumb { background: #b0b0b0; border-radius: 6px; }
            ::-webkit-scrollbar-thumb:hover { background: #909090; }

            html.tt-dark { scrollbar-color: #3a3a3a #101010; }
            html.tt-dark ::-webkit-scrollbar-track { background: #101010; }
            html.tt-dark ::-webkit-scrollbar-thumb { background: #3a3a3a; }
            html.tt-dark ::-webkit-scrollbar-thumb:hover { background: #505050; }
        `;
        document.head.appendChild(style);
    },

    // The star field/halftone are OUR OWN UI (id starts "tt-"), so the
    // generic sweep skips them on purpose — but black stars/dots go
    // invisible once the page behind them turns dark, so they need their
    // own explicit light/dark swap.
    syncDecorationColor() {
        const starColor  = this.darkModeOn ? "#ffffff" : "#000000";
        const starShadow = this.darkModeOn ? "0 0 2px rgba(0,0,0,0.6)" : "0 0 2px rgba(255,255,255,0.6)";
        document.querySelectorAll("#tt-stars span").forEach(s => {
            s.style.setProperty("color", starColor, "important");
            s.style.setProperty("text-shadow", starShadow, "important");
        });

        const dotColor = this.darkModeOn ? "#ffffff" : "#000000";
        document.querySelectorAll('[id^="tt-halftone-"]').forEach(el => {
            el.style.setProperty("background-image", `radial-gradient(circle, ${dotColor} 1.5px, transparent 1.5px)`, "important");
        });
    },

    // "Light gray": R/G/B all close together (grayscale, not a real
    // color) and bright enough to read as background, but short of
    // pure white — that upper cutoff, plus the tag skip-list, is what
    // keeps every white input field untouched.
    isLightGray(rgbString) {
        const m = rgbString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return false;
        const [r, g, b] = [+m[1], +m[2], +m[3]];
        const isGrayscale = Math.max(r, g, b) - Math.min(r, g, b) < 10;
        const isLight = r > 180 && r < 250;
        return isGrayscale && isLight;
    },

    recolorGrayToWhite() {
        const SKIP_TAGS = new Set(["INPUT", "SELECT", "BUTTON", "TEXTAREA", "OPTION"]);

        document.querySelectorAll("body *").forEach(el => {
            if (SKIP_TAGS.has(el.tagName)) return;

            const bg = getComputedStyle(el).backgroundColor;
            if (!this.isLightGray(bg)) return;

            el.style.setProperty("background-color", "#ffffff", "important");
        });
    },

    buildStars() {
        const field = document.createElement("div");
        field.id = "tt-stars";
        field.style.cssText = `
            position: fixed !important;
            inset: 0 !important;
            z-index: 100 !important;
            overflow: hidden !important;
            pointer-events: none !important;
        `;

        const chars = [".", "·", "*", "✦", "⋆"];
        let html = "";
        for (let i = 0; i < 70; i++) {
            const char     = chars[Math.floor(Math.random() * chars.length)];
            const top      = (Math.random() * 100).toFixed(2);
            const left     = (Math.random() * 100).toFixed(2);
            const size     = (Math.random() * 12 + 14).toFixed(1); // bigger — was 7-13px, now 14-26px
            const delay    = (Math.random() * 6).toFixed(2);
            const duration = (Math.random() * 3 + 3).toFixed(2);
            html += `<span style="position:absolute;top:${top}%;left:${left}%;font-size:${size}px;color:#000000;opacity:0.35;text-shadow:0 0 2px rgba(255,255,255,0.6);animation:tt-star-twinkle ${duration}s ease-in-out ${delay}s infinite">${char}</span>`;
        }
        field.innerHTML = html;

        const style = document.createElement("style");
        style.textContent = `
            @keyframes tt-star-twinkle {
                0%, 100% { opacity: 0.15; }
                50%      { opacity: 0.55; }
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(field);
    },

    // Two small halftone-dot patches (classic newsprint-style dot
    // pattern via a repeating radial-gradient) tucked into corners —
    // texture, not a wash over the whole page, so it stays a design
    // accent instead of competing with the real form for attention.
    buildHalftone() {
        [
            { top: "0",    left: "auto", right: "0",  bottom: "auto" },
            { top: "auto", left: "0",    right: "auto", bottom: "0" }
        ].forEach((pos, i) => {
            const patch = document.createElement("div");
            patch.id = `tt-halftone-${i}`;
            patch.style.cssText = `
                position: fixed !important;
                top: ${pos.top} !important;
                left: ${pos.left} !important;
                right: ${pos.right} !important;
                bottom: ${pos.bottom} !important;
                width: 220px !important;
                height: 220px !important;
                z-index: 99 !important;
                pointer-events: none !important;
                opacity: 0.06 !important;
                background-image: radial-gradient(circle, #000000 1.5px, transparent 1.5px) !important;
                background-size: 12px 12px !important;
            `;
            document.body.appendChild(patch);
        });
    },

    handle(_event) {},
    handleBlur(_event) {}
};
