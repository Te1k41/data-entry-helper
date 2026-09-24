// Highlight Review page — mark each captured record's auto-picked highlight
// right/wrong and click the correct row. Verdicts persist server-side
// (highlight-review-store.js). See routes/highlight-review.js.
(function () {
    const state = { items: [], current: null, filter: "unreviewed", files: {} };
    const $ = id => document.getElementById(id);

    const effectiveAuto = item => (item.autoSpecial ? item.autoRow : null);
    const isReviewed    = item => Boolean(item.truth);
    const agrees        = item => isReviewed(item) && item.truth.row === effectiveAuto(item);

    const FILTERS = {
        unreviewed: i => !isReviewed(i),
        all:        () => true,
        special:    i => i.autoSpecial,
        fallback:   i => !i.autoSpecial,
        disagree:   i => isReviewed(i) && !agrees(i),
        reviewed:   isReviewed,
    };
    const FILTER_LABELS = {
        unreviewed: "Unreviewed", all: "All", special: "Auto found a special port",
        fallback: "Auto found nothing (SP001 default)", disagree: "Marked wrong", reviewed: "Reviewed",
    };

    const filtered = () => state.items.filter(FILTERS[state.filter]);

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
        state.files = { data: data.dataFile, export: data.exportFile };
        if (!state.items.some(i => i.record === state.current) || !filtered().some(i => i.record === state.current)) {
            state.current = filtered()[0]?.record || null;
        }
        renderAll();
    }

    // Verdict → advance. If the current item leaves the filtered list
    // (e.g. filter is "Unreviewed"), the same index now points at the
    // next item; otherwise step forward one.
    async function verdict(record, row) {
        const idx = filtered().findIndex(i => i.record === record);
        try {
            await post("/highlight-review/verdict", { record, row });
        } catch (err) {
            flash(`Could not save: ${err.message}`, false);
            return;
        }
        state.items.find(i => i.record === record).truth = { row, reviewedAt: new Date().toISOString() };
        const after = filtered();
        const still = after.findIndex(i => i.record === record);
        state.current = after[Math.min(still >= 0 ? still + 1 : idx, after.length - 1)]?.record || null;
        renderAll();
    }

    async function clearVerdict(record) {
        try {
            await post("/highlight-review/verdict", { record, clear: true });
        } catch (err) {
            flash(`Could not clear: ${err.message}`, false);
            return;
        }
        delete state.items.find(i => i.record === record).truth;
        renderAll();
    }

    function step(delta) {
        const list = filtered();
        const idx  = list.findIndex(i => i.record === state.current);
        const next = list[Math.max(0, Math.min(list.length - 1, idx + delta))];
        if (next) { state.current = next.record; renderAll(); }
    }

    function statusIcon(item) {
        if (!isReviewed(item)) return "·";
        return agrees(item) ? "✅" : "❌";
    }

    function renderStats() {
        const total    = state.items.length;
        const reviewed = state.items.filter(isReviewed).length;
        const wrong    = state.items.filter(FILTERS.disagree).length;
        const select   = el("select", { onchange: e => { state.filter = e.target.value; state.current = filtered()[0]?.record || null; renderAll(); } },
            Object.entries(FILTER_LABELS).map(([value, label]) => {
                const opt = el("option", { value }, `${label} (${state.items.filter(FILTERS[value]).length})`);
                if (value === state.filter) opt.selected = true;
                return opt;
            })
        );
        const stats = $("stats");
        stats.replaceChildren(
            el("b", {}, reviewed), ` / ${total} reviewed · `, el("b", {}, wrong), " marked wrong",
            select
        );
        if (total === 0) {
            stats.append(el("div", { class: "hint" }, "Nothing captured yet — run 🧾 Capture Receipts in the extension first."));
        }
    }

    function renderList() {
        const list = $("list");
        list.replaceChildren(...filtered().map(item =>
            el("div", { class: "listItem" + (item.record === state.current ? " current" : ""), onclick: () => { state.current = item.record; renderAll(); } },
                el("span", {}, `${item.service || "(no service)"}`),
                el("span", { class: "st" }, statusIcon(item))
            )
        ));
        list.querySelector(".current")?.scrollIntoView({ block: "nearest" });
    }

    function renderCard() {
        const wrap = $("card");
        wrap.replaceChildren();
        const item = state.items.find(i => i.record === state.current);
        if (!item) {
            wrap.append(el("div", { class: "empty" }, state.items.length ? "Nothing in this filter — pick another above." : ""));
            return;
        }

        const auto = effectiveAuto(item);
        const autoPort = auto && item.ports.find(p => p.row === auto);
        const truthPort = isReviewed(item) && item.truth.row && item.ports.find(p => p.row === item.truth.row);
        const directional = /-[A-Z]$/i.test(item.service);

        wrap.append(
            el("div", { class: "cardTitle" }, `${item.service || "(no service)"} · record ${item.record}`),
            el("div", { class: "tags" },
                el("span", { class: "tag" }, directional ? "directional (1 bound)" : "2 bounds"),
                autoPort
                    ? el("span", { class: "tag special" }, `auto: SP${auto} ${autoPort.name}`)
                    : el("span", { class: "tag" }, "auto: found nothing special (SP001 default)"),
                isReviewed(item)
                    ? el("span", { class: "tag " + (agrees(item) ? "ok" : "bad") },
                        agrees(item) ? "✅ marked right"
                            : `❌ should be: ${truthPort ? `SP${item.truth.row} ${truthPort.name}` : "no special port"}`)
                    : null
            ),
            el("div", { class: "extraInfo" },
                `First US port: ${[item.firstUsPort.code, item.firstUsPort.desc].filter(Boolean).join(" — ") || "—"}`, el("br"),
                `First EU port: ${[item.firstEuPort.code, item.firstEuPort.desc].filter(Boolean).join(" — ") || "—"}`, el("br"),
                `Last foreign port: ${[item.lastForeignPort.code, item.lastForeignPort.desc].filter(Boolean).join(" — ") || "—"}`
            ),
            el("div", { class: "actions" },
                el("button", { class: "good", onclick: () => verdict(item.record, auto) },
                    auto ? `✅ Right — SP${auto} (Y)` : "✅ Right — nothing special (Y)"),
                auto ? el("button", { class: "none", onclick: () => verdict(item.record, null) }, "🚫 No special port (N)") : null,
                el("button", { onclick: () => step(-1) }, "◀ Prev"),
                el("button", { onclick: () => step(1) }, "Skip ▶ (S)"),
                isReviewed(item) ? el("button", { onclick: () => clearVerdict(item.record) }, "↩ Clear verdict") : null
            ),
            el("table", { class: "portsTable" },
                el("thead", {}, el("tr", {}, ["Row", "Port", "Category", "Arrival", "Depart", "Code", "Key"].map(h => el("th", {}, h)))),
                el("tbody", {}, item.ports.map(p => {
                    const cls = ["portRow"];
                    if (p.row === auto) cls.push("autoPick");
                    if (isReviewed(item) && item.truth.row === p.row) cls.push("truthPick");
                    return el("tr", { class: cls.join(" "), title: "Click = this is the port that should be highlighted", onclick: () => verdict(item.record, p.row) },
                        el("td", {}, `SP${p.row}`),
                        el("td", {}, p.name),
                        el("td", { class: "dim" }, p.fine === "UK" || p.fine === "CANADA" ? `${p.category} (${p.fine})` : p.category),
                        el("td", { class: "dim" }, p.arrival || "—"),
                        el("td", { class: "dim" }, p.depart || "—"),
                        el("td", { class: "dim" }, p.code || "—"),
                        el("td", { class: "dim" }, p.key || "")
                    );
                }))
            )
        );
    }

    function renderAll() {
        renderStats();
        renderList();
        renderCard();
    }

    document.addEventListener("keydown", e => {
        if (e.target.tagName === "SELECT" || e.ctrlKey || e.metaKey || e.altKey) return;
        const item = state.items.find(i => i.record === state.current);
        if (!item) return;
        const key = e.key.toLowerCase();
        if (key === "y" || key === "enter") verdict(item.record, effectiveAuto(item));
        else if (key === "n") verdict(item.record, null);
        else if (key === "s" || key === "arrowright") step(1);
        else if (key === "arrowleft") step(-1);
        else return;
        e.preventDefault();
    });

    $("refreshBtn").addEventListener("click", load);
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
