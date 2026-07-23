let allServices = [];
let sortKey      = 'nextUpdateDate';
let sortAsc      = true;
let showOnlyBatch = true; // default view: just today's batch, not the full list
const filters    = { service: '', carrier: '', nextUpdateDate: '' };

const COLUMNS = [
    { key: 'service',        label: 'Service' },
    { key: 'carrier',        label: 'Carrier' },
    { key: 'schedule',       label: 'Schedule',   sortable: false },
    { key: 'routeMap',       label: 'Route Map',  sortable: false },
    { key: 'nextUpdateDate', label: 'Next Update' },
    { key: 'actions',        label: '',           sortable: false }
];

// ── ASCII box-drawing helpers ──────────────────────────────────
// The charm this dashboard is going for lives in this repo's own
// docs (Readme.txt's block-letter banner + hand-drawn ┌─┬─┐ tables).
// Column widths there are typed by hand; here they're computed from
// the actual data so alignment can't drift when a carrier code or a
// count gets longer.
function padEnd(s, n)   { return s + ' '.repeat(Math.max(0, n - s.length)); }
function padStart(s, n) { return ' '.repeat(Math.max(0, n - s.length)) + s; }

// 6-row "ANSI Shadow" style figlet font — same font Readme.txt's own
// big banner uses. D and A here are copied verbatim from that banner
// (proven correct); S/H/B/O/R are reconstructed to match the same
// style and checked for internal width-consistency below, but weren't
// copied from an existing verified source — flag it if any letter
// looks wrong.
const BLOCK_FONT = {
    D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
    A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
    H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    B: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██████╔╝', '╚═════╝ '],
    O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
    R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝']
};

function bigWord(word) {
    const letters = [...word].map(c => BLOCK_FONT[c]);
    for (const l of letters) {
        for (const row of l) {
            if ([...row].length !== [...l[0]].length) throw new Error(`BLOCK_FONT glyph width mismatch in "${word}"`);
        }
    }
    return [0, 1, 2, 3, 4, 5].map(r => letters.map(l => l[r]).join(' ')).join('\n');
}

function centerText(s, w) {
    const total = w - s.length;
    const l = Math.floor(total / 2);
    const r = total - l;
    return ' '.repeat(Math.max(0, l)) + s + ' '.repeat(Math.max(0, r));
}

function spacedCaps(s) { return s.toUpperCase().split('').join(' '); }

// Fixed ASCII starfield behind everything — generated once (it's
// decorative, not data), each star a random glyph/position/twinkle
// timing so it doesn't look like a repeating tile.
function renderStarfield() {
    const el = document.getElementById('starfield');
    if (!el) return;
    const chars  = ['.', '·', '*', '✦', '⋆'];
    // Mostly plain white, with a handful of colored ones (same status
    // hues used everywhere else) scattered in for variety.
    const colors = ['', '', '', '', 'c-blue', 'c-green', 'c-amber', 'c-red'];
    let html = '';
    for (let i = 0; i < 260; i++) {
        const char     = chars[Math.floor(Math.random() * chars.length)];
        const colorCls = colors[Math.floor(Math.random() * colors.length)];
        const top      = (Math.random() * 100).toFixed(2);
        const left     = (Math.random() * 100).toFixed(2);
        const size     = (Math.random() * 10 + 8).toFixed(1);
        const delay    = (Math.random() * 6).toFixed(2);
        const duration = (Math.random() * 3 + 3).toFixed(2);
        html += `<span class="star ${colorCls}" style="top:${top}%;left:${left}%;font-size:${size}px;animation-delay:${delay}s;animation-duration:${duration}s">${char}</span>`;
    }
    // Shooting stars — mostly invisible, then streak across in the
    // first ~15% of their own long cycle, so each one only fires a
    // few times a minute instead of constantly.
    for (let i = 0; i < 6; i++) {
        const top      = (Math.random() * 55).toFixed(2);
        const left     = (Math.random() * 70).toFixed(2);
        const dx       = (150 + Math.random() * 220).toFixed(0);
        const dy       = (80 + Math.random() * 140).toFixed(0);
        const delay    = (Math.random() * 14).toFixed(2);
        const duration = (7 + Math.random() * 6).toFixed(2);
        html += `<span class="shootingStar" style="top:${top}%;left:${left}%;--dx:${dx}px;--dy:${dy}px;animation-delay:${delay}s;animation-duration:${duration}s">✦</span>`;
    }
    el.innerHTML = html;
}

const DEEP_FIELD_HEIGHT = 3500; // px — only matters in background-only mode (see toggleBgOnly)

// A second, TALLER star layer that scrolls normally (unlike the fixed
// #starfield twinkle layer above it) — this is what background-only
// mode actually gives you something to scroll through. A handful of
// big glowing "landmarks" are scattered down it so scrolling has a
// destination, not just more of the same dots.
function renderDeepField() {
    const el = document.getElementById('deepField');
    if (!el) return;
    const chars  = ['.', '·', '*', '✦', '⋆'];
    const colors = ['', '', '', '', 'c-blue', 'c-green', 'c-amber', 'c-red'];
    let html = '';
    for (let i = 0; i < 320; i++) {
        const char     = chars[Math.floor(Math.random() * chars.length)];
        const colorCls = colors[Math.floor(Math.random() * colors.length)];
        const top      = (Math.random() * DEEP_FIELD_HEIGHT).toFixed(0);
        const left     = (Math.random() * 100).toFixed(2);
        const size     = (Math.random() * 10 + 8).toFixed(1);
        const delay    = (Math.random() * 6).toFixed(2);
        const duration = (Math.random() * 3 + 3).toFixed(2);
        html += `<span class="star ${colorCls}" style="top:${top}px;left:${left}%;font-size:${size}px;animation-delay:${delay}s;animation-duration:${duration}s">${char}</span>`;
    }

    const landmarks = [
        { y: 550,  glyph: '🪐', label: 'a ringed something, far off' },
        { y: 1300, glyph: '🌕', label: 'just a moon. nothing due today.' },
        { y: 2050, glyph: '✧ ⋆ ✦ ⋆ ✧', label: 'a small cluster' },
        { y: 2850, glyph: '🌌', label: 'the rest of it, further out' }
    ];
    for (const lm of landmarks) {
        html += `<div class="landmark" style="top:${lm.y}px"><div class="landmarkGlyph">${lm.glyph}</div><div class="landmarkLabel">${lm.label}</div></div>`;
    }

    el.innerHTML = html;
}

// Subtle depth: the whole field drifts a few px opposite the mouse,
// like a slow parallax layer behind the page.
function initStarfieldParallax() {
    const el = document.getElementById('starfield');
    if (!el) return;
    document.addEventListener('mousemove', (e) => {
        const dx = (e.clientX / window.innerWidth  - 0.5) * -16;
        const dy = (e.clientY / window.innerHeight - 0.5) * -16;
        el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    });
}

// A little click-anywhere sparkle burst — purely for fun, no data
// behind it. Appended to <body> (not #starfield) so it isn't stuck
// behind the page content the way #starfield's z-index:-1 subtree is.
function initClickBurst() {
    const chars = ['✦', '·', '⋆'];
    document.addEventListener('click', (e) => {
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.3;
            const dist  = 30 + Math.random() * 20;
            const dx    = (Math.cos(angle) * dist).toFixed(1);
            const dy    = (Math.sin(angle) * dist).toFixed(1);
            const span  = document.createElement('span');
            span.className = 'burstParticle';
            span.textContent = chars[Math.floor(Math.random() * chars.length)];
            span.style.left = e.clientX + 'px';
            span.style.top  = e.clientY + 'px';
            span.style.setProperty('--dx', dx + 'px');
            span.style.setProperty('--dy', dy + 'px');
            document.body.appendChild(span);
            span.addEventListener('animationend', () => span.remove());
        }
    });
}

// Hides everything except the starfield — the button itself stays
// visible (it's outside #workArea/#banner) so there's always a way
// back. localStorage'd so it survives a refresh.
function toggleBgOnly() {
    const on = document.body.classList.toggle('bgOnlyMode');
    document.getElementById('bgOnlyToggle').textContent = on ? '✕ Exit background-only' : '🌌 Background only';
    try { localStorage.setItem('bgOnlyMode', on ? 'true' : 'false'); } catch (e) { /* fine if unavailable */ }
}

function loadBgOnlyPreference() {
    let on = false;
    try { on = localStorage.getItem('bgOnlyMode') === 'true'; } catch (e) { /* default false */ }
    if (on) {
        document.body.classList.add('bgOnlyMode');
        document.getElementById('bgOnlyToggle').textContent = '✕ Exit background-only';
    }
}

// Boxed banner, same convention as Readme.txt's: a ╔═╗ frame around
// the block-letter word, a spaced-caps line, and a plain detail line
// — but every width here is computed (see /tmp/banner_test.js check
// during development), never hand-counted, so it can't go crooked.
function renderBanner() {
    const el = document.getElementById('banner');
    if (!el) return;

    const wordLines = bigWord('DASHBOARD').split('\n');
    const subtitle1 = spacedCaps('Services Due For Update');
    const subtitle2 = 'Tradetech Dashboard — auto-updated from live scans';
    const width = Math.max(...wordLines.map(l => l.length), subtitle1.length, subtitle2.length);

    const body = [
        '',
        ...wordLines.map(l => centerText(l, width)),
        '',
        centerText(subtitle1, width),
        '',
        centerText(subtitle2, width),
        ''
    ];
    const top = '╔' + '═'.repeat(width + 4) + '╗';
    const bot = '╚' + '═'.repeat(width + 4) + '╝';
    const mid = body.map(l => '║  ' + padEnd(l, width) + '  ║').join('\n');

    el.textContent = `${top}\n${mid}\n${bot}`;
}

// headers: array of strings. rows: array of arrays, each cell either
// a plain string or { text, cls } for a colored value. rightAlign:
// array of booleans, one per column.
function renderAsciiTable(headers, rows, rightAlign = []) {
    const cellText = (c) => (typeof c === 'string' ? c : c.text);
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => cellText(r[i]).length)));

    const border = (l, m, r) => l + widths.map(w => '─'.repeat(w + 2)).join(m) + r;
    const line = (cells, forceCls) => '│ ' + cells.map((c, i) => {
        const text  = cellText(c);
        const cls   = forceCls || (typeof c === 'string' ? '' : c.cls);
        const padded = (rightAlign[i] ? padStart : padEnd)(text, widths[i]);
        return cls ? `<span class="${cls}">${padded}</span>` : padded;
    }).join(' │ ') + ' │';

    // Body rows are wrapped in a span so CSS can zebra-stripe them —
    // readability on a wide monospace table benefits from a row
    // highlight the same way the real due-services table below has.
    const out = [
        border('┌', '┬', '┐'),
        line(headers, 'taHead'),
        border('├', '┼', '┤'),
        ...rows.map((r, i) => `<span class="taRow${i % 2 ? ' taRowAlt' : ''}">${line(r)}</span>`),
        border('└', '┴', '┘')
    ];
    return `<pre class="asciiTable">${out.join('\n')}</pre>`;
}

function daysUntil(dateStr) {
    // expects "DD-MON-YYYY" e.g. "11-JUL-2026"
    const months = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
    const m = (dateStr || '').match(/^(\d{2})-([A-Z]{3})-(\d{4})$/);
    if (!m) return null;
    const target = new Date(parseInt(m[3], 10), months[m[2]], parseInt(m[1], 10));
    const today  = new Date();
    today.setHours(0,0,0,0);
    return Math.round((target - today) / 86400000);
}

function linksHtml(urls, label) {
    if (!urls || urls.length === 0) return '<span class="noLink">--</span>';
    return urls.map((u, i) => `<a class="linkBtn" href="${u}" target="_blank">${label}${urls.length > 1 ? ' ' + (i+1) : ''}</a>`).join('');
}

function clearFilters() {
    filters.service = '';
    filters.carrier = '';
    filters.nextUpdateDate = '';
    render();
}

function toggleShowAll() {
    showOnlyBatch = !showOnlyBatch;
    render();
}

async function nextBatch() {
    if (!confirm('Move to the next day now? Anything not done today carries forward automatically.')) return;
    await fetch('/due-services/next-batch', { method: 'POST' });
    load();
}

async function previousBatch() {
    await fetch('/due-services/previous-batch', { method: 'POST' });
    load();
}

async function goToDay(dayIndex) {
    await fetch('/due-services/go-to-day', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dayIndex })
    });
    load();
}

const RECALC_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

async function recalculateWeek() {
    const select   = document.getElementById('recalcDaySelect');
    const raw      = select ? select.value : '';
    const dayIndex = raw === '' ? null : parseInt(raw, 10);
    const anchorLabel = dayIndex === null ? 'today' : RECALC_DAY_NAMES[dayIndex];

    if (!confirm(`Recalculate this whole week from scratch, using ${anchorLabel} as the anchor day? Any manual progress tracking (which day you were on) resets to ${anchorLabel}.`)) return;

    await fetch('/due-services/recalculate-week', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dayIndex })
    });
    load();
}

function setSort(key) {
    const col = COLUMNS.find(c => c.key === key);
    if (!col || col.sortable === false) return;

    if (sortKey === key) {
        sortAsc = !sortAsc;
    } else {
        sortKey = key;
        sortAsc = true;
    }
    render();
}

async function markDone(record) {
    await fetch('/due-services/mark-done', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ record })
    });
    load();
}

async function undoDone(record) {
    const res = await fetch('/due-services/undo-done', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ record })
    });
    if (!res.ok) {
        console.warn('Nothing to undo for', record);
        return;
    }
    load();
}

function copyService(serviceName, event) {
    navigator.clipboard.writeText(serviceName).then(() => {
        const el = event.target;
        const original = el.textContent;
        el.textContent = 'Copied!';
        setTimeout(() => { el.textContent = original; }, 800);
    }).catch(err => console.error('Clipboard copy failed:', err));
}

let activityPoints  = [];
let activityStreak  = 0;
let currentBatch    = [];
let batchInfo       = null; // { dayIndex, dayName, weekStart, weekComplete }
let weeklyPlan      = null;
let weeklyPlanOffset = 0; // 0 = real current week; Next/Previous Week buttons shift this

async function load() {
    const res  = await fetch('/due-services');
    const data = await res.json();

    document.getElementById('asOf').textContent = data.asOf
        ? '# last scanned ' + new Date(data.asOf).toLocaleString()
        : '# no scan received yet -- run the scanner on the Tradetech list page first';

    allServices = data.services || [];

    try {
        const actRes = await fetch('/due-services/activity');
        const actData = await actRes.json();
        activityPoints = actData.points || [];
        activityStreak = actData.streak || 0;
    } catch (e) {
        activityPoints = [];
        activityStreak = 0;
    }

    try {
        const batchRes = await fetch('/due-services/current-batch');
        const batchData = await batchRes.json();
        currentBatch = batchData.services || [];
        batchInfo = {
            dayIndex: batchData.dayIndex,
            dayName: batchData.dayName,
            weekStart: batchData.weekStart,
            weekComplete: batchData.weekComplete,
            leftoverCount: batchData.leftoverCount || 0
        };
    } catch (e) {
        currentBatch = [];
        batchInfo = null;
    }

    await loadWeeklyPlan();

    render();
}

// Fetches just the weekly-plan preview at the current weeklyPlanOffset
// and re-renders — used both by the initial load() and by the Next
// Week / Previous Week buttons, so switching weeks doesn't need to
// re-fetch everything else (services, history, batch, etc.).
async function loadWeeklyPlan() {
    try {
        const planRes = await fetch(`/due-services/weekly-plan?offset=${weeklyPlanOffset}`);
        weeklyPlan = await planRes.json();
    } catch (e) {
        weeklyPlan = null;
    }
}

async function nextWeekPlan() {
    weeklyPlanOffset++;
    await loadWeeklyPlan();
    render();
}

async function previousWeekPlan() {
    weeklyPlanOffset--;
    await loadWeeklyPlan();
    render();
}

function statusOf(s, days) {
    if (s.done) return 'done';
    if (days !== null && days < 0) return 'overdue';
    if (days !== null && days <= 3) return 'due-soon';
    return 'ok';
}

function renderStats() {
    const counts = { overdue: 0, 'due-soon': 0, done: 0, ok: 0 };
    for (const s of allServices) {
        const days = daysUntil(s.nextUpdateDate);
        counts[statusOf(s, days)]++;
    }
    const row = [
        String(allServices.length),
        { text: String(counts.overdue),          cls: 'c-red' },
        { text: String(counts['due-soon']),      cls: 'c-amber' },
        String(counts.ok),
        { text: String(counts.done),             cls: 'c-green' }
    ];
    document.getElementById('stats').innerHTML =
        renderAsciiTable(['TOTAL', 'OVERDUE', 'DUE SOON', 'OK', 'DONE'], [row], [true, true, true, true, true]);
    return counts;
}

function renderCarrierChart() {
    const byCarrier = {};
    for (const s of allServices) {
        const c = s.carrier || '?';
        byCarrier[c] = (byCarrier[c] || 0) + 1;
    }
    const entries = Object.entries(byCarrier).sort((a, b) => b[1] - a[1]);

    const BAR_WIDTH = 20;
    const max = entries.length ? entries[0][1] : 1;
    const rows = entries.map(([carrier, count]) => {
        const filled = Math.max(1, Math.round((count / max) * BAR_WIDTH));
        const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
        return [carrier, String(count), bar];
    });

    const body = entries.length
        ? renderAsciiTable(['CARRIER', 'COUNT', ''], rows, [false, true, false])
        : '<div id="noHistory">-- no data --</div>';

    return `<div class="chartPanel">
        <h2>by carrier</h2>
        ${body}
    </div>`;
}

function renderStatusChart(counts) {
    const total = allServices.length || 1;
    const pct = (n) => Math.round((n / total) * 100) + '%';
    const rows = [
        [{ text: 'Overdue',  cls: 'c-red' },   { text: String(counts.overdue),      cls: 'c-red' },   pct(counts.overdue)],
        [{ text: 'Due Soon', cls: 'c-amber' }, { text: String(counts['due-soon']),  cls: 'c-amber' },  pct(counts['due-soon'])],
        ['OK',                                 String(counts.ok),                                     pct(counts.ok)],
        [{ text: 'Done',     cls: 'c-green' }, { text: String(counts.done),         cls: 'c-green' },  pct(counts.done)]
    ];

    return `<div class="chartPanel">
        <h2>by status</h2>
        ${renderAsciiTable(['STATUS', 'COUNT', '%'], rows, [false, true, true])}
    </div>`;
}

function renderHistogram() {
    const DAYS = 14;
    const buckets = Array.from({ length: DAYS }, () => 0);
    const overdueFlag = Array.from({ length: DAYS }, () => false);
    const labels = [];

    const today = new Date();
    today.setHours(0,0,0,0);

    for (let i = 0; i < DAYS; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        labels.push(`${d.getDate()}`);
    }

    for (const s of allServices) {
        const days = daysUntil(s.nextUpdateDate);
        if (days === null) continue;
        if (days < 0) { buckets[0]++; overdueFlag[0] = true; continue; }
        if (days < DAYS) buckets[days]++;
    }

    const max = Math.max(1, ...buckets);
    const bars = buckets.map((count, i) =>
        `<div class="histBar ${overdueFlag[i] ? 'hasOverdue' : ''}" style="height:${Math.round((count / max) * 100)}%" title="${count} due"></div>`
    ).join('');
    const labelsHtml = labels.map(l => `<span>${l}</span>`).join('');

    return `<div class="chartPanel wide">
        <h2>next 14 days (day of month, day 0 = overdue)</h2>
        <div class="histogram">${bars}</div>
        <div class="histLabels">${labelsHtml}</div>
    </div>`;
}

function renderActivityChart() {
    const totalDone = activityPoints.reduce((sum, p) => sum + p.count, 0);

    if (totalDone === 0) {
        return `<div class="chartPanel wide">
            <h2>daily throughput -- last 30 days</h2>
            <div id="noHistory">-- no "Mark Done" activity logged yet --</div>
        </div>`;
    }

    const max = Math.max(1, ...activityPoints.map(p => p.count));
    const bars = activityPoints.map(p =>
        `<div class="histBar activityBar ${p.isWeekend ? 'weekend' : ''}" style="height:${Math.round((p.count / max) * 100) || 2}%" title="${p.date}${p.isWeekend ? ' (weekend)' : ''}: ${p.count} done"></div>`
    ).join('');

    const labels = activityPoints.map((p, i) => {
        const show = i % 5 === 0 || i === activityPoints.length - 1;
        return `<span>${show ? p.date.slice(5) : ''}</span>`;
    }).join('');

    const streakLabel = activityStreak > 0
        ? `<span class="streak">🔥 ${activityStreak} day streak</span>`
        : '';

    return `<div class="chartPanel wide">
        <h2>daily throughput -- last 30 days ${streakLabel}</h2>
        <div class="histogram">${bars}</div>
        <div class="histLabels">${labels}</div>
    </div>`;
}

function weekPlanTitle() {
    if (weeklyPlanOffset === 0) return "this week's workload (mon-fri)";
    if (weeklyPlanOffset === 1) return "next week's workload (preview)";
    if (weeklyPlanOffset === -1) return "last week's workload (preview)";
    return weeklyPlanOffset > 0
        ? `${weeklyPlanOffset} weeks ahead (preview)`
        : `${Math.abs(weeklyPlanOffset)} weeks back (preview)`;
}

function renderWeeklyPlanChart() {
    const nav = `<div class="weekNav">
        <button onclick="previousWeekPlan()">← Previous Week</button>
        <span class="weekNavLabel">${weeklyPlan && weeklyPlan.weekStart ? 'week of ' + weeklyPlan.weekStart : ''}</span>
        <button onclick="nextWeekPlan()">Next Week →</button>
    </div>`;

    if (!weeklyPlan || !weeklyPlan.breakdown || weeklyPlan.breakdown.length === 0) {
        return `<div class="chartPanel wide">
            <h2>${weekPlanTitle()}</h2>
            ${nav}
            <div id="noHistory">-- no data --</div>
        </div>`;
    }

    const max = Math.max(1, ...weeklyPlan.breakdown.map(b => b.count));
    const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

    const bars = weeklyPlan.breakdown.map((b, i) =>
        `<div class="histBar ${b.mandatory ? 'hasOverdue' : 'activityBar'}" style="height:${Math.round((b.count / max) * 100) || 2}%" title="${DAY_NAMES[i]} (${b.date}): ${b.count}${b.mandatory ? ' -- mandatory' : ' -- balanced'}"></div>`
    ).join('');

    const labels = weeklyPlan.breakdown.map((b, i) =>
        `<span>${DAY_NAMES[i]}<br>${b.count}</span>`
    ).join('');

    const backlogNote = weeklyPlan.backlogCount > 0
        ? `<span class="streak">⚠ includes ${weeklyPlan.backlogCount} from before this week</span>`
        : '';

    return `<div class="chartPanel wide">
        <h2>${weekPlanTitle()} -- ${weeklyPlan.total} total ${backlogNote}</h2>
        ${nav}
        <div class="histogram">${bars}</div>
        <div class="histLabels">${labels}</div>
    </div>`;
}

function render() {
    const counts = renderStats();

    const splitBtn = document.getElementById('splitToggleBtn');
    if (splitBtn) splitBtn.textContent = showOnlyBatch ? 'Show All' : 'Show Batch Only';

    const dayIndicator = document.getElementById('batchDayIndicator');
    if (dayIndicator && batchInfo) {
        if (batchInfo.weekComplete) {
            dayIndicator.textContent = `# ✅ every day this week (starting ${batchInfo.weekStart}) is done!`;
        } else if (batchInfo.dayName) {
            const leftoverNote = batchInfo.leftoverCount > 0
                ? ` (+ ${batchInfo.leftoverCount} carried forward, not yet done)`
                : '';
            dayIndicator.textContent = `# working on: ${batchInfo.dayName}'s batch (week of ${batchInfo.weekStart})${leftoverNote}`;
        } else {
            dayIndicator.textContent = '';
        }
    }

    const dayTabsEl = document.getElementById('dayTabs');
    if (dayTabsEl && batchInfo) {
        const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        dayTabsEl.innerHTML = DAY_NAMES.map((name, i) => {
            const active = !batchInfo.weekComplete && batchInfo.dayIndex === i;
            return `<button class="dayTab ${active ? 'activeDayTab' : ''}" onclick="goToDay(${i})">${name}</button>`;
        }).join('');
    }

    const remainingToday = (batchInfo && !batchInfo.weekComplete)
        ? currentBatch.filter(s => !s.done).length
        : null;

    // Floating "N left today" badge — stays visible on the right edge
    // of the screen regardless of scroll position, counting undone
    // items in TODAY's actual batch (not the full service list).
    const remainingBadge = document.getElementById('remainingTodayBadge');
    if (remainingBadge) {
        if (remainingToday === null) {
            remainingBadge.style.display = 'none';
        } else {
            remainingBadge.style.display = 'block';
            remainingBadge.className = remainingToday === 0 ? 'doneToday' : '';
            remainingBadge.innerHTML = remainingToday === 0
                ? `✅<br>all done`
                : `<b>${remainingToday}</b><br>left today`;
        }
    }

    // Chill mode — nothing left to do today, whether that's because
    // every assigned item is done OR because nothing was assigned to
    // today at all (an empty day-slot is just as chill-worthy — both
    // mean remainingToday === 0). Stop showing the backlog/charts
    // (that's tomorrow's problem, literally) and give a clear
    // "you're off the hook" screen instead, until Next Day is clicked.
    const isChillMode = remainingToday === 0;
    document.getElementById('stats').style.display = isChillMode ? 'none' : '';
    document.getElementById('charts').style.display = isChillMode ? 'none' : '';

    if (isChillMode) {
        document.getElementById('content').innerHTML = `
            <div class="chillZone">
                <div class="chillArt">✦&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;⋆&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;🌙&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;⋆&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;✦</div>
                <div class="chillTitle">Today's batch is clear.</div>
                <div class="chillSub">Nothing else needs you right now. Go be somewhere else for a while.</div>
                <button class="chillNextBtn" onclick="nextBatch()">🌙 See tomorrow's batch →</button>
            </div>`;
        document.getElementById('count').textContent = '';
        return;
    }

    document.getElementById('charts').innerHTML =
        renderStatusChart(counts) +
        renderCarrierChart() +
        renderHistogram() +
        renderWeeklyPlanChart() +
        renderActivityChart();

    const content = document.getElementById('content');

    if (allServices.length === 0) {
        content.innerHTML = '<div id="empty">-- no due-service data yet --</div>';
        document.getElementById('count').textContent = '';
        return;
    }

    // Default view shows only the CURRENT BATCH — a persisted snapshot
    // computed once server-side, not live-recomputed here. "Show All"
    // toggles to the full stored list instead.
    const batchRecordIds = new Set(currentBatch.map(s => s.record));
    const pool = showOnlyBatch
        ? allServices.filter(s => batchRecordIds.has(s.record))
        : allServices;

    // Filter (case-insensitive "contains", Excel-style quick filter)
    let filtered = pool.filter(s => {
        if (filters.service && !(s.service || '').toLowerCase().includes(filters.service.toLowerCase())) return false;
        if (filters.carrier && !(s.carrier || '').toLowerCase().includes(filters.carrier.toLowerCase())) return false;
        if (filters.nextUpdateDate && !(s.nextUpdateDate || '').toLowerCase().includes(filters.nextUpdateDate.toLowerCase())) return false;
        return true;
    });

    // Sort — "done" items always sink to the bottom no matter which
    // column/direction is active; the chosen sort only decides ordering
    // WITHIN the not-done group and WITHIN the done group separately.
    filtered.sort((a, b) => {
        if (!!a.done !== !!b.done) return a.done ? 1 : -1;

        let va, vb;
        if (sortKey === 'nextUpdateDate') {
            va = daysUntil(a.nextUpdateDate) ?? 9999;
            vb = daysUntil(b.nextUpdateDate) ?? 9999;
        } else {
            va = (a[sortKey] || '').toLowerCase();
            vb = (b[sortKey] || '').toLowerCase();
        }
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
    });

    document.getElementById('count').textContent =
        `showing ${filtered.length} / ${allServices.length}`;

    const STATUS_LABEL = { overdue: '!', 'due-soon': '~', done: 'OK', ok: '.' };

    let html = '<table><thead><tr>';
    for (const col of COLUMNS) {
        const arrow = (sortKey === col.key && col.sortable !== false)
            ? (sortAsc ? '^' : 'v') : '';
        html += `<th onclick="setSort('${col.key}')">${col.label}${arrow ? '<span class="arrow">'+arrow+'</span>' : ''}</th>`;
    }
    html += '</tr><tr class="filterRow">';
    html += `<th><input value="${filters.service}" onkeydown="if(event.key==='Enter'){filters.service=this.value; render();}" placeholder="filter... (enter)"></th>`;
    html += `<th><input value="${filters.carrier}" onkeydown="if(event.key==='Enter'){filters.carrier=this.value; render();}" placeholder="filter... (enter)"></th>`;
    html += '<th></th><th></th>';
    html += `<th><input value="${filters.nextUpdateDate}" onkeydown="if(event.key==='Enter'){filters.nextUpdateDate=this.value; render();}" placeholder="filter... (enter)"></th>`;
    html += '<th></th></tr></thead><tbody>';

    for (const s of filtered) {
        const days   = daysUntil(s.nextUpdateDate);
        const status = statusOf(s, days);
        const dayNote = days !== null
            ? (days < 0 ? `overdue ${Math.abs(days)}d` : (days === 0 ? 'today' : `${days}d`))
            : '';

        const actionBtn = status === 'done'
            ? `<button class="markDoneBtn undoBtn" onclick="undoDone('${s.record}')">Undo</button>`
            : `<button class="markDoneBtn" onclick="markDone('${s.record}')">Mark Done</button>`;

        html += `<tr class="${status}">
            <td><span class="tag ${status}">${STATUS_LABEL[status]}</span><span class="copyable" title="Click to copy" onclick="copyService('${s.service}', event)">${s.service}</span></td>
            <td>${s.carrier}</td>
            <td>${linksHtml(s.links.schedule, 'sched')}</td>
            <td>${linksHtml(s.links.routeMap, 'map')}</td>
            <td class="dateCell">${s.nextUpdateDate}${dayNote ? '<span class="dayNote">('+dayNote+')</span>' : ''}</td>
            <td>${actionBtn}</td>
        </tr>`;
    }

    html += '</tbody></table>';
    content.innerHTML = html;
}

// ============================================================
//  Wellness reminders
//  Interval is based on real research, not a guess: Diaz et al.,
//  "Breaking Up Prolonged Sitting to Improve Cardiometabolic Risk"
//  (Columbia University, Medicine & Science in Sports & Exercise) —
//  a 5-minute walk every 30 minutes was the only pattern tested that
//  meaningfully helped blood sugar (-58% post-meal spikes) AND blood
//  pressure (-4 to -5 mmHg, comparable to 6 months of regular
//  exercise). So: every 30 minutes, one gentle nudge.
//
//  Deliberately calm on purpose: no sound, ever (Notification is
//  always created with silent: true). Both a real desktop
//  notification AND an in-page banner fire together, since either
//  one alone might be missed — but neither is urgent, neither
//  demands a response, and both are trivially dismissible. Off by
//  default; only starts if explicitly turned on.
// ============================================================

const WELLNESS_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const WELLNESS_SNOOZE_MS   = 10 * 60 * 1000; // 10 minutes

const WELLNESS_MESSAGES = [
    { emoji: '🚶', text: "No rush at all -- whenever you're ready, maybe a short 5-minute walk? Your body would probably really appreciate it." },
    { emoji: '💧', text: "Just a gentle thought: a sip of water might be nice right now, if you feel like it." },
    { emoji: '🌿', text: "However you're doing right now is okay. If you want, a little stretch could feel good." },
    { emoji: '🧘', text: "No pressure whatsoever -- just checking in. Maybe stand up and roll your shoulders for a moment?" },
    { emoji: '💛', text: "Small reminder, take it or leave it: your body might enjoy a quick walk and some water about now." },
];

// Fixed daily check-ins, separate from the 30-minute rotation above --
// these fire once at that clock time each day, not on a repeating
// interval.
const WELLNESS_DAILY_REMINDERS = [
    { hour: 12, minute: 0, emoji: '🍽️', text: "It's around lunchtime -- no pressure, but if you haven't eaten yet, now could be a nice time to." },
    { hour: 17, minute: 0, emoji: '🌇', text: "It's 5pm. If today's a wrap for you, that's more than okay -- take care of yourself out there." },
];

let wellnessEnabled  = false;
let wellnessTimerId  = null;
let wellnessMsgIndex = 0;
let wellnessNextTick = null; // timestamp (ms) of the next 30-min reminder, for the countdown display
let wellnessCountdownTimerId = null;
let wellnessDailyTimeoutIds  = [];

function loadWellnessPreference() {
    try {
        wellnessEnabled = localStorage.getItem('wellnessRemindersEnabled') === 'true';
    } catch (e) {
        wellnessEnabled = false;
    }
    if (wellnessEnabled) {
        startWellnessTimer();
        scheduleDailyReminders();
    }
    updateWellnessToggleLabel();
}

function saveWellnessPreference() {
    try {
        localStorage.setItem('wellnessRemindersEnabled', wellnessEnabled ? 'true' : 'false');
    } catch (e) { /* fine if unavailable -- just won't persist across reloads */ }
}

function updateWellnessToggleLabel() {
    const btn = document.getElementById('wellnessToggle');
    if (!btn) return;

    const supported = 'Notification' in window;
    const denied = supported && Notification.permission === 'denied';

    if (!wellnessEnabled) {
        btn.textContent = '💛 Wellness reminders: off';
    } else if (denied) {
        // Desktop notifications are blocked at the browser level --
        // JS can't re-prompt once denied, so say so plainly instead
        // of silently only-sometimes working.
        btn.textContent = '💛 On (banner only -- notifications blocked, see below)';
    } else if (!supported) {
        btn.textContent = '💛 On (banner only -- notifications unsupported)';
    } else {
        btn.textContent = '💛 Wellness reminders: on';
    }
    btn.classList.toggle('wellnessOn', wellnessEnabled);

    const help = document.getElementById('wellnessHelp');
    if (help) {
        help.innerHTML = (wellnessEnabled && denied)
            ? `Desktop notifications are blocked for this page, so only the in-page banner will show (only while this tab is open and visible).
               To fix: click the icon just left of the address bar (padlock or "i") → Site settings / Permissions → set Notifications to Allow, then reload.
               Also double check Windows itself isn't muting your browser: Settings → System → Notifications → make sure your browser is allowed.`
            : '';
    }
}

async function toggleWellnessReminders() {
    if (!wellnessEnabled) {
        // Only ask for notification permission on a deliberate click,
        // never automatically on page load -- and it's fine if this
        // is denied or unsupported, the in-page banner still works.
        if ('Notification' in window && Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
        }
        wellnessEnabled = true;
        startWellnessTimer();
        scheduleDailyReminders();
    } else {
        wellnessEnabled = false;
        stopWellnessTimer();
        clearDailyReminders();
    }
    saveWellnessPreference();
    updateWellnessToggleLabel();
}

// Fires a reminder immediately (bypassing the 30-minute wait) so you
// can check right now whether the desktop notification actually shows
// up, instead of finding out half an hour later.
function testWellnessNotification() {
    showWellnessReminder();
}

function startWellnessTimer() {
    stopWellnessTimer();
    // First nudge is a full interval away -- no reminder the instant
    // you turn this on, that would feel like a jump-scare, not calm.
    wellnessNextTick = Date.now() + WELLNESS_INTERVAL_MS;
    wellnessTimerId = setInterval(() => {
        showWellnessReminder();
        wellnessNextTick = Date.now() + WELLNESS_INTERVAL_MS;
    }, WELLNESS_INTERVAL_MS);
    startWellnessCountdownDisplay();
}

function stopWellnessTimer() {
    if (wellnessTimerId) clearInterval(wellnessTimerId);
    wellnessTimerId = null;
    wellnessNextTick = null;
    stopWellnessCountdownDisplay();
}

// --- Live countdown display (updates once a second) ---

function startWellnessCountdownDisplay() {
    stopWellnessCountdownDisplay();
    updateWellnessCountdownDisplay();
    wellnessCountdownTimerId = setInterval(updateWellnessCountdownDisplay, 1000);
}

function stopWellnessCountdownDisplay() {
    if (wellnessCountdownTimerId) clearInterval(wellnessCountdownTimerId);
    wellnessCountdownTimerId = null;
    const el = document.getElementById('wellnessCountdown');
    if (el) el.textContent = '';
}

function formatCountdownClock(ms) {
    if (ms == null || ms < 0) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatCountdownRough(ms) {
    const totalMinutes = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

// Milliseconds until the next time it's exactly `hour:minute` --
// today if that hasn't happened yet, otherwise tomorrow.
function msUntilClockTime(hour, minute) {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target - now;
}

function updateWellnessCountdownDisplay() {
    const el = document.getElementById('wellnessCountdown');
    if (!el) return;

    if (!wellnessEnabled || wellnessNextTick == null) {
        el.textContent = '';
        return;
    }

    const remaining = wellnessNextTick - Date.now();
    const [lunch, endOfDay] = WELLNESS_DAILY_REMINDERS;
    const lunchMs = msUntilClockTime(lunch.hour, lunch.minute);
    const eodMs   = msUntilClockTime(endOfDay.hour, endOfDay.minute);

    el.textContent =
        `next check-in in ${formatCountdownClock(remaining)}` +
        ` · ${lunch.emoji} lunch in ${formatCountdownRough(lunchMs)}` +
        ` · ${endOfDay.emoji} end of day in ${formatCountdownRough(eodMs)}`;
}

// --- Fixed daily reminders (12:00 lunch, 17:00 end of day) ---

function scheduleDailyReminders() {
    clearDailyReminders();
    WELLNESS_DAILY_REMINDERS.forEach((reminder, i) => {
        const fire = () => {
            if (wellnessEnabled) showWellnessReminder(reminder);
            // Reschedule for the same time tomorrow regardless, so
            // this keeps working across midnight without a reload.
            wellnessDailyTimeoutIds[i] = setTimeout(fire, msUntilClockTime(reminder.hour, reminder.minute));
        };
        wellnessDailyTimeoutIds[i] = setTimeout(fire, msUntilClockTime(reminder.hour, reminder.minute));
    });
}

function clearDailyReminders() {
    wellnessDailyTimeoutIds.forEach(id => { if (id) clearTimeout(id); });
    wellnessDailyTimeoutIds = [];
}

// explicitMsg lets the fixed daily reminders (lunch/end-of-day) reuse
// this same notification+banner machinery instead of duplicating it.
function showWellnessReminder(explicitMsg) {
    const msg = explicitMsg || WELLNESS_MESSAGES[wellnessMsgIndex % WELLNESS_MESSAGES.length];
    if (!explicitMsg) wellnessMsgIndex++;

    // Desktop notification -- silent: true means no sound under any
    // circumstance, regardless of OS/browser settings.
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            const n = new Notification('Tradetech Dashboard', {
                body: msg.text,
                silent: true,
                tag: 'wellness-reminder', // replaces any previous one instead of stacking up
            });
            setTimeout(() => n.close(), 15000);
        } catch (e) { /* ignore -- banner still shows below */ }
    }

    // In-page banner, shown alongside the notification.
    const banner = document.getElementById('wellnessBanner');
    if (banner) {
        banner.querySelector('.wellnessEmoji').textContent = msg.emoji;
        banner.querySelector('.wellnessText').textContent = msg.text;
        banner.classList.add('show');
    }
}

function dismissWellnessBanner() {
    const banner = document.getElementById('wellnessBanner');
    if (banner) banner.classList.remove('show');
}

function snoozeWellnessBanner() {
    dismissWellnessBanner();
    if (!wellnessEnabled) return;
    stopWellnessTimer(); // clears the normal 30-min countdown display
    wellnessNextTick = Date.now() + WELLNESS_SNOOZE_MS;
    startWellnessCountdownDisplay(); // resume the countdown, now counting down to the snooze
    setTimeout(() => {
        showWellnessReminder();
        if (wellnessEnabled) startWellnessTimer(); // back to the normal 30-min cadence after this
    }, WELLNESS_SNOOZE_MS);
}

renderStarfield();
renderDeepField();
loadBgOnlyPreference();
initStarfieldParallax();
initClickBurst();
renderBanner();
loadWellnessPreference();
load();