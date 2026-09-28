# Update Extension — one-time setup

The "🔄 Update Extension" button in the toolbar needs this set up once,
per machine, before it works. It never needs redoing after that.

## What it does

Clicking the button in the extension downloads the latest code and
reloads it in — no git, no terminal, no re-downloading a ZIP yourself.
A browser extension can't rewrite its own files on disk (that's a
security boundary, not a bug), so the button asks this small local
helper to do it instead, the same way a game launcher like itch.io's
own app updates a game while the game itself can't.

## Setup (do this once)

1. Double-click `register.bat` in this folder.
2. It'll print "Setup complete." Press any key to close the window.

That's it. No admin rights needed — it only writes to your own
Windows user account's settings, not the whole machine's.

## What setup actually changes

- Writes `native-host-manifest.json` in this same folder, telling
  Chrome where `update.bat` lives.
- Adds one small entry to your Windows registry (under
  `HKCU\Software\Google\Chrome\NativeMessagingHosts`) pointing at
  that file. This is the only way Chrome allows an extension to talk
  to a local program at all — it's how the button is allowed to
  trigger anything outside the browser.

## What happens when you click the button

1. The extension asks this helper "is there anything new?"
2. If not: a small banner says "Already up to date."
3. If yes: it downloads the latest code, replaces the extension's
   files with it (this `updater/` folder itself is left alone), then
   the extension reloads itself and the page you were on. A few
   seconds, no visible download or unzip step.

## If the button doesn't work

- "Setup needed" or a native-host error in the banner → run
  `register.bat` again.
- Nothing happens at all → check that `update.bat` and
  `update-extension.ps1` are still in this same folder — they can't
  move away from `register.bat`'s manifest without re-running setup.
