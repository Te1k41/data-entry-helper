# TODO

Open items, newest first. Remove an item when it ships (the commit is the record).

## Route Map (private only — community once proven)

- [ ] Prove it on real use, then ship to community: move the page into the extension
  (extension page + bundled land/ports data, no relay) and drop the `-relay` from
  `src/utils/receipt-data-relay.js`. Until then don't sync it (memory: route map private-only).
- [ ] Country borders on the map (Natural Earth admin-0 boundary lines) like Tradetech's.
- [ ] 31/494 receipt port names still unplaced (e.g. Pyongtaek, Sihanoukville, Tanger Med,
  Apapa, Messina) — place once via the map's "Place" button, or add aliases.
- [ ] Batch "Route maps for all receipts" export, if wanted.

## Fill feature

- [ ] **ZIM schedule reader (all vessels, full rotations)** — fill gets *nothing* from ZIM today:
  no DOM scrape, no page-HTML side-capture (`isRecognizedSchedulePage()` in
  `src/background-relay.js` is Yang Ming only), no `proof-parsers/` entry.
  - Page: `https://www.zim.com/schedules/schedule-by-line?trade=26&line=CTV` (and other lines).
  - Data lives inside the `<schedule-by-line-v1>` web component — open shadow root
    (ZIM's own inline script reads `host.shadowRoot`). Loaded from ZIM's API after
    page load, not in the page source.
  - Each vessel card is collapsed; port rows probably only render once its chevron is
    opened → must open every card, wait for each, then read.
  - Read per vessel: vessel, ZIM voyage, partner's voyage(s), every port + dates.
    Send to the relay like `src/features/schedule-table-scrape-relay.js` (Yang Ming)
    does, so fill-calc can prefer it.
  - Blocked on: the real card markup (expanded). Either reconnect Claude-in-Chrome and
    inspect live, or paste `schedule-by-line-v1` via DevTools "Copy element" with one
    card opened. Direct fetches of zim.com get 403/stub pages.

## Full Page Capture

- [ ] Confirm on live ZIM (VEX/CTV) + CMA CGM MEDEX that the header/widgets show only once
  (`e87240d` closed-shadow fix). If not: run the `zim-navbar-v1` console check from the chat.
- [ ] Remaining "account for all situations" plan — open questions first: checkpoint per
  phase? pre-load pass worth +1–2s? very tall pages → split into parts or scale down?
  1. Prep style during capture: hide scrollbars (not crop), no smooth-scroll / scroll-snap /
     transitions / parallax. Guard: abort if the tab stops being active; transparent
     input blocker; restore everything.
  2. Inner scroll containers (pages that scroll a div, not the window); RTL pages
     (negative scrollX).
  3. Pre-scroll pass for lazy images / re-measure height; cap infinite feeds.
  4. Left/right-pinned widgets (quadrants instead of top/bottom halves).
  5. Stitch in an offscreen document (`chrome.offscreen`) instead of the page; split
     >32767px pages into several PNGs.
  Test pages under `test-pages/fpc/`, one per situation.

## Port highlighting

- [ ] Decide: should `…, GUAM` / `…, PUERTO RICO` / `HONOLULU, HI` count as USA? Today
  only names ending in USA / US / UNITED STATES do (`matchCountry()`).
- [ ] Two reviewed receipts disagree with the logic (both directional, no bound keys):
  AC1-E (MSK) logic picks Yokohama, verdict "none"; BALT1-S (CMA) fine fallback picks
  Zeebrugge, verdict "none". Rule change or verdict fix?
- [ ] `CODE_NOTES.md` port-highlighting section is stale (still documents the removed
  `PRIORITY_PORT_KEYS` / `first_us_port` pass and the old tie/directional rules); stale
  comment at `src/features/port-highlighting.js` ~416 ("+ last repeat of the first port").
