# Feature Guide

This guide describes what the extension currently does. Most Tradetech helpers run automatically when the relevant schedule page or field is present; manual tools appear in the floating **Tools** panel or beside the row they affect.

## Validation and data checks

- **SP001 date check:** After related date tools make a change, checks whether SP001's departure date matches a vessel departure date. A mismatch produces a warning; a match identifies and highlights the vessel the schedule is based on.
- **Arrival before departure:** On page load and whenever a port arrival or departure changes, flags any port whose departure is earlier than its own arrival.
- **Port sequence order:** On load and after port-date edits, checks that dates do not move backward from one filled port row to the next. Blank rows are skipped.
- **Missing port dates:** On load and after relevant edits, flags a named port only when both its arrival and departure dates are blank.
- **Missing vessel dates:** On load and after relevant edits, flags a named vessel with no departure date.
- **Duplicate vessel rows:** On load and after vessel edits, flags rows that repeat the same Lloyds/IMO code and the same voyage number.
- **Last Foreign Port rule:** Keeps Last Foreign Port consistent with the form: it is required when AWR is Yes and First USA Port is filled, and expected to be blank otherwise.
- **Live Check (optional relay):** On load, every 20 seconds, after relevant edits, and when **Live Check** is clicked, compares all entered vessel names, voyage numbers, and first-port departure dates with proof data. It can fill a blank vessel departure date but never overwrite a typed one. It also checks duplicate IMO rows locally and requires exactly one regular (not one-off) row. Relay-backed comparisons are disabled without the optional server; the duplicate-IMO check remains local.
- **Shared warning area:** Warnings from the checks above are combined into one stacked banner area instead of replacing one another. Temporary confirmations and informational notices use the same top-right notification area.

## Port helpers

- **Insert Port:** Adds a small plus button beside each port name. Clicking it inserts a blank row after that port and shifts later port data downward into the existing spare rows.
- **Delete Port:** Adds a per-row delete control that removes a port and shifts later port data upward — including shifting later ports up when the row you delete is itself already empty, closing the gap.
- **Restore Port Action:** The Tools panel can undo recent insert/delete port actions from the current page session.
- **Port name reminder:** While an arrival or departure field has focus, shows the corresponding port name in a small floating label; it follows scrolling and disappears on blur.
- **Region-entry highlighting:** Automatically highlights one significant port where the route enters the USA/Canada, Japan, EU, or UK. It prefers Tradetech's First USA/First EU fields when available, otherwise chooses from category changes in the port sequence.
- **Manual ETD highlighting:** If the route loops back to its starting port, departure dates entered beyond that auto-sync boundary are highlighted as manual values.
- **AWR helper:** On load and relevant port/radio changes, selects AWR Yes when the schedule calls a US port or the Panama Canal, unless the user has manually touched the AWR choice. It does not automatically change Yes back to No.

## Vessel and voyage helpers

- **Duplicate Vessel:** Adds a copy control beside each vessel. It copies the vessel into the next empty vessel row, including its Lloyds/IMO identity, and steps the voyage number forward by the page's configured increment. Duplicating the same vessel repeatedly chains the voyage number forward each click (e.g. 201 → 202 → 203) rather than repeating the same number; a negative or zero increment keeps every duplicate's voyage number the same as the source instead of stepping it.
- **Delete Vessel:** Adds a per-row delete control and moves later vessel data up after removal.
- **Restore Vessel Action:** The Tools panel can undo recent duplicate/delete vessel actions from the current page session.
- **Fix Vessel Dates:** When clicked, finds non-one-off vessel dates earlier than SP001, moves them forward in weekly steps after the latest vessel date, and increments their voyage codes.
- **Rearrange Vessels:** Manually sorts the visible vessel table by departure date, earliest first. Undated rows remain at the end in their existing relative order.
- **Vessel recommendation:** Automatically suggests up to two vessels whose departure dates are closest to a calculated base date. The base uses today's date or the highlighted port and saved schedule offsets, and suggestions refresh when relevant fields change.
- **Vessel name reminder:** While a vessel voyage or departure-date field has focus, shows that row's vessel name in a floating label.
- **TBA shortcut:** Typing a single backtick in a vessel-name field changes it to `VESSEL TO BE ANNOUNCED` and fills an empty voyage with `TBN`. Clearing that placeholder also clears its unchanged `TBN` voyage.
- **Voyage direction suffix:** The **Direction: ON/OFF** tool controls whether a bare voyage number receives the N/S/E/W suffix from a direction-suffixed service code when the voyage field changes.
- **Voyage step buttons:** Adds minus/plus controls beside voyage fields. A click changes every number in the code by one while preserving padding and text; Shift-click uses the page's voyage increment setting when valid.

## Date tools

- **Arrival/departure syncing:** When a valid port arrival changes, copies it to the same row's departure through the route's loop-back boundary. SP001 is intentionally reversed: changing its departure copies to its arrival.
- **Date step buttons:** Adds minus/plus controls beside arrival and departure fields. Click changes one day; Shift-click changes seven. For a same-port pair, the other date also moves when necessary to prevent an impossible arrival/departure order.
- **Snapshot Diffs:** Saves the current day offsets between SP001 and the port dates for later use on the current page.
- **Cascade Dates:** Rebuilds port dates forward from SP001 using the saved offsets.
- **Cascade Back:** Rebuilds earlier port dates backward from the last port date the user edited, using the saved offsets.
- **Date Calculator:** Opens a small calculator where a base date and positive or negative day offset produce a date and weekday immediately as values are typed.

## Notes, highlighting, and page appearance

- **Notes date refresh:** On page load, replaces six-digit or `MM/DD/YY` dates already present in the notes field with today's date, preserving the original slash/no-slash style.
- **Notes sidebar:** When a notes field exists, creates a collapsible, always-visible sidebar. Editing either the sidebar or Tradetech's original notes box updates the other.
- **Saved text highlights:** On any injectable web page, select text and press Ctrl+D to mark it yellow. Click a saved mark to remove it. Highlights are stored for that exact page and restored on reload; Chrome's built-in PDF viewer is not supported.
- **Decorative stars:** Adds a pointer-free animated starfield and subtle corner decoration to Tradetech pages without changing form fields.
- **Merge-site resize setting:** On mergeimagesonline.com, waits for the resize switch and turns image resizing off automatically.

## Navigation and interface

- **Tools panel:** Collects actions into Vessel, Port, Date, Proof, and Other groups. It can be collapsed, dragged, and reordered; layout choices are saved locally. **Reset Layout** restores default tool and row-button positions. Cross-tab collapse syncing is optional-server behavior, while the local panel works without it.
- **Spreadsheet-style field navigation:** Arrow keys move between SP/SV fields when the text cursor is at the relevant edge. Tab and Shift+Tab cycle specifically through port arrival/departure fields, selecting the destination value.
- **Select on focus:** Selects the full contents of supported text fields when they receive focus, making replacement typing faster.
- **Automatic schedule navigation:** Once per calendar day, looks for Tradetech's Data Input and Sailing Schedules links after login and clicks through to the schedule search flow. Per-tab flags prevent repeated clicks during that run.
- **Normal tabs instead of popup windows:** When a website calls `window.open` with popup-window options, opens the destination as a normal background tab instead. Ordinary `window.open` calls without popup options are unchanged.
- **Full-page capture:** Clicking the extension's toolbar icon captures and stitches the current page into a PNG download. On a recognized Yang Ming schedule page it also saves the page's HTML for the optional server workflow. Screenshot capture itself does not require the server.

## Optional relay-backed workflow

The optional local relay is not included with this community package. See [README.md](README.md#no-server-required) for the no-server behavior. When it is absent, relevant controls are hidden or disabled/grayed with a **Requires the optional local relay server** tooltip.

- **Scan & Save:** With the relay connected, the due-service search flow can read the configured Assigned To name, run once daily, parse assigned-service results, and save them for the local dashboard. A manual **Scan & Save** action can rescan. Without the relay, the automated search/scan does not start and the button is disabled.
- **Upload Proof:** Finds today's downloaded proof for the current service, opens Tradetech's Support Document flow, stages the file, and submits it. It records successful uploads locally so the missing-proof warning can clear. The button is disabled without the relay.
- **Schedule preview tools:** On a Tradetech preview page, resolves the record through the relay, offers **Open Proof File**, and adds **Mark Done**, which updates the due-service list and best-effort closes the opened proof application before closing the tab. These controls stay hidden without the relay.
- **Rename toggle:** On non-Tradetech pages, shows a floating Rename ON/OFF control for server-side download renaming. It is hidden without the relay and synchronizes again after reconnection.
- **Schedule capture:** On a Tradetech schedule-details page, quietly sends the current service, operator, ports, vessels, dates, and highlighted-port information to the relay when the page changes. Without the relay it makes no page changes and sends nothing.
- **Service-code sharing:** Quietly sends the current service code to the relay on load, edits, and reconnect so server-side download workflows know which service is active. It is a no-op offline.
- **Merge download cleanup:** On mergeimagesonline.com, detects the site's merged-image download button and asks the relay to run its cleanup workflow. It is a no-op offline.
- **Yang Ming table capture:** On a Yang Ming long-term schedule page, reads the real HTML schedule, fetches the opposite direction when available, combines the rows, and sends the result to the relay. Without the relay, the page is still parsed but the result is not saved.

## Supporting behavior

The remaining manifest-loaded support scripts provide date parsing/formatting, voyage stepping, safe field updates, port/vessel row access, loop-boundary detection, draggable buttons, the shared Tools panel, warnings, relay availability detection, and feature startup/event routing. They do not add separate end-user actions beyond the features described above.
