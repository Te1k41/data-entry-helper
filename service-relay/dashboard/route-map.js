// ============================================================
//  dashboard/route-map.js — draws a receipt's route on a world map,
//  like Tradetech's own route map: red port dots, curved arrows (one
//  colour per leg), the highlighted port ringed, and the Vessel
//  Operator / Carriers box. Everything is one SVG, so Export PNG
//  captures exactly what's on screen.
//
//  Zoom (wheel, ＋/－) and pan (drag) change the VIEW and redraw, rather
//  than scaling a picture — so arrows, dots, labels and arrowheads keep the
//  same clear on-screen size at every zoom, while coastlines get sharper.
//
//  Data: routes/route-map.js (receipt list, route + placed ports, land).
//  Map: Mercator, centred on the route's own longitude — the world is
//  drawn 3x side by side (land.json rings already stop at ±180°), so a
//  trans-Pacific route never splits at the date line.
// ============================================================

const W = 1100, MAP_H = 560;           // SVG user units
const COLORS = ["#2346b8", "#2e9b3c"]; // leg 1 blue, leg 2 green (like Tradetech's)
const MAX_LAT = 82;

// ── Pure geometry (also run by the Node self-check at the bottom) ──

const mercY = lat => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 360));
const invMercY = y => (360 / Math.PI) * Math.atan(Math.exp((y * Math.PI) / 180)) - 90;

// Circular mean of longitudes — the route's own centre, so a route
// across the date line centres on the Pacific, not on Greenwich.
function centerLon(lons) {
    const x = lons.reduce((s, l) => s + Math.cos((l * Math.PI) / 180), 0);
    const y = lons.reduce((s, l) => s + Math.sin((l * Math.PI) / 180), 0);
    return (Math.atan2(y, x) * 180) / Math.PI;
}

// Move a longitude by whole turns so it's within 180° of `center`.
const unwrap = (lon, center) => lon + 360 * Math.round((center - lon) / 360);

// View (map units: x = longitude, y = Mercator degrees) fitting all
// points with padding, a minimum span, and the drawing's aspect ratio.
function fitView(points, aspect = W / MAP_H) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const padX = Math.max(8, (x1 - x0) * 0.15), padY = Math.max(6, (y1 - y0) * 0.2);
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
    let w = Math.max(x1 - x0, 40), h = Math.max(y1 - y0, 40 / aspect);
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return { x0: cx - w / 2, y0: cy - h / 2, w, h };
}

// Leg colour index per port row: Tradetech marks where leg 1 ends with
// the first End marker in a port_key ("EE", "WE", "EEWS"…) — same rule
// as PortHighlighting.findFullBoundPivotRow(). No marker = one leg.
function pivotRow(ports) {
    for (const p of ports) {
        const k = String(p.key || "").trim().toUpperCase();
        if (/^([NSEW][SE]){1,2}$/.test(k) && k.match(/../g).some(c => c[1] === "E")) return parseInt(p.row, 10);
    }
    return null;
}

// Quadratic curve control point: bend to the LEFT of the direction of
// travel, so an out leg and its return leg between the same two areas
// bow apart instead of drawing on top of each other.
function bendPoint(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(len * 0.22, 90);
    return { x: (a.x + b.x) / 2 + (dy / len) * bend, y: (a.y + b.y) / 2 - (dx / len) * bend };
}

// Greedy label placement: first of right / left / above / below whose box
// doesn't overlap an already-placed label or any dot; right if none is free.
// labels: [{ x, y, width }] (dot centre + text width) -> [{ x, y, anchor }]
function placeLabels(labels, dots, H = 13) {
    const taken = dots.map(d => ({ x0: d.x - 7, y0: d.y - 7, x1: d.x + 7, y1: d.y + 7 }));
    const hit = b => taken.some(t => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
    return labels.map(({ x, y, width }) => {
        const options = [
            { x: x + 10, y: y + 4, anchor: "start", box: { x0: x + 9, y0: y - 7, x1: x + 11 + width, y1: y + 6 } },
            { x: x - 10, y: y + 4, anchor: "end", box: { x0: x - 11 - width, y0: y - 7, x1: x - 9, y1: y + 6 } },
            { x, y: y - 11, anchor: "middle", box: { x0: x - width / 2, y0: y - 9 - H, x1: x + width / 2, y1: y - 8 } },
            { x, y: y + 20, anchor: "middle", box: { x0: x - width / 2, y0: y + 9, x1: x + width / 2, y1: y + 9 + H } },
        ];
        const pick = options.find(o => !hit(o.box)) || options[0];
        taken.push(pick.box);
        return { x: pick.x, y: pick.y, anchor: pick.anchor };
    });
}

// Zoom by `factor` (>1 = in) keeping the map point under (ux, uy) — SVG
// user units, origin top-left of the map — exactly where it is.
const MIN_W = 1.5, MAX_W = 720; // degrees of longitude across the map
function zoomAt(v, ux, uy, factor, mapW = W, mapH = MAP_H) {
    const w = Math.min(MAX_W, Math.max(MIN_W, v.w / factor)), h = (w * v.h) / v.w;
    const mx = v.x0 + v.w * (ux / mapW), my = v.y0 + v.h * (1 - uy / mapH);
    return { x0: mx - w * (ux / mapW), y0: my - h * (1 - uy / mapH), w, h };
}

// Pan by a drag of (dx, dy) SVG user units (drag right = see more west).
function panBy(v, dx, dy, mapW = W, mapH = MAP_H) {
    return { ...v, x0: v.x0 - dx * (v.w / mapW), y0: v.y0 + dy * (v.h / mapH) };
}

const cityLabel = name => String(name || "").split(",")[0].replace(/\s*\(.*?\)\s*/g, " ").trim()
    .toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

if (typeof module !== "undefined") module.exports = { mercY, invMercY, centerLon, unwrap, fitView, pivotRow, bendPoint, cityLabel, placeLabels, zoomAt, panBy };

// ── Page ──────────────────────────────────────────────────────

if (typeof document !== "undefined") {
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    let land = null, borders = null, current = null, placing = null, view = null;

    const status = msg => { $("rmStatus").textContent = msg; };

    async function loadList() {
        const { folder, files } = await (await fetch("/route-map/receipts")).json();
        $("rmFolder").textContent = folder;
        $("rmList").innerHTML = files.length ? files.map(f => `
            <div class="rmItem" data-file="${esc(f.file)}">${esc(f.file.replace(/-receipt\.png$/i, ""))}
                <div class="when">${esc(new Date(f.mtime).toLocaleString())}</div></div>`).join("")
            : `<div class="rmItem" style="cursor:default;color:var(--dim)">No receipts in this folder yet</div>`;
        for (const el of $("rmList").querySelectorAll("[data-file]")) {
            el.onclick = () => {
                for (const x of $("rmList").querySelectorAll(".current")) x.classList.remove("current");
                el.classList.add("current");
                const load = () => openRoute(fetch(`/route-map/receipt?file=${encodeURIComponent(el.dataset.file)}`).then(r => r.json()), el.dataset.file, load);
                load();
            };
        }
    }

    async function openFile(file) {
        const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
        const load = () => openRoute(fetch("/route-map/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl, filename: file.name }) }).then(r => r.json()), file.name, load);
        load();
    }

    // reload: re-runs the same open (after a placement or a port-data update)
    async function openRoute(promise, label, reload) {
        status(`Loading ${label}…`);
        const result = await promise;
        if (!result.ok) { status(result.reason); return; }
        if (current?.reload !== reload) view = null; // a different route re-fits; a reload (after Place) keeps your zoom
        current = { ...result, label, reload };
        land ||= await (await fetch("/route-map/land.json")).json();
        borders ||= await (await fetch("/route-map/borders.json")).json();
        render();
    }

    function render(withTable = true) {
        const { data, places, source } = current;
        const ports = data.ports.map((p, i) => ({ ...p, place: places[i] }));
        const placed = ports.filter(p => p.place);
        if (!placed.length) { status("None of this route's ports could be placed — use “Place” in the table below."); }

        const center = placed.length ? centerLon(placed.map(p => p.place.lon)) : 0;
        for (const p of placed) { p.x = unwrap(p.place.lon, center); p.y = mercY(p.place.lat); }
        view ||= fitView(placed.length ? placed : [{ x: center, y: 0 }]);
        const k = W / view.w;
        const sx = x => (x - view.x0) * k, sy = y => (view.y0 + view.h - y) * k;

        // Land, 3 copies so any centre longitude has full coverage.
        let landPath = "";
        for (const off of [-360, 0, 360]) {
            for (const ring of land) {
                let inView = false;
                const pts = ring.map(([lon, lat]) => {
                    const x = sx(lon + off), y = sy(mercY(lat));
                    if (x > -50 && x < W + 50 && y > -50 && y < MAP_H + 50) inView = true;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                });
                if (inView) landPath += `M${pts.join("L")}Z`;
            }
        }
        // Country borders — same 3 copies, open polylines.
        let borderPath = "";
        for (const off of [-360, 0, 360]) {
            for (const line of borders) {
                const pts = line.map(([lon, lat]) => [sx(lon + off), sy(mercY(lat))]);
                if (pts.some(([x, y]) => x > -50 && x < W + 50 && y > -50 && y < MAP_H + 50)) {
                    borderPath += `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}`;
                }
            }
        }
        const dateLines = [];
        for (let x = Math.ceil((view.x0 - 180) / 360) * 360 + 180; x < view.x0 + view.w; x += 360) dateLines.push(sx(x));

        // Arrows between consecutive placed ports.
        const pivot = pivotRow(data.ports);
        const legOf = p => (pivot && parseInt(p.row, 10) > pivot ? 1 : 0);
        let arrows = "";
        for (let i = 1; i < placed.length; i++) {
            const a = { x: sx(placed[i - 1].x), y: sy(placed[i - 1].y) }, b = { x: sx(placed[i].x), y: sy(placed[i].y) };
            if (Math.hypot(b.x - a.x, b.y - a.y) < 4) continue;
            const c = bendPoint(a, b), leg = legOf(placed[i]);
            const gap = ports.indexOf(placed[i]) - ports.indexOf(placed[i - 1]) > 1; // an unplaced port in between
            arrows += `<path d="M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}" fill="none" stroke="${COLORS[leg]}" stroke-width="2.6" stroke-linecap="round"${gap ? ' stroke-dasharray="6 4"' : ""} marker-end="url(#arrow${leg})"/>`;
        }

        // Dots + labels, one per distinct spot (a port visited twice gets one dot).
        const spots = new Map();
        for (const p of placed) {
            const key = `${sx(p.x).toFixed(0)},${sy(p.y).toFixed(0)}`;
            if (!spots.has(key)) spots.set(key, { x: sx(p.x), y: sy(p.y), p, highlighted: false });
            if (p.row === data.highlightedRow) spots.get(key).highlighted = true;
        }
        const spotList = [...spots.values()];
        const texts = spotList.map(s => cityLabel(s.p.name) + (s.p.place.how === "approx" ? " ≈" : ""));
        const spotsLabels = placeLabels(spotList.map((s, i) => ({ x: s.x, y: s.y, width: texts[i].length * 7.6 })), spotList);
        let dots = "", labels = "";
        spotList.forEach((s, i) => {
            const approx = s.p.place.how === "approx", l = spotsLabels[i];
            dots += (s.highlighted ? `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="11" fill="none" stroke="#f2c200" stroke-width="4"/>` : "")
                + `<circle data-port="${esc(s.p.name)}" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="5.5" fill="${approx ? "#f28c28" : "#e8202a"}" stroke="#fff" stroke-width="1.5"/>`;
            labels += `<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" text-anchor="${l.anchor}" font-size="13" font-weight="bold" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(texts[i])}</text>`;
        });

        // Vessel operator / carriers box (inside the SVG so Export includes it).
        const op = data.vesselOperator || {};
        const opLine = [op.name, op.code && op.name ? `(${op.code})` : op.code].filter(Boolean).join(" ") || "—";
        const carriers = (data.carriers || []).map(c => [c.name || c.code, c.service ? `— ${c.service}` : ""].filter(Boolean).join(" "));
        const lineH = 18, boxLines = 1 + Math.max(1, carriers.length);
        const boxH = 24 + boxLines * lineH + 10, totalH = MAP_H + boxH + 20;
        let box = `<rect x="${W - 520}" y="${MAP_H + 10}" width="500" height="${boxH}" fill="#fff" stroke="#e0403f" stroke-width="1.5"/>`;
        box += `<text x="${W - 380}" y="${MAP_H + 34}" text-anchor="end" font-size="14" font-weight="bold" fill="#111">Vessel Operator:</text>`
            + `<text x="${W - 370}" y="${MAP_H + 34}" font-size="14" fill="#111">${esc(opLine)}</text>`
            + `<text x="${W - 380}" y="${MAP_H + 34 + lineH}" text-anchor="end" font-size="14" font-weight="bold" fill="#111">Carriers:</text>`;
        (carriers.length ? carriers : [source === "review-store" ? "(not in this older receipt)" : "—"])
            .forEach((c, i) => { box += `<text x="${W - 370}" y="${MAP_H + 34 + lineH * (i + 1)}" font-size="14" fill="#111">${esc(c)}</text>`; });
        const title = `<text x="14" y="${MAP_H + 34}" font-size="16" font-weight="bold" fill="#111">${esc(data.service || current.label)}</text>`
            + `<text x="14" y="${MAP_H + 54}" font-size="12" fill="#555">${pivot ? `<tspan fill="${COLORS[0]}">━ leg 1</tspan>  <tspan fill="${COLORS[1]}">━ leg 2</tspan>  ·  ` : ""}<tspan fill="#c9a000">◯</tspan> highlighted port</text>`;

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${totalH}" font-family="Arial, Helvetica, sans-serif">
            <defs>${COLORS.map((c, i) => `<marker id="arrow${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" markerUnits="strokeWidth" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join("")}
                <clipPath id="mapClip"><rect width="${W}" height="${MAP_H}"/></clipPath></defs>
            <rect width="${W}" height="${totalH}" fill="#fff"/>
            <g clip-path="url(#mapClip)">
                <rect width="${W}" height="${MAP_H}" fill="#ffffff"/>
                <path d="${landPath}" fill="#d6d6d6" stroke="#9a9a9a" stroke-width="0.6" fill-rule="evenodd"/>
                <path d="${borderPath}" fill="none" stroke="#a8a8a8" stroke-width="0.7"/>
                ${dateLines.map(x => `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${MAP_H}" stroke="#9a9a9a" stroke-dasharray="4 4"/>`).join("")}
                ${arrows}${dots}${labels}
            </g>
            <rect width="${W}" height="${MAP_H}" fill="none" stroke="#bbb"/>
            ${title}${box}
        </svg>`;
        $("rmMap").innerHTML = svg;
        $("rmExport").disabled = false;

        const unplaced = ports.filter(p => !p.place).length;
        if (!withTable) return; // zoom/pan redraw — table and status unchanged
        status(`${data.service || current.label}: ${placed.length}/${ports.length} ports placed${unplaced ? ` — ${unplaced} not placed, use “Place” below` : ""}${source === "review-store" ? " · older receipt: route taken from stored review data" : ""}`);
        renderTable(ports);
    }

    function renderTable(ports) {
        const label = { exact: "✓", waypoint: "✓ waypoint", code: "✓ by code", override: "✓ placed by you", approx: "≈ approximate" };
        $("rmPorts").innerHTML = `<tr><th>SP</th><th>Port</th><th>Key</th><th>Arrival</th><th>Depart</th><th>On map</th><th></th></tr>`
            + ports.map((p, i) => `<tr class="${p.row === current.data.highlightedRow ? "hl" : ""}">
                <td>${esc(p.row)}</td><td>${esc(p.name)}${p.code ? ` <span style="color:var(--dim)">${esc(p.code)}</span>` : ""}</td>
                <td>${esc(p.key)}</td><td>${esc(p.arrival)}</td><td>${esc(p.depart)}</td>
                <td class="pl-${p.place ? p.place.how : "none"}" title="${p.place ? esc(`matched “${p.place.matched}” (${p.place.source})`) : ""}">${p.place ? label[p.place.how] : "✗ not placed"}</td>
                <td><button data-place="${i}">${p.place ? "Move" : "Place"}</button>${p.place?.how === "override" ? ` <button data-reset="${i}">Reset</button>` : ""}</td></tr>`).join("");
        for (const b of $("rmPorts").querySelectorAll("[data-place]")) {
            b.onclick = () => { placing = ports[+b.dataset.place].name; $("rmMap").classList.add("placing"); status(`Click on the map where ${placing} is.`); };
        }
        for (const b of $("rmPorts").querySelectorAll("[data-reset]")) {
            b.onclick = () => saveOverride(ports[+b.dataset.reset].name, null, null);
        }
    }

    async function saveOverride(name, lat, lon) {
        await fetch("/route-map/override", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, lat, lon }) });
        current?.reload();
    }

    // Mouse position -> SVG user units (viewBox is W wide, aspect kept).
    const toUser = (e) => {
        const r = $("rmMap").querySelector("svg").getBoundingClientRect();
        return { ux: ((e.clientX - r.left) / r.width) * W, uy: ((e.clientY - r.top) / r.width) * W };
    };
    let pending = false;
    const redraw = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; render(false); }); };

    $("rmMap").addEventListener("wheel", (e) => {
        if (!view || !current) return;
        const { ux, uy } = toUser(e);
        if (uy > MAP_H) return;
        e.preventDefault();
        view = zoomAt(view, ux, uy, Math.exp(-e.deltaY * 0.0015));
        redraw();
    }, { passive: false });

    let drag = null, dragged = false;
    $("rmMap").addEventListener("mousedown", (e) => {
        if (e.button !== 0 || !view) return;
        const p = toUser(e);
        if (p.uy > MAP_H) return;
        drag = { ...p, view }; dragged = false;
        e.preventDefault(); // no text selection while dragging
    });
    window.addEventListener("mousemove", (e) => {
        if (!drag) return;
        const p = toUser(e);
        if (Math.hypot(p.ux - drag.ux, p.uy - drag.uy) > 3) dragged = true;
        if (dragged) { view = panBy(drag.view, p.ux - drag.ux, p.uy - drag.uy); redraw(); }
    });
    window.addEventListener("mouseup", () => { drag = null; });

    const zoomCenter = factor => { if (view && current) { view = zoomAt(view, W / 2, MAP_H / 2, factor); render(false); } };
    $("rmZoomIn").onclick = () => zoomCenter(1.6);
    $("rmZoomOut").onclick = () => zoomCenter(1 / 1.6);
    $("rmZoomReset").onclick = () => { if (current) { view = null; render(false); } };

    $("rmMap").addEventListener("click", (e) => {
        if (dragged) { dragged = false; return; } // end of a pan, not a placement click
        if (!placing || !view) return;
        const { ux, uy } = toUser(e);
        if (uy > MAP_H) return;
        const k = W / view.w;
        let lon = ux / k + view.x0;
        lon = ((((lon + 180) % 360) + 360) % 360) - 180;
        const lat = invMercY(view.y0 + view.h - uy / k);
        const name = placing;
        placing = null;
        $("rmMap").classList.remove("placing");
        saveOverride(name, lat, lon);
    });

    $("rmExport").onclick = () => {
        const svg = $("rmMap").querySelector("svg");
        const [, , vw, vh] = svg.getAttribute("viewBox").split(" ").map(Number);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = vw * 2; canvas.height = vh * 2;
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            const a = document.createElement("a");
            a.href = canvas.toDataURL("image/png");
            a.download = `${(current.data.service || "route").replace(/[^A-Za-z0-9-]/g, "_")}-route-map.png`;
            a.click();
        };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    };

    $("rmUpdatePorts").onclick = async () => {
        $("rmUpdatePorts").disabled = true;
        status("Downloading port data (IMF PortWatch + UN/LOCODE)… this takes a few seconds");
        const r = await (await fetch("/route-map/update-ports", { method: "POST" })).json();
        $("rmUpdatePorts").disabled = false;
        status(r.ok ? "Port data updated." : `Update failed: ${r.reason}`);
        if (r.ok) current?.reload();
    };

    $("rmFile").onchange = () => $("rmFile").files[0] && openFile($("rmFile").files[0]);
    const drop = $("rmDrop");
    document.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    document.addEventListener("dragleave", () => drop.classList.remove("over"));
    document.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) openFile(f); });

    // ?file=NAME opens that receipt straight away (links from other pages).
    loadList().then(() => {
        const want = new URLSearchParams(location.search).get("file");
        if (want) [...$("rmList").querySelectorAll("[data-file]")].find(el => el.dataset.file === want)?.click();
    }).catch(err => status(`Could not list receipts: ${err.message}`));
}
