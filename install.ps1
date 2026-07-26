# Set up Mashup Deck on a Windows PC that has nothing installed.
#
#   irm https://<your-url>/install.ps1 | iex
#
# Same reasoning as install.sh: a file that arrives through a browser gets marked,
# and SmartScreen then blocks it with a warning that looks like a virus alert.
# Nothing fetched by Invoke-RestMethod is marked, and the launcher this writes is
# a local file the user made, so it simply runs. No certificate, no warning.
#
# Nothing touches the system: no system Python, no PATH edits, no admin. It all
# lands in one folder that can be deleted in one go.

$ErrorActionPreference = 'Stop'

# Where the app comes from. A private repo cannot be fetched without credentials,
# so this has to point at something public.
$SourceUrl = if ($env:SOURCE_URL) { $env:SOURCE_URL } else {
  'https://codeload.github.com/laksh-ya/mashup-deck/tar.gz/refs/heads/main'
}

$Root  = if ($env:MASHUP_HOME) { $env:MASHUP_HOME } else { Join-Path $env:LOCALAPPDATA 'MashupDeck' }
$Tools = Join-Path $Root 'tools'
$App   = Join-Path $Root 'app'
$Venv  = Join-Path $Root '.venv'
$PythonVersion = '3.11'

function Say($m) { Write-Host "  $m" }
function Die($m) { Write-Host ""; Write-Error $m; exit 1 }

Write-Host ""
Write-Host "  Mashup Deck"
Say "installing into $Root"
Write-Host ""

New-Item -ItemType Directory -Force -Path $Tools, $App | Out-Null

# ── the app itself ──────────────────────────────────────────────────────────
if ($env:SOURCE_DIR) {
  Say "[1/4] copying the app from $env:SOURCE_DIR"
  Get-ChildItem -Path $env:SOURCE_DIR -Exclude '.git', '.venv', 'downloads', 'outputs', '__pycache__' |
    Copy-Item -Destination $App -Recurse -Force
} else {
  Say "[1/4] fetching the app"
  $tar = Join-Path $Root 'app.tar.gz'
  try { Invoke-WebRequest -Uri $SourceUrl -OutFile $tar -UseBasicParsing }
  catch { Die "Could not download the app from $SourceUrl. If that repo is private, this cannot see it." }
  # tar.exe ships with Windows 10 and later. GitHub nests everything one folder
  # deep, hence the strip.
  & tar.exe -xzf $tar -C $App --strip-components=1
  if ($LASTEXITCODE -ne 0) { Die "Could not unpack the app" }
  Remove-Item $tar -Force
}

if (-not (Test-Path (Join-Path $App 'main.py'))) { Die "That did not look like the app: no main.py in $App" }

# ── python, without touching the system python ──────────────────────────────
$uv = Join-Path $Tools 'uv.exe'
if (-not (Test-Path $uv)) {
  Say "[2/4] installing a private copy of Python"
  $env:UV_INSTALL_DIR = $Tools
  $env:UV_NO_MODIFY_PATH = '1'
  Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
  if (-not (Test-Path $uv)) { Die "Could not install uv" }
} else {
  Say "[2/4] Python is already here"
}

# --clear so a second run repairs instead of failing on the existing environment
& $uv venv --clear --python $PythonVersion $Venv | Out-Null
if ($LASTEXITCODE -ne 0) { Die "Could not create the environment" }

$py = Join-Path $Venv 'Scripts\python.exe'
& $uv pip install --quiet --python $py -r (Join-Path $App 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Die "Could not install the app's dependencies" }

# ── ffmpeg, the one thing pip cannot provide ────────────────────────────────
# pydub is a wrapper around ffmpeg, and yt-dlp needs ffprobe too in order to turn
# what it downloads into mp3. Static single file builds, nothing to install.
$ffmpeg  = Join-Path $Tools 'ffmpeg.exe'
$ffprobe = Join-Path $Tools 'ffprobe.exe'
if ((Test-Path $ffmpeg) -and (Test-Path $ffprobe)) {
  Say "[3/4] ffmpeg is already here"
} else {
  Say "[3/4] installing ffmpeg"
  $base = 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download'
  foreach ($tool in 'ffmpeg', 'ffprobe') {
    $gz  = Join-Path $Tools "$tool.gz"
    $exe = Join-Path $Tools "$tool.exe"
    Invoke-WebRequest -Uri "$base/$tool-win32-x64.gz" -OutFile $gz -UseBasicParsing
    $in  = [System.IO.File]::OpenRead($gz)
    $out = [System.IO.File]::Create($exe)
    $gzip = New-Object System.IO.Compression.GzipStream($in, [System.IO.Compression.CompressionMode]::Decompress)
    $gzip.CopyTo($out)
    $gzip.Dispose(); $out.Dispose(); $in.Dispose()
    Remove-Item $gz -Force
  }
}

& $ffmpeg -version | Out-Null
if ($LASTEXITCODE -ne 0) { Die "ffmpeg was installed but will not run" }

# ── the launcher ────────────────────────────────────────────────────────────
# Written here rather than downloaded, so Windows sees a local file rather than
# something from the internet. That is the whole trick: no SmartScreen.
Say "[4/4] putting a launcher on the Desktop"

$desktop  = [Environment]::GetFolderPath('Desktop')
$launcher = Join-Path $desktop 'Mashup Deck.cmd'

# Loopback only, on purpose: listening on all interfaces is what makes Windows
# Firewall ask for permission, and that is a dialog we do not want.
$body = @"
@echo off
title Mashup Deck
cd /d "$App"
set "PATH=$Tools;%PATH%"
cls
echo.
echo   Mashup Deck is starting up...
echo.

rem YouTube changes how it serves audio every few weeks, so a pinned yt-dlp goes
rem stale and stops downloading. Refreshing here is what keeps this working
rem months from now with nobody doing anything. No network, no problem.
"$uv" pip install --quiet --python "$py" --upgrade yt-dlp >nul 2>&1

rem main.py picks a free port, waits for the server, opens the browser
"$py" main.py
pause
"@

Set-Content -Path $launcher -Value $body -Encoding ASCII

Write-Host ""
Say "Done."
Write-Host ""
Say 'Double-click "Mashup Deck.cmd" on your Desktop to start.'
Say "To remove it: delete that file and the folder $Root"
Write-Host ""
