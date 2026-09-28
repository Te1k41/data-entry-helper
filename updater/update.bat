@echo off
rem Native Messaging entry point Chrome actually launches — its "path"
rem must point at a single executable, so this thin wrapper runs the
rem real logic (update-extension.ps1) via PowerShell, which every
rem Windows machine already has built in, nothing to install.
rem -ExecutionPolicy Bypass applies to this one process only, it does
rem not change the machine's normal PowerShell script policy.
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0update-extension.ps1"
