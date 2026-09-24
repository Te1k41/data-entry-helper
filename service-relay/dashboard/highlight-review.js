// Highlight Review page — mark each item's auto-picked highlight right/wrong.
//  • Items with rotation data (from the extension's batch capture): click the
//    row that SHOULD be highlighted.
//  • PNG-only items (receipts imported from the receipts folder): look at the
//    image (yellow row = the pick) and say right / none, or click the SP number that
//    should have been highlighted.
// Verdicts persist server-side (highlight-review-store.js). Refresh re-scans
// the receipts folder, so newly captured PNGs show up.
(function () {
    const state = { items: [], current: null, filter: "unreviewed", files: {} };
    const $ = id => document.getElementById(id);

    const hasData       = item => item.ports.length > 0;
    const effectiveAuto = item => (item.autoSpecial ? item.autoRow : null);
    const isReviewed    = item => Boolean(item.truth);
    const byRow         = item => item.truth && item.truth.row !== undefined; // row-style verdict vs image-style
    const agrees        = item => isReviewed(item) && (byRow(item) ? item.truth.row === effectiveAuto(item) : item.truth.verdict === "right");

    const FILTERS = {
        unreviewed: i => !isReviewed(i),
        all:        () => true,
        special:    i => i.autoSpecial,
        fallback:   i => hasData(i) && !i.autoSpecial,
        imported:   i => !hasData(i),
        disagree:   i => isReviewed(i) && !agrees(i),
        reviewed:   isReviewed,
    };
    const FILTER_LABELS = {
        unreviewed: "Unreviewed", all: "All", special: "Auto found a special port",
        fallback: "Auto found nothing (SP001 default)", imported: "PNG only (no rotation data)",
        disagree: "Marked wrong", reviewed: "Reviewed",
    };

    const filtered = () => state.items.filter(FILTERS[state.filter]);
    const imageUrl = item => `/highlight-review/image?name=${encodeURIComponent(item.receiptFile)}`;

    function el(tag, attrs, ...kids) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (k === "class") node.className = v;
            else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v);
        }
        for (const kid of kids.flat()) {
            if (kid == null) continue;
            node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
        }
        return node;
    }

    function flash(text, ok) {
        const msg = $("msg");
        msg.textContent = text;
        msg.className = ok ? "ok" : "err";
        clearTimeout(flash.t);
        flash.t = setTimeout(() => { msg.textContent = ""; }, 3500);
    }

    async function post(path, body) {
        const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
    }

    async function load() {
        const res  = await fetch("/highlight-review/data");
        const data = await res.json();
        state.items = data.items;
        state.files = { folder: data.receiptsFolder, data: data.dataFile, export: data.exportFile };
        if (!filtered().some(i => i.key === state.current)) state.current = filtered()[0]?.key || null;
        renderAll();
    }

    // Save a verdict, apply it locally, then advance. If the item leaves the
    // filtered list (e.g. filter is "Unreviewed") the same index now points at
    // the next item; otherwise step forward one.
    async function submitVerdict(key, payload, truth) {
        const idx = filtered().findIndex(i => i.key === key);
        try {
            await post("/highlight-review/verdict", { key, ...payload });
        } catch (err) {
            flash(`Could not save: ${err.message}`, false);
            return;
        }
        state.items.find(i => i.key === key).truth = { ...truth, reviewedAt: new Date().toISOString() };
        const after = filtered();
        const still = after.findIndex(i => i.key === key);
        state.current = after[Math.min(still >= 0 ? still + 1 : idx, after.length - 1)]?.key || null;
        renderAll();
    }

    const verdictRow   = (key, row) => submitVerdict(key, { row }, { row });
    // Mirrors what the server stores (highlight-review-store.js setImageVerdict),
    // including correctRow, so the picked SP button shows right away on revisit.
    const verdictImage = (key, verdict, correct) => {
        const text = verdict === "wrong" ? String(correct || "").trim() : "";
        const rowMatch = text.match(/^SP([0-9]{3})$/i);
        return submitVerdict(key, { verdict, correct }, { verdict, correct: text, ...(rowMatch ? { correctRow: rowMatch[1] } : {}) });
    };

    async function clearVerdict(key) {
        try {
            await post("/highlight-review/verdict", { key, clear: true });
        } catch (err) {
            flash(`Could not clear: ${err.message}`, false);
            return;
        }
        delete state.items.find(i => i.key === key).truth;
        renderAll();
    }

    function step(delta) {
        const list = filtered();
        const idx  = list.findIndex(i => i.key === state.current);
        const next = list[Math.max(0, Math.min(list.length - 1, idx + delta))];
        if (next) { state.current = next.key; renderAll(); }
    }

    const statusIcon = item => (!isReviewed(item) ? "·" : agrees(item) ? "✅" : "❌");

    function renderStats() {
        const total    = state.items.length;
        const reviewed = state.items.filter(isReviewed).length;
        const wrong    = state.items.filter(FILTERS.disagree).length;
        const select   = el("select", { onchange: e => { state.filter = e.target.value; state.current = filtered()[0]?.key || null; renderAll(); } },
            Object.entries(FILTER_LABELS).map(([value, label]) => {
                const opt = el("option", { value }, `${label} (${state.items.filter(FILTERS[value]).length})`);
                if (value === state.filter) opt.selected = true;
                return opt;
            })
        );
        const stats = $("stats");
        stats.replaceChildren(el("b", {}, reviewed), ` / ${total} reviewed · `, el("b", {}, wrong), " marked wrong", select);
        if (total === 0) {
            stats.append(el("div", { class: "hint" }, `Nothing found — no receipt PNGs in ${state.files.folder || "the receipts folder"} and no captured rotation data yet. Run 🧾 Capture Receipts in the extension.`));
        }
    }

    function renderList() {
        const list = $("list");
        list.replaceChildren(...filtered().map(item =>
            el("div", { class: "listItem" + (item.key === state.current ? " current" : ""), onclick: () => { state.current = item.key; renderAll(); } },
                el("span", {}, item.service || "(no service)"),
                el("span", { class: "st" }, statusIcon(item))
            )
        ));
        list.querySelector(".current")?.scrollIntoView({ block: "nearest" });
    }

    // What the human said, as a tag.
    function truthTag(item) {
        if (!isReviewed(item)) return null;
        if (agrees(item)) return el("span", { class: "tag ok" }, "✅ marked right");
        if (byRow(item)) {
            const port = item.truth.row && item.ports.find(p => p.row === item.truth.row);
            return el("span", { class: "tag bad" }, `❌ should be: ${port ? `SP${item.truth.row} ${port.name}` : "no special port"}`);
        }
        return el("span", { class: "tag bad" }, `❌ should be: ${item.truth.verdict === "none" ? "no special port" : item.truth.correct}`);
    }

    function renderActionsForRows(item, auto) {
        return el("div", { class: "actions" },
            el("button", { class: "good", onclick: () => verdictRow(item.key, auto) },
                auto ? `✅ Right — SP${auto} (Y)` : "✅ Right — nothing special (Y)"),
            auto ? el("button", { class: "none", onclick: () => verdictRow(item.key, null) }, "🚫 No special port (N)") : null,
            el("button", { onclick: () => step(-1) }, "◀ Prev"),
            el("button", { onclick: () => step(1) }, "Skip ▶ (S)"),
            isReviewed(item) ? el("button", { onclick: () => clearVerdict(item.key) }, "↩ Clear verdict") : null
        );
    }

    // The PNG-only item's rotation isn't readable here, so offer one button per
    // port row that exists in the image (row count comes from the PNG's height,
    // see highlight-review-store.js rowsFromPngHeight) — click the port that
    // SHOULD be highlighted instead of typing it. Falls back to a generic
    // range when the count couldn't be worked out.
    const FALLBACK_ROWS = 30;

    function renderActionsForImage(item) {
        const rowCount = item.receiptRows || FALLBACK_ROWS;
        const picked = isReviewed(item) && item.truth.verdict === "wrong" ? item.truth.correctRow : null;

        const rowButtons = Array.from({ length: rowCount }, (_, i) => {
            const row = String(i + 1).padStart(3, "0");
            return el("button", {
                class: "spBtn" + (picked === row ? " picked" : ""),
                title: `SP${row} is the port that should be highlighted`,
                onclick: () => verdictImage(item.key, "wrong", `SP${row}`)
            }, `SP${row}`);
        });

        return el("div", null,
            el("div", { class: "actions" },
                el("button", { class: "good", onclick: () => verdictImage(item.key, "right") }, "✅ Yellow row is right (Y)"),
                el("button", { class: "none", onclick: () => verdictImage(item.key, "none") }, "🚫 No special port (N)"),
                el("button", { onclick: () => step(-1) }, "◀ Prev"),
                el("button", { onclick: () => step(1) }, "Skip ▶ (S)"),
                isReviewed(item) ? el("button", { onclick: () => clearVerdict(item.key) }, "↩ Clear verdict") : null
            ),
            el("div", { class: "spLabel" },
                "Yellow row is wrong — the port that SHOULD be highlighted is:",
                item.receiptRows ? null : el("span", { class: "dim" }, ` (couldn't read the row count from this image — showing SP001–SP${FALLBACK_ROWS})`)
            ),
            el("div", { class: "spGrid" }, rowButtons)
        );
    }

    function renderCard() {
        const wrap = $("card");
        wrap.replaceChildren();
        const item = state.items.find(i => i.key === state.current);
        if (!item) {
            wrap.append(el("div", { class: "empty" }, state.items.length ? "Nothing in this filter — pick another above." : ""));
            return;
        }

        const structured = hasData(item);
        const auto = structured ? effectiveAuto(item) : null;
        const autoPort = auto && item.ports.find(p => p.row === auto);
        const directional = /-[A-Z]$/i.test(item.service);

        wrap.append(
            el("div", { class: "cardTitle" }, `${item.service || "(no service)"}${item.vesselOperator ? ` · ${item.vesselOperator}` : ""} · ${item.record ? `record ${item.record}` : "imported receipt"}`),
            el("div", { class: "tags" },
                el("span", { class: "tag" }, directional ? "directional (1 bound)" : "2 bounds"),
                !structured
                    ? el("span", { class: "tag special" }, "auto: the yellow row in the image")
                    : autoPort
                        ? el("span", { class: "tag special" }, `auto: SP${auto} ${autoPort.name}`)
                        : el("span", { class: "tag" }, "auto: found nothing special (SP001 default)"),
                truthTag(item)
            )
        );

        if (!structured) {
            wrap.append(
                renderActionsForImage(item),
                item.receiptFile
                    ? el("img", { class: "receiptImg", src: imageUrl(item), alt: `${item.service} receipt` })
                    : el("div", { class: "empty" }, "Receipt image is gone from the folder.")
            );
            return;
        }

        wrap.append(
            el("div", { class: "extraInfo" },
                `First US port: ${[item.firstUsPort.code, item.firstUsPort.desc].filter(Boolean).join(" — ") || "—"}`, el("br"),
                `First EU port: ${[item.firstEuPort.code, item.firstEuPort.desc].filter(Boolean).join(" — ") || "—"}`, el("br"),
                `Last foreign port: ${[item.lastForeignPort.code, item.lastForeignPort.desc].filter(Boolean).join(" — ") || "—"}`
            ),
            renderActionsForRows(item, auto),
            el("table", { class: "portsTable" },
                el("thead", {}, el("tr", {}, ["Row", "Port", "Category", "Arrival", "Depart", "Code", "Key"].map(h => el("th", {}, h)))),
                el("tbody", {}, item.ports.map(p => {
                    const cls = ["portRow"];
                    if (p.row === auto) cls.push("autoPick");
                    if (byRow(item) && item.truth.row === p.row) cls.push("truthPick");
                    return el("tr", { class: cls.join(" "), title: "Click = this is the port that should be highlighted", onclick: () => verdictRow(item.key, p.row) },
                        el("td", {}, `SP${p.row}`),
                        el("td", {}, p.name),
                        el("td", { class: "dim" }, p.fine === "UK" || p.fine === "CANADA" ? `${p.category} (${p.fine})` : p.category),
                        el("td", { class: "dim" }, p.arrival || "—"),
                        el("td", { class: "dim" }, p.depart || "—"),
                        el("td", { class: "dim" }, p.code || "—"),
                        el("td", { class: "dim" }, p.key || "")
                    );
                }))
            ),
            item.receiptFile
                ? el("details", { class: "receiptDetails" }, el("summary", {}, "Receipt image (from the folder)"),
                    el("img", { class: "receiptImg", src: imageUrl(item), alt: `${item.service} receipt` }))
                : null
        );
    }

    function renderAll() {
        renderStats();
        renderList();
        renderCard();
    }

    document.addEventListener("keydown", e => {
        if (["SELECT", "INPUT", "TEXTAREA"].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
        const item = state.items.find(i => i.key === state.current);
        if (!item) return;
        const key = e.key.toLowerCase();
        const structured = hasData(item);
        if (key === "y" || key === "enter") structured ? verdictRow(item.key, effectiveAuto(item)) : verdictImage(item.key, "right");
        else if (key === "n") structured ? verdictRow(item.key, null) : verdictImage(item.key, "none");
        else if (key === "s" || key === "arrowright") step(1);
        else if (key === "arrowleft") step(-1);
        else return;
        e.preventDefault();
    });

    $("refreshBtn").addEventListener("click", () => load().then(() => flash("Re-scanned the receipts folder", true)));
    $("exportBtn").addEventListener("click", () => {
        location.href = "/highlight-review/export";
        flash(`Export also saved to ${state.files.export}`, true);
    });
    $("exportAllBtn").addEventListener("click", () => {
        location.href = "/highlight-review/export?all=1";
        flash(`Export also saved to ${state.files.export}`, true);
    });

    load().catch(err => { $("stats").textContent = `Could not load: ${err.message}`; });
})();
