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

It is the five manual steps below, with the two "you already have this"
assumptions removed: [`uv`](https://docs.astral.sh/uv/) brings its own Python
because a fresh PC has none, and ffmpeg arrives as a single static binary because
`brew install` assumes Homebrew, which is a several hundred megabyte download that
wants a sudo password and does not exist on Windows.

Prefer to read it before running it? Same thing, two steps:

```bash
curl -fsSL https://raw.githubusercontent.com/Laksh-ya/mashup-deck/main/install.sh -o install.sh
less install.sh && sh install.sh
```

It runs on the machine it is installed on, so it uses that connection to fetch
audio. Home connections are not blocked by YouTube, which is why this needs no
cookies and no configuration.

**On a phone**, run the launcher from a terminal with `MASHUP_LAN=1` and it prints
a second address that any device on the same wifi can open. That is the one time
the firewall will ask for permission.

### From a checkout, the usual way

Needs ffmpeg and Python 3.11 or newer.

```bash
brew install ffmpeg                  # linux: apt install ffmpeg · windows: winget install ffmpeg

python3 --version                    # 1. check python is there
python3 -m venv .venv                # 2. make the venv
source .venv/bin/activate            # 3. go into it
pip install -r requirements.txt      # 4. install the dependencies
python main.py                       # 5. run it
```

Step 5 picks a free port and opens your browser. `Ctrl-C` stops it, `deactivate`
leaves the venv. Next time it is only steps 3 and 5.

All five in one go:

```bash
python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt && .venv/bin/python main.py
```

While editing code you want reload instead, which means naming the port yourself:

```bash
uvicorn main:app --reload --port 8000
```

On Windows swap step 2 for `py -m venv .venv` and step 3 for
`.venv\Scripts\activate`.

**If `pip` or `uvicorn` inside the venv says "no such file or directory",** the
venv was copied from elsewhere or its folder was renamed; those wrappers hard code
an absolute path to their python. Delete `.venv` and redo steps 2 to 4.

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
