# Build a rollback DeepSeek Harness (DSH) Desktop version from source and
# overwrite the current installation.
#
# Usage examples (run in a normal PowerShell window, NOT inside DSH):
#   # From a zip downloaded by the dsh-rollback plugin's settings page:
#   .\build-rollback.ps1 -ZipPath "$env:USERPROFILE\Downloads\dsh-v0.2.1-rc.5.zip"
#
#   # Or let the script fetch the tag from GitHub directly:
#   .\build-rollback.ps1 -Tag dsh-v0.2.1-rc.5
#
#   # Preview everything but the final overwrite:
#   .\build-rollback.ps1 -Tag dsh-v0.2.1-rc.5 -SkipOverwrite
#
# Requirements: Node.js >= 24.9, pnpm, git (for -Tag), network access.

param(
  [string] $Tag = '',
  [string] $ZipPath = '',
  [string] $WorkDir = Join-Path $env:TEMP 'dsh-rollback-build',
  [string] $InstallDir = 'D:\AI\ProgramFiles\DeepseekHarness',
  [switch] $SkipOverwrite
)

$ErrorActionPreference = 'Stop'

function Fail($message) { Write-Host "[ERROR] $message" -ForegroundColor Red; exit 1 }

if (-not $Tag -and -not $ZipPath) { Fail 'Provide -Tag <dsh-vX.Y.Z> or -ZipPath <downloaded source zip>.' }

# --- Preflight ---------------------------------------------------------------
foreach ($tool in @('node', 'pnpm', 'tar')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "missing tool: $tool" }
}
$nodeMajor = [int]((node --version) -replace 'v(\d+)\..*', '$1')
if ($nodeMajor -lt 24) { Fail "Node.js >= 24.9 required, found $(node --version)" }

$proc = Get-Process | Where-Object { $_.Path -like "$InstallDir*" }
if ($proc -and -not $SkipOverwrite) {
  Fail "DSH is still running from $InstallDir (PID $($proc[0].Id)). Quit DeepSeek Harness completely first, or use -SkipOverwrite."
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

# --- Obtain the source -------------------------------------------------------
$srcDir = Join-Path $WorkDir 'src'
if (Test-Path $srcDir) { Remove-Item -Recurse -Force $srcDir }

if ($ZipPath) {
  if (-not (Test-Path $ZipPath)) { Fail "zip not found: $ZipPath" }
  Write-Host "[1/6] Expanding $ZipPath" -ForegroundColor Cyan
  $tmp = Join-Path $WorkDir 'expand'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  Expand-Archive -Path $ZipPath -DestinationPath $tmp
  $inner = Get-ChildItem -Directory $tmp | Select-Object -First 1
  Move-Item $inner.FullName $srcDir
} else {
  Write-Host "[1/6] Cloning deepseek-harness at $Tag (shallow)" -ForegroundColor Cyan
  git clone --depth 1 --branch $Tag https://github.com/deepseek-ai/deepseek-harness.git $srcDir
  if ($LASTEXITCODE -ne 0) { Fail 'git clone failed; check the tag name.' }
}

Push-Location $srcDir

# --- Build -------------------------------------------------------------------
Write-Host '[2/6] pnpm install (this downloads a lot; be patient)' -ForegroundColor Cyan
pnpm install
if ($LASTEXITCODE -ne 0) { Fail 'pnpm install failed.' }

Write-Host '[3/6] Building the repository (make build)' -ForegroundColor Cyan
pnpm run build
if ($LASTEXITCODE -ne 0) { Fail 'pnpm run build failed.' }

Write-Host '[4/6] Packaging Desktop win-x64 (unpacked, no signing)' -ForegroundColor Cyan
pnpm --dir apps/desktop run package:win:x64:dir
if ($LASTEXITCODE -ne 0) { Fail 'packaging failed.' }
Pop-Location

# Locate the unpacked output.
$unpacked = Get-ChildItem -Directory -Recurse (Join-Path $srcDir 'apps\desktop') -Filter 'win-unpacked' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $unpacked) { Fail 'win-unpacked output not found under apps\desktop.' }
Write-Host "[4/6] Built: $($unpacked.FullName)" -ForegroundColor Green

# --- Backup then overwrite ---------------------------------------------------
$backupZip = Join-Path $env:USERPROFILE ("Downloads\dsh-install-backup-{0}.zip" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path (Split-Path $backupZip) | Out-Null

if ($SkipOverwrite) {
  Write-Host "[5/6] -SkipOverwrite: backup skipped; built app is at $($unpacked.FullName)" -ForegroundColor Yellow
  Write-Host "[6/6] Skipped. To overwrite manually: quit DSH, back up $InstallDir, then copy the contents of $($unpacked.FullName) over $InstallDir." -ForegroundColor Yellow
  exit 0
}

Write-Host "[5/6] Backing up current install to $backupZip (tar zip)" -ForegroundColor Cyan
tar.exe -a -c -f $backupZip -C $InstallDir .
if ($LASTEXITCODE -ne 0) { Fail 'backup failed; nothing was overwritten.' }

Write-Host "[6/6] Overwriting $InstallDir with the built version" -ForegroundColor Cyan
# Remove old contents except the backup we just made elsewhere, then copy.
Get-ChildItem -Force $InstallDir | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $unpacked.FullName '*') -Destination $InstallDir -Recurse -Force

Write-Host "Done. Rollback build installed to $InstallDir." -ForegroundColor Green
Write-Host "Old version saved at $backupZip. Start DeepSeek Harness to verify." -ForegroundColor Green
