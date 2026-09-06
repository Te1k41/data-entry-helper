let currentPorts    = []; // [{ operator, raw_port_label, port_code }] — ALL ports for this operator, not just unmapped
let currentVessels  = []; // [{ vessel, code }]

// No devtools access on this machine — surface any JS error directly on
// the page (saveMsg) instead of only in a console nobody can open.
window.addEventListener('error', e => {
    showMessage('saveMsg', `❌ JS error: ${e.message} (${e.filename}:${e.lineno})`, false);
});
window.addEventListener('unhandledrejection', e => {
    showMessage('saveMsg', `❌ Unhandled promise rejection: ${e.reason?.message || e.reason}`, false);
});

async function loadAll() {
    await Promise.all([loadPorts(), loadVessels(), loadBatch()]);
}

// Shows every raw port label seen for this operator, pre-filled with
// its current code (blank if none) — an already-mapped label can still
// be WRONG, so it stays editable here instead of disappearing once it
// has any code at all.
async function loadPorts() {
    const wrap = document.getElementById('tableWrap');
    try {
        const res = await fetch('/result');
        if (!res.ok) {
            wrap.innerHTML = '<div class="empty">No result.xlsx built yet — extract a proof first.</div>';
            currentPorts = [];
            return;
        }
        const data = await res.json();
        currentPorts = data.ports || [];
        renderPortsTable();
    } catch (e) {
        wrap.innerHTML = '<div class="empty">Could not reach the relay server.</div>';
    }
}

// Vessel list = only the vessels seen in the latest result.xlsx (the
// current service) — not every vessel ever saved in the (global) Lloyds
// code dictionary, which would drag in every other service's ships too.
// The dictionary is still consulted per vessel to fill in an already-known
// code; it just doesn't add extra rows of its own.
async function loadVessels() {
    const wrap = document.getElementById('vesselsWrap');
    let seenNames = [];
    try {
        const res = await fetch('/result');
        if (res.ok) {
            const data = await res.json();
            // Placeholder rows ("(no vessels found in this proof)") have
            // no voyage — a real vessel entry always has one.
            seenNames = [...new Set((data.vessels || []).filter(v => v.vessel && v.voyage).map(v => v.vessel))];
        } else {
            wrap.innerHTML = '<div class="empty">No result.xlsx built yet — extract a proof first.</div>';
            currentVessels = [];
            return;
        }
    } catch (e) {
        wrap.innerHTML = '<div class="empty">Could not reach the relay server.</div>';
        currentVessels = [];
        return;
    }

    let known = {};
    try {
        const res = await fetch('/vessel-dictionary');
        if (res.ok) known = await res.json();
    } catch (e) {
        // best-effort — codes just show blank if the dictionary is unreachable
    }

    // Space count/placement shouldn't cause a lookup miss (a wrapped PDF
    // cell, a stray extra space) — same rule vessel-dictionary.js uses.
    const matchKey = name => String(name || '').replace(/\s+/g, '').toUpperCase();
    const codeFor = name => {
        const target = matchKey(name);
        const key = Object.keys(known).find(k => matchKey(k) === target);
        return key ? known[key] : '';
    };

    const seen = new Map(); // matchKey -> { vessel, code }
    for (const name of seenNames) {
        const normalized = name.replace(/\s+/g, ' ').trim().toUpperCase();
        seen.set(matchKey(normalized), { vessel: normalized, code: codeFor(normalized) });
    }

    currentVessels = [...seen.values()].sort((a, b) => a.vessel.localeCompare(b.vessel));
    renderVesselsTable();
}

// Small read-only side panel — today's batch, for quick reference while
// working through mappings. Same data source as the main dashboard's
// due-services view.
async function loadBatch() {
    const wrap = document.getElementById('batchWrap');
    try {
        const res = await fetch('/due-services/current-batch');
        if (!res.ok) {
            wrap.innerHTML = '<div class="empty">No batch loaded.</div>';
            return;
        }
        const data = await res.json();
        renderBatch(data);
    } catch (e) {
        wrap.innerHTML = '<div class="empty">Could not reach the relay server.</div>';
    }
}

function renderBatch(data) {
    const wrap = document.getElementById('batchWrap');
    const items = data.services || [];
    if (items.length === 0) {
        wrap.innerHTML = `<div class="empty">${data.weekComplete ? 'Week complete 🎉' : 'Nothing in this batch.'}</div>`;
        return;
    }

    let html = `<div class="batchDay">${escapeHtml(data.dayName || '')}</div><ul class="batchList">`;
    for (const item of items) {
        const doneBtn = item.done
            ? ''
            : `<button class="batchBtn" onclick="markBatchDone('${item.record}')" title="Mark done">✓</button>`;
        html += `<li class="${item.done ? 'batchDone' : ''}">`
              + `<span onclick="copyBatchService('${escapeHtml(item.service)}', event)" title="Copy">${item.done ? '✅' : '▫'} ${escapeHtml(item.service)}</span>`
              + (item.carrier ? ` <span class="batchCarrier">${escapeHtml(item.carrier)}</span>` : '')
              + doneBtn
              + `</li>`;
    }
    html += '</ul>';
    wrap.innerHTML = html;
}

function copyBatchService(serviceName, event) {
    navigator.clipboard.writeText(serviceName).then(() => {
        const el = event.target;
        const original = el.textContent;
        el.textContent = 'Copied!';
        setTimeout(() => { el.textContent = original; }, 800);
    }).catch(err => console.error('Clipboard copy failed:', err));
}

async function markBatchDone(record) {
    await fetch('/due-services/mark-done', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ record })
    });
    await loadBatch();
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
}

function renderPortsTable() {
    const wrap = document.getElementById('tableWrap');
    if (currentPorts.length === 0) {
        wrap.innerHTML = '<div class="empty">No port labels found — extract a proof first.</div>';
        return;
    }

    let html = '<table class="portsTable"><thead><tr><th>Operator</th><th>Raw Port Label</th><th>Tradetech Port Code</th></tr></thead><tbody>';
    currentPorts.forEach((row, i) => {
        html += `<tr><td>${escapeHtml(row.operator)}</td><td>${escapeHtml(row.raw_port_label)}</td>`
              + `<td><input type="text" id="code-${i}" value="${escapeHtml(row.port_code)}" placeholder="e.g. UKB"></td></tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
}

function renderVesselsTable() {
    const wrap = document.getElementById('vesselsWrap');
    if (currentVessels.length === 0) {
        wrap.innerHTML = '<div class="empty">No vessels seen yet — extract a proof first, or add one below.</div>';
        return;
    }

    let html = '<table class="portsTable"><thead><tr><th>Vessel Name</th><th>Lloyds Code</th></tr></thead><tbody>';
    currentVessels.forEach((v, i) => {
        html += `<tr><td>${escapeHtml(v.vessel)}</td>`
              + `<td><input type="text" id="vcode-${i}" value="${escapeHtml(v.code)}" placeholder="e.g. 9963516"></td></tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
}

// Best-effort — a save action still reports its own success even if the
// recalc step fails (e.g. no proof file found for this service yet).
async function recalcQuiet() {
    try {
        const res = await fetch('/result/rebuild', { method: 'POST' });
        const data = await res.json();
        return !!data.ok;
    } catch (e) {
        return false;
    }
}

// Standalone recalc (re-scans the watch folder, re-extracts, rebuilds
// result.xlsx) — no port/vessel codes submitted first.
async function recalc() {
    const recalced = await recalcQuiet();
    showMessage('saveMsg', recalced ? '✅ Recalculated.' : '❌ Recalc failed — no proof file found for this service, or no active guideline.', recalced);
    await loadAll();
}

// ONE button, does everything: whatever port codes and vessel codes are
// currently typed in (across both tables, plus the "add a new vessel"
// row) get saved, then the result gets recalculated. No separate
// Import/Save/Add/Recalc buttons to think about.
async function saveEverything() {
    const mappings = currentPorts
        .map((row, i) => {
            const code = document.getElementById(`code-${i}`)?.value.trim();
            return code ? { operator: row.operator, rawLabel: row.raw_port_label, portCode: code } : null;
        })
        .filter(Boolean);

    const vesselEntries = currentVessels
        .map((v, i) => {
            const code = document.getElementById(`vcode-${i}`)?.value.trim();
            return code ? { vessel: v.vessel, lloydsCode: code } : null;
        })
        .filter(Boolean);

    const newVessel = document.getElementById('newVessel').value.trim();
    const newCode   = document.getElementById('newCode').value.trim();
    if (newVessel && newCode) vesselEntries.push({ vessel: newVessel, lloydsCode: newCode });

    let learnedPorts = 0, learnedVessels = 0;

    if (mappings.length > 0) {
        try {
            const res = await fetch('/port-dictionary/learn-batch', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ mappings })
            });
            const data = await res.json();
            if (data.ok) learnedPorts = data.learned;
        } catch (e) {
            // best-effort — still try the vessel save + recalc below
        }
    }

    if (vesselEntries.length > 0) {
        try {
            const res = await fetch('/vessel-dictionary/learn-batch', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ entries: vesselEntries })
            });
            const data = await res.json();
            if (data.ok) learnedVessels = data.learned;
        } catch (e) {
            // best-effort — still try the recalc below
        }
    }

    const recalced = await recalcQuiet();

    document.getElementById('newVessel').value = '';
    document.getElementById('newCode').value = '';

    showMessage('saveMsg', `✅ Saved ${learnedPorts} port(s), ${learnedVessels} vessel(s)${recalced ? ' — recalculated' : ' (recalc failed)'}.`, true);
    await loadAll();
}

function showMessage(elId, text, ok) {
    const el = document.getElementById(elId);
    el.textContent = text;
    el.className = ok ? 'ok' : 'err';
}

loadAll();
