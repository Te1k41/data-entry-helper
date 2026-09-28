@echo off
rem One-time setup for the "Update Extension" button — run this once
rem after you first install the extension. No admin rights needed
rem (writes to HKCU, your own user's registry, not the machine's).
rem See README.md in this folder for what this does and why.
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0register.ps1"
pause
