// ─────────────────────────────────────────────────────
//  FEATURE: Tradetech Stars
//  Purely decorative overlay — a colorful twinkling starfield
//  plus a couple of subtle halftone-dot corner patches. Never
//  touches any real field, layout, or color on the actual page;
//  fixed-position elements with pointer-events:none, appended to
//  body and left alone.
//
//  This used to also carry a much bigger cosmetic layer (gray-to-
//  white recolor, reinforced input borders/shadows, required-field
//  stars, scrollbar theming, a full dark mode + "show native"
//  toggle). All of that turned out cool but not practical
//  day-to-day and was removed outright — real native Tradetech is
//  what's wanted, plus just this starfield.
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

        this.buildStars();
        this.buildShootingStars();
        this.buildCosmicEvent();
        this.buildHalftone();
    },

    // Grid + jitter instead of pure Math.random() — plain random top/left
    // for every star independently tends to clump some areas dense (over
    // real text, hurting readability) and leave others empty. Splitting the
    // viewport into a grid and placing one star per cell (with randomness
    // WITHIN the cell, so it doesn't look like a rigid grid) guarantees an
    // even spread while still looking organic.
    buildStars() {
        const field = document.createElement("div");
        field.id = "tt-stars";
        field.style.cssText = `
            position: fixed !important;
            inset: 0 !important;
            z-index: 100 !important;
            overflow: hidden !important;
            pointer-events: none !important;
            transition: transform 0.1s linear !important;
        `;

        const chars = [".", "·", "*", "✦", "⋆"];
        const cols = 13, rows = 10; // 130 cells
        let html = "";
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const char     = chars[Math.floor(Math.random() * chars.length)];
                const jitterX  = 0.15 + Math.random() * 0.7; // stays inside the cell, not touching its edges
                const jitterY  = 0.15 + Math.random() * 0.7;
                const top      = (((row + jitterY) / rows) * 100).toFixed(2);
                const left     = (((col + jitterX) / cols) * 100).toFixed(2);
                const size     = (Math.random() * 6 + 8).toFixed(1); // 8-14px
                const delay    = (Math.random() * 6).toFixed(2);
                const duration = (Math.random() * 3 + 3).toFixed(2);
                html += `<span style="position:absolute;top:${top}%;left:${left}%;font-size:${size}px;color:#000000;opacity:0.35;text-shadow:0 0 2px rgba(255,255,255,0.6);animation:tt-star-twinkle ${duration}s ease-in-out ${delay}s infinite">${char}</span>`;
            }
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

        // Scroll parallax: the field drifts slowly opposite the scroll
        // direction instead of staying frozen in place — reads as gentle
        // depth rather than a static wallpaper. capture:true + reading the
        // scroll from event.target (not always window.scrollY) so this
        // also reacts to scrolling inside a nested container, e.g. the
        // Rotation Schedule table, not just the window itself.
        window.addEventListener("scroll", (e) => {
            const scrollY = e.target === document ? window.scrollY : (e.target.scrollTop || 0);
            field.style.transform = `translateY(${scrollY * 0.15}px)`;
        }, true);
    },

    // A handful of streaking shooting stars — each one has a long full
    // animation cycle (15-30s) but only actually moves/shows during the
    // first ~15% of it (see the keyframe below), so across several of them
    // with randomized delays you get occasional streaks rather than
    // constant motion, which would be distracting over a real form.
    buildShootingStars() {
        const field = document.createElement("div");
        field.id = "tt-shooting-stars";
        field.style.cssText = `
            position: fixed !important;
            inset: 0 !important;
            z-index: 101 !important;
            overflow: hidden !important;
            pointer-events: none !important;
        `;

        let html = "";
        for (let i = 0; i < 6; i++) {
            const top      = (Math.random() * 60).toFixed(2); // upper 60% of the screen, like real shooting stars
            const left     = (Math.random() * 80).toFixed(2);
            const dx       = (150 + Math.random() * 150).toFixed(0); // streak length/direction
            const dy       = (80 + Math.random() * 80).toFixed(0);
            const delay    = (Math.random() * 20).toFixed(2);
            const duration = (15 + Math.random() * 15).toFixed(2);
            html += `<span style="position:absolute;top:${top}%;left:${left}%;--dx:${dx}px;--dy:${dy}px;font-size:14px;color:#000000;opacity:0;text-shadow:0 0 6px rgba(255,255,255,0.8);animation:tt-shoot ${duration}s ease-in ${delay}s infinite">✦</span>`;
        }
        field.innerHTML = html;

        const style = document.createElement("style");
        style.textContent = `
            @keyframes tt-shoot {
                0%   { transform: translate(0, 0); opacity: 0; }
                2%   { opacity: 1; }
                15%  { transform: translate(var(--dx), var(--dy)); opacity: 0; }
                100% { opacity: 0; }
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(field);
    },

    // The "fun" extra: a little cosmic event happens in the background
    // every 6-12 seconds, picked randomly between two flavors so it doesn't
    // get repetitive — a colorful glow bloom, or a black hole drifting
    // across the screen.
    buildCosmicEvent() {
        const glow = document.createElement("div");
        glow.id = "tt-cosmic-event";
        glow.style.cssText = `
            position: fixed !important;
            width: 260px !important;
            height: 260px !important;
            border-radius: 50% !important;
            z-index: 98 !important;
            pointer-events: none !important;
            opacity: 0 !important;
            transition: opacity 2.5s ease-in-out, top 0.01s, left 0.01s !important;
        `;
        document.body.appendChild(glow);

        if (!document.getElementById("tt-blackhole-style")) {
            const style = document.createElement("style");
            style.id = "tt-blackhole-style";
            style.textContent = `
                @keyframes tt-blackhole-drift {
                    0%   { left: -8%;  opacity: 0; }
                    8%   { opacity: 1; }
                    92%  { opacity: 1; }
                    100% { left: 108%; opacity: 0; }
                }
                @keyframes tt-blackhole-spin {
                    from { transform: rotate(0deg); }
                    to   { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        // Was too faint to notice at 10% black opacity on a mostly-white
        // page — now a real colored glow (picked from the same accent
        // palette used elsewhere) at much higher opacity.
        const GLOW_COLORS = ["#e67e00", "#1e5f9e", "#6e1e9e", "#0e8a6e", "#cc0000"];
        const triggerGlow = () => {
            const color = GLOW_COLORS[Math.floor(Math.random() * GLOW_COLORS.length)];
            glow.style.background = `radial-gradient(circle, ${color}55 0%, ${color}22 40%, transparent 70%)`;
            glow.style.top  = `${Math.random() * 80}%`;
            glow.style.left = `${Math.random() * 80}%`;
            glow.style.opacity = "1";
            setTimeout(() => { glow.style.opacity = "0"; }, 3000);
        };

        // A black hole that actually pulls: bigger, a spinning accretion
        // disk (conic-gradient + its own rotate animation layered on top of
        // the left→right drift), and — the part that was missing before —
        // real nearby stars get visibly tugged toward it and shrink as it
        // passes, then spring back once it's gone. That's tracked with a
        // requestAnimationFrame loop reading the hole's live position each
        // frame (CSS alone can't react to two independent moving things).
        const triggerBlackHole = () => {
            const hole = document.createElement("div");
            const ring = document.createElement("div");
            const top      = 10 + Math.random() * 60;
            const duration = 8 + Math.random() * 4;

            hole.style.cssText = `
                position: fixed !important;
                top: ${top}% !important;
                left: -10% !important;
                width: 90px !important;
                height: 90px !important;
                z-index: 98 !important;
                pointer-events: none !important;
                animation: tt-blackhole-drift ${duration}s linear forwards !important;
            `;
            ring.style.cssText = `
                width: 100% !important;
                height: 100% !important;
                border-radius: 50% !important;
                background:
                    radial-gradient(circle, #000000 0%, #000000 38%, transparent 40%),
                    conic-gradient(from 0deg, #e67e00, #1e5f9e, #6e1e9e, #e67e00) !important;
                box-shadow: 0 0 24px rgba(0, 0, 0, 0.55) !important;
                animation: tt-blackhole-spin 1.4s linear infinite !important;
            `;
            hole.appendChild(ring);
            document.body.appendChild(hole);

            const stars = Array.from(document.querySelectorAll("#tt-stars span"));
            const PULL_RADIUS = 160;
            const startTime = performance.now();
            const durationMs = duration * 1000;

            const pull = (now) => {
                const elapsed = now - startTime;
                if (elapsed > durationMs) {
                    stars.forEach(s => { s.style.transform = ""; });
                    return;
                }

                const holeRect = hole.getBoundingClientRect();
                const hx = holeRect.left + holeRect.width / 2;
                const hy = holeRect.top + holeRect.height / 2;

                stars.forEach(s => {
                    const r = s.getBoundingClientRect();
                    const dx = hx - (r.left + r.width / 2);
                    const dy = hy - (r.top + r.height / 2);
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < PULL_RADIUS) {
                        const strength = 1 - dist / PULL_RADIUS;
                        s.style.transition = "transform 0.1s linear";
                        s.style.transform = `translate(${(dx * strength * 0.35).toFixed(1)}px, ${(dy * strength * 0.35).toFixed(1)}px) scale(${(1 - strength * 0.7).toFixed(2)})`;
                    } else if (s.style.transform) {
                        s.style.transform = "";
                    }
                });

                requestAnimationFrame(pull);
            };
            requestAnimationFrame(pull);

            setTimeout(() => hole.remove(), durationMs + 200);
        };

        const trigger = () => {
            if (Math.random() < 0.5) triggerGlow();
            else triggerBlackHole();
            setTimeout(trigger, 6000 + Math.random() * 6000);
        };
        setTimeout(trigger, 3000 + Math.random() * 4000); // first one arrives a little after load, not instantly
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
