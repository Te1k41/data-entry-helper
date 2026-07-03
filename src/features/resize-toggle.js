// ─────────────────────────────────────────────────────
//  FEATURE: Resize Toggle Off
//  On page load, automatically turns off the resize
//  image toggle on mergeimagesonline.com
// ─────────────────────────────────────────────────────
const ResizeToggleOff = {

    init() {
    const tryToggle = () => {
        const toggle = document.getElementById("resize-switch");
        const label  = document.querySelector('label[for="resize-switch"]');

        if (!toggle || !label) {
            // not ready yet — try again in 200ms
            setTimeout(tryToggle, 200);
            return;
        }

        if (toggle.checked) {
            label.click();
            console.log("🖼 Resize toggle turned off");
        } else {
            console.log("🖼 Resize toggle already off");
        }
    };

    tryToggle();
},

    handle(_event) {}
};