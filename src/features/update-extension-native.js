// ─────────────────────────────────────────────────────
//  FEATURE: Update Extension (native, no relay server)
//  A toolbar button for people who don't run the local relay server —
//  the community edition's audience. Asks the background script (see
//  background.js's CHECK_FOR_UPDATE_NATIVE handler) to message a small
//  local program (updater/update.bat, registered once per machine via
//  updater/register.bat — see updater/README.md) that downloads the
//  latest code and overwrites this extension's folder on disk, outside
//  the browser sandbox a content script is stuck in. On success the
//  background script reloads the tab and the extension itself — no
//  chrome://extensions click needed.
//
//  Always registered, no Custom Rule toggle — a maintenance action, not
//  an opt-in data-entry feature (same reasoning live-check-relay.js's
//  button uses). Harmless if the native host was never registered —
//  chrome.runtime.sendNativeMessage just fails with "specified native
//  messaging host not found", surfaced below as a plain banner.
// ─────────────────────────────────────────────────────
Toolbar.register({
    id:    "tt-update-extension-native-btn",
    label: "🔄 Update Extension",
    title: "Download the latest code and reload the extension (needs the one-time updater setup — see updater/README.md)",
    group: "misc",
    onClick: () => {
        console.log("🖱 Update Extension (native) clicked");
        chrome.runtime.sendMessage({ type: "CHECK_FOR_UPDATE_NATIVE" }, (response) => {
            // On a real update the background script reloads the tab (and
            // itself) before ever replying — a response here means either
            // nothing changed, the pull failed, or the native host isn't
            // registered yet, all banner-worthy, not a reload in flight.
            if (!response) {
                showTemporaryBanner({ title: "🔄 Update Extension", message: "No response from the background script — try again" });
            } else if (!response.ok) {
                showTemporaryBanner({ title: "🔄 Update Extension", message: response.reason || "Update failed — see updater/README.md for setup" });
            } else if (!response.updated) {
                showTemporaryBanner({ title: "🔄 Update Extension", message: "Already up to date" });
            }
        });
    }
});
