<!-- Drop a hero screenshot here -->
<p align="center">
  <img src="docs/hero.png" alt="Mashup Deck" width="820">
</p>

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

<!-- screenshot: step 1, the pad and the form side by side -->
<img src="docs/step-1.png" alt="Writing the cue sheet" width="100%">

### Trim before you commit

| | |
| --- | --- |
| **Drag to reorder** | Grab the ridged handle. Arrow keys work too. |
| **Draggable trim** | Pull either chrome handle, or slide the lit region to move the whole selection. Arrow keys nudge a second, shift jumps five. |
| **Hear it** | Preview the exact slice before cutting, straight from YouTube. |
| **Live tally** | Clip count and true runtime, with crossfade overlap subtracted. |
| **Crossfade** | A real fader, off by default. |
| **Add or drop** | Add a song without leaving the rack. |

<!-- screenshot: step 2, the rack -->
<img src="docs/step-2.png" alt="The rack" width="100%">

### Then it cuts the tape

- Progress comes from the actual backend steps, not a timer
- A blocked clip gets skipped and named, instead of losing the whole mix
- Name the cassette and that becomes the downloaded filename
- The deck names the song currently playing, and marks the handover during a crossfade
- Each clip's stretch is drawn on the scrub bar, crossfade zones hatched
- Share the finished mp3 as a file, so it lands in WhatsApp playable
- Not happy? Edit the trims and cut it again

<!-- screenshot: step 3, the deck and the finished cassette -->
<img src="docs/step-3.png" alt="The tape deck" width="100%">

### The room reacts

The background is a canvas, not a video. Two records turning, drifting stage
lights, and a spectrum along the floor reading the real audio through a Web Audio
analyser while your mix plays. Press anywhere and the waves swell under it. It
gets busier while a tape is being cut.

### Jukebox

Eight ready mixes for when you have nothing in mind. Shuffle play picks one and
drops you on the trim screen, so you can still change it before cutting.

<!-- screenshot: the jukebox -->
<img src="docs/jukebox.png" alt="The jukebox" width="100%">

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
| `run.py` | starts it, picks a port, opens the browser |
| `install.sh` / `install.ps1` | one command setup on a machine with nothing installed |
| `main.py` | routes, job tracker, filename handling |
| `parser.py` | plain English into clips, regex only |
| `youtube.py` | yt-dlp lookups and downloads, retries, fallback clients |
| `cookies.py` | finds a cookie file, only needed on a server |
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
| **Deploy** | Docker, optional |

No bundler, no node_modules, no CSS framework. The whole frontend is
`index.html`, one stylesheet and six ES modules.

---

## Run it

One command. Nothing needs to be installed first, not even Python.

**macOS and Linux** — paste into Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/Laksh-ya/mashup-deck/main/install.sh | sh
```

**Windows** — paste into PowerShell:

```powershell
irm https://raw.githubusercontent.com/Laksh-ya/mashup-deck/main/install.ps1 | iex
```

That puts **Mashup Deck** on the Desktop. Double-click it, the browser opens, and
you are cutting. No security warnings, no account, no admin rights, nothing added
to `PATH`. Everything lives in one folder you can delete: `~/.mashup-deck` on
macOS and Linux, `%LOCALAPPDATA%\MashupDeck` on Windows.

It runs on the machine it is installed on, so it uses that connection to fetch
audio. Home connections are not blocked by YouTube, which is why this needs no
cookies and no configuration.

**On a phone**, run the launcher from a terminal with `MASHUP_LAN=1` and it prints
a second address that any device on the same wifi can open. That is the one time
the firewall will ask for permission.

### From a checkout, step by step

If you have the repo and would rather do it by hand. Needs Python 3.11 or newer.

```bash
brew install ffmpeg                                  # 1. the audio tool
python3 -m venv .venv                                # 2. a private environment
.venv/bin/python -m pip install -r requirements.txt  # 3. the dependencies
.venv/bin/python run.py                              # 4. start it
```

The last line opens your browser. `Ctrl-C` stops it. Next time, only step 4.

On Linux swap step 1 for `sudo apt install ffmpeg`; on Windows use
`winget install ffmpeg`, then `py -m venv .venv`,
`.venv\Scripts\python -m pip install -r requirements.txt`,
`.venv\Scripts\python run.py`.

Two things worth knowing. Always call `.venv/bin/python`, because a virtualenv
that gets copied or whose folder is renamed keeps stale absolute paths inside its
`bin` wrappers, so `.venv/bin/uvicorn` breaks while `.venv/bin/python` still
works. And `python run.py` without the venv will complain about missing
dependencies rather than doing something surprising.

For auto-reload while editing:

```bash
.venv/bin/uvicorn main:app --reload --port 8000
```

### Deploy to a server

Possible, but read this first: **YouTube refuses cloud IP addresses.** Every
download from a fresh Render or Railway deploy fails with *"sign in to confirm
you're not a bot"*, and the only fix is a cookie file from a throwaway account
that you re-export every few weeks. That is why the installer above exists.

If you still want it: render.com → **New** → **Blueprint** → pick the repo →
**Apply**, then add `YTDLP_COOKIES_B64` in the dashboard. The full explanation,
including how to export cookies without wrecking them, is in
[DOCUMENTATION.md](DOCUMENTATION.md#blocked-downloads).

---

## Note

Downloading audio from YouTube is against their terms of service. Running this
yourself is one thing; a public instance is the kind of thing a host takes down
if it gets reported.

<p align="center">
  Made by <a href="https://github.com/Laksh-ya">Lakshya</a>
</p>
