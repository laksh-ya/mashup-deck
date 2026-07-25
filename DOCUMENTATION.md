# Documentation

The long version: what this is, how it is put together, what was decided and
what was rejected, and the things that are not obvious from the outside.

- [What it is for](#what-it-is-for)
- [The pipeline](#the-pipeline)
- [Decisions](#decisions)
- [The frontend](#the-frontend)
- [Design](#design)
- [Bugs worth remembering](#bugs-worth-remembering)
- [Hidden features](#hidden-features)
- [Operations](#operations)
- [How it was verified](#how-it-was-verified)
- [Limits](#limits)

---

## What it is for

Cutting a mashup by hand means finding each song, downloading it, opening an
audio editor, locating the hook, trimming, lining the pieces up, crossfading and
exporting. For a three song sangeet mix that is twenty minutes of work for
someone who knows the tools, and impossible for someone who does not.

This turns it into a sentence:

```
Kesariya from 0:45 to 1:10
then Naatu Naatu from 0:20 to 0:52
then Jhoome Jo Pathaan from 1:02 to 1:34
```

The target user is a cousin at a wedding who wants a mashup for a performance and
has never opened Audacity.

---

## The pipeline

Four stages, each its own module, each independently testable.

### 1. Parse — `parser.py`

Plain text into structured clips. **Regex only, no language model.** It is
instant, free, deterministic and works offline. The set of shapes people actually
write is small enough to enumerate:

| written | parsed |
| --- | --- |
| `Kesariya from 0:45 to 1:10` | search, 45s → 70s |
| `youtu.be/abc123 from 12 to 28` | that video, 12s → 28s |
| `Levitating full` | search, whole track |
| `Ilahi 0:40 till 1:10` | search, 40s → 70s |

Splits on newlines and on the word `then`. Times accept `mm:ss`, `h:mm:ss`, bare
seconds and a trailing `s`. Ranges accept `to`, `-`, `till`, `until` and en dash.
`full`, `whole`, `complete`, `entire` and `start to end` all mean the whole track.

Links are matched with an **optional scheme** on purpose. People type
`youtu.be/abc` far more often than `https://youtu.be/abc`, and without this the
input silently became a search query for the literal URL text. The parser
normalises it to a full URL before yt-dlp sees it, because yt-dlp treats a
schemeless string as a search term.

Stopwords (`this`, `then`, `video`, `song`, `track`, `clip`, `from`, `to`, `use`,
`take`, `the`, `a`, `an`) are stripped from what is left, and the remainder
becomes the search query.

### 2. Resolve — `youtube.py`

One yt-dlp metadata lookup per clip: id, title, length, artwork. No audio yet, so
the rack can be shown quickly.

Results are cached in process. Not to make a second visit faster, but because
hammering YouTube search is what gets an IP rate limited. The cache protects the
deployment more than the user.

### 3. Cut — `audio.py`

Download each clip's audio, trim to the range, append with a crossfade.

```python
final = final.append(seg, crossfade=min(crossfade_ms, len(final), len(seg)))
```

Runs on a background thread with a job id, so the request returns immediately and
the browser polls for progress. Progress messages carry `(2/4)` so the frontend
can compute a real percentage rather than animate a fake one.

**A clip that cannot be downloaded is skipped, not fatal.** Losing one song out
of four should not lose the mix. Skipped titles come back in the status so the UI
can say which ones and why.

### 4. Serve — `main.py`

The finished mp3, named from whatever the cassette was labelled.

The name has to be applied **server side**, in `Content-Disposition`. Every
browser prioritises that header over the anchor's `download` attribute, so the
label was being ignored until the name was passed through as a query parameter
and sanitised there. Sanitising also blocks path traversal: `../../etc/passwd`
becomes `etcpasswd`.

---

## Decisions

### Regex instead of an LLM

An API key, a per request cost, latency, a network dependency and non-determinism,
to parse `Kesariya from 0:45 to 1:10`. The regex handles every shape anyone
actually types and the user reviews the result before anything is cut, which is
the real safety net.

### No build step

No bundler, no `node_modules`, no framework. `index.html`, one stylesheet, six ES
modules served as-is. The two third party libraries are vendored as ESM into
`static/vendor/`, so the deployed container makes no third party requests at
runtime. Fonts are self hosted for the same reason.

This is why the two React libraries that were considered for the fabric hero and
the jelly components were not used: both need a bundler, and adding one to gain a
background effect was the wrong trade. The cloth effect was written from scratch
as a Verlet mass-spring simulation instead, and later removed entirely because it
looked wrong for the product.

### One note if you ever use Hugging Face Spaces

A Space reads its configuration from a YAML block at the very top of `README.md`.
That block was removed so the README looks right on GitHub. If you deploy to a
Space, paste this back above the first line:

```yaml
---
title: Mashup Deck
emoji: "🎧"
colorFrom: orange
colorTo: red
sdk: docker
app_port: 7860
pinned: false
---
```

Nothing else about the repo changes; the same Dockerfile works on both.

### Docker, not a native runtime

pydub is a wrapper around ffmpeg, and ffmpeg is an apt package. Render's native
Python runtime cannot install one, so the container is not a preference, it is a
requirement. The same image runs on Render, Hugging Face Spaces, Railway, Koyeb,
Fly and a laptop, because the entrypoint reads `$PORT` and falls back to 7860.

### Everything pinned except yt-dlp

Exact versions everywhere, so a build today and a build next year install the
same thing. Python is pinned in the Dockerfile **and** `.python-version`.

yt-dlp is the deliberate exception. YouTube changes how it serves audio every few
weeks, and a pinned yt-dlp stops downloading within a month or two. That is what
quietly kills most self hosted tools like this. So `docker-entrypoint.sh` installs
the current yt-dlp on every container start into its own directory, placed at the
front of `PYTHONPATH` so it deterministically wins over the pinned copy. If PyPI
cannot be reached, the pinned version is used and the app still starts.

The mechanism was verified rather than assumed: an old version installed to a
target directory, confirmed to override the pinned one, then the whole app run
that way through a real export.

### Presets carry their video ids

`presets.js` has the resolved id, title and length for all 23 songs, looked up
once, offline. Picking a jukebox mix therefore costs **no** YouTube search for
anybody, including a first time visitor. This replaced an earlier per-device
cache, which only helped someone who had already waited once, and was the wrong
shape of solution.

### Rejected: caching finished mixes

An earlier version indexed each mix by a signature of its clips and returned an
existing file for an identical request. It made a repeat cut instant, but it was
solving a problem nobody has (cutting the exact same mix twice) and it made the
disk situation worse. Removed.

---

## The frontend

Six modules, no framework.

| module | responsibility |
| --- | --- |
| `app.js` | orchestration: the three bays, the deck, the jukebox, the about card |
| `sheet.js` | the boxes editor, and converting between rows and cue text |
| `stage.js` | the canvas room: records, lights, audio reactive spectrum |
| `dragsort.js` | pointer and keyboard reordering with neighbours sliding aside |
| `sfx.js` | sound and haptics behind one mute, plus the touch fidget bridge |
| `presets.js` | the jukebox mixes |

### The timeline

The deck names the song you are hearing, which means knowing where each clip lands
in the finished file. pydub's crossfade makes that non-obvious: every clip after
the first starts *early* by the overlap, and the total is shorter than the sum of
the parts. `buildTimeline()` mirrors that maths:

```
fade_i  = i == 0 ? 0 : min(crossfade, total_so_far, duration_i)
start_i = total_so_far - fade_i
total   = total_so_far + duration_i - fade_i
```

Checked against reality, not just unit tested: three 22 second clips with a 3
second crossfade predicted 60.0s, and the rendered mp3 measured 60.0s.

That timeline drives three things at once: the now-playing name, the segment
bands drawn on the scrub bar with crossfade zones hatched, and the green outline
on whichever strip in the rack is currently sounding.

### Titles

YouTube titles are advertising: `Full Video: Naatu Naatu Song (Telugu) | RRR |
NTR, Ram Charan...`. `tidyTitle()` cuts at the first pipe, drops a trailing
channel tag, and removes decorative brackets, but only when the bracket contains
words like *official*, *video*, *4K*. So `(Official HD Video)` goes and
`(The Piña Colada Song)` and `(1988)` stay, because they are part of the name.

The rack keeps the full title so you can confirm you got the right upload; only
the deck shows the short one.

### The room

`stage.js` draws a canvas behind everything: two vinyl records with grooves and a
sweeping sheen, three drifting warm lights, and a spectrum along the floor. When
a mix plays, the spectrum is real, read from a Web Audio `AnalyserNode` on the
audio element, and the VU needles follow its level.

A video would have been the obvious choice for a rich background and was rejected:
it cannot react to audio, and it would be the largest thing in the deploy.

Portrait gets its own tuning. Sized by the larger viewport dimension, the records
were 287px discs parked mostly off screen on a phone; they are now width based and
positioned to peek in from the top edge and the left margin, the spectrum drops
from 64 hairlines to 26 readable bars, and the vignette lightens because on a
phone it was erasing the only visible parts of the room.

---

## Design

A wooden console in a dark room, where everything is a physical object.

**Type.** Shrikhand for display (chunky, warm, reverse contrast), Caveat for
anything handwritten, Baloo 2 for interface text, Space Mono for numbers and LCDs.
An earlier generic sans was removed entirely; there are exactly four families on
screen and nothing else.

**Materials.** Walnut with layered grain, brushed steel from repeating gradients,
brass nameplates, screws that rotate when you touch a panel, LCD panels with
scanlines, ruled paper, punch holes, a cassette that ejects.

**Restraint.** The tape deck stays. The cloth hero, the constant ripple following
the cursor, the three step plates and the `songs + timestamps = one mp3` line were
all built and then deleted because they were decoration pretending to be
communication.

**Touch parity.** Phones have no hover, so every hover flourish would simply never
happen. `sfx.js` adds a `poked` class on press and the stylesheet mirrors each
hover rule onto it. The signature stroke under *Lakshya* draws itself when the
card opens rather than waiting for a hover that will never come.

---

## Bugs worth remembering

Each of these was a real defect found by measuring rather than looking.

**Thumbnails never loaded.** The `<img>` was `hidden` *and* `loading="lazy"`.
Browsers skip lazy images that are not being rendered, so the request was never
made at all. Now the image renders from the start and fades in, with a candidate
chain (`maxresdefault` → `hqdefault` → `mqdefault` → `default`) because maxres
does not exist for every video, and a check for YouTube's 120×90 grey placeholder.

**The download name was ignored.** The server's `Content-Disposition` overrides
the anchor's `download` attribute in every browser.

**A dismissed modal still swallowed clicks.** `.onboard { display: grid }` beat
the UA `[hidden]` rule, leaving an invisible layer over the page. Fixed with an
explicit `[hidden] { display: none !important }`.

**Bare links were searched, not fetched.** Covered above.

**`to` was clipped on mobile.** The form's second row mapped the *to* field into a
28px column meant for the delete button, so `1:10` rendered as `1:1`.

**The now-playing name never updated when paused.** `timeupdate` only fires during
playback; scrubbing a paused tape needed `seeked`.

**A stale `flex-wrap: wrap` from an earlier round** pushed the info button below
the nameplate at 320px. And `white-space: nowrap` does not stop *flex items* from
wrapping, which is what the two words of the wordmark are.

**Race on job completion.** `status` flipped to `done` before `used` and `skipped`
were written, so a poll landing in that instant saw a finished job with missing
data. The metadata is now written first.

### Measurement mistakes

Worth recording, because the wrong measurement is more dangerous than none.

- Contrast from **computed** `background-color` is wrong wherever the background
  is a gradient or translucent. Several "failures" were artifacts, and one real
  failure was hidden. Contrast is now measured from **rendered pixels**.
- Comparing "idle" and "active" over **different durations** made ordinary
  animation drift look like a pointer trail that had already been removed.
- A flex container is block level, so its box always fills the row. Measuring it
  reported zero slack on a line that actually had 16% headroom, which nearly led
  to shrinking type that did not need shrinking.
- Counting text rows by element `top` breaks under `align-items: baseline`, since
  a padded label sits at a different offset on the same visual row.

---

## Hidden features

Nothing here is signposted.

**Keyboard**

| key | where | does |
| --- | --- | --- |
| `⌘/Ctrl` + `Enter` | anywhere | read the card, or cut the tape |
| `Space` | after a cut | play or pause |
| `←` `→` | on a trim handle | nudge one second, `Shift` for five |
| `↑` `↓` | on a drag handle | move that clip |
| `Enter` | last row of the form | add another row |
| `Esc` | about card, add row | close it |

**Pointer**

- Tap the bare part of a waveform to move the nearer edge there
- Drag the lit region to slide a selection without changing its length
- Press anywhere on the page to make the floor waves swell under it
- Click or drag the scrub bar to seek
- Hover the tape deck and the reels wind faster
- Hover a preset sleeve and the record slides out and turns

**Behaviour**

- Shuffle play never hands back the same mix twice in a row
- The mute setting persists across visits
- Times are clamped to the track's real length, and a selection can never be
  shorter than a second
- A one second selection keeps a 7px minimum width so it stays grabbable
- Trim handles and drag grips have invisible padding, so they are easier to hit
  than they look without being visually larger
- `prefers-reduced-motion` settles the room, stops the reels and the records, and
  draws every stroke immediately instead of animating it

---

## Operations

### Disk

Downloaded audio and finished mixes are both throwaway, and without management
`downloads/` grows with every song anyone ever asks for until the disk fills.
`janitor.py` sweeps on boot, every five minutes, and after every export.

| variable | default | does |
| --- | --- | --- |
| `YTDLP_AUTO_UPDATE` | `1` | fetch the current yt-dlp on each start |
| `DOWNLOAD_TTL_MIN` | `30` | how long a source is kept, so re-cutting stays fast |
| `OUTPUT_TTL_MIN` | `90` | how long a finished mix is kept |
| `MAX_DOWNLOAD_MB` | `400` | hard cap, oldest deleted first |
| `MAX_OUTPUT_MB` | `150` | hard cap, oldest deleted first |
| `SWEEP_EVERY_MIN` | `5` | background sweep interval |
| `PORT` | `7860` | set by the host |
| `DATA_DIR` | app dir | where scratch lives |
| `YTDLP_COOKIEFILE` | unset | cookies, if YouTube blocks the host |

Three independent rules: a TTL, a size cap, and immediate release when someone
starts a new mix. Files belonging to a running job are never touched. `JOBS` is
pruned in the same sweep, so it cannot grow forever either.

### Writable paths

Some hosts run the container as a user who does not own the app directory.
`paths.py` tries `DATA_DIR`, the app directory, `~/.mashup-deck` and the system
temp directory, using the first that accepts a write. Verified by making the app
directory read only and confirming it recovers.

### Blocked downloads

YouTube rate limits datacenter IPs. `youtube.py` retries across five player
clients (`default`, `web_safari`, `mweb`, `tv_simply`, `android`), spaces requests
at least 1.2 seconds apart, and backs off between attempts. It distinguishes
"blocked" from "unusable" so the UI can say which. If a host is blocked properly,
`YTDLP_COOKIEFILE` is the escape hatch.

The most reliable free option is not a cloud host at all: run it at home and
expose it with a free Cloudflare Tunnel, since residential IPs are rarely blocked.

### Health

`GET /api/health` returns the running Python and yt-dlp versions, whether ffmpeg
is present, the scratch directory, live job count and current disk usage. The same
line is printed to the logs on every boot.

---

## How it was verified

Manual clicking does not catch layout regressions across seven viewports, so
almost everything was checked in a headless browser: the full flow on desktop and
phone, drag reorder actually moving a strip, trim handles changing values,
switching input modes without losing content, the skipped clip path, filename
through a real browser download, share receiving an actual mp3 `File`, no
horizontal overflow at 320 / 360 / 375 / 390 / 412 / 430 / 768 / 1024 / 1280 /
1600px, no touch target under 24px, and contrast on every text element measured
from rendered pixels.

Beyond the browser: parser cases for every link shape, filename sanitising
including path traversal, the janitor's three rules (release, TTL, size cap
against 600MB of planted files), the writable path fallback under a read only
directory, the timeline maths against a rendered mp3, and every one of the 23
jukebox songs confirmed to resolve to the right upload with its trim window inside
the track's real length.

Repeated end to end runs against live YouTube produced real mp3s throughout.

---

## Limits

- **YouTube's terms of service** prohibit this. A public instance can be taken
  down.
- **No authentication or rate limiting.** Anyone with the URL can make the server
  download audio. Fine for something private or short lived, not fine for
  something posted publicly.
- **Jobs live in memory**, so a restart forgets in flight exports.
- **Preview plays the original video**, not your cut. Previewing the actual
  trimmed audio would require downloading and exporting first, which defeats the
  point of a preview.
- **Search takes the first result.** Paste a link when the exact version matters.
- **Unusual phrasing can be misread**, which is exactly why the rack exists.
- **No volume normalisation** between clips, and no fade in or out at the ends.
