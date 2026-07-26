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
| `main.py` | routes, job tracker, filename handling, and `python main.py` to start it |
| `install.sh` / `install.ps1` | one command setup on a machine with nothing installed |
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

### Windows

Needs nothing installed. Paste into **PowerShell**:

```powershell
irm https://raw.githubusercontent.com/Laksh-ya/mashup-deck/main/install.ps1 | iex
```

Then double-click **Mashup Deck** on the Desktop. The browser opens on its own.

Uninstall: delete the Desktop file and the folder `%LOCALAPPDATA%\MashupDeck`.

### macOS and Linux

Needs nothing installed. Paste into **Terminal**:

```bash
curl -fsSL https://raw.githubusercontent.com/Laksh-ya/mashup-deck/main/install.sh | sh
```

Then double-click **Mashup Deck** on the Desktop. The browser opens on its own.

Uninstall: delete the Desktop file and the folder `~/.mashup-deck`.

### Using it from a phone

The installed copy only listens to its own machine. To let a phone on the same
wifi use it, start it with `MASHUP_LAN=1` instead of double-clicking.

**Windows**, in PowerShell:

```powershell
$env:MASHUP_LAN=1; & "$HOME\Desktop\Mashup Deck.cmd"
```

**macOS and Linux**, in Terminal:

```bash
MASHUP_LAN=1 sh ~/Desktop/"Mashup Deck.command"
```

It prints two addresses. The second one, `http://192.168.x.x:8765`, is the one to
open on the phone. Both devices have to be on the same wifi, and the firewall asks
permission the first time, which is expected: allow it.

---

## Build it yourself

Needs **Python 3.11 or newer** and **ffmpeg**:

```bash
brew install ffmpeg          # macOS
sudo apt install ffmpeg      # Linux
winget install ffmpeg        # Windows
```

Then, in the project folder:

```bash
python3 -m venv .venv               # make the venv
source .venv/bin/activate           # start the venv
pip install -r requirements.txt     # install
uvicorn main:app --port 8000        # run
```

Open http://localhost:8000. `Ctrl-C` stops it.

On Windows the middle two are `py -m venv .venv` and `.venv\Scripts\activate`;
the rest is identical.

### Other ways to run it

| when you want to | command |
| --- | --- |
| start it again another day | `source .venv/bin/activate` then `uvicorn main:app --port 8000` |
| do the whole setup in one line | `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --port 8000` |
| have it restart when you save | `uvicorn main:app --reload --port 8000` |
| skip picking a port, open the browser too | `python main.py` |
| use it from your phone | `uvicorn main:app --host 0.0.0.0 --port 8000` |

For the phone case, get this machine's address and open `http://that-address:8000`
on the phone. Same wifi for both, and allow it when the firewall asks.

```bash
ipconfig getifaddr en0     # macOS
hostname -I                # Linux
ipconfig                   # Windows, the IPv4 Address line
```

---

## Note

Downloading audio from YouTube is against their terms of service. Running this
yourself is one thing; a public instance is the kind of thing a host takes down
if it gets reported.

<p align="center">
  Made by <a href="https://github.com/Laksh-ya">Lakshya</a>
</p>
