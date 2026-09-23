#!/bin/sh
# Mashup Deck, one command, nothing needed beforehand.
#
#   curl -fsSL https://raw.githubusercontent.com/laksh-ya/mashup-deck/main/install.sh | sh
#
# The README's universal command (the same line for Mac, Linux and Windows
# PowerShell) ends up running exactly this on Mac and Linux.
#
# What it does:
#   - works out what machine this is (and asks if it cannot tell)
#   - asks whether you want to try it once or install it
#   - fetches everything itself: the app, a private Python (uv), static ffmpeg,
#     and deno (the JavaScript runtime yt-dlp now needs for YouTube)
#   - prints the steps for your machine, at the moment you need them
#   - opens the app in your browser at the end
#
# Why a pasted command rather than a download: a file that arrives through a
# browser gets tagged, and macOS then refuses to open it with a warning that
# reads like a virus alert. curl does not add that tag, and the launcher this
# script writes is a local file you made, so it normally just opens. If a Mac
# does complain anyway, the script tells you exactly where to click.
#
# Nothing here touches the system: no Homebrew, no system Python, no PATH edits,
# no sudo. Everything lands in one folder that can be deleted in one go.
#
# Deliberately not using git: `git` on a stock Mac is a stub that pops the Xcode
# Command Line Tools installer. curl and tar are really there.
#
# Knobs, all optional (mostly for testing):
#   MASHUP_MODE=once|install   skip the question
#   MASHUP_HOME=/path          install somewhere other than ~/.mashup-deck
#   MASHUP_REF=branch          which branch of the repo to install and follow
#   MASHUP_NO_START=1          install but do not start it at the end
#   SOURCE_DIR=/path           use a local checkout instead of downloading
#
# Everything is inside functions and `main` runs on the last line. That matters
# for `curl | sh`: the shell reads this script from the pipe, so nothing may run
# until the whole script has arrived, and the questions have to be read from the
# terminal (/dev/tty) rather than from the pipe. Same trick rustup uses.

REPO="laksh-ya/mashup-deck"
REF="${MASHUP_REF:-main}"
PYTHON_VERSION="3.11"
PORT_HINT="8765"

say()  { printf '%s\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die()  { printf '\n  %s\n\n' "$*" >&2; exit 1; }
rule() { printf '  %s\n' "------------------------------------------------------------"; }

HAVE_TTY=0

# ask "question" default -> answer in $REPLY. Without a terminal, the default.
ask() {
  if [ "$HAVE_TTY" = 1 ]; then
    printf '  %s ' "$1" >/dev/tty
    IFS= read -r REPLY </dev/tty || REPLY=""
  else
    REPLY=""
  fi
  [ -n "$REPLY" ] || REPLY="$2"
}

# ── what machine is this ────────────────────────────────────────────────────
detect() {
  OS=""
  case "$(uname -s 2>/dev/null)" in
    Darwin) OS=mac ;;
    Linux)
      if [ -n "$TERMUX_VERSION" ] || [ -d /data/data/com.termux ] \
         || [ "$(uname -o 2>/dev/null)" = Android ]; then
        OS=android
      elif grep -qi microsoft /proc/version 2>/dev/null; then
        OS=wsl
      else
        OS=linux
      fi ;;
    MINGW*|MSYS*|CYGWIN*) OS=windows ;;
  esac

  case "$(uname -m 2>/dev/null)" in
    arm64|aarch64) ARCH=arm64 ;;
    x86_64|amd64)  ARCH=x64 ;;
    *)             ARCH="" ;;
  esac

  if [ -z "$OS" ]; then
    say ""
    note "I could not tell what kind of computer this is ($(uname -s 2>/dev/null))."
    note "  1) Mac"
    note "  2) Linux"
    note "  3) Windows"
    note "  4) Something else"
    ask "Which one? [1-4]:" ""
    case "$REPLY" in
      1) OS=mac ;; 2) OS=linux ;; 3) OS=windows ;;
      *) die "Sorry, this only runs on Mac, Linux and Windows for now." ;;
    esac
  fi

  if [ -z "$ARCH" ]; then
    note "I could not tell what processor this is ($(uname -m 2>/dev/null))."
    note "  1) Apple Silicon / ARM"
    note "  2) Intel / AMD (x86-64)"
    ask "Which one? [1/2]:" ""
    case "$REPLY" in
      1) ARCH=arm64 ;; 2) ARCH=x64 ;;
      *) die "Sorry, only ARM and x86-64 processors are supported." ;;
    esac
  fi

  case "$OS" in
    windows)
      die "This is a Unix-style window on Windows (Git Bash or similar).
  Windows needs PowerShell instead:
    1. Close this window.
    2. Open the Start menu, type PowerShell, press Enter.
    3. Paste the same command there and press Enter." ;;
    android)
      die "This looks like an Android phone. The phone version is not ready yet.
  For now, run this command on a laptop (Mac, Windows or Linux)." ;;
  esac

  # a Linux box with no screen cannot open a browser for you
  HEADLESS=0
  if [ "$OS" = linux ] && [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
    HEADLESS=1
  fi

  case "$OS" in
    mac)   FF_OS=darwin; LABEL="Mac" ;;
    wsl)   FF_OS=linux;  LABEL="Linux inside Windows (WSL)" ;;
    linux) FF_OS=linux;  LABEL="Linux" ;;
  esac
  [ "$ARCH" = arm64 ] && [ "$OS" = mac ] && LABEL="Mac (Apple Silicon)"
  [ "$ARCH" = x64 ]   && [ "$OS" = mac ] && LABEL="Mac (Intel)"
}

choose_mode() {
  MODE="${MASHUP_MODE:-}"
  if [ -z "$MODE" ]; then
    if [ "$HAVE_TTY" = 1 ]; then
      say ""
      note "How do you want to use it?"
      note ""
      note "  1) Try it once   runs now from a temporary folder,"
      note "                   nothing is left behind when you close it"
      case "$OS" in
      wsl)
      note "  2) Install it    keeps it on this machine with a start command," ;;
      mac)
      note "  2) Install it    adds a Mashup Deck app to Launchpad and your" 
      note "                   Applications folder, plus a Desktop icon," ;;
      *)
      note "  2) Install it    adds Mashup Deck to your apps menu and Desktop," ;;
      esac
      note "                   and it updates itself every time it starts"
      note ""
      ask "Choose 1 or 2 [2]:" 2
      case "$REPLY" in 1) MODE=once ;; *) MODE=install ;; esac
    else
      MODE=install
      note "(no terminal to ask in, so installing. MASHUP_MODE=once to just try it)"
    fi
  fi
  case "$MODE" in once|install) ;; *) die "MASHUP_MODE must be once or install" ;; esac
}

# ── the app itself ──────────────────────────────────────────────────────────
fetch_app() {
  rm -rf "$APP"; mkdir -p "$APP"
  if [ -n "$SOURCE_DIR" ]; then
    note "[1/5] copying the app from $SOURCE_DIR"
    (cd "$SOURCE_DIR" && tar cf - \
        --exclude .git --exclude .venv --exclude downloads --exclude outputs \
        --exclude __pycache__ .) | (cd "$APP" && tar xf -)
    printf 'local\n' > "$APP/.mashup-version"
  else
    note "[1/5] fetching the app"
    # Pin to the exact commit so the launcher can tell later whether it is stale.
    SHA=$(curl -fsS --max-time 10 -H 'Accept: application/vnd.github.sha' \
          "https://api.github.com/repos/$REPO/commits/$REF" 2>/dev/null) || SHA=""
    case "$SHA" in *[!0-9a-f]*|"") SHA="" ;; esac
    url="https://codeload.github.com/$REPO/tar.gz/${SHA:-$REF}"
    curl -fsSL "$url" -o "$ROOT/app.tar.gz" \
      || die "Could not download the app from $url
  Check the internet connection and run the command again."
    # GitHub tarballs nest everything under one folder, hence strip-components
    tar xzf "$ROOT/app.tar.gz" -C "$APP" --strip-components=1
    rm -f "$ROOT/app.tar.gz"
    printf '%s\n' "${SHA:-unknown}" > "$APP/.mashup-version"
  fi
  [ -f "$APP/main.py" ] || die "That did not look like the app: no main.py in $APP"
}

# ── python, without touching the system python ──────────────────────────────
# uv is a single static binary that installs its own CPython. Its Python and its
# cache are pointed inside our folder too, so deleting the folder really removes
# everything (by default uv would keep them under ~/.local and ~/.cache).
setup_python() {
  if [ ! -x "$TOOLS/uv" ]; then
    note "[2/5] installing a private copy of Python"
    # the release tarball straight from GitHub, rather than uv's own installer
    # script, which would also drop a receipt file in ~/.config/uv
    case "$OS-$ARCH" in
      mac-arm64) UV_TARGET=aarch64-apple-darwin ;;
      mac-x64)   UV_TARGET=x86_64-apple-darwin ;;
      *-arm64)   UV_TARGET=aarch64-unknown-linux-gnu ;;
      *)         UV_TARGET=x86_64-unknown-linux-gnu ;;
    esac
    curl -fsSL "https://github.com/astral-sh/uv/releases/latest/download/uv-$UV_TARGET.tar.gz" \
      | tar xzf - -C "$TOOLS" --strip-components=1 2>/dev/null
    [ -x "$TOOLS/uv" ] \
      || die "Could not install uv (the Python manager). Check the internet and try again."
  else
    note "[2/5] Python is already here"
  fi
  # --clear so running the installer twice repairs rather than fails
  "$TOOLS/uv" venv --quiet --clear --python "$PYTHON_VERSION" "$VENV" >/dev/null 2>&1 \
    || die "Could not set up Python"
  note "[3/5] installing the app's libraries and deno"
  # yt-dlp[default] brings yt-dlp-ejs, the solver for YouTube's JavaScript
  # challenge, and the deno package puts a deno binary in the environment.
  # Without a JS runtime YouTube increasingly refuses to hand over audio.
  "$TOOLS/uv" pip install --quiet --python "$VENV/bin/python" \
      -r "$APP/requirements.txt" "yt-dlp[default]" deno \
    || die "Could not install the app's libraries"
  # requirements.txt pins yt-dlp as a fallback floor; start on the current one
  "$TOOLS/uv" pip install --quiet --python "$VENV/bin/python" \
      --upgrade "yt-dlp[default]" deno >/dev/null 2>&1 || true
  "$VENV/bin/deno" --version >/dev/null 2>&1 || die "deno was installed but will not run"
}

# ── ffmpeg, the one thing pip cannot provide ────────────────────────────────
setup_ffmpeg() {
  FF_BASE="https://github.com/eugeneware/ffmpeg-static/releases/latest/download"
  if [ -x "$TOOLS/ffmpeg" ] && [ -x "$TOOLS/ffprobe" ]; then
    note "[4/5] ffmpeg is already here"
  else
    note "[4/5] installing ffmpeg"
    for tool in ffmpeg ffprobe; do
      curl -fsSL "$FF_BASE/$tool-$FF_OS-$ARCH.gz" -o "$TOOLS/$tool.gz" \
        || die "Could not download $tool for $FF_OS-$ARCH"
      gunzip -f "$TOOLS/$tool.gz"
      chmod +x "$TOOLS/$tool"
      # Apple Silicon kills an unsigned binary with "Killed: 9" and no
      # explanation. An ad-hoc signature is enough; codesign is on a stock Mac.
      if [ "$OS" = mac ]; then
        codesign --force --sign - "$TOOLS/$tool" >/dev/null 2>&1 || true
      fi
    done
  fi
  if ! "$TOOLS/ffmpeg" -version >/dev/null 2>&1; then
    if [ "$OS" = mac ]; then
      die "ffmpeg was downloaded but macOS will not run it.
  Open System Settings > Privacy & Security, scroll down, click
  \"Open Anyway\" next to ffmpeg, then run the same command again."
    fi
    die "ffmpeg was installed but will not run"
  fi
}

# ── the launcher ────────────────────────────────────────────────────────────
# Written here rather than shipped, so the OS sees a local file the user made.
# It updates the app and yt-dlp, then starts it. Every step is allowed to fail
# quietly: no network means you just get the copy you already have.
write_launch_script() {
  # Written to a temp file and moved into place: a running launcher may be the
  # one asking for this, and overwriting a script a shell is reading corrupts it.
  L="$ROOT/launch.sh.tmp"
  cat > "$L" <<LAUNCH_EOF
#!/bin/sh
# Starts Mashup Deck. Written by install.sh; running install.sh again rewrites it.
ROOT="$ROOT"
REPO="$REPO"
REF="$REF"
LAUNCH_EOF
  cat >> "$L" <<'LAUNCH_EOF'
UV="$ROOT/tools/uv"
PY="$ROOT/.venv/bin/python"
export UV_PYTHON_INSTALL_DIR="$ROOT/python" UV_CACHE_DIR="$ROOT/cache"
export UV_HTTP_TIMEOUT=15
export PATH="$ROOT/tools:$ROOT/.venv/bin:$PATH"
# scratch files outside the app folder, so an update can swap the app freely
export DATA_DIR="$ROOT/data"
export PYTHONUNBUFFERED=1
# WSL has no browser of its own: hand the link to Windows
if grep -qi microsoft /proc/version 2>/dev/null && [ -z "$BROWSER" ]; then
  if command -v wslview >/dev/null 2>&1; then export BROWSER=wslview
  else export BROWSER=explorer.exe; fi
fi

printf '\n  Mashup Deck is starting up...\n'

# 1. the app itself: compare our commit with the repo's, fetch if different
update_app() {
  [ "${MASHUP_UPDATE:-1}" = 1 ] || return 0
  mine=$(cat "$ROOT/app/.mashup-version" 2>/dev/null)
  [ "$mine" = local ] && return 0
  latest=$(curl -fsS --max-time 5 -H 'Accept: application/vnd.github.sha' \
           "https://api.github.com/repos/$REPO/commits/$REF" 2>/dev/null) || return 0
  case "$latest" in *[!0-9a-f]*|"") return 0 ;; esac
  [ "$latest" = "$mine" ] && return 0
  printf '  getting the latest version...\n'
  new="$ROOT/app.new"
  rm -rf "$new"; mkdir -p "$new"
  if ! curl -fsSL --max-time 60 "https://codeload.github.com/$REPO/tar.gz/$latest" \
       | tar xzf - -C "$new" --strip-components=1 2>/dev/null \
     || [ ! -f "$new/main.py" ]; then
    rm -rf "$new"; return 0
  fi
  if ! cmp -s "$new/requirements.txt" "$ROOT/app/requirements.txt"; then
    "$UV" pip install --quiet --python "$PY" -r "$new/requirements.txt" >/dev/null 2>&1 \
      || { rm -rf "$new"; return 0; }
  fi
  printf '%s\n' "$latest" > "$new/.mashup-version"
  rm -rf "$ROOT/app.old"
  mv "$ROOT/app" "$ROOT/app.old" && mv "$new" "$ROOT/app" && rm -rf "$ROOT/app.old"
  # a newer installer may write a better launcher; use it from the next start
  # (only an installer that knows --refresh-launcher; an older one would treat
  # the call as a full reinstall)
  if grep -q -e '--refresh-launcher' "$ROOT/app/install.sh" 2>/dev/null; then
    MASHUP_HOME="$ROOT" MASHUP_REF="$REF" sh "$ROOT/app/install.sh" --refresh-launcher >/dev/null 2>&1 || true
  fi
}
update_app

# 2. yt-dlp and deno: YouTube changes how it serves audio every few weeks, so a
# pinned yt-dlp goes stale. Refreshing on every start keeps it working.
if [ "${MASHUP_UPDATE:-1}" = 1 ]; then
  printf '  checking yt-dlp is current...\n'
  "$UV" pip install --quiet --python "$PY" --upgrade "yt-dlp[default]" deno >/dev/null 2>&1 || true
fi

cd "$ROOT/app" || exit 1
if [ "$MASHUP_NO_BROWSER" = 1 ]; then
  printf '\n  When it is ready, open the http://127.0.0.1:... link printed below\n'
  printf '  (usually http://127.0.0.1:8765) in a browser on this machine.\n'
else
  printf '\n  Your browser will open by itself when it is ready.\n'
  printf '  If it does not, open the http://127.0.0.1:... link printed below\n'
  printf '  (usually http://127.0.0.1:8765) in any browser.\n'
fi
printf '  To stop it: close this window, or press Ctrl+C.\n'
exec "$PY" main.py "$@"
LAUNCH_EOF
  chmod +x "$L"
  mv -f "$L" "$ROOT/launch.sh"
}

desktop_dir() {
  d=""
  if command -v xdg-user-dir >/dev/null 2>&1; then d=$(xdg-user-dir DESKTOP 2>/dev/null); fi
  [ -n "$d" ] && [ "$d" != "$HOME" ] || d="$HOME/Desktop"
  printf '%s' "$d"
}

write_launchers() {
  LAUNCHER=""; MENU_ENTRY=""; MAC_APP=""
  case "$OS" in
    mac)
      # the .command is what actually runs, in a Terminal window: that window
      # is the app, and closing it stops it
      cat > "$ROOT/Mashup Deck.command" <<CMD_EOF
#!/bin/sh
# Double-click to open Mashup Deck. Close this window to stop it.
clear
exec sh "$ROOT/launch.sh"
CMD_EOF
      chmod +x "$ROOT/Mashup Deck.command"
      mkdir -p "$HOME/Desktop"
      LAUNCHER="$HOME/Desktop/Mashup Deck.command"
      cp "$ROOT/Mashup Deck.command" "$LAUNCHER" && chmod +x "$LAUNCHER"
      write_mac_app
      ;;
    linux)
      entry="[Desktop Entry]
Type=Application
Name=Mashup Deck
Comment=Make mashups from song links
Exec=sh \"$ROOT/launch.sh\"
Icon=$ROOT/icon.png
Terminal=true
Categories=AudioVideo;Audio;"
      apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
      mkdir -p "$apps"
      MENU_ENTRY="$apps/mashup-deck.desktop"
      printf '%s\n' "$entry" > "$MENU_ENTRY"
      chmod +x "$MENU_ENTRY"
      desk=$(desktop_dir)
      if [ -d "$desk" ]; then
        LAUNCHER="$desk/mashup-deck.desktop"
        printf '%s\n' "$entry" > "$LAUNCHER"
        chmod +x "$LAUNCHER"
        # GNOME only runs Desktop icons it has been told to trust
        gio set "$LAUNCHER" metadata::trusted true >/dev/null 2>&1 || true
      fi
      ;;
  esac
  # the plain command works everywhere, and is the only launcher on WSL
  cat > "$ROOT/mashup-deck" <<CMD_EOF
#!/bin/sh
exec sh "$ROOT/launch.sh" "\$@"
CMD_EOF
  chmod +x "$ROOT/mashup-deck"
}

# The app gets a real Mac app in Launchpad and Applications. It is a tiny
# bundle whose only job is to open the .command above in Terminal. Built here,
# on this machine, so macOS does not treat it as something downloaded.
write_mac_app() {
  APPS_DIR="/Applications"
  [ -w "$APPS_DIR" ] || APPS_DIR="$HOME/Applications"
  MAC_APP="$APPS_DIR/Mashup Deck.app"
  rm -rf "$MAC_APP"
  mkdir -p "$MAC_APP/Contents/MacOS" "$MAC_APP/Contents/Resources" || { MAC_APP=""; return 0; }
  cat > "$MAC_APP/Contents/Info.plist" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Mashup Deck</string>
  <key>CFBundleDisplayName</key><string>Mashup Deck</string>
  <key>CFBundleIdentifier</key><string>com.laksh-ya.mashup-deck</string>
  <key>CFBundleExecutable</key><string>mashup-deck</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
</dict>
</plist>
PLIST_EOF
  cat > "$MAC_APP/Contents/MacOS/mashup-deck" <<APP_EOF
#!/bin/sh
exec open -a Terminal "$ROOT/Mashup Deck.command"
APP_EOF
  chmod +x "$MAC_APP/Contents/MacOS/mashup-deck"
  [ -f "$ROOT/icon.icns" ] && cp "$ROOT/icon.icns" "$MAC_APP/Contents/Resources/icon.icns"
  # nudge Launchpad and Spotlight to notice it now rather than later
  touch "$MAC_APP"
  LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  [ -x "$LSREG" ] && "$LSREG" -f "$MAC_APP" >/dev/null 2>&1 || true
}

# icon.png / icon.icns / icon.ico drawn by the app's own Python, no downloads
make_icon() {
  if [ -f "$APP/make_icon.py" ]; then
    "$VENV/bin/python" "$APP/make_icon.py" "$ROOT" >/dev/null 2>&1 || true
  fi
}

# one file that removes everything this installer added
write_uninstaller() {
  U="$ROOT/uninstall.sh"
  {
    printf '#!/bin/sh\n# Removes Mashup Deck from this computer. Written by install.sh.\n'
    printf 'printf "\\n  Removing Mashup Deck...\\n"\n'
    [ -n "$MAC_APP" ]    && printf 'rm -rf "%s"\n' "$MAC_APP"
    [ -n "$LAUNCHER" ]   && printf 'rm -f "%s"\n' "$LAUNCHER"
    [ -n "$MENU_ENTRY" ] && printf 'rm -f "%s"\n' "$MENU_ENTRY"
    printf 'rm -rf "%s"\n' "$ROOT"
    printf 'printf "  Done. Mashup Deck is gone from this computer.\\n"\n'
    printf 'printf "  (mp3s you saved are still in your Downloads folder.)\\n\\n"\n'
  } > "$U"
  chmod +x "$U"
}

# ── what to tell the person, for this machine only ──────────────────────────
tell_install_done() {
  say ""
  rule
  note "Installed. Here is how to use it from now on:"
  say ""
  case "$OS" in
    mac)
      if [ -n "$MAC_APP" ]; then
        note "1. Open it: click Mashup Deck in Launchpad, or in your"
        note "   $( [ "$APPS_DIR" = /Applications ] && echo 'Applications folder' || echo 'Applications folder (the one in your home folder)'),"
        note "   or double-click \"Mashup Deck\" on your Desktop."
        note "   To keep it in the Dock: open it, then right-click its Dock"
        note "   icon > Options > Keep in Dock."
      else
        note "1. Open it: double-click \"Mashup Deck\" on your Desktop."
      fi
      note "2. A Terminal window opens along with your browser. That window"
      note "   IS the app: leave it open while you use Mashup Deck."
      note "3. Done? Close that Terminal window. That stops it."
      say ""
      note "If macOS says it \"cannot be opened\" or \"cannot verify\" it:"
      note "  System Settings > Privacy & Security, scroll down,"
      note "  click \"Open Anyway\" next to Mashup Deck, then confirm."
      note "  (Or right-click it > Open > Open.) Only needed once."
      ;;
    linux)
      if [ -n "$LAUNCHER" ]; then
        note "1. Open it: \"Mashup Deck\" on your Desktop, or search"
        note "   \"Mashup Deck\" in your apps menu."
      else
        note "1. Open it: search \"Mashup Deck\" in your apps menu."
      fi
      note "   Or from a terminal:  $ROOT/mashup-deck"
      note "2. A terminal window opens along with your browser. That window"
      note "   IS the app: leave it open while you use Mashup Deck."
      note "3. Done? Close that window (or press Ctrl+C in it)."
      if [ -n "$LAUNCHER" ]; then
        say ""
        case "${XDG_CURRENT_DESKTOP:-}" in
          *GNOME*|*Unity*|*ubuntu*)
            note "If the Desktop icon shows a red cross or will not open:"
            note "  right-click it > Allow Launching." ;;
          *KDE*)
            note "If KDE asks what to do with it, choose Execute / Continue." ;;
          *)
            note "If the Desktop icon will not open: right-click it and look for"
            note "  \"Allow Launching\" or \"Trust\"." ;;
        esac
      fi
      ;;
    wsl)
      note "1. Open it: run this in your WSL terminal:"
      note "     $ROOT/mashup-deck"
      note "   It opens in your normal Windows browser."
      note "2. Done? Press Ctrl+C in that terminal."
      ;;
  esac
  say ""
  note "It runs only on this computer, at http://127.0.0.1:$PORT_HINT"
  note "(if that is busy it picks the next free port and prints it)."
  note "It updates itself (the app and yt-dlp) each time it starts."
  say ""
  note "To remove it completely, paste this in a terminal:"
  note "  sh \"$ROOT/uninstall.sh\""
  rule
}

# try-once: say what was cleaned up, and check it really is gone
tell_once_closed() {
  rm -rf "$ROOT" 2>/dev/null
  {
    printf '\n'
    rule
    note "Mashup Deck is closed."
    if [ -e "$ROOT" ]; then
      note "Some temporary files could not be deleted. Remove them with:"
      note "  rm -rf \"$ROOT\""
    else
      note "Cleaned up: the temporary folder it ran from is deleted, with"
      note "everything it downloaded. Nothing else was added to this computer."
    fi
    note "mp3s you saved from the browser stay in your Downloads folder."
    note "You can close the browser tab now."
    note "Liked it? Run the same command again and choose 2 to install it."
    rule
    printf '\n'
  } 2>/dev/null
}

tell_browser_notes() {
  if [ "$HEADLESS" = 1 ]; then
    export MASHUP_NO_BROWSER=1
    note "No screen detected, so I will not try to open a browser."
  fi
}

main() {
  if [ "$1" = "--refresh-launcher" ]; then
    # called by an installed launcher after it updated itself
    ROOT="${MASHUP_HOME:-$HOME/.mashup-deck}"
    [ -x "$ROOT/tools/uv" ] || exit 1
    write_launch_script
    exit 0
  fi

  if (exec </dev/tty) 2>/dev/null && [ -t 1 ]; then HAVE_TTY=1; fi
  [ -n "$MASHUP_NO_ASK" ] && HAVE_TTY=0

  say ""
  say "  Mashup Deck"
  say "  make mashups from song links"
  detect
  note "Detected: $LABEL"
  choose_mode

  if [ "$MODE" = once ]; then
    ROOT=$(mktemp -d "${TMPDIR:-/tmp}/mashup-deck.XXXXXX") || die "Could not make a temporary folder"
    # everything goes when this run ends, however it ends
    # (HUP is the Terminal window being closed)
    trap tell_once_closed EXIT
    trap 'exit 130' INT TERM HUP
    note "Trying it once from $ROOT"
  else
    ROOT="${MASHUP_HOME:-$HOME/.mashup-deck}"
    note "Installing into $ROOT"
  fi
  say ""

  TOOLS="$ROOT/tools"; APP="$ROOT/app"; VENV="$ROOT/.venv"
  export UV_PYTHON_INSTALL_DIR="$ROOT/python" UV_CACHE_DIR="$ROOT/cache"
  mkdir -p "$TOOLS" "$APP"

  fetch_app
  setup_python
  setup_ffmpeg

  note "[5/5] getting it ready to start"
  write_launch_script

  if [ "$MODE" = install ]; then
    make_icon
    write_launchers
    write_uninstaller
    tell_install_done
    if [ -n "$MASHUP_NO_START" ]; then
      say ""; note "Not starting it now (MASHUP_NO_START is set)."; say ""
      return 0
    fi
    say ""
    note "Starting it now..."
    tell_browser_notes
    # already fresh, skip the update check on this first start
    MASHUP_UPDATE=0 sh "$ROOT/launch.sh"
  else
    say ""
    rule
    note "Starting it now. Your browser will open with Mashup Deck."
    note "This window IS the app: leave it open while you use it."
    note "When you are done: press Ctrl+C here (or close this window)."
    note "Everything it downloaded gets deleted then, nothing stays behind."
    rule
    tell_browser_notes
    MASHUP_UPDATE=0 sh "$ROOT/launch.sh"
  fi
}

# Everything above has been read. Now run, with the terminal (not the pipe that
# carried this script) as input, so the app never eats the rest of the script.
if (exec </dev/tty) 2>/dev/null; then
  main "$@" </dev/tty
else
  main "$@" </dev/null
fi
