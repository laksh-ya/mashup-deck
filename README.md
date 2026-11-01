<!-- screenshots: drop hero.png here once you have one -->

<h1 align="center">Mashup Deck</h1>

<p align="center">
  Make mashups from song links.<br>
  Name a few songs, mark the part you want from each, get one mp3.
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#built-with">Built with</a> ·
  <a href="#run-it">Run it</a> ·
  <a href="#build-it-yourself">Build it yourself</a> ·
  <a href="DOCUMENTATION.md">Documentation</a>
</p>

---

## Features

### Two input modes

Plain text or rows. Switching modes keeps the current input, and each lookup
adds to the track list rather than replacing it.

```
Kesariya from 0:45 to 1:10
then youtu.be/4_eEgJhsBMo from 0:20 to 0:52
then instagram.com/reel/C8xYz12AbCd
then Levitating full
```

Song names are searched. Links work with or without `https://`, including
`youtu.be`, `watch?v=`, `/shorts/`, `/live/` and extra parameters, plus
Instagram reels and posts. A link copied at a moment (`?t=90`, `?t=1m30s`)
starts the clip there unless a range is written out. No times, or `full`, keeps
the whole track.

### Your own files

**Upload** or drop any audio or video file on the page. ffmpeg reads it into the
same mp3 a download would be, so it trims, levels and previews like any other
clip. Uploads stay on the deck as long as downloads do (`DOWNLOAD_TTL_MIN`).

### Trim and arrange

| | |
| --- | --- |
| **Drag to reorder** | Grab the ridged handle. Arrow keys work too. |
| **Draggable trim** | Pull either chrome handle, or slide the lit region to move the whole selection. Arrow keys nudge a second, shift jumps five. |
| **Preview** | Plays the exact slice before cutting: in YouTube's player, or the audio itself for reels and files. |
| **Volume per clip** | -12 to +12 dB on each clip. Double click resets it. |
| **Blend per join** | Each clip can set its own crossfade from the one before, or follow the mix. |
| **Live tally** | Clip count and true runtime, with every crossfade overlap subtracted. |
| **Add or remove** | Songs are added from the track list itself. |
| **Saved mixes** | Kept on this device (localStorage) with trims, levels and settings, and reopened in one tap. |

### Export

| | |
| --- | --- |
| **Even out volume** | Every clip is brought to the typical clip's average loudness, lifting quiet ones only as far as their peaks allow. On by default. |
| **Match tempo** | Each clip's tempo is estimated from its beat and nudged (pitch kept) onto the first one's, within 10 percent. Off by default. |
| **Fade in / out** | On the start and end of the whole mix. |
| **Format** | MP3, M4A or WAV, at 128 to 320 kbps. |

- Downloads run three at a time, so a long mix waits on the network once, not per song
- Progress reflects the actual backend steps, not a timer
- A blocked clip is skipped and named; the rest of the mix still exports
- The mix's name becomes the downloaded filename
- The player shows the song currently playing and marks the handover during a crossfade
- Each clip's span is drawn on the scrub bar from where the server actually put it, crossfade zones hatched
- Send shares the file itself, so it plays inside WhatsApp
- Trims can be edited and the mix exported again
- A failed export says why, rather than reporting a restart

### Ready-made mixes

Eight ready mixes. Shuffle picks one and loads it into the track list, where it
can be edited before exporting.

### Details

- **Sound** on every interaction, chosen semantically, with a mute that persists
- **Haptics** on phones, using patterns that match what happened
- **Three steps, one column**: add songs, choose the part of each, make the mix.
  Advanced settings wait under *More options* and *Adjust*
- **A colour per song**, on its trim bar and again on the finished mix's timeline
- **Light and dark**, following the system setting
- **Responsive from 320px up**, verified in a browser
- **Contrast at WCAG AA** for every text colour on every surface it sits on
- **Keyboard reachable**: reorder, trim, submit, play, close
- **Respects reduced motion**
- **The system font**, so type never waits on a download

---

## How it works

```
        browser                          server                      outside
  ┌───────────────────┐        ┌────────────────────────┐      ┌──────────────┐
  │ cue sheet         │        │                        │      │              │
  │  pad  or  form    │        │  parser.py             │      │              │
  └─────────┬─────────┘        │   regex, no LLM        │      │              │
            │  POST /api/parse │                        │      │              │
            ├─────────────────►│  text ──► clips        │      │              │
            │                  │                        │      │              │
            │ POST /api/resolve│  youtube.py            │      │   YouTube    │
            ├─────────────────►│   yt-dlp lookup   ─────┼─────►│   metadata   │
            │◄─────────────────┤   title, length, art   │      │              │
  ┌─────────┴─────────┐        │                        │      │              │
  │ track list        │        │                        │      │              │
  │  reorder, trim    │        │                        │      │              │
  └─────────┬─────────┘        │                        │      │              │
            │ POST /api/export │  background thread     │      │              │
            ├─────────────────►│   download each clip ──┼─────►│   audio      │
            │                  │   trim  (pydub)        │      │              │
            │  poll  /status   │   join  (crossfade)    │      └──────────────┘
            │◄────────────────►│   write one mp3        │
            │                  │                        │      ┌──────────────┐
            │  GET  /download  │  janitor.py            │      │   ffmpeg     │
            │◄─────────────────┤   sweeps the scratch   │◄─────┤   decode,    │
  ┌─────────┴─────────┐        │   folders on a timer   │      │   encode     │
  │ deck + player     │        │                        │      └──────────────┘
  │  play, share, mp3 │        └────────────────────────┘
  └───────────────────┘
```

### API

| method | route | does |
| --- | --- | --- |
| `POST` | `/api/parse` | plain text into structured clips |
| `POST` | `/api/resolve` | look up title, length and artwork |
| `POST` | `/api/upload?name=` | a file from this computer as the raw body, returns a clip |
| `GET` | `/api/source/{id}/audio` | a reel's or a file's audio, for previewing |
| `POST` | `/api/export` | start a cut, returns a job id |
| `GET` | `/api/export/{id}/status` | progress, what got skipped, where each clip landed |
| `GET` | `/api/export/{id}/download` | the mix, named from its title |
| `POST` | `/api/export/{id}/release` | bin that mix and its sources now |
| `GET` | `/api/health` | versions, job count, disk usage |

### Files

| path | does |
| --- | --- |
| `main.py` | routes, job tracker, filename handling, and `python3 main.py` to start it |
| `install.sh` / `install.ps1` | one command setup on a machine with nothing installed |
| `make_icon.py` | draws the app icon for the Mac app, Start menu and Linux launcher |
| `parser.py` | plain English into clips, regex only |
| `youtube.py` | yt-dlp lookups and downloads (YouTube and Instagram), retries, fallback clients, cookies |
| `audio.py` | trimming, levelling, tempo matching, crossfade merging, export formats, uploads |
| `janitor.py` | keeps the scratch folders from growing forever |
| `paths.py` | picks a writable scratch dir, falls back to temp |
| `static/js/app.js` | adding songs, the track list, the mix, the player, saved mixes |
| `static/js/sheet.js` | the rows editor |
| `static/js/dragsort.js` | drag and keyboard reordering |
| `static/js/presets.js` | the jukebox mixes, ids already resolved |

---

## Built with

| | |
| --- | --- |
| **Server** | FastAPI, Uvicorn |
| **Audio** | ffmpeg, pydub |
| **Sourcing** | yt-dlp |
| **Frontend** | plain ES modules, no framework, no build step |
| **Type** | the system font |
| **Sound** | [cuelume](https://cuelume-site.pages.dev) |
| **Haptics** | [web-haptics](https://haptics.lochie.me) |
| **Install** | one command, `uv` for Python, static ffmpeg |

No bundler, no node_modules, no CSS framework. The frontend is `index.html`,
one stylesheet and five ES modules.

---

## Run it

One command for Mac, Windows and Linux. No prerequisites.

1. Open a terminal:
   - **Mac:** Launchpad > type `Terminal` > Enter
   - **Windows:** Start > type `PowerShell` > Enter
   - **Linux:** open Terminal
2. Paste this line and press Enter:

```
${__md-$(curl -fsSL --proto-default https raw.githubusercontent.com/laksh-ya/mashup-deck/main/install.sh|sh >&2)};${__md+'}; irm https://raw.githubusercontent.com/laksh-ya/mashup-deck/main/install.ps1|iex #'}
```

3. The installer detects the system, then offers two modes:
   - **1) Try it once** - runs from a temporary folder. Everything it downloaded
     is deleted on close. On Windows, close it with Ctrl+C in its window; closing
     the window instead leaves the temporary folder until the next try-once run.
   - **2) Install it** - adds a Mashup Deck app: Launchpad and Applications on
     Mac, Start menu and Desktop on Windows, apps menu and Desktop on Linux.
     Updates itself on every start.
4. Mashup Deck opens in the browser. The terminal window is the app process:
   keep it open while in use, close it to stop.

Python, ffmpeg, deno and yt-dlp are downloaded into one private folder. No admin
password. Nothing is added to the system.

The command is a polyglot: Mac/Linux shells run the first half, PowerShell runs
the second. On Windows, use PowerShell, not Command Prompt.

Per-OS equivalents:

```bash
# Mac and Linux (Terminal)
curl -fsSL https://raw.githubusercontent.com/laksh-ya/mashup-deck/main/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/laksh-ya/mashup-deck/main/install.ps1 | iex
```

### Uninstall

The uninstaller removes the app, its private Python, ffmpeg and deno, and every
shortcut. Saved mixes in Downloads are kept.

**Mac**

1. Quit Mashup Deck (close its Terminal window).
2. Open Terminal: Launchpad > type `Terminal` > Enter.
3. Run:
   ```
   sh ~/.mashup-deck/uninstall.sh
   ```
4. Output ends with "Done. Mashup Deck is gone from this computer." Removed: the
   app in Applications and Launchpad, the Desktop icon, and `~/.mashup-deck`.
   A Dock icon, if pinned, has to be dragged off manually.

**Windows**

1. Close Mashup Deck (close its PowerShell window).
2. Start > type `Installed apps` > Enter (`Apps & features` on Windows 10).
3. Find **Mashup Deck**, click `...` next to it (or click the entry), then
   **Uninstall**.
4. A window shows "Removing Mashup Deck..." then "Done" and closes. Removed:
   Start menu and Desktop shortcuts, and the app folder.

If Mashup Deck is missing from that list, run in PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\MashupDeck\uninstall.ps1"
```

**Linux**

1. Close Mashup Deck (close its terminal window).
2. In a terminal, run:
   ```
   sh ~/.mashup-deck/uninstall.sh
   ```
3. Removed: the apps-menu entry, the Desktop icon, and `~/.mashup-deck`.

**Custom install location:** the installer prints the matching uninstall command
at the end of the install.

**Try it once** leaves nothing to uninstall. Mac and Linux delete everything on
close. On Windows, Ctrl+C deletes everything immediately; closing the window
leaves the temporary folder until the next "Try it once" run.

### Phone access

The installed app listens on its own machine only. To allow a phone on the same
wifi, start it with `MASHUP_LAN=1` instead of opening the app.

**Windows** (PowerShell):

```powershell
$env:MASHUP_LAN=1; powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\MashupDeck\launch.ps1"
```

**macOS and Linux** (Terminal):

```bash
MASHUP_LAN=1 sh ~/.mashup-deck/launch.sh
```

It prints the address for the phone:

```
  Open this on your phone:  http://192.168.29.112:8765
```

Both devices must be on the same wifi. The firewall asks for permission on first
run; allow it.

---

## Build it yourself

Requires **Python 3.11 or 3.12** (3.13+ removed a module pydub needs) and ffmpeg:
`brew install ffmpeg` / `sudo apt install ffmpeg` / `winget install ffmpeg`

```bash
python3 -m venv .venv                    # 1. make the venv    (windows: py -m venv .venv)
source .venv/bin/activate                # 2. start the venv   (windows: .venv\Scripts\activate)
pip install -r requirements.txt "yt-dlp[default]" deno   # 3. install
uvicorn main:app --reload --port 8000    # 4. run it
```

`yt-dlp[default]` and `deno` let yt-dlp solve YouTube's JavaScript challenge. The
installers and the Docker image include both.

Open http://localhost:8000. `Ctrl-C` stops the server. `--reload` restarts it on
file changes.

Phone access: replace step 4 with:

```bash
python3 main.py --lan
```

It prints the address for the phone:

```
  Open this on your phone:  http://192.168.29.112:8765
```

Both devices must be on the same wifi. Allow the firewall prompt on first run.
