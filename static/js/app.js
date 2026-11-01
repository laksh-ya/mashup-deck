import { play, tap, isMuted, setMuted } from '/js/sfx.js';
import { makeSortable } from '/js/dragsort.js';
import { mountSheet } from '/js/sheet.js';
import { MIXES, STICKERS, mixToText, mixToClips } from '/js/presets.js';

const $ = (s) => document.querySelector(s);

/* The API is served from the same origin as the page. */
const api = (path) => path;

const RACK_NOTE = 'drag to reorder, set in and out points, preview any clip';

/* ── state ────────────────────────────────────────────────── */

let clips = [];
let jobId = null;
let pollTimer = null;
// what the finished tape was saved as, so the save and send buttons agree
let jobFile = { ext: 'mp3', mime: 'audio/mpeg' };

// anything without a source came from YouTube: presets, and mixes kept before reels
const isYouTube = (clip) => !clip.source || clip.source === 'youtube';

/* ── bays ─────────────────────────────────────────────────── */

const BAYS = { write: $('#bay-write'), rack: $('#bay-rack'), deck: $('#bay-deck') };

/* Everything is on one screen now, so "showing" a section means bringing it
   into view when it is not, which on a phone is most of the time. The result
   panel only exists once something has been exported. */
function showBay(name, quiet) {
  const el = BAYS[name];
  if (name === 'deck') el.hidden = false;
  if (!quiet) play('page');
  const top = el.getBoundingClientRect().top;
  if (top < 64 || top > innerHeight * 0.55) {
    window.scrollTo({ top: Math.max(0, top + window.scrollY - 76), behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;   // restart the highlight
    el.classList.add('flash');
  }
}

/* The webkit range track has no progress part, so the filled share is painted
   from a custom property. */
function paintRange(el) {
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  el.style.setProperty('--fill', `${((Number(el.value) - min) / (max - min)) * 100}%`);
}

/* ── time ─────────────────────────────────────────────────── */

function fmt(sec) {
  if (sec == null || Number.isNaN(sec)) return '0:00';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function toSec(str) {
  str = String(str).trim();
  if (!str) return null;
  if (str.includes(':')) {
    const parts = str.split(':').map(Number);
    if (parts.some(Number.isNaN)) return null;
    return parts.reduce((a, p) => a * 60 + p, 0);
  }
  const n = Number(str);
  return Number.isNaN(n) ? null : n;
}

/* ── network ──────────────────────────────────────────────── */

async function post(path, body) {
  const r = await fetch(api(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`the deck is not answering (${r.status})`);
  return r.json();
}

// Wake a sleeping host early so the first real request is not the slow one.
fetch(api('/api/health')).catch(() => {});

/* ── mute ─────────────────────────────────────────────────── */

/* the sound switch now lives inside the about sleeve */
const muteBtn = $('#btn-mute');
function paintMute() {
  muteBtn.setAttribute('aria-pressed', String(isMuted()));
  muteBtn.setAttribute('aria-label', isMuted() ? 'Turn the button sounds back on' : 'Mute the button sounds');
}
paintMute();
muteBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  paintMute();
  play('toggle');
  tap('rigid');
});

/* ── about, over the top of everything ────────────────────── */

const scrim = $('#scrim');
const sleeve = $('#sleeve');
const infoBtn = $('#btn-info');
const closeBtn = $('#btn-about-close');

let lastFocus = null;

function openAbout() {
  lastFocus = document.activeElement;
  scrim.hidden = false;
  scrim.classList.remove('closing');
  infoBtn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  play('bloom');
  tap('medium');
  closeBtn.focus();
  // draw the stroke under the name on its own, so it happens on a phone too
  setTimeout(() => sleeve.classList.add('shown'), 380);
}

function closeAbout() {
  if (scrim.hidden) return;
  scrim.classList.add('closing');
  infoBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  play('droplet');
  setTimeout(() => {
    scrim.hidden = true;
    scrim.classList.remove('closing');
    sleeve.classList.remove('shown');
    $('#share-toast').hidden = true;
  }, 230);
  (lastFocus || infoBtn).focus();
}

infoBtn.addEventListener('click', () => (scrim.hidden ? openAbout() : closeAbout()));
$('#btn-credits').addEventListener('click', () => (scrim.hidden ? openAbout() : closeAbout()));
closeBtn.addEventListener('click', closeAbout);

/* ── uninstall help, only for an installed copy ───────────── */

const unBtn = $('#btn-uninstall');
const unHelp = $('#uninstall-help');

fetch(api('/api/install')).then((r) => r.json()).then((info) => {
  if (!info.installed) return;
  const win = info.os === 'windows';
  const steps = win
    ? ['Close the Mashup Deck window.', 'Settings › Apps › Installed apps › Mashup Deck › Uninstall.', 'Not listed? In PowerShell:']
    : [`Close the Mashup Deck ${info.os === 'mac' ? 'Terminal' : 'terminal'} window.`, 'Then run this in a terminal:'];
  $('#un-steps').replaceChildren(...steps.map((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    return li;
  }));
  $('#un-cmd').textContent = win
    ? `powershell -ExecutionPolicy Bypass -File "${info.uninstaller}"`
    : `sh "${info.uninstaller}"`;
  unBtn.hidden = false;
}).catch(() => {});

unBtn.addEventListener('click', () => {
  const open = unHelp.hidden;
  unHelp.hidden = !open;
  unBtn.setAttribute('aria-expanded', String(open));
  play(open ? 'bloom' : 'droplet');
  tap('light');
});

$('#un-copy').addEventListener('click', async () => {
  const b = $('#un-copy');
  try {
    await navigator.clipboard.writeText($('#un-cmd').textContent);
    b.textContent = 'copied';
    play('success');
    setTimeout(() => { b.textContent = 'copy'; }, 1600);
  } catch {
    getSelection().selectAllChildren($('#un-cmd'));
  }
});
scrim.addEventListener('click', (e) => { if (e.target === scrim) closeAbout(); });

document.addEventListener('keydown', (e) => {
  if (scrim.hidden) return;
  if (e.key === 'Escape') { closeAbout(); return; }
  // keep tabbing inside the sleeve while it is open
  if (e.key !== 'Tab') return;
  const stops = sleeve.querySelectorAll('a[href], button:not([disabled])');
  if (!stops.length) return;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

$('#link-github').addEventListener('click', () => { play('page'); tap('light'); });
$('#link-mail').addEventListener('click', () => { play('page'); tap('light'); });

/* share whatever address this is being served from */
$('#link-share').addEventListener('click', async () => {
  const url = location.origin + location.pathname;
  const data = { title: 'Mashup Deck', text: 'make a mashup by describing it', url };
  const toast = $('#share-toast');

  try {
    if (navigator.share) {
      await navigator.share(data);
      play('success');
      tap('success');
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.textContent = 'link copied';
    toast.hidden = false;
    play('success');
    tap('success');
  } catch (err) {
    // a cancelled share sheet is not a failure worth shouting about
    if (err?.name === 'AbortError') return;
    toast.textContent = url;
    toast.hidden = false;
    play('error');
  }
});

/* ── 1. the cue card ──────────────────────────────────────── */

const input = $('#cue-input');
const warn = $('#write-warn');

input.placeholder = 'Kesariya 0:45 to 1:10\nyoutu.be/4_eEgJhsBMo 0:20 to 0:52\nLevitating full';

const stickerBox = $('#stickers');
STICKERS.forEach((s) => {
  const b = document.createElement('button');
  b.className = 'sticker';
  b.type = 'button';
  b.textContent = s.label;
  b.addEventListener('click', () => {
    input.value = s.text;
    if (mode === 'rows') sheet.fromText(s.text);
    warn.hidden = true;
    focusInput();
    play('sparkle');
    tap('light');
  });
  stickerBox.appendChild(b);
});

/* ── two ways to write the same thing ─────────────────────── */

const clipboard = $('.clipboard');
const sheetBox = $('#sheet');
const tabWrite = $('#mode-write');
const tabRows = $('#mode-rows');

const sheet = mountSheet(sheetBox, {
  onChange: () => { warn.hidden = true; },
  onSubmit: () => $('#btn-read').click(),
  onAdd: () => { play('bloom'); tap('light'); },
  onDrop: () => { play('droplet'); tap('light'); },
});

let mode = 'write';

function setMode(next) {
  if (next === mode) return;

  // carry the content across so switching never loses anything
  if (next === 'rows') sheet.fromText(input.value);
  else input.value = sheet.toText();

  mode = next;
  const rows = next === 'rows';
  clipboard.hidden = rows;
  sheetBox.hidden = !rows;
  tabWrite.classList.toggle('is-on', !rows);
  tabRows.classList.toggle('is-on', rows);
  tabWrite.setAttribute('aria-pressed', String(!rows));
  tabRows.setAttribute('aria-pressed', String(rows));
  $('.say').hidden = rows;   // the written hint belongs to the pad

  play('toggle');
  tap('rigid');
  (rows ? sheet.focus : () => input.focus())();
}

tabWrite.addEventListener('click', () => setMode('write'));
tabRows.addEventListener('click', () => setMode('rows'));

// whichever mode is showing, this is the text we act on
const currentText = () => (mode === 'rows' ? sheet.toText() : input.value);
const focusInput = () => (mode === 'rows' ? sheet.focus() : input.focus());

$('#btn-read').addEventListener('click', () => readCard(currentText()));

async function readCard(text) {
  text = (text || '').trim();
  warn.hidden = true;

  if (!text) {
    warn.textContent = mode === 'rows'
      ? 'put at least one song in a box first'
      : 'write a line first, or grab one of the stickers';
    warn.hidden = false;
    play('error');
    tap('warning');
    focusInput();
    return;
  }

  const btn = $('#btn-read');
  const face = btn.querySelector('.push-face');
  btn.disabled = true;
  face.textContent = 'Finding…';
  play('loading');

  try {
    const parsed = await post('/api/parse', { text });
    if (!parsed.clips?.length) throw new Error('could not find any clips in that');

    // new songs join the list rather than replacing it
    renderRack();
    appendGhosts(parsed.clips);
    $('#rack-note').textContent = 'looking these up';
    showBay('rack', true);

    const found = await post('/api/resolve', { clips: parsed.clips });
    clips.push(...found.clips);
    markPicked(null);
    $('#rack-note').textContent = RACK_NOTE;
    renderRack();

    const ok = found.clips.filter((c) => !c.error).length;
    if (ok) {
      // the box did its job, so it is clear for the next ones
      input.value = '';
      sheet.fromText('');
      play('ready');
      tap('success');
    } else {
      play('error');
      tap('error');
    }
  } catch (e) {
    renderRack();
    $('#rack-note').textContent = RACK_NOTE;
    warn.textContent = e.message;
    warn.hidden = false;
    play('error');
    tap('error');
  } finally {
    btn.disabled = false;
    face.textContent = 'Find songs';
  }
}

/* ── 2. the rack ──────────────────────────────────────────── */

const rack = $('#rack');
const tmpl = $('#strip-tmpl');

/* Placeholder strips under the real ones while the lookup runs. */
function appendGhosts(raw) {
  $('#rack-empty').hidden = true;
  raw.forEach((c) => {
    const node = tmpl.content.cloneNode(true);
    node.querySelector('.strip').classList.add('ghost');
    node.querySelector('.strip-title').textContent = c.raw || c.query || 'looking this up';
    node.querySelector('.strip-times').remove();
    node.querySelector('.strip-knobs').remove();
    node.querySelector('.peek').remove();
    node.querySelector('.grip').style.visibility = 'hidden';
    node.querySelector('.toss').style.visibility = 'hidden';

    // a light crawling along the empty waveform
    const scope = node.querySelector('.scope');
    scope.querySelectorAll('.scope-h').forEach((h) => h.remove());
    const bar = document.createElement('span');
    bar.className = 'bar-ghost';
    scope.appendChild(bar);

    rack.appendChild(node);
  });
  paintBench();
}

function renderRack(refocus) {
  rack.innerHTML = '';
  // a "saved" note stops being true the moment anything changes
  $('#kept-note').hidden = true;
  // the first clip has nothing before it to blend from
  const firstGood = clips.findIndex((c) => !c.error);

  clips.forEach((clip, i) => {
    const node = tmpl.content.cloneNode(true);
    const strip = node.querySelector('.strip');
    const title = node.querySelector('.strip-title');

    if (clip.error) {
      strip.classList.add('bad');
      title.textContent = clip.source === 'upload'
        ? `could not use "${clip.query}": ${clip.error}`
        : `no luck finding "${clip.query || 'that one'}"`;
      node.querySelector('.photo').remove();
      node.querySelector('.strip-times').remove();
      node.querySelector('.strip-knobs').remove();
      node.querySelector('.scope').remove();
      node.querySelector('.peek').remove();
      node.querySelector('.grip').remove();
    } else {
      if (clip.end == null) clip.end = clip.duration;
      title.textContent = clip.title;
      title.title = clip.title;

      // say where it came from when that is not YouTube
      const tag = node.querySelector('.src-tag');
      if (clip.source === 'upload') { tag.textContent = 'File'; tag.classList.add('file'); tag.hidden = false; }
      else if (clip.source === 'instagram') { tag.textContent = 'Instagram'; tag.classList.add('ig'); tag.hidden = false; }
      else if (!isYouTube(clip)) { tag.textContent = clip.source; tag.hidden = false; }

      wireThumb(node.querySelector('.photo'), clip);

      const tIn = node.querySelector('.t-in');
      const tOut = node.querySelector('.t-out');
      const len = node.querySelector('.strip-len');
      const scope = node.querySelector('.scope');
      const sel = node.querySelector('.scope-sel');
      const hIn = node.querySelector('.h-in');
      const hOut = node.querySelector('.h-out');

      const paint = () => {
        const d = Math.max(0, clip.end - clip.start);
        len.textContent = fmt(d);
        const dur = clip.duration || Math.max(d, 1);
        const l = Math.max(0, Math.min(100, (clip.start / dur) * 100));
        const w = Math.max(0.5, Math.min(100 - l, (d / dur) * 100));
        sel.style.left = `${l}%`;
        sel.style.width = `${w}%`;
        hIn.style.left = `${l}%`;
        hOut.style.left = `${l + w}%`;
        tIn.value = fmt(clip.start);
        tOut.value = fmt(clip.end);
        paintBench();
      };

      const clamp = () => {
        const dur = clip.duration;
        clip.start = Math.max(0, clip.start);
        if (dur) {
          clip.start = Math.min(clip.start, Math.max(0, dur - 1));
          clip.end = Math.min(clip.end, dur);
        }
        if (clip.end - clip.start < 1) clip.end = Math.min(dur ?? Infinity, clip.start + 1);
      };

      const commit = (el, key) => {
        const v = toSec(el.value);
        if (v == null) { el.value = fmt(clip[key]); play('error'); return; }
        clip[key] = v;
        clamp();
        paint();
        play('tick');
      };

      tIn.addEventListener('change', () => commit(tIn, 'start'));
      tOut.addEventListener('change', () => commit(tOut, 'end'));

      wireScope({ clip, scope, sel, hIn, hOut, paint, clamp });
      wirePreview(node.querySelector('.hear'), node.querySelector('.peek'), clip);
      wireKnobs(node, clip, i === firstGood);
      paint();
    }

    node.querySelector('.toss').addEventListener('click', () => {
      strip.classList.add('tossing');
      play('droplet');
      tap('light');
      setTimeout(() => { clips.splice(i, 1); renderRack(); }, 260);
    });

    rack.appendChild(node);
  });

  $('#rack-empty').hidden = clips.length > 0;
  $('#btn-add').hidden = clips.length === 0;
  paintBench();

  if (refocus != null) {
    rack.querySelectorAll('.strip')[refocus]?.querySelector('.grip')?.focus();
  }
}

/* Thumbnails. yt-dlp hands back whatever size it found, and maxresdefault does
   not exist for every video, so walk a list of candidates and keep the film
   placeholder up until one of them actually decodes. */
function wireThumb(photo, clip) {
  const img = photo.querySelector('img');
  // the i.ytimg.com guesses only mean anything for a YouTube id
  const id = isYouTube(clip) ? clip.video_id : null;
  const tries = [
    clip.thumbnail,
    id && `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    id && `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    id && `https://i.ytimg.com/vi/${id}/default.jpg`,
  ].filter(Boolean);

  if (!tries.length) { photo.classList.add('blank'); return; }

  let at = 0;
  let timer = null;

  const settle = () => { clearTimeout(timer); timer = null; };

  const next = () => {
    settle();
    if (at >= tries.length) { photo.classList.add('blank'); return; }
    const url = tries[at++];
    // some CDNs stall rather than error, so move on after a while
    timer = setTimeout(next, 5000);
    img.src = url;
  };

  img.addEventListener('load', () => {
    settle();
    // YouTube answers a missing thumbnail with a 120x90 grey placeholder
    if (img.naturalWidth <= 120 && at < tries.length) { next(); return; }
    photo.classList.add('ready');
  });
  img.addEventListener('error', next);

  next();
}

/* Drag the two chrome handles to set in and out, or drag the lit region to
   slide the whole selection along the track. Arrow keys nudge, shift jumps. */
function wireScope({ clip, scope, sel, hIn, hOut, paint, clamp }) {
  const dur = () => clip.duration || Math.max(clip.end, 1);
  const ratioAt = (clientX) => {
    const r = scope.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  let mode = null;
  let grabOffset = 0;
  let lastTick = 0;

  const tick = () => {
    const now = performance.now();
    if (now - lastTick > 110) { play('tick'); lastTick = now; }
  };

  const onMove = (e) => {
    if (!mode) return;
    const t = ratioAt(e.clientX) * dur();
    if (mode === 'in') clip.start = Math.min(t, clip.end - 1);
    else if (mode === 'out') clip.end = Math.max(t, clip.start + 1);
    else {
      const span = clip.end - clip.start;
      let s = t - grabOffset;
      s = Math.max(0, Math.min(s, dur() - span));
      clip.start = s;
      clip.end = s + span;
    }
    clamp();
    paint();
    tick();
  };

  const stop = () => {
    if (!mode) return;
    mode = null;
    scope.classList.remove('grabbing');
    hIn.classList.remove('pull');
    hOut.classList.remove('pull');
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', stop);
    tap('selection');
  };

  const startDrag = (which, e) => {
    e.preventDefault();
    e.stopPropagation();
    mode = which;
    if (which === 'body') grabOffset = ratioAt(e.clientX) * dur() - clip.start;
    if (which === 'in') hIn.classList.add('pull');
    if (which === 'out') hOut.classList.add('pull');
    scope.classList.add('grabbing');
    play('press');
    tap('rigid');
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', stop);
  };

  hIn.addEventListener('pointerdown', (e) => startDrag('in', e));
  hOut.addEventListener('pointerdown', (e) => startDrag('out', e));
  sel.addEventListener('pointerdown', (e) => startDrag('body', e));

  // tapping the empty part of the track moves the nearest edge there
  scope.addEventListener('pointerdown', (e) => {
    if (e.target !== scope) return;
    const t = ratioAt(e.clientX) * dur();
    if (Math.abs(t - clip.start) < Math.abs(t - clip.end)) clip.start = Math.min(t, clip.end - 1);
    else clip.end = Math.max(t, clip.start + 1);
    clamp();
    paint();
    play('tick');
  });

  const key = (which) => (e) => {
    const step = e.shiftKey ? 5 : 1;
    let d = 0;
    if (e.key === 'ArrowLeft') d = -step;
    else if (e.key === 'ArrowRight') d = step;
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (which === 'in') clip.start = Math.min(clip.start + d, clip.end - 1);
    else clip.end = Math.max(clip.end + d, clip.start + 1);
    clamp();
    paint();
    play('tick');
  };
  hIn.addEventListener('keydown', key('in'));
  hOut.addEventListener('keydown', key('out'));
}

/* A clip's own volume, and how it blends in from the one before. Left alone,
   the blend follows the crossfade fader for the whole mix. */
function wireKnobs(node, clip, first) {
  const gain = node.querySelector('.k-gain');
  const gainVal = node.querySelector('.k-gain-v');
  const xf = node.querySelector('.k-xf');

  const paintGain = () => {
    const v = clip.gain_db || 0;
    gainVal.textContent = v > 0 ? `+${v} dB` : `${v} dB`;
  };
  gain.value = clip.gain_db || 0;
  paintGain();
  gain.addEventListener('input', () => { clip.gain_db = Number(gain.value); paintGain(); });
  gain.addEventListener('change', () => { play('tick'); tap('selection'); });
  // double click puts it back where it started
  gain.addEventListener('dblclick', () => { clip.gain_db = 0; gain.value = 0; paintGain(); play('tick'); });

  if (first) { node.querySelector('.k-blend').remove(); return; }
  xf.value = clip.crossfade_ms == null ? '' : String(clip.crossfade_ms);
  // a value saved by an older mix might not be one of the choices
  if (xf.value === '' && clip.crossfade_ms != null) clip.crossfade_ms = null;
  xf.addEventListener('change', () => {
    clip.crossfade_ms = xf.value === '' ? null : Number(xf.value);
    paintBench();
    play('tick');
  });
}

/* Preview the exact slice before committing to it. Plays the range straight
   from YouTube in a small frame, so nothing has to be downloaded first. */
let openPeek = null;

function wirePreview(btn, peek, clip) {
  const frame = peek.querySelector('.peek-frame');
  const note = peek.querySelector('.peek-note');

  const close = () => {
    frame.innerHTML = '';
    peek.hidden = true;
    btn.classList.remove('on');
    btn.querySelector('svg')?.removeAttribute('data-on');
    if (openPeek === close) openPeek = null;
  };

  peek.querySelector('.peek-close').addEventListener('click', () => { close(); play('droplet'); });

  btn.addEventListener('click', () => {
    if (!peek.hidden) { close(); play('droplet'); return; }
    if (openPeek) openPeek();
    audio.pause();

    const s = Math.max(0, Math.floor(clip.start));
    const e = Math.max(s + 1, Math.ceil(clip.end));
    frame.innerHTML = '';

    if (isYouTube(clip)) {
      const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(clip.video_id)}`
        + `?start=${s}&end=${e}&autoplay=1&rel=0&modestbranding=1&playsinline=1`;

      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.title = `Preview of ${clip.title}`;
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.appendChild(iframe);
      frame.classList.remove('sound');
      note.textContent = 'playing straight from YouTube, just this bit';
    } else {
      // a reel or a file has no player to embed, so play the audio this deck
      // cuts from; the #t fragment stops it at the out point
      const q = clip.url ? `?url=${encodeURIComponent(clip.url)}` : '';
      const player = document.createElement('audio');
      player.src = api(`/api/source/${encodeURIComponent(clip.video_id)}/audio${q}#t=${s},${e}`);
      player.controls = true;
      player.autoplay = true;
      player.setAttribute('aria-label', `Preview of ${clip.title}`);
      frame.appendChild(player);
      frame.classList.add('sound');
      note.textContent = clip.source === 'upload'
        ? 'playing your file, just this bit'
        : 'fetching the reel first, then just this bit';
    }

    peek.hidden = false;
    btn.classList.add('on');
    play('bloom');
    tap('light');
    openPeek = close;
  });
}

makeSortable(rack, {
  itemSelector: '.strip',
  handleSelector: '.grip',
  onLift: () => { play('press'); tap('rigid'); },
  onMoveStep: () => play('tick'),
  onReorder: (from, to, o) => {
    const [moved] = clips.splice(from, 1);
    clips.splice(to, 0, moved);
    play('toggle');
    tap('medium');
    renderRack(o?.refocus);
  },
});

function goodClips() { return clips.filter((c) => !c.error); }

// each join can have its own blend now, so add it up the way the server will
function totalSec() {
  return buildTimeline(goodClips(), Number(fader.value)).total;
}

function paintBench() {
  const n = goodClips().length;
  $('#n-clips').textContent = String(n).padStart(2, '0');
  $('#n-total').textContent = fmt(totalSec());
  $('#btn-cut').disabled = n === 0;
  const format = $('#opt-format')?.value.toUpperCase() || 'MP3';
  $('#export-note').textContent = n
    ? `${n} ${n === 1 ? 'clip' : 'clips'}, ${fmt(totalSec())} as ${format}`
    : 'Add a track to export a mix';
}

const fader = $('#fader');
fader.addEventListener('input', () => {
  const v = Number(fader.value);
  $('#fader-val').textContent = v === 0 ? 'off' : `${(v / 1000).toFixed(1)}s`;
  paintBench();
});
fader.addEventListener('change', () => { play('tick'); tap('selection'); });

paintRange(fader);
fader.addEventListener('input', () => paintRange(fader));

/* Add another clip without leaving the rack. Enter works, and so does the
   button, so nobody has to guess that Enter is the way. */
$('#btn-add').addEventListener('click', openAdder);

function openAdder() {
  const existing = rack.querySelector('.adder');
  if (existing) { existing.querySelector('.add-input').focus(); return; }

  const row = document.createElement('div');
  row.className = 'strip adder';
  row.innerHTML = `
    <div class="adder-wrap">
      <input class="add-input" type="text" aria-label="Song to add, with timestamps"
             placeholder="Song name or link, with times: Kesariya 0:45 to 1:10" />
    </div>
    <button class="add-go" type="button">Add</button>
    <p class="adder-hint">times are optional. leave them out and you get the <b>whole track</b>.</p>`;
  rack.appendChild(row);

  const field = row.querySelector('.add-input');
  const go = row.querySelector('.add-go');
  field.focus();
  play('bloom');

  const bail = () => { row.remove(); paintBench(); };

  const submit = async () => {
    const q = field.value.trim();
    if (!q) { play('error'); tap('warning'); field.focus(); return; }
    field.disabled = true;
    go.disabled = true;
    go.textContent = 'Finding…';
    try {
      const parsed = await post('/api/parse', { text: q });
      const found = await post('/api/resolve', { clips: parsed.clips });
      clips.push(...found.clips);
      play(found.clips.some((c) => !c.error) ? 'ready' : 'error');
      tap('success');
    } catch {
      play('error');
      tap('error');
    }
    renderRack();
  };

  go.addEventListener('click', submit);
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { bail(); play('droplet'); return; }
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
}

/* ── 3. export ────────────────────────────────────────────── */

const deck = $('#tapedeck');
const rail = $('#rail-fill');
const counter = $('#counter');
const deckMsg = $('#deck-msg');

function setRail(pct, msg) {
  rail.style.width = `${pct}%`;
  counter.textContent = `${Math.round(pct)}%`;
  if (msg) deckMsg.textContent = msg;
}

/* Where each clip lands in the finished mix.

   pydub appends with a crossfade, so each clip after the first starts early by
   the overlap amount and the total comes out shorter than the sum of the parts.
   Mirroring that here is what lets the deck name the song you are hearing. */
/* YouTube titles carry a lot of luggage: "Song | Movie | Singer | 4K". The rack
   keeps the full title so you can check you got the right upload, but the deck
   only has room for the name of the song. */
function tidyTitle(raw) {
  if (!raw) return '';
  let s = String(raw).split(/\s*[|｜]\s*/)[0];
  // drop the channel tag some uploads tack on
  s = s.replace(/\s*[•·]\s*[^•·]{1,24}$/, '');
  // drop decorative brackets, but not ones carrying part of the real name,
  // so "(The Pina Colada Song)" survives while "(Official Video)" does not
  s = s.replace(/\s*[([](?![^)\]]*\bthe\b)[^)\]]*\b(official|video|audio|lyrical?|4k|hd|remaster(?:ed)?|full)\b[^)\]]*[)\]]/gi, '');
  s = s.replace(/\s*[-–]\s*(official|full|lyrical|video|audio)\b.*$/i, '');
  s = s.replace(/\s*\bfull (video )?song\b\s*/gi, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim().replace(/[-–,:]$/, '').trim();
  return s.length > 46 ? s.slice(0, 45).trim() + '…' : (s || String(raw).slice(0, 46));
}

function buildTimeline(list, crossfadeMs) {
  let total = 0;
  const segs = [];

  list.forEach((c, i) => {
    const C = (c.crossfade_ms ?? crossfadeMs) / 1000;
    const d = Math.max(0, (c.end ?? 0) - (c.start ?? 0));
    const fade = i === 0 ? 0 : Math.min(C, total, d);
    const from = Math.max(0, total - fade);
    total = total + d - fade;
    segs.push({ title: tidyTitle(c.title) || `clip ${i + 1}`, from, to: total, fade, clip: c });
  });

  return { segs, total };
}

let mix = { segs: [], total: 0 };
// the clips as they were sent, which the server's timeline indexes into
let cutList = [];

$('#btn-cut').addEventListener('click', () => cutTape());

async function cutTape() {
  const good = goodClips();
  if (!good.length) return;
  cutList = good;
  mix = buildTimeline(good, Number(fader.value));

  audio.pause();
  $('#done').hidden = true;
  $('#jam').hidden = true;
  showBay('deck');
  deck.classList.remove('halt');
  rail.classList.remove('err');
  $('#btn-cut').disabled = true;
  $('#deck-title').textContent = 'Rendering your mix';
  $('#deck-note').textContent = 'this takes a minute or so';
  setRail(4, 'getting started');
  play('loading');
  tap('medium');

  try {
    const res = await post('/api/export', {
      clips: good.map((c) => ({
        video_id: c.video_id,
        url: isYouTube(c) ? null : c.url,
        title: c.title,
        start: c.start,
        end: c.end,
        gain_db: c.gain_db || 0,
        crossfade_ms: c.crossfade_ms ?? null,
      })),
      crossfade_ms: Number(fader.value),
      ...mixOptions(),
    });
    jobId = res.job_id;
    watchJob(good.length);
  } catch (e) {
    jam(e.message);
  }
}

function pctFor(step, total) {
  if (!step) return 6;
  if (/merging/i.test(step)) return 92;
  if (/tempo|volume/i.test(step)) return 90;
  const m = step.match(/\((\d+)\s*\/\s*(\d+)\)/);
  if (m) {
    const i = Number(m[1]) - 1;
    const n = Number(m[2]) || total || 1;
    const within = /trimming/i.test(step) ? 0.78 : 0.3;
    return Math.min(90, 6 + ((i + within) / n) * 84);
  }
  return 10;
}

function humanStep(step) {
  if (!step) return 'working';
  const m = step.match(/\((\d+)\s*\/\s*(\d+)\)/);
  const pair = m ? ` ${m[1]} of ${m[2]}` : '';
  if (/downloading/i.test(step)) return `pulling clip${pair}`;
  if (/trimming/i.test(step)) return `cutting clip${pair}`;
  if (/tempo/i.test(step)) return 'lining up the beats';
  if (/volume/i.test(step)) return 'evening out the volume';
  if (/merging/i.test(step)) return 'splicing it together';
  return step.toLowerCase();
}

function watchJob(total) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    let s;
    try {
      s = await fetch(api(`/api/export/${jobId}/status`)).then((r) => r.json());
    } catch { return; }

    if (s.status === 'done') {
      clearInterval(pollTimer);
      finish(s);
      return;
    }
    if (s.status === 'error') {
      clearInterval(pollTimer);
      jam(String(s.step || '').replace(/^Error:\s*/i, ''));
      return;
    }
    // Jobs live in memory, so a restart or an out of memory kill mid cut leaves
    // us polling for a job the server has never heard of. Without this the reels
    // keep turning forever and nothing ever says why.
    if (s.status === 'not_found') {
      clearInterval(pollTimer);
      jam('the server restarted while cutting, press cut again');
      return;
    }
    setRail(pctFor(s.step, total), humanStep(s.step));
  }, 750);
}

/* ── finished ─────────────────────────────────────────────── */

const audio = $('#audio');
const playBtn = $('#btn-play');
const saveBtn = $('#btn-save');
const scrubRail = $('#scrub-rail');
const scrubFill = $('#scrub-fill');

function finish(status) {
  setRail(100, 'done');
  deck.classList.add('halt');
  paintBench();
  $('#deck-title').textContent = 'Your mix is ready';
  $('#deck-note').textContent = 'name it, play it, send it';
  counter.textContent = '';

  jobFile = { ext: status?.ext || 'mp3', mime: status?.mime || 'audio/mpeg' };

  // The server says where each clip really landed. That is the truth once a
  // clip was skipped or played faster to match the beat, which the trims alone
  // cannot predict.
  const placed = status?.timeline || [];
  if (placed.length) {
    mix = {
      segs: placed.map((t) => ({
        title: tidyTitle(t.title) || 'clip', from: t.from, to: t.to, fade: t.fade, clip: cutList[t.index],
      })),
      total: placed[placed.length - 1].to,
    };
  }

  // the player streams the plain url; only the save link carries the name
  audio.src = api(`/api/export/${jobId}/download`);
  syncName();
  $('#send-said').hidden = true;

  const used = status?.used ?? goodClips().length;
  const skipped = status?.skipped || [];
  const lines = [];
  if (skipped.length) {
    const names = skipped.map((s) => s.title).join(', ');
    lines.push(skipped.length === 1
      ? `could not get ${names}, so it is not in here. everything else made it.`
      : `could not get ${skipped.length} of these, so they are not in here: ${names}. everything else made it.`);
  }
  const nudged = status?.tempo || [];
  if (nudged.length) {
    lines.push(`played ${nudged.length === 1 ? '1 song' : `${nudged.length} songs`} a little `
      + 'faster or slower to sit on the beat of the first.');
  }
  const note = $('#skipped');
  note.textContent = lines.join(' ');
  note.hidden = !lines.length;

  $('#mix-meta').textContent = `${used} ${used === 1 ? 'clip' : 'clips'} · ${fmt(mix.total || totalSec())}`;
  paintSegments();
  $('#done').hidden = false;
  play('success');
  tap('success');
}

/* Draw each clip's stretch onto the scrub bar, with the crossfade overlaps
   hatched, so you can see where one song hands over to the next. */
function paintSegments() {
  const box = $('#seg-marks');
  box.innerHTML = '';
  if (!mix.total) return;

  mix.segs.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = `seg ${i % 2 ? 'b' : 'a'}`;
    el.style.left = `${(s.from / mix.total) * 100}%`;
    el.style.width = `${((s.to - s.from) / mix.total) * 100}%`;
    el.title = `${s.title} (${fmt(s.from)} to ${fmt(s.to)})`;
    box.appendChild(el);

    if (s.fade > 0.05) {
      const f = document.createElement('div');
      f.className = 'seg-fade';
      f.style.left = `${(s.from / mix.total) * 100}%`;
      f.style.width = `${(s.fade / mix.total) * 100}%`;
      box.appendChild(f);
    }
  });
}

/* Which song is under the playhead, naming both during a crossfade. */
function segmentAt(t) {
  const segs = mix.segs;
  if (!segs.length) return null;

  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (t >= s.from - 0.01) {
      if (i > 0 && s.fade > 0.05 && t < s.from + s.fade) {
        return { label: `${segs[i - 1].title}  ▸  ${s.title}`, index: i, fading: true };
      }
      return { label: s.title, index: i, fading: false };
    }
  }
  return { label: segs[0].title, index: 0, fading: false };
}

const nowbar = $('#nowbar');
const nowTitle = $('#now-title');
let shownSegment = -1;

function paintNowPlaying(t) {
  const at = segmentAt(t);
  if (!at) return;
  nowbar.hidden = false;
  if (nowTitle.textContent !== at.label) nowTitle.textContent = at.label;

  if (at.index !== shownSegment) {
    shownSegment = at.index;
    const strips = rack.querySelectorAll('.strip');
    strips.forEach((el) => el.classList.remove('playing'));
    // mix.segs lines up with goodClips(), so map back to that strip
    const clip = mix.segs[at.index]?.clip;
    const idx = clips.indexOf(clip);
    if (idx >= 0 && strips[idx]) strips[idx].classList.add('playing');
  }
}

function clearNowPlaying() {
  nowbar.hidden = true;
  shownSegment = -1;
  rack.querySelectorAll('.strip.playing').forEach((el) => el.classList.remove('playing'));
}

function jam(msg) {
  deck.classList.add('halt');
  rail.classList.add('err');
  paintBench();
  $('#deck-title').textContent = 'Export failed';
  $('#deck-note').textContent = 'nothing lost, change something and try again';
  setRail(100, 'stopped');
  counter.textContent = '';
  const blocked = /sign in to confirm|not a bot|429/i.test(msg);
  $('#jam-msg').textContent = blocked
    ? `YouTube blocked this download. ${msg}`
    : msg || 'something went wrong while merging';
  $('#jam').hidden = false;
  play('error');
  tap('error');
}

$('#btn-jam-back').addEventListener('click', () => {
  rail.classList.remove('err');
  showBay('rack');
});

const nameField = $('#mix-name');

function mixName() {
  const cleaned = (nameField.value || '').trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 48).replace(/^-+|-+$/g, '');
  return cleaned || 'mashup';
}

/* Whatever the cassette is labelled becomes the saved file's name. The server
   has to be told, because its Content-Disposition wins over the download
   attribute in every browser I know of. */
function syncName() {
  if (!jobId) return;
  const stem = mixName();
  saveBtn.setAttribute('download', `${stem}.${jobFile.ext}`);
  saveBtn.href = api(`/api/export/${jobId}/download?name=${encodeURIComponent(stem)}`);
}
nameField.addEventListener('input', syncName);
nameField.addEventListener('change', () => { syncName(); play('tick'); });

playBtn.addEventListener('click', () => {
  if (audio.paused) audio.play(); else audio.pause();
});

audio.addEventListener('play', () => {
  playBtn.classList.add('on');
  playBtn.setAttribute('aria-label', 'Pause the mix');
  if (openPeek) openPeek();
  play('press');
});
audio.addEventListener('pause', () => {
  playBtn.classList.remove('on');
  playBtn.setAttribute('aria-label', 'Play the mix');
});
audio.addEventListener('ended', () => {
  playBtn.classList.remove('on');
  clearNowPlaying();
  play('droplet');
});
audio.addEventListener('loadedmetadata', () => {
  $('#t-end').textContent = fmt(audio.duration);
});
// timeupdate only fires while playing, so keep the readout honest when someone
// drags the playhead on a paused mix
function paintPlayhead() {
  const p = audio.duration ? audio.currentTime / audio.duration : 0;
  scrubFill.style.width = `${p * 100}%`;
  $('#t-now').textContent = fmt(audio.currentTime);
  paintNowPlaying(audio.currentTime);
}
audio.addEventListener('seeked', paintPlayhead);
audio.addEventListener('timeupdate', paintPlayhead);

function seek(e) {
  const r = scrubRail.getBoundingClientRect();
  const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  if (audio.duration) { audio.currentTime = p * audio.duration; tap('selection'); }
}
scrubRail.addEventListener('pointerdown', (e) => {
  seek(e);
  const move = (ev) => seek(ev);
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
});

/* ── send the actual mp3 ──────────────────────────────────── */

const sendBtn = $('#btn-send');
const sendSaid = $('#send-said');

function said(msg) {
  sendSaid.textContent = msg;
  sendSaid.hidden = false;
}

sendBtn.addEventListener('click', async () => {
  if (!jobId || sendBtn.classList.contains('working')) return;
  const stem = mixName();
  sendBtn.classList.add('working');
  sendSaid.hidden = true;
  play('loading');

  try {
    const blob = await fetch(api(`/api/export/${jobId}/download`)).then((r) => {
      if (!r.ok) throw new Error('could not read the tape');
      return r.blob();
    });
    const file = new File([blob], `${stem}.${jobFile.ext}`, { type: jobFile.mime });

    // the real prize: hand over the file itself, so it lands in WhatsApp or
    // wherever as a playable mp3 rather than as a link to this site
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: stem });
      play('success');
      tap('success');
      return;
    }

    // no file sharing here, so fall back to saving it
    const tmp = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = tmp;
    a.download = `${stem}.${jobFile.ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(tmp), 4000);
    said('saved, now attach it anywhere');
    play('success');
    tap('success');
  } catch (err) {
    if (err?.name === 'AbortError') return;   // they closed the share sheet
    said('could not send it, try save instead');
    play('error');
    tap('error');
  } finally {
    sendBtn.classList.remove('working');
  }
});

/* not happy with it: go back and change the cut */
$('#btn-edit').addEventListener('click', () => {
  audio.pause();
  clearNowPlaying();
  $('#rack-note').textContent = 'change what you like, then export again';
  showBay('rack');
});

$('#btn-fresh').addEventListener('click', () => {
  // tell the server it can bin that tape and the audio it was cut from
  if (jobId) {
    fetch(api(`/api/export/${jobId}/release`), { method: 'POST', keepalive: true }).catch(() => {});
  }
  audio.pause();
  audio.removeAttribute('src');
  clearNowPlaying();
  if (openPeek) openPeek();
  mix = { segs: [], total: 0 };
  $('#seg-marks').innerHTML = '';
  clips = [];
  jobId = null;
  rack.innerHTML = '';
  input.value = '';
  sheet.fromText('');
  markPicked(null);
  fader.value = 0;
  $('#fader-val').textContent = 'off';
  paintRange(fader);
  $('#done').hidden = true;
  $('#jam').hidden = true;
  BAYS.deck.hidden = true;
  rail.classList.remove('err');
  nameField.value = 'my mashup';
  jobFile = { ext: 'mp3', mime: 'audio/mpeg' };
  cutList = [];
  $('#rack-note').textContent = RACK_NOTE;
  renderRack();
  showBay('write');
  play('sparkle');
  tap('nudge');
  focusInput();
});

/* ── jukebox ──────────────────────────────────────────────── */

const cards = $('#juke-cards');
MIXES.forEach((mix) => {
  const b = document.createElement('button');
  b.className = 'jcard';
  b.type = 'button';
  b.dataset.mix = mix.id;
  b.innerHTML = '<b></b><span></span><i class="jcard-n"></i>';
  b.querySelector('b').textContent = mix.name;
  b.querySelector('span').textContent = mix.blurb;
  // each one says how many songs are on it
  b.querySelector('.jcard-n').textContent = `${mix.clips.length} songs`;
  b.addEventListener('click', () => loadMix(mix));
  cards.appendChild(b);
});

/* mark which sleeve is currently out of the rack */
function markPicked(id) {
  cards.querySelectorAll('.jcard').forEach((el) => {
    el.classList.toggle('picked', el.dataset.mix === id);
  });
}

/* The first few are out and the rest wait behind "show all", so the panel
   stays short enough to leave room for the prompts under it. */
const SHOWN = 4;
const juke = $('#juke');
const jukeMore = $('#btn-juke-more');
const jukeLabel = jukeMore.querySelector('.juke-more-t');

$('#juke-count').textContent = `+${Math.max(0, MIXES.length - SHOWN)}`;
jukeMore.hidden = MIXES.length <= SHOWN;

jukeMore.addEventListener('click', () => {
  const open = juke.classList.toggle('open');
  jukeMore.setAttribute('aria-expanded', String(open));
  jukeLabel.textContent = open ? 'Show fewer' : 'Show all';
  $('#juke-count').textContent = open ? '' : `+${MIXES.length - SHOWN}`;
  play(open ? 'page' : 'droplet');
  tap('light');
});

const dome = $('#btn-surprise');
let lastSpin = null;

dome.addEventListener('click', () => {
  // never hand back the same one twice in a row
  const pool = MIXES.filter((m) => m.id !== lastSpin);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  lastSpin = pick.id;

  dome.classList.add('spun');
  setTimeout(() => dome.classList.remove('spun'), 620);
  loadMix(pick);
});

/* A preset already carries its video ids, so there is nothing to look up. It
   lands on the rack so you can see the trims and change your mind. If you change
   nothing and press cut, the server recognises the mix and hands back the tape
   it already made, so it plays immediately. */
function loadMix(mix) {
  input.value = mixToText(mix);
  if (mode === 'rows') sheet.fromText(input.value);
  nameField.value = mix.name.toLowerCase();
  clips = mixToClips(mix);

  play('sparkle');
  tap('medium');

  showBay('rack');
  $('#rack-note').textContent = 'ready to go, or change the trims first';
  renderRack();
  markPicked(mix.id);
}

/* ── how the tape is finished ─────────────────────────────── */

const OPTS_KEY = 'mashupdeck.options';
const optEls = {
  fade_in_ms: $('#opt-fade-in'),
  fade_out_ms: $('#opt-fade-out'),
  normalize: $('#opt-even'),
  match_tempo: $('#opt-tempo'),
  format: $('#opt-format'),
  bitrate: $('#opt-bitrate'),
};

function mixOptions() {
  return {
    fade_in_ms: Number(optEls.fade_in_ms.value),
    fade_out_ms: Number(optEls.fade_out_ms.value),
    normalize: optEls.normalize.checked,
    match_tempo: optEls.match_tempo.checked,
    format: optEls.format.value,
    bitrate: optEls.bitrate.value,
  };
}

function setMixOptions(o) {
  if (!o) return;
  Object.entries(optEls).forEach(([k, el]) => {
    if (o[k] == null) return;
    if (el.type === 'checkbox') el.checked = Boolean(o[k]);
    else if ([...el.options].some((op) => op.value === String(o[k]))) el.value = String(o[k]);
  });
  paintOptions();
}

// a wav is not compressed, so there is no quality to pick
function paintOptions() {
  optEls.bitrate.disabled = optEls.format.value === 'wav';
}

// kept on this device, since these are a taste more than part of one mix
try { setMixOptions(JSON.parse(localStorage.getItem(OPTS_KEY))); } catch { /* private window */ }
paintOptions();
Object.values(optEls).forEach((el) => el.addEventListener('change', () => {
  paintOptions();
  paintBench();
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(mixOptions())); } catch { /* private window */ }
  play('tick');
  tap('selection');
}));

/* ── songs from this computer ─────────────────────────────── */

const filePick = $('#file-pick');
$('#btn-upload').addEventListener('click', () => filePick.click());
$('#btn-upload-write').addEventListener('click', () => filePick.click());
filePick.addEventListener('change', () => {
  const files = [...filePick.files];
  filePick.value = '';   // so picking the same file again still counts
  if (files.length) addFiles(files);
});

// dropping a file anywhere works too, rather than the browser opening it and
// throwing away the tracks
const emptyBox = $('#rack-empty');
addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  emptyBox.classList.add('drop');
});
addEventListener('dragleave', (e) => { if (!e.relatedTarget) emptyBox.classList.remove('drop'); });
addEventListener('drop', (e) => {
  emptyBox.classList.remove('drop');
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  const playable = files.filter((f) => /^(audio|video)\//.test(f.type) || !f.type);
  if (playable.length) addFiles(playable);
  else { play('error'); tap('warning'); }
});

/* The file goes up as the raw body and comes back as a clip like any other,
   so trimming, levels and previews all work the same on it. */
async function addFiles(files) {
  showBay('rack', true);
  appendGhosts(files.map((f) => ({ raw: f.name })));

  const note = $('#rack-note');
  let failed = false;
  play('loading');
  for (const [n, file] of files.entries()) {
    note.textContent = files.length > 1
      ? `bringing in your files (${n + 1} of ${files.length})`
      : `bringing in ${file.name}`;
    try {
      const r = await fetch(api(`/api/upload?name=${encodeURIComponent(file.name)}`), {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const got = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(got.error || `the deck said no (${r.status})`);
      clips.push(got);
    } catch (e) {
      failed = true;
      clips.push({ error: e.message, source: 'upload', query: file.name });
    }
    // the ones still on their way keep their placeholders
    renderRack();
    appendGhosts(files.slice(n + 1).map((f) => ({ raw: f.name })));
  }
  markPicked(null);
  note.textContent = RACK_NOTE;
  play(failed ? 'error' : 'ready');
  tap(failed ? 'error' : 'success');
}

/* ── mixes kept on this device ────────────────────────────── */

const SAVED_KEY = 'mashupdeck.saved';
const savedRow = $('#saved-row');
const savedBox = $('#saved');
const keptNote = $('#kept-note');

function readSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; } catch { return []; }
}

function writeSaved(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

function paintSaved() {
  const list = readSaved();
  savedRow.hidden = !list.length;
  savedBox.replaceChildren(...list.map((m) => {
    const wrap = document.createElement('span');
    wrap.className = 'kept-mix';

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sticker';
    b.textContent = m.name;
    b.title = `${m.clips.length} clips, saved ${new Date(m.saved).toLocaleDateString()}`;
    b.addEventListener('click', () => loadSaved(m));

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'kept-x';
    x.setAttribute('aria-label', `Forget ${m.name}`);
    x.textContent = '×';
    x.addEventListener('click', () => {
      writeSaved(readSaved().filter((o) => o.id !== m.id));
      paintSaved();
      play('droplet');
      tap('light');
    });

    wrap.append(b, x);
    return wrap;
  }));
}

$('#btn-keep').addEventListener('click', () => {
  const good = goodClips();
  if (!good.length) { play('error'); tap('warning'); return; }

  // the cassette label is the name; until it has one, name it after the songs
  let name = (nameField.value || '').trim();
  if (!name || name === 'my mashup') {
    const first = tidyTitle(good[0].title) || 'mix';
    name = good.length > 1 ? `${first} + ${good.length - 1} more` : first;
    nameField.value = name;
  }

  const entry = {
    id: Date.now().toString(36),
    name,
    saved: Date.now(),
    crossfade_ms: Number(fader.value),
    options: mixOptions(),
    clips: good.map(({ video_id, url, source, title, thumbnail, duration, start, end, gain_db, crossfade_ms }) => (
      { video_id, url, source, title, thumbnail, duration, start, end, gain_db, crossfade_ms })),
  };
  // the same name again is an update, not a second copy
  const ok = writeSaved([entry, ...readSaved().filter((m) => m.name !== name)].slice(0, 30));
  const uploads = good.some((c) => c.source === 'upload');
  keptNote.textContent = !ok
    ? 'this browser would not let it be saved'
    : `saved as "${name}" on this device.${uploads ? ' files from this computer only stay on the deck for a while, so add those again later.' : ''}`;
  keptNote.hidden = false;
  paintSaved();
  play(ok ? 'success' : 'error');
  tap(ok ? 'success' : 'error');
});

function loadSaved(m) {
  clips = m.clips.map((c) => ({ ...c }));
  fader.value = m.crossfade_ms || 0;
  fader.dispatchEvent(new Event('input'));
  setMixOptions(m.options);
  nameField.value = m.name;
  // written out the way someone could have typed it, links where there are links
  input.value = m.clips
    .filter((c) => c.source !== 'upload')
    .map((c) => `${c.url || c.title} from ${fmt(c.start)} to ${fmt(c.end)}`)
    .join('\nthen ');
  if (mode === 'rows') sheet.fromText(input.value);
  markPicked(null);

  play('sparkle');
  tap('medium');
  showBay('rack');
  $('#rack-note').textContent = 'your mix, the way you left it';
  renderRack();
}

paintSaved();

/* ── keyboard ─────────────────────────────────────────────── */

document.addEventListener('keydown', (e) => {
  // Ctrl+Enter finds what is written while writing, and exports otherwise
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (BAYS.write.contains(document.activeElement)) $('#btn-read').click();
    else if (!$('#btn-cut').disabled) $('#btn-cut').click();
    return;
  }
  // space plays the finished mix, unless you are typing
  if (e.code === 'Space' && !$('#done').hidden) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
    e.preventDefault();
    playBtn.click();
  }
});

paintBench();
