// ============================================================
//  merge.js — local, lossless image merger.
//  Replaces mergeimagesonline.com for anyone using this page:
//  merges up to MAX_IMAGES screenshots into one PNG via <canvas>
//  (native, no recompression), downloads it into the same
//  Downloads folder download-watcher.js already watches, and
//  reuses the existing rename/cleanup pipeline via the same
//  WebSocket protocol merge-download-signal.js uses.
// ============================================================

const MAX_IMAGES = 30;

// Conservative canvas ceiling — Firefox caps a single dimension at
// 32,767px; Chrome caps total area around 268,435,456px². Used both
// to trigger the grid-wrap (a row/column longer than this starts a
// new one) and as the final hard limit checked after layout.
const MAX_DIMENSION = 32767;
const MAX_AREA      = 268435456;

let files = [];             // File[], in merge order
let decodeCache = new Map(); // File -> Image, so re-preview doesn't re-decode
let ws = null;

function connect() {
    ws = new WebSocket("ws://localhost:3737");
    ws.addEventListener("close", () => {
        setTimeout(connect, 3000);
    });
}
connect();

function signalMergeDownload() {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "merge-download" }));
    }
}

function clearPreview() {
    const canvas = document.getElementById("previewCanvas");
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
    document.getElementById("previewCaption").textContent = "";
}

function renderList() {
    document.getElementById("capNote").textContent = `${files.length} / ${MAX_IMAGES} images selected`;

    const list = document.getElementById("imgList");
    list.innerHTML = "";
    files.forEach((file, i) => {
        const li = document.createElement("li");

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = `${i + 1}. ${file.name}`;
        li.appendChild(name);

        const size = document.createElement("span");
        size.className = "dim";
        size.textContent = `${(file.size / 1024).toFixed(0)} KB`;
        li.appendChild(size);

        const up = document.createElement("button");
        up.textContent = "▲";
        up.disabled = i === 0;
        up.onclick = () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; renderList(); };
        li.appendChild(up);

        const down = document.createElement("button");
        down.textContent = "▼";
        down.disabled = i === files.length - 1;
        down.onclick = () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; renderList(); };
        li.appendChild(down);

        const remove = document.createElement("button");
        remove.textContent = "✕";
        remove.onclick = () => {
            decodeCache.delete(files[i]); // don't hold decoded bitmaps for images no longer in the list
            files.splice(i, 1);
            renderList();
        };
        li.appendChild(remove);

        list.appendChild(li);
    });

    // ponytail: full-res re-render on every add/reorder/remove/direction
    // change — decode is cached so this is draw-only work; add debouncing
    // if reordering large (near-30-image) sets ever feels laggy.
    if (files.length) {
        updatePreview();
    } else {
        clearPreview();
    }
}

document.getElementById("fileInput").addEventListener("change", (event) => {
    const picked = Array.from(event.target.files);
    const room   = MAX_IMAGES - files.length;

    if (picked.length > room) {
        alert(`Only ${room} more image(s) fit under the ${MAX_IMAGES}-image cap — dropped ${picked.length - room}.`);
    }

    files = files.concat(picked.slice(0, room));
    event.target.value = ""; // allow re-picking the same file(s) later
    renderList();
});

document.querySelectorAll('input[name="dir"]').forEach((radio) => {
    radio.addEventListener("change", () => {
        if (files.length) updatePreview();
    });
});

function resetAll() {
    files = [];
    decodeCache.clear();
    renderList(); // files is now empty, so this clears the preview too
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "renaming", enabled: true }));
    }
    setMsg("", "");
}

function setMsg(text, cls) {
    const el = document.getElementById("mergeMsg");
    el.textContent = text;
    el.className = cls || "";
}

// Decodes a File into an Image with real naturalWidth/naturalHeight
// available — resolves only once the browser has actually finished
// loading it, never before. Cached so reordering/re-previewing doesn't
// re-decode images already loaded.
function loadImage(file) {
    if (decodeCache.has(file)) return Promise.resolve(decodeCache.get(file));
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload  = () => { decodeCache.set(file, img); resolve(img); };
        img.onerror = () => reject(new Error(`Could not decode ${file.name}`));
        img.src = url;
    });
}

async function decodeAll(fileList) {
    return Promise.all(fileList.map(loadImage));
}

// Shelf/bin-packing layout, symmetric for both directions. Returns
// { canvasW, canvasH, placements: [{img,x,y,w,h}], bandCount } or
// throws with a user-facing message if the result can't fit any
// canvas regardless of how it's wrapped.
function computeLayout(images, fileNames, direction) {
    const horiz = direction === "horizontal";

    // Pre-check: a single image bigger than MAX_DIMENSION along the
    // packing axis can never fit any row/column, wrapping can't help it.
    images.forEach((img, i) => {
        const size = horiz ? img.naturalWidth : img.naturalHeight;
        if (size > MAX_DIMENSION) {
            throw new Error(`"${fileNames[i]}" is ${size}px ${horiz ? "wide" : "tall"} by itself — exceeds the ${MAX_DIMENSION}px canvas limit, no layout can fit it.`);
        }
    });

    const placements = [];
    const bandCrossSizes = []; // cross-axis size of each closed row (horiz) / column (vert)
    const bandAlongTotals = []; // along-axis extent of each closed band, to find the widest row / tallest column

    let bandStart = 0; // y (horiz) / x (vert) position where the current band begins
    let along = 0;      // position along the packing axis within the current band
    let cross = 0;       // max cross-axis size seen in the current band

    for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const alongSize = horiz ? img.naturalWidth  : img.naturalHeight;
        const crossSize = horiz ? img.naturalHeight : img.naturalWidth;

        if (along > 0 && along + alongSize > MAX_DIMENSION) {
            // close current band, start a new one
            bandCrossSizes.push(cross);
            bandAlongTotals.push(along);
            bandStart += cross;
            along = 0;
            cross = 0;
        }

        placements.push({
            img,
            x: horiz ? along : bandStart,
            y: horiz ? bandStart : along,
            w: img.naturalWidth,
            h: img.naturalHeight,
        });

        along += alongSize;
        cross = Math.max(cross, crossSize);
    }
    bandCrossSizes.push(cross);
    bandAlongTotals.push(along);

    const maxBandAlong = Math.max(...bandAlongTotals);
    const canvasW = horiz ? maxBandAlong : bandCrossSizes.reduce((a, b) => a + b, 0);
    const canvasH = horiz ? bandCrossSizes.reduce((a, b) => a + b, 0) : maxBandAlong;

    // Post-check: the wrap loop only bounds the packing axis — the
    // cross axis (sum of band sizes) grows unbounded as bands are
    // added, so check the FINAL canvas on both axes plus total area.
    if (canvasW > MAX_DIMENSION || canvasH > MAX_DIMENSION) {
        throw new Error(`Merged image would be ${canvasW}×${canvasH} — one side still exceeds the ${MAX_DIMENSION}px canvas limit even after wrapping. Split into two merges.`);
    }
    if (canvasW * canvasH > MAX_AREA) {
        throw new Error(`Merged image would be ${canvasW}×${canvasH} (${(canvasW * canvasH).toLocaleString()}px²) — exceeds the browser's ${MAX_AREA.toLocaleString()}px² canvas area limit. Split into two merges.`);
    }

    return { canvasW, canvasH, placements, bandCount: bandCrossSizes.length };
}

// Draws a layout onto a new canvas at the given scale. scale=1 is the
// only path used for the actual export — always full native resolution,
// never resized/recompressed. Preview uses scale<1 purely for on-screen
// display speed.
function renderToCanvas(layout, scale) {
    const canvas = document.createElement("canvas");
    canvas.width  = Math.max(1, Math.round(layout.canvasW * scale));
    canvas.height = Math.max(1, Math.round(layout.canvasH * scale));
    const ctx = canvas.getContext("2d");

    // White backdrop — avoids transparent gaps where a narrower/shorter
    // image doesn't reach the canvas edge.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const p of layout.placements) {
        ctx.drawImage(p.img, p.x * scale, p.y * scale, p.w * scale, p.h * scale);
    }

    return canvas;
}

function currentDirection() {
    return document.querySelector('input[name="dir"]:checked').value;
}

// Live preview, called automatically on every list/direction change (see
// renderList()) — always full native resolution (scale=1), same pixels
// as the real export. #previewCanvas's CSS (max-width:100%) shrinks it
// on screen without touching the underlying data.
async function updatePreview() {
    setMsg("Decoding images…", "");

    let images, layout;
    try {
        images = await decodeAll(files);
        layout = computeLayout(images, files.map(f => f.name), currentDirection());
    } catch (err) {
        setMsg(`❌ ${err.message}`, "err");
        return;
    }

    const rendered = renderToCanvas(layout, 1);
    const target = document.getElementById("previewCanvas");
    target.width  = rendered.width;
    target.height = rendered.height;
    target.getContext("2d").drawImage(rendered, 0, 0);

    const bandWord = currentDirection() === "horizontal" ? "row(s)" : "column(s)";
    document.getElementById("previewCaption").textContent =
        `Result: ${layout.canvasW} × ${layout.canvasH}px, ${layout.bandCount} ${bandWord}`;

    setMsg("", "");
}

async function mergeAndDownload() {
    if (files.length === 0) {
        document.getElementById("fileInput").click();
        return;
    }

    setMsg("Decoding images…", "");

    let images, layout;
    try {
        images = await decodeAll(files);
        layout = computeLayout(images, files.map(f => f.name), currentDirection());
    } catch (err) {
        setMsg(`❌ ${err.message}`, "err");
        return;
    }

    setMsg("Encoding PNG…", "");

    const canvas = renderToCanvas(layout, 1); // scale=1 — full resolution, lossless

    canvas.toBlob((blob) => {
        if (!blob) {
            setMsg("❌ Browser could not encode the merged image — try fewer/smaller images.", "err");
            return;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `tt-merge-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        setMsg(`✅ Downloaded ${layout.canvasW}×${layout.canvasH} merged image — renaming/cleanup running…`, "ok");
        setTimeout(signalMergeDownload, 2000);
    }, "image/png"); // no quality argument — PNG has no lossy mode
}
