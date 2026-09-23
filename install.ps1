# Mashup Deck for Windows, one command, nothing needed beforehand.
#
#   irm https://raw.githubusercontent.com/laksh-ya/mashup-deck/main/install.ps1 | iex
#
# The README's universal command (the same line for Mac, Linux and Windows
# PowerShell) ends up running exactly this on Windows.
#
# What it does, same as install.sh on Mac and Linux:
#   - works out what machine this is
#   - asks whether you want to try it once or install it
#   - fetches everything itself: the app, a private Python (uv), static ffmpeg,
#     and deno (the JavaScript runtime yt-dlp now needs for YouTube)
#   - install: adds Mashup Deck to the Start menu and the Desktop, and to
#     Settings > Apps so it can be removed like any other app
#   - try once: runs from a temporary folder and deletes it afterwards
#   - opens the app in your browser at the end
#
# Why a pasted command rather than a download: a file that arrives through a
# browser gets marked, and SmartScreen then blocks it with a warning that looks
# like a virus alert. Nothing fetched by Invoke-RestMethod is marked, and the
# launcher this writes is a local file you made, so it simply runs.
#
# Nothing touches the system: no system Python, no PATH edits, no admin. It all
# lands in one folder that can be deleted in one go.
#
# Everything runs inside one script block, so nothing leaks into the PowerShell
# window it was pasted into, and a problem ends this script, not the window.
#
# Knobs, all optional (mostly for testing):
#   $env:MASHUP_MODE = 'once' or 'install'   skip the question
#   $env:MASHUP_HOME = 'C:\path'             install somewhere else
#   $env:MASHUP_REF  = 'branch'              which branch to install and follow
#   $env:MASHUP_NO_START = '1'               install but do not start it
#   $env:SOURCE_DIR  = 'C:\path'             use a local checkout

& {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads crawl
# older Windows 10 PowerShell only speaks old TLS unless told otherwise
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch {}

$Repo = 'laksh-ya/mashup-deck'
$Ref  = if ($env:MASHUP_REF) { $env:MASHUP_REF } else { 'main' }
$PythonVersion = '3.11'
$PortHint = 8765

function Say($m)  { Write-Host "  $m" }
function Rule     { Write-Host '  ------------------------------------------------------------' }
function Fail($m) { throw [System.Exception]::new("MASHUP: $m") }

# Run a program quietly and hand back its exit code. Windows PowerShell 5 turns
# a program's stderr into errors, and with 'Stop' above the first warning line
# would end the script, so this runs with 'Continue'.
function Run {
  $ErrorActionPreference = 'Continue'
  $exe, $rest = $args
  & $exe @rest 2>&1 | Out-Null
  return $LASTEXITCODE
}

# ── what machine is this ────────────────────────────────────────────────────
function Get-Machine {
  $arch = $env:PROCESSOR_ARCHITEW6432
  if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
  $label = 'Windows'
  if ($arch -eq 'ARM64') { $label = 'Windows (ARM)' }
  elseif ($arch -ne 'AMD64') { Fail "This needs 64-bit Windows (found $arch)." }
  return @{ IsArm = ($arch -eq 'ARM64'); Label = $label }
}

function Get-Mode {
  $m = $env:MASHUP_MODE
  if (-not $m) {
    $interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
    if (-not $interactive) {
      Say '(no window to ask in, so installing. Set MASHUP_MODE=once to just try it)'
      return 'install'
    }
    Write-Host ''
    Say 'How do you want to use it?'
    Say ''
    Say '  1) Try it once   runs now from a temporary folder,'
    Say '                   nothing is left behind when you close it'
    Say '  2) Install it    adds Mashup Deck to the Start menu and Desktop,'
    Say '                   and it updates itself every time it starts'
    Say ''
    $a = Read-Host '  Choose 1 or 2 [2]'
    if ("$a".Trim() -eq '1') { $m = 'once' } else { $m = 'install' }
  }
  if ($m -ne 'once' -and $m -ne 'install') { Fail 'MASHUP_MODE must be once or install' }
  return $m
}

function Get-Sha {
  try {
    $s = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/$Ref" `
         -Headers @{ Accept = 'application/vnd.github.sha' } -TimeoutSec 10 -UseBasicParsing
    $s = "$s".Trim()
    if ($s -match '^[0-9a-f]{40}$') { return $s }
  } catch {}
  return ''
}

# ── the app itself ──────────────────────────────────────────────────────────
function Get-App {
  if (Test-Path $App) { Remove-Item $App -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $App | Out-Null
  if ($env:SOURCE_DIR) {
    Say "[1/5] copying the app from $env:SOURCE_DIR"
    Get-ChildItem -Path $env:SOURCE_DIR -Force -Exclude '.git', '.venv', 'downloads', 'outputs', '__pycache__' |
      Copy-Item -Destination $App -Recurse -Force
    Set-Content -Path (Join-Path $App '.mashup-version') -Value 'local' -Encoding ASCII
  } else {
    Say '[1/5] fetching the app'
    $sha = Get-Sha
    $which = if ($sha) { $sha } else { $Ref }
    $url = "https://codeload.github.com/$Repo/tar.gz/$which"
    $tar = Join-Path $Root 'app.tar.gz'
    try { Invoke-WebRequest -Uri $url -OutFile $tar -UseBasicParsing }
    catch { Fail "Could not download the app. Check the internet connection and run the command again." }
    # tar.exe ships with Windows 10 and later. GitHub nests everything one
    # folder deep, hence the strip.
    if ((Run tar.exe -xzf $tar -C $App --strip-components=1) -ne 0) { Fail 'Could not unpack the app' }
    Remove-Item $tar -Force
    $v = if ($sha) { $sha } else { 'unknown' }
    Set-Content -Path (Join-Path $App '.mashup-version') -Value $v -Encoding ASCII
  }
  if (-not (Test-Path (Join-Path $App 'main.py'))) { Fail "That did not look like the app: no main.py in $App" }
}

# ── python, without touching the system python ──────────────────────────────
# uv is one self-contained program that installs its own Python. Its Python and
# its cache point inside our folder, so deleting the folder removes everything.
function Install-Python {
  if (-not (Test-Path $Uv)) {
    Say '[2/5] installing a private copy of Python'
    $zipName = if ($IsArm) { 'uv-aarch64-pc-windows-msvc.zip' } else { 'uv-x86_64-pc-windows-msvc.zip' }
    $zip = Join-Path $Tools 'uv.zip'
    try { Invoke-WebRequest -Uri "https://github.com/astral-sh/uv/releases/latest/download/$zipName" -OutFile $zip -UseBasicParsing }
    catch { Fail 'Could not download uv (the Python manager). Check the internet and try again.' }
    Expand-Archive -Path $zip -DestinationPath $Tools -Force
    Remove-Item $zip -Force
    if (-not (Test-Path $Uv)) { Fail 'Could not install uv (the Python manager).' }
  } else {
    Say '[2/5] Python is already here'
  }
  # On ARM Windows use the x64 Python: every library (and ffmpeg) exists for it,
  # and Windows runs it fine.
  $want = if ($IsArm) { "cpython-$PythonVersion-windows-x86_64-none" } else { $PythonVersion }
  if ((Run $Uv venv --quiet --clear --python $want $Venv) -ne 0) { Fail 'Could not set up Python' }
  Say "[3/5] installing the app's libraries and deno"
  # yt-dlp[default] brings yt-dlp-ejs, the solver for YouTube's JavaScript
  # challenge, and the deno package puts deno.exe in the environment.
  $req = Join-Path $App 'requirements.txt'
  if ((Run $Uv pip install --quiet --python $Py -r $req 'yt-dlp[default]' deno) -ne 0) {
    Fail "Could not install the app's libraries. Check the internet and try again."
  }
  # requirements.txt pins yt-dlp as a fallback floor; start on the current one
  $null = Run $Uv pip install --quiet --python $Py --upgrade 'yt-dlp[default]' deno
  if ((Run (Join-Path $Venv 'Scripts\deno.exe') --version) -ne 0) { Fail 'deno was installed but will not run' }
}

# ── ffmpeg, the one thing pip cannot provide ────────────────────────────────
function Install-Ffmpeg {
  $ffmpeg  = Join-Path $Tools 'ffmpeg.exe'
  $ffprobe = Join-Path $Tools 'ffprobe.exe'
  if ((Test-Path $ffmpeg) -and (Test-Path $ffprobe)) {
    Say '[4/5] ffmpeg is already here'
  } else {
    Say '[4/5] installing ffmpeg'
    $base = 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download'
    foreach ($tool in 'ffmpeg', 'ffprobe') {
      $gz  = Join-Path $Tools "$tool.gz"
      $exe = Join-Path $Tools "$tool.exe"
      try { Invoke-WebRequest -Uri "$base/$tool-win32-x64.gz" -OutFile $gz -UseBasicParsing }
      catch { Fail "Could not download $tool. Check the internet and try again." }
      $in  = [System.IO.File]::OpenRead($gz)
      $out = [System.IO.File]::Create($exe)
      $gzip = New-Object System.IO.Compression.GzipStream($in, [System.IO.Compression.CompressionMode]::Decompress)
      $gzip.CopyTo($out)
      $gzip.Dispose(); $out.Dispose(); $in.Dispose()
      Remove-Item $gz -Force
    }
  }
  if ((Run $ffmpeg -version) -ne 0) { Fail 'ffmpeg was installed but will not run' }
}

# PowerShell 5 reads a .ps1 without a byte order mark as the old ANSI code
# page, which would mangle a user name with accents in it. So: UTF-8 with BOM.
function Write-Utf8Bom($path, $text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $true))
}
function Quote($s) { "'" + $s.Replace("'", "''") + "'" }

# ── the launcher ────────────────────────────────────────────────────────────
# Written here rather than shipped, so Windows sees a local file you made. It
# updates the app and yt-dlp, then starts it. Every update step may fail
# quietly: no network just means you get the copy you already have.
function Write-Launcher {
  $body = @'
# Starts Mashup Deck. Written by install.ps1; running install.ps1 again rewrites it.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch {}
$Root = __ROOT__
$Repo = __REPO__
$Ref  = __REF__
$Uv = Join-Path $Root 'tools\uv.exe'
$Py = Join-Path $Root '.venv\Scripts\python.exe'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Root 'python'
$env:UV_CACHE_DIR = Join-Path $Root 'cache'
$env:UV_HTTP_TIMEOUT = '15'
$env:PATH = (Join-Path $Root 'tools') + ';' + (Join-Path $Root '.venv\Scripts') + ';' + $env:PATH
$env:DATA_DIR = Join-Path $Root 'data'
$env:PYTHONUNBUFFERED = '1'
$Host.UI.RawUI.WindowTitle = 'Mashup Deck'

Write-Host ''
Write-Host '  Mashup Deck is starting up...'

function Update-App {
  if ($env:MASHUP_UPDATE -eq '0') { return }
  $mine = ''
  try { $mine = (Get-Content (Join-Path $Root 'app\.mashup-version') -ErrorAction Stop | Select-Object -First 1).Trim() } catch {}
  if ($mine -eq 'local') { return }
  try {
    $latest = "$(Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/$Ref" -Headers @{ Accept = 'application/vnd.github.sha' } -TimeoutSec 5 -UseBasicParsing)".Trim()
  } catch { return }
  if ($latest -notmatch '^[0-9a-f]{40}$' -or $latest -eq $mine) { return }
  Write-Host '  getting the latest version...'
  $new = Join-Path $Root 'app.new'
  $tar = Join-Path $Root 'app.new.tar.gz'
  try {
    if (Test-Path $new) { Remove-Item $new -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $new | Out-Null
    Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/tar.gz/$latest" -OutFile $tar -TimeoutSec 60 -UseBasicParsing
    & tar.exe -xzf $tar -C $new --strip-components=1 2>$null
    Remove-Item $tar -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path (Join-Path $new 'main.py'))) { throw 'bad download' }
    $oldReq = Get-Content (Join-Path $Root 'app\requirements.txt') -Raw -ErrorAction SilentlyContinue
    $newReq = Get-Content (Join-Path $new 'requirements.txt') -Raw -ErrorAction SilentlyContinue
    if ($oldReq -ne $newReq) {
      & $Uv pip install --quiet --python $Py -r (Join-Path $new 'requirements.txt') 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'libraries' }
    }
    Set-Content -Path (Join-Path $new '.mashup-version') -Value $latest -Encoding ASCII
    $old = Join-Path $Root 'app.old'
    if (Test-Path $old) { Remove-Item $old -Recurse -Force }
    Rename-Item (Join-Path $Root 'app') 'app.old'
    Rename-Item $new 'app'
    Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
  } catch {
    Remove-Item $new -Recurse -Force -ErrorAction SilentlyContinue
    return
  }
  # a newer installer may write a better launcher; it takes effect next start
  $inst = Join-Path $Root 'app\install.ps1'
  if ((Test-Path $inst) -and (Select-String -Path $inst -Pattern 'MASHUP_REFRESH_LAUNCHER' -Quiet)) {
    $env:MASHUP_REFRESH_LAUNCHER = '1'; $env:MASHUP_HOME = $Root; $env:MASHUP_REF = $Ref
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $inst 2>&1 | Out-Null
    Remove-Item Env:MASHUP_REFRESH_LAUNCHER -ErrorAction SilentlyContinue
  }
}
Update-App

# YouTube changes how it serves audio every few weeks, so a pinned yt-dlp goes
# stale. Refreshing on every start keeps it working.
if ($env:MASHUP_UPDATE -ne '0') {
  Write-Host '  checking yt-dlp is current...'
  & $Uv pip install --quiet --python $Py --upgrade 'yt-dlp[default]' deno 2>&1 | Out-Null
}

Set-Location (Join-Path $Root 'app')
Write-Host ''
Write-Host '  Your browser will open by itself when it is ready.'
Write-Host '  If it does not, open the http://127.0.0.1:... link printed below'
Write-Host '  (usually http://127.0.0.1:8765) in any browser.'
Write-Host '  To stop it: close this window, or press Ctrl+C.'
& $Py main.py @args
'@
  $body = $body.Replace('__ROOT__', (Quote $Root)).Replace('__REPO__', (Quote $Repo)).Replace('__REF__', (Quote $Ref))
  $tmp = Join-Path $Root 'launch.ps1.tmp'
  Write-Utf8Bom $tmp $body
  Move-Item -Force $tmp (Join-Path $Root 'launch.ps1')
}

function New-Shortcut($path, $iconPath) {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $ps
  $lnk.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Root 'launch.ps1') + '"'
  $lnk.WorkingDirectory = $Root
  $lnk.Description = 'Make mashups from song links'
  if ($iconPath -and (Test-Path $iconPath)) { $lnk.IconLocation = "$iconPath,0" }
  else { $lnk.IconLocation = (Join-Path $env:SystemRoot 'System32\imageres.dll') + ',103' }
  $lnk.Save()
}

function Install-Shortcuts {
  $icon = Join-Path $Root 'icon.ico'
  $null = Run $Py (Join-Path $App 'make_icon.py') $Root
  $startLnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Mashup Deck.lnk'
  $deskLnk  = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Mashup Deck.lnk'
  New-Shortcut $startLnk $icon
  New-Shortcut $deskLnk $icon

  # the uninstaller, and an entry in Settings > Apps that runs it (per user,
  # so no admin rights are needed). PowerShell reads a script whole before
  # running it, so it can delete the folder it sits in.
  $un = @'
# Removes Mashup Deck from this computer. Written by install.ps1.
$ErrorActionPreference = 'SilentlyContinue'
Write-Host ''
Write-Host '  Removing Mashup Deck...'
Set-Location $env:TEMP
Remove-Item -Force __START__, __DESK__
Remove-Item -Recurse -Force 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MashupDeck'
Remove-Item -Recurse -Force __ROOT__
Write-Host '  Done. Mashup Deck is gone from this computer.'
Write-Host '  (mp3s you saved are still in your Downloads folder.)'
Write-Host ''
Start-Sleep -Seconds 4
'@
  $un = $un.Replace('__START__', (Quote $startLnk)).Replace('__DESK__', (Quote $deskLnk)).Replace('__ROOT__', (Quote $Root))
  $unPath = Join-Path $Root 'uninstall.ps1'
  Write-Utf8Bom $unPath $un
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MashupDeck'
  try {
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name DisplayName -Value 'Mashup Deck'
    Set-ItemProperty -Path $key -Name Publisher -Value 'laksh-ya'
    Set-ItemProperty -Path $key -Name DisplayIcon -Value $icon
    Set-ItemProperty -Path $key -Name InstallLocation -Value $Root
    Set-ItemProperty -Path $key -Name UninstallString -Value ('"' + $ps + '" -NoProfile -ExecutionPolicy Bypass -File "' + $unPath + '"')
    Set-ItemProperty -Path $key -Name NoModify -Value 1 -Type DWord
    Set-ItemProperty -Path $key -Name NoRepair -Value 1 -Type DWord
  } catch {}
}

function Show-InstallDone {
  Write-Host ''
  Rule
  Say 'Installed. Here is how to use it from now on:'
  Write-Host ''
  Say '1. Open it: click Start and type "Mashup Deck", or double-click'
  Say '   "Mashup Deck" on your Desktop. (To pin it: right-click it in'
  Say '   the Start menu > Pin to Start, or Pin to taskbar.)'
  Say '2. A PowerShell window opens along with your browser. That'
  Say '   window IS the app: leave it open while you use Mashup Deck.'
  Say '3. Done? Close that window. That stops it.'
  Write-Host ''
  Say "It runs only on this computer, at http://127.0.0.1:$PortHint"
  Say '(if that is busy it picks the next free port and prints it).'
  Say 'It updates itself (the app and yt-dlp) each time it starts.'
  Write-Host ''
  Say 'To remove it completely: Settings > Apps > Installed apps >'
  Say 'Mashup Deck > Uninstall. (Or delete the Desktop and Start menu'
  Say "shortcuts and the folder $Root)"
  Rule
}

function Show-OnceClosed {
  Write-Host ''
  Rule
  Say 'Mashup Deck is closed.'
  if (Test-Path $Root) {
    Say 'A few temporary files were still in use and could not be deleted.'
    Say 'They are removed the next time you run the command, or delete'
    Say "this folder yourself: $Root"
  } else {
    Say 'Cleaned up: the temporary folder it ran from is deleted, with'
    Say 'everything it downloaded. Nothing else was added to this computer.'
  }
  Say 'mp3s you saved from the browser stay in your Downloads folder.'
  Say 'You can close the browser tab now.'
  Say 'Liked it? Run the same command again and choose 2 to install it.'
  Rule
  Write-Host ''
}

function Start-App {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $env:MASHUP_UPDATE = '0'   # already fresh, skip the update check this time
  try { & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'launch.ps1') }
  finally { Remove-Item Env:MASHUP_UPDATE -ErrorAction SilentlyContinue }
}

# ── main ────────────────────────────────────────────────────────────────────
$saved = @{}
foreach ($n in 'UV_PYTHON_INSTALL_DIR', 'UV_CACHE_DIR') {
  $saved[$n] = [Environment]::GetEnvironmentVariable($n, 'Process')
}
$Mode = ''
try {
  if ($env:MASHUP_REFRESH_LAUNCHER -eq '1') {
    # called by an installed launcher after it updated itself
    $Root = if ($env:MASHUP_HOME) { $env:MASHUP_HOME } else { Join-Path $env:LOCALAPPDATA 'MashupDeck' }
    Write-Launcher
    return
  }

  Write-Host ''
  Write-Host '  Mashup Deck'
  Write-Host '  make mashups from song links'
  $machine = Get-Machine
  $IsArm = $machine.IsArm
  Say "Detected: $($machine.Label)"
  $Mode = Get-Mode

  if ($Mode -eq 'once') {
    # clear out what an earlier try-once left behind if its window was closed
    Get-ChildItem -Path $env:TEMP -Directory -Filter 'mashup-deck-once-*' -ErrorAction SilentlyContinue |
      ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    $Root = Join-Path $env:TEMP ('mashup-deck-once-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    Say 'Trying it once from a temporary folder'
  } else {
    $Root = if ($env:MASHUP_HOME) { $env:MASHUP_HOME } else { Join-Path $env:LOCALAPPDATA 'MashupDeck' }
    Say "Installing into $Root"
  }
  Write-Host ''

  $Tools = Join-Path $Root 'tools'
  $App   = Join-Path $Root 'app'
  $Venv  = Join-Path $Root '.venv'
  $Uv    = Join-Path $Tools 'uv.exe'
  $Py    = Join-Path $Venv 'Scripts\python.exe'
  $env:UV_PYTHON_INSTALL_DIR = Join-Path $Root 'python'
  $env:UV_CACHE_DIR = Join-Path $Root 'cache'
  New-Item -ItemType Directory -Force -Path $Tools | Out-Null

  Get-App
  Install-Python
  Install-Ffmpeg
  Say '[5/5] getting it ready to start'
  Write-Launcher

  if ($Mode -eq 'install') {
    Install-Shortcuts
    Show-InstallDone
    if ($env:MASHUP_NO_START) { Write-Host ''; Say 'Not starting it now (MASHUP_NO_START is set).'; Write-Host ''; return }
    Write-Host ''
    Say 'Starting it now...'
    Start-App
  } else {
    Write-Host ''
    Rule
    Say 'Starting it now. Your browser will open with Mashup Deck.'
    Say 'This window IS the app: leave it open while you use it.'
    Say 'When you are done: press Ctrl+C here. That also deletes'
    Say 'everything it downloaded, so nothing stays behind.'
    Rule
    Start-App
  }
} catch {
  $msg = $_.Exception.Message
  Write-Host ''
  if ($msg -like 'MASHUP: *') { Write-Host ('  ' + $msg.Substring(8)) -ForegroundColor Yellow }
  else { Write-Host "  Something went wrong: $msg" -ForegroundColor Yellow; Write-Host '  Run the same command again; if it keeps happening, send this message to whoever shared the app.' }
  Write-Host ''
} finally {
  if ($Mode -eq 'once' -and $Root) {
    Set-Location $env:TEMP
    for ($i = 0; $i -lt 10 -and (Test-Path $Root); $i++) {
      Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue
      if (Test-Path $Root) { Start-Sleep -Milliseconds 500 }
    }
    Show-OnceClosed
  }
  foreach ($n in $saved.Keys) { [Environment]::SetEnvironmentVariable($n, $saved[$n], 'Process') }
}
}
