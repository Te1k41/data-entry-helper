// ============================================================
//  FEATURE: Never open a chrome-less popup window
//
//  Some sites/buttons open links via JS — window.open(url, name,
//  "toolbar=no,width=...,height=...") — instead of a plain
//  <a href>. Chrome honors that feature string and opens a small
//  popup window with no tab strip, no address bar, and no
//  extension icons.
//
//  This script runs in the PAGE'S OWN "MAIN" world (see the
//  matching content_scripts entry in manifest.json — `"world":
//  "MAIN"`), which lets it see and wrap the page's real
//  window.open directly. No extra extension permission is
//  needed for this — MAIN-world content scripts are a normal
//  Manifest V3 capability.
//
//  Unconditionally: any window.open() call that would create a
//  popup-style window (i.e. it passed a "features" string) opens
//  as a normal background tab in the same window instead. Plain
//  window.open(url) calls with no features already open as tabs
//  in Chrome, so those are left untouched.
// ============================================================
(function () {
    const realOpen = window.open.bind(window);

    window.open = function (url, target, features, ...rest) {
        if (features) {
            console.log("🪟 Blocked popup window — opening as a tab instead:", url);
            return realOpen(url, "_blank", "", ...rest);
        }
        return realOpen(url, target, features, ...rest);
    };
})();