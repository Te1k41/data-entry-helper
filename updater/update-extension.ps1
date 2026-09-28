# ============================================================
#  updater/update-extension.ps1
#  Native Messaging host for the "Update Extension" toolbar button
#  (src/features/update-extension-native.js). Runs entirely inside
#  Chrome's Native Messaging sandbox — stdin/stdout only, no console
#  window, no arguments. See updater/README.md for one-time setup.
#
#  Protocol: 4-byte little-endian length prefix, then that many UTF-8
#  JSON bytes, both ways — Chrome's Native Messaging wire format.
#
#  What it does: checks the community repo's latest commit against the
#  one recorded locally (no git needed on this machine — a public
#  GitHub ZIP download + the GitHub API's "latest commit" endpoint),
#  and if newer, downloads + overwrites this extension's own folder,
#  everything except this updater/ folder itself (so a running script
#  never tries to overwrite itself mid-run).
# ============================================================

$ErrorActionPreference = "Stop"

$RepoZipUrl    = "https://github.com/Te1k41/data-entry-helper-community/archive/refs/heads/main.zip"
$RepoCommitApi = "https://api.github.com/repos/Te1k41/data-entry-helper-community/commits/main"
$ExtensionRoot = Split-Path -Parent $PSScriptRoot  # updater/ -> extension root
$MarkerFile    = Join-Path $PSScriptRoot ".installed-commit"

$stdin  = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

function Read-NativeMessage {
    $lengthBytes = New-Object byte[] 4
    $read = 0
    while ($read -lt 4) {
        $n = $stdin.Read($lengthBytes, $read, 4 - $read)
        if ($n -le 0) { return $null }  # Chrome closed the pipe
        $read += $n
    }
    $length = [BitConverter]::ToUInt32($lengthBytes, 0)
    $msgBytes = New-Object byte[] $length
    $read = 0
    while ($read -lt $length) {
        $n = $stdin.Read($msgBytes, $read, $length - $read)
        if ($n -le 0) { break }
        $read += $n
    }
    return [System.Text.Encoding]::UTF8.GetString($msgBytes)
}

function Write-NativeMessage($obj) {
    $json = $obj | ConvertTo-Json -Compress -Depth 5
    $jsonBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $lengthBytes = [BitConverter]::GetBytes([uint32]$jsonBytes.Length)
    $stdout.Write($lengthBytes, 0, 4)
    $stdout.Write($jsonBytes, 0, $jsonBytes.Length)
    $stdout.Flush()
}

function Do-Update {
    $headers = @{ "User-Agent" = "TTHelper-Updater" }  # GitHub API refuses requests with no User-Agent

    $latest = (Invoke-RestMethod -Uri $RepoCommitApi -Headers $headers).sha
    $installed = if (Test-Path $MarkerFile) { (Get-Content $MarkerFile -Raw).Trim() } else { $null }
    if ($latest -eq $installed) {
        return @{ ok = $true; updated = $false; commit = $latest.Substring(0, 7) }
    }

    $tempDir = Join-Path $env:TEMP ("tthelper-update-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    try {
        $zipPath = Join-Path $tempDir "update.zip"
        Invoke-WebRequest -Uri $RepoZipUrl -OutFile $zipPath -Headers $headers
        Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force

        # GitHub's ZIP wraps everything in one "<repo>-<branch>" folder
        $extracted = Get-ChildItem $tempDir -Directory | Where-Object { $_.Name -ne "update.zip" } | Select-Object -First 1
        if (-not $extracted) { throw "downloaded archive had no extracted folder" }

        # Overwrite everything except updater/ itself — never touch the
        # files this running script lives in.
        Get-ChildItem $extracted.FullName | Where-Object { $_.Name -ne "updater" } | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $ExtensionRoot -Recurse -Force
        }

        Set-Content -Path $MarkerFile -Value $latest -NoNewline
        return @{ ok = $true; updated = $true; commit = $latest.Substring(0, 7) }
    } finally {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

try {
    $raw = Read-NativeMessage
    if ($null -eq $raw) { exit 0 }  # Chrome closed the pipe before sending anything
    $message = $raw | ConvertFrom-Json

    if ($message.action -eq "update") {
        Write-NativeMessage (Do-Update)
    } else {
        Write-NativeMessage @{ ok = $false; reason = "unknown action: $($message.action)" }
    }
} catch {
    Write-NativeMessage @{ ok = $false; reason = $_.Exception.Message }
}
