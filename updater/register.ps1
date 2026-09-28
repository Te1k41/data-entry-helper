# ============================================================
#  updater/register.ps1
#  One-time setup for the "Update Extension" button — writes the
#  Native Messaging host manifest and points Chrome at it, both in
#  HKCU (your own user's registry, no admin rights needed). Run once
#  after installing the extension; see README.md.
#
#  JSON/registry work goes through PowerShell's own cmdlets rather
#  than raw batch string-building — batch's quote+paren handling is
#  notoriously unreliable for exactly this kind of "write a JSON file"
#  task (confirmed live: it silently produced an empty "path" value).
# ============================================================

$ErrorActionPreference = "Stop"

$BatPath      = Join-Path $PSScriptRoot "update.bat"
$ManifestPath = Join-Path $PSScriptRoot "native-host-manifest.json"

$manifest = @{
    name            = "com.tthelper.updater"
    description     = "TTHelper-SC extension updater"
    path            = $BatPath
    type            = "stdio"
    allowed_origins = @("chrome-extension://fkjfhpikhfbbhmllffoibokinnghdgoa/")
}
$manifest | ConvertTo-Json | Set-Content -Path $ManifestPath -Encoding UTF8

$regKeyPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.tthelper.updater"
New-Item -Path $regKeyPath -Force | Out-Null
Set-ItemProperty -Path $regKeyPath -Name "(default)" -Value $ManifestPath

Write-Host "Setup complete. The `"Update Extension`" button will work now."
