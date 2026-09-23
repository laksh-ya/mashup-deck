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

### Write it however you want

Type it like a sentence, or fill in boxes. Switching between the two keeps
whatever you already wrote.

```
Kesariya from 0:45 to 1:10
then youtu.be/4_eEgJhsBMo from 0:20 to 0:52
then Levitating full
```

Song names get searched. Links work with or without `https://`, including
`youtu.be`, `watch?v=`, `/shorts/`, `/live/` and extra parameters. Leave the
times out, or write `full`, to keep a whole track.

### Trim before you commit

| | |
| --- | --- |
| **Drag to reorder** | Grab the ridged handle. Arrow keys work too. |
| **Draggable trim** | Pull either chrome handle, or slide the lit region to move the whole selection. Arrow keys nudge a second, shift jumps five. |
| **Hear it** | Preview the exact slice before cutting, straight from YouTube. |
| **Live tally** | Clip count and true runtime, with crossfade overlap subtracted. |
| **Crossfade** | A real fader, off by default. |
| **Add or drop** | Add a song without leaving the rack. |

### Then it cuts the tape

- Progress comes from the actual backend steps, not a timer
- A blocked clip gets skipped and named, instead of losing the whole mix
- Name the cassette and that becomes the downloaded filename
- The deck names the song currently playing, and marks the handover during a crossfade
- Each clip's stretch is drawn on the scrub bar, crossfade zones hatched
- Share the finished mp3 as a file, so it lands in WhatsApp playable
- Not happy? Edit the trims and cut it again

### The room reacts

The background is a canvas, not a video. Two records turning, drifting stage
lights, and a spectrum along the floor reading the real audio through a Web Audio
analyser while your mix plays. Press anywhere and the waves swell under it. It
gets busier while a tape is being cut.

### Jukebox

Eight ready mixes for when you have nothing in mind. Shuffle play picks one and
drops you on the trim screen, so you can still change it before cutting.

### Details

- **Sound** on every interaction, chosen semantically, with a mute that persists
- **Haptics** on phones, using patterns that match what happened
- **Skeuomorphic throughout**: walnut, brushed steel, brass, screws, LCD, ruled
  paper, punch holes, a cassette that ejects
- **Every hover flourish also fires on touch**, since phones have no hover
- **Responsive from 320px up**, verified rather than assumed
- **Contrast checked from rendered pixels**, not computed styles
- **Keyboard reachable**: reorder, trim, submit, play, close
- **Respects reduced motion**
- **Self-hosted fonts**, so type never waits on a CDN

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
  │ the rack          │        │                        │      │              │
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
| `POST` | `/api/export` | start a cut, returns a job id |
| `GET` | `/api/export/{id}/status` | progress, and what got skipped |
| `GET` | `/api/export/{id}/download` | the mp3, named from the cassette |
| `POST` | `/api/export/{id}/release` | bin that mix and its sources now |
| `GET` | `/api/health` | versions, job count, disk usage |

### Files

| path | does |
| --- | --- |
| `main.py` | routes, job tracker, filename handling, and `python3 main.py` to start it |
| `install.sh` / `install.ps1` | one command setup on a machine with nothing installed |
| `make_icon.py` | draws the app icon for the Mac app, Start menu and Linux launcher |
| `parser.py` | plain English into clips, regex only |
| `youtube.py` | yt-dlp lookups and downloads, retries, fallback clients, cookies |
| `audio.py` | trimming and crossfade merging |
| `janitor.py` | keeps the scratch folders from growing forever |
| `paths.py` | picks a writable scratch dir, falls back to temp |
| `static/js/app.js` | the three steps, the deck, the jukebox |
| `static/js/sheet.js` | the fill in boxes editor |
| `static/js/stage.js` | the room behind the console |
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
| **Type** | Shrikhand, Caveat, Baloo 2, Space Mono, all self hosted |
| **Sound** | [cuelume](https://cuelume-site.pages.dev) |
| **Haptics** | [web-haptics](https://haptics.lochie.me) |
| **Install** | one command, `uv` for Python, static ffmpeg |

No bundler, no node_modules, no CSS framework. The whole frontend is
`index.html`, one stylesheet and six ES modules.

---

## Run it

**One command, same on Mac, Windows and Linux. Needs nothing installed.**

1. Open a terminal:
   - **Mac:** open Launchpad, type `Terminal`, press Enter
   - **Windows:** open Start, type `PowerShell`, press Enter
   - **Linux:** open Terminal
2. Paste this line and press Enter:

```
${__md-$(curl -fsSL --proto-default https raw.githubusercontent.com/laksh-ya/mashup-deck/main/install.sh|sh >&2)};${__md+'}; irm https://raw.githubusercontent.com/laksh-ya/mashup-deck/main/install.ps1|iex #'}
```

3. It tells you what computer it found, then asks one question:
   - **1) Try it once** - runs straight away from a temporary folder. When you
     close it, everything it downloaded is deleted.
   - **2) Install it** - adds a Mashup Deck app you can open any time:
     Launchpad and Applications on a Mac, the Start menu and Desktop on
     Windows, the apps menu and Desktop on Linux. It updates itself every time
     it starts.
4. Your browser opens with Mashup Deck. The terminal window that stays open
   **is** the app: leave it open while you use it, close it when you are done.

Everything else (Python, ffmpeg, deno, yt-dlp) it downloads by itself into one
private folder. No admin password, nothing added to the system.

Why the line looks odd: it is one line written so that the Mac/Linux terminal
runs the first half and Windows PowerShell runs the second half, each ignoring
the other. Use PowerShell on Windows, not the old Command Prompt.

If you prefer the plain per-system commands, they do exactly the same thing:

```bash
# Mac and Linux (Terminal)
curl -fsSL https://raw.githubusercontent.com/laksh-ya/mashup-deck/main/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/laksh-ya/mashup-deck/main/install.ps1 | iex
```

### Removing it

- **Windows:** Settings > Apps > Installed apps > Mashup Deck > Uninstall
- **Mac and Linux:** paste `sh ~/.mashup-deck/uninstall.sh` in Terminal

A try-once run removes itself when you close it.

### Using it from a phone

The installed copy only listens to its own machine. To let a phone on the same
wifi use it, start it with `MASHUP_LAN=1` instead of opening the app.

**Windows**, in PowerShell:

```powershell
$env:MASHUP_LAN=1; powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\MashupDeck\launch.ps1"
```

**macOS and Linux**, in Terminal:

```bash
MASHUP_LAN=1 sh ~/.mashup-deck/launch.sh
```

It prints the link to open on the phone:

```
  Open this on your phone:  http://192.168.29.112:8765
```

Both devices have to be on the same wifi, and the firewall asks permission the
first time, which is expected: allow it.

---

## Build it yourself

Needs **Python 3.11 or newer**, and ffmpeg:
`brew install ffmpeg` / `sudo apt install ffmpeg` / `winget install ffmpeg`

```bash
python3 -m venv .venv                    # 1. make the venv    (windows: py -m venv .venv)
source .venv/bin/activate                # 2. start the venv   (windows: .venv\Scripts\activate)
pip install -r requirements.txt          # 3. install
uvicorn main:app --reload --port 8000    # 4. run it
```

Open http://localhost:8000. `Ctrl-C` stops it, and `--reload` picks up your edits
as you save.

To use it from your phone, run step 4 as this instead:

```bash
python3 main.py --lan
```

It prints the link to open on the phone:

```
  Open this on your phone:  http://192.168.29.112:8765
```

Both devices on the same wifi, and allow it the first time the firewall asks.
