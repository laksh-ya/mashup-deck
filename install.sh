#!/bin/sh
# Set up Mashup Deck on a Mac (or a Linux box) that has nothing installed.
#
#   curl -fsSL https://<your-url>/install.sh | sh
#
# Why a pasted command rather than a download: a file that arrives through a
# browser gets tagged, and macOS then refuses to open it with a warning that
# reads like a virus alert. Nothing fetched by curl is tagged, and nothing this
# script writes is tagged either, so the launcher it leaves on the Desktop just
# opens. No signing, no Developer Program, no "unidentified developer".
#
# Nothing here touches the system: no Homebrew, no system Python, no PATH edits,
# no sudo. Everything lands in one folder that can be deleted in one go.
#
# Deliberately not using git: `git` on a stock Mac is a stub that pops the Xcode
# Command Line Tools installer, which is exactly the kind of dialog we are
# avoiding. curl and tar are really there.

set -e

# Where the app is fetched from. A private repo cannot be curled, so this needs
# to point at something public: a public repo, or a release asset, or any host
# serving the tarball. Override to test: SOURCE_URL=... or SOURCE_DIR=...
SOURCE_URL="${SOURCE_URL:-https://codeload.github.com/laksh-ya/mashup-deck/tar.gz/refs/heads/main}"

ROOT="${MASHUP_HOME:-$HOME/.mashup-deck}"
TOOLS="$ROOT/tools"
APP="$ROOT/app"
VENV="$ROOT/.venv"
PYTHON_VERSION="3.11"

say() { printf '%s\n' "$*"; }
die() { printf '\n%s\n' "$*" >&2; exit 1; }

# OS is how we talk about it; FF_OS is what the ffmpeg release calls it
case "$(uname -s)" in
  Darwin) OS=mac;   FF_OS=darwin ;;
  Linux)  OS=linux; FF_OS=linux ;;
  *) die "This installer is for macOS and Linux. On Windows, use install.ps1" ;;
esac

case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=x64 ;;
  *) die "Unsupported processor: $(uname -m)" ;;
esac

say ""
say "  Mashup Deck"
say "  installing into $ROOT"
say ""

mkdir -p "$TOOLS" "$APP"

# ── the app itself ──────────────────────────────────────────────────────────
if [ -n "$SOURCE_DIR" ]; then
  say "  [1/4] copying the app from $SOURCE_DIR"
  # -R with a trailing dot copies contents, not the folder itself
  rm -rf "$APP"
  mkdir -p "$APP"
  (cd "$SOURCE_DIR" && tar cf - \
      --exclude .git --exclude .venv --exclude downloads --exclude outputs \
      --exclude __pycache__ .) | (cd "$APP" && tar xf -)
else
  say "  [1/4] fetching the app"
  curl -fsSL "$SOURCE_URL" -o "$ROOT/app.tar.gz" \
    || die "Could not download the app from $SOURCE_URL
If that repo is private, curl cannot see it. Make it public or host the tarball."
  rm -rf "$APP"
  mkdir -p "$APP"
  # GitHub tarballs nest everything under one folder, hence strip-components
  tar xzf "$ROOT/app.tar.gz" -C "$APP" --strip-components=1
  rm -f "$ROOT/app.tar.gz"
fi

[ -f "$APP/main.py" ] || die "That did not look like the app: no main.py in $APP"

# ── python, without touching the system python ──────────────────────────────
# uv is a single static binary that can install its own CPython, which keeps us
# away from the system python (missing on Windows, and on a Mac it is another
# Command Line Tools prompt waiting to happen).
if [ ! -x "$TOOLS/uv" ]; then
  say "  [2/4] installing a private copy of Python"
  curl -fsSL https://astral.sh/uv/install.sh \
    | env UV_INSTALL_DIR="$TOOLS" UV_NO_MODIFY_PATH=1 INSTALLER_NO_MODIFY_PATH=1 sh >/dev/null \
    || die "Could not install uv"
else
  say "  [2/4] Python is already here"
fi

# --clear so running the installer twice repairs rather than fails: uv refuses to
# reuse an existing environment, and "run it again" is the first thing anyone
# tries when something went wrong.
"$TOOLS/uv" venv --clear --python "$PYTHON_VERSION" "$VENV" >/dev/null \
  || die "Could not create the environment"

"$TOOLS/uv" pip install --quiet --python "$VENV/bin/python" -r "$APP/requirements.txt" \
  || die "Could not install the app's dependencies"

# ── ffmpeg, the one thing pip cannot provide ────────────────────────────────
# pydub is a wrapper around ffmpeg, and yt-dlp needs ffprobe as well as ffmpeg
# to turn what it downloads into mp3. Static single-file builds, so there is no
# Homebrew (a 400MB dependency) in the picture.
FF_BASE="https://github.com/eugeneware/ffmpeg-static/releases/latest/download"
if [ -x "$TOOLS/ffmpeg" ] && [ -x "$TOOLS/ffprobe" ]; then
  say "  [3/4] ffmpeg is already here"
else
  say "  [3/4] installing ffmpeg"
  for tool in ffmpeg ffprobe; do
    curl -fsSL "$FF_BASE/$tool-$FF_OS-$ARCH.gz" -o "$TOOLS/$tool.gz" \
      || die "Could not download $tool for $FF_OS-$ARCH"
    gunzip -f "$TOOLS/$tool.gz"
    chmod +x "$TOOLS/$tool"
    # Apple Silicon refuses to run an unsigned binary at all: it dies with
    # "Killed: 9" and no explanation. An ad-hoc signature is enough, and
    # /usr/bin/codesign is on a stock Mac, unlike git.
    if [ "$OS" = mac ]; then
      codesign --force --sign - "$TOOLS/$tool" >/dev/null 2>&1 || true
    fi
  done
fi

"$TOOLS/ffmpeg" -version >/dev/null 2>&1 || die "ffmpeg was installed but will not run"

# ── the launcher ────────────────────────────────────────────────────────────
# Written here rather than shipped, so the OS sees a local file the user made
# rather than something downloaded. That is the whole trick: no warning.
if [ "$OS" = mac ] && [ -d "$HOME/Desktop" ]; then
  LAUNCHER="$HOME/Desktop/Mashup Deck.command"
else
  LAUNCHER="$ROOT/mashup-deck.command"
fi

say "  [4/4] putting a launcher on the Desktop"

cat > "$LAUNCHER" <<LAUNCHER_EOF
#!/bin/sh
# Double-click to open Mashup Deck. Close this window to stop it.
# Everything below is one line of real work; main.py does the rest.
ROOT="$ROOT"
export PATH="\$ROOT/tools:\$PATH"
cd "\$ROOT/app"

clear
printf '\n  Mashup Deck is starting up...\n\n'

# YouTube changes how it serves audio every few weeks, so a pinned yt-dlp goes
# stale and stops downloading. Refreshing it on every start is what keeps this
# working months from now with nobody doing anything. No network, no problem.
"\$ROOT/tools/uv" pip install --quiet --python "\$ROOT/.venv/bin/python" \\
  --upgrade yt-dlp >/dev/null 2>&1 || true

exec "\$ROOT/.venv/bin/python" main.py
LAUNCHER_EOF

chmod +x "$LAUNCHER"

say ""
say "  Done."
say ""
say "  Double-click \"$(basename "$LAUNCHER")\" on your Desktop to start."
say "  To remove it: delete that file and the folder $ROOT"
say ""
