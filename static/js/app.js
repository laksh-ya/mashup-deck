import { mountStage } from '/js/stage.js';
import { play, tap, isMuted, setMuted, wireSquish, wireTouchFidget } from '/js/sfx.js';
import { makeSortable } from '/js/dragsort.js';
import { mountSheet } from '/js/sheet.js';
import { MIXES, STICKERS, mixToText, mixToClips } from '/js/presets.js';

const $ = (s) => document.querySelector(s);

/* The API is served from the same origin as the page. */
const api = (path) => path;

const stage = mountStage($('#stage'));
wireSquish();
wireTouchFidget();

// small hook so the room's behaviour can be exercised from a test
window.__stageBusy = (v) => stage.setBusy(v);

/* ── state ────────────────────────────────────────────────── */

let clips = [];
let jobId = null;
let pollTimer = null;
let deckTimer = null;

/* ── bays ─────────────────────────────────────────────────── */

const BAYS = { write: $('#bay-write'), rack: $('#bay-rack'), deck: $('#bay-deck') };

function showBay(name, quiet) {
  Object.entries(BAYS).forEach(([k, el]) => el.classList.toggle('off', k !== name));
  // The jukebox only belongs on the first screen. Once there is a real tape in
  // play its big PLAY dome reads as the transport, which it is not.
  $('#juke').classList.toggle('stow', name !== 'write');
  if (!quiet) play('page');
  const el = BAYS[name];
  const y = el.getBoundingClientRect().top + window.scrollY - 20;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
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

// wrap each letter so they can bounce individually on hover
const sigInk = $('.sig-ink');
sigInk.innerHTML = [...sigInk.textContent].map((ch) => `<span>${ch}</span>`).join('');

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

/* The example inside the paper has to fit the paper. A full line with a link
   wraps into a mess on a narrow phone, so the short version goes there. */
function setExample() {
  const narrow = window.innerWidth < 620;
  input.placeholder = narrow
    ? 'Kesariya from 0:45 to 1:10\nthen youtu.be/4_eEgJhsBMo\nfrom 0:20 to 0:52\nthen Levitating full'
    : 'Kesariya from 0:45 to 1:10\nthen youtu.be/4_eEgJhsBMo from 0:20 to 0:52\nthen Levitating full';
}
setExample();
addEventListener('resize', setExample);

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
  face.textContent = 'reading';
  play('loading');

  try {
    const parsed = await post('/api/parse', { text });
    if (!parsed.clips?.length) throw new Error('could not find any clips in that');

    showBay('rack');
    $('#rack-note').textContent = 'looking these up';
    renderGhosts(parsed.clips);

    const found = await post('/api/resolve', { clips: parsed.clips });
    clips = found.clips;
    $('#rack-note').textContent = 'drag to reorder, tap a time to change it';
    renderRack();

    const ok = clips.filter((c) => !c.error).length;
    if (ok) { play('ready'); tap('success'); }
    else { play('error'); tap('error'); }
  } catch (e) {
    showBay('write');
    warn.textContent = e.message;
    warn.hidden = false;
    play('error');
    tap('error');
  } finally {
    btn.disabled = false;
    face.textContent = 'read the card';
  }
}

/* ── 2. the rack ──────────────────────────────────────────── */

const rack = $('#rack');
const tmpl = $('#strip-tmpl');

/* Placeholder strips while the YouTube lookup runs. The photo slot shows a
   turning reel behind film sprockets rather than a broken image icon. */
function renderGhosts(raw) {
  rack.innerHTML = '';
  raw.forEach((c) => {
    const node = tmpl.content.cloneNode(true);
    node.querySelector('.strip').classList.add('ghost');
    node.querySelector('.strip-title').textContent = c.raw || c.query || 'looking this up';
    node.querySelector('.strip-times').remove();
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
  $('#btn-add').hidden = true;
  paintBench();
}

function renderRack(refocus) {
  rack.innerHTML = '';

  clips.forEach((clip, i) => {
    const node = tmpl.content.cloneNode(true);
    const strip = node.querySelector('.strip');
    const title = node.querySelector('.strip-title');

    if (clip.error) {
      strip.classList.add('bad');
      title.textContent = `no luck finding "${clip.query || 'that one'}"`;
      node.querySelector('.photo').remove();
      node.querySelector('.strip-times').remove();
      node.querySelector('.scope').remove();
      node.querySelector('.peek').remove();
      node.querySelector('.grip').remove();
    } else {
      if (clip.end == null) clip.end = clip.duration;
      title.textContent = clip.title;
      title.title = clip.title;

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

  $('#btn-add').hidden = false;
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
  const id = clip.video_id;
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

/* Preview the exact slice before committing to it. Plays the range straight
   from YouTube in a small frame, so nothing has to be downloaded first. */
let openPeek = null;

function wirePreview(btn, peek, clip) {
  const frame = peek.querySelector('.peek-frame');

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
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(clip.video_id)}`
      + `?start=${s}&end=${e}&autoplay=1&rel=0&modestbranding=1&playsinline=1`;

    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.title = `Preview of ${clip.title}`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.innerHTML = '';
    frame.appendChild(iframe);

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

function totalSec() {
  const good = goodClips();
  const raw = good.reduce((n, c) => n + Math.max(0, (c.end ?? 0) - (c.start ?? 0)), 0);
  const overlap = (Number(fader.value) / 1000) * Math.max(0, good.length - 1);
  return Math.max(0, raw - overlap);
}

function paintBench() {
  const n = goodClips().length;
  $('#n-clips').textContent = String(n).padStart(2, '0');
  $('#n-total').textContent = fmt(totalSec());
  $('#btn-cut').disabled = n === 0;
}

const fader = $('#fader');
fader.addEventListener('input', () => {
  const v = Number(fader.value);
  $('#fader-val').textContent = v === 0 ? 'off' : `${(v / 1000).toFixed(1)}s`;
  paintBench();
});
fader.addEventListener('change', () => { play('tick'); tap('selection'); });

$('#btn-back-write').addEventListener('click', () => showBay('write'));

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
             placeholder="song name or youtube link, with times: Kesariya 0:45 to 1:10" />
    </div>
    <button class="add-go" type="button">look it up</button>
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
    go.textContent = 'looking';
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

/* ── 3. cut the tape ──────────────────────────────────────── */

const deck = $('#tapedeck');
const rail = $('#rail-fill');
const counter = $('#counter');
const deckMsg = $('#deck-msg');
const needleL = $('#needle-l');
const needleR = $('#needle-r');

function setNeedles(v) {
  // -52deg is rest, +52deg is pinned
  const a = -52 + Math.max(0, Math.min(1, v)) * 104;
  needleL.style.transform = `rotate(${a}deg)`;
  needleR.style.transform = `rotate(${a - 4 + Math.random() * 8}deg)`;
}

function setRail(pct, msg) {
  rail.style.width = `${pct}%`;
  counter.textContent = String(Math.round(pct)).padStart(3, '0');
  setNeedles(pct / 100 * .82 + Math.random() * .12);
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
  const C = crossfadeMs / 1000;
  let total = 0;
  const segs = [];

  list.forEach((c, i) => {
    const d = Math.max(0, (c.end ?? 0) - (c.start ?? 0));
    const fade = i === 0 ? 0 : Math.min(C, total, d);
    const from = Math.max(0, total - fade);
    total = total + d - fade;
    segs.push({ title: tidyTitle(c.title) || `clip ${i + 1}`, from, to: total, fade, clip: c });
  });

  return { segs, total };
}

let mix = { segs: [], total: 0 };

$('#btn-cut').addEventListener('click', () => cutTape());

async function cutTape() {
  const good = goodClips();
  if (!good.length) return;
  mix = buildTimeline(good, Number(fader.value));

  showBay('deck');
  $('#done').hidden = true;
  $('#jam').hidden = true;
  deck.classList.remove('halt');
  stage.setBusy(true);
  rail.classList.remove('err');
  $('#deck-title').textContent = 'rolling';
  $('#deck-note').textContent = 'this takes a minute, the tape is being cut';
  setRail(4, 'threading the tape');
  play('loading');
  tap('medium');

  try {
    const res = await post('/api/export', {
      clips: good.map((c) => ({ video_id: c.video_id, title: c.title, start: c.start, end: c.end })),
      crossfade_ms: Number(fader.value),
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
  stage.setBusy(false);
  // a burst out of the middle of the deck when the tape lands
  const r = deck.getBoundingClientRect();
  stage.poke(r.left + r.width / 2, r.top + r.height / 2, 1.8);
  $('#deck-title').textContent = 'side A';
  $('#deck-note').textContent = 'name it, play it, send it';

  // the player streams the plain url; only the save link carries the name
  audio.src = api(`/api/export/${jobId}/download`);
  syncName();
  $('#send-said').hidden = true;

  const used = status?.used ?? goodClips().length;
  const skipped = status?.skipped || [];
  const note = $('#skipped');
  if (skipped.length) {
    const names = skipped.map((s) => s.title).join(', ');
    const one = skipped.length === 1;
    note.textContent = one
      ? `YouTube would not hand over ${names}, so it is not in here. everything else made it.`
      : `YouTube would not hand over ${skipped.length} of these, so they are not in here: ${names}. everything else made it.`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }

  $('#mix-meta').textContent = `${used} CLIPS / ${fmt(totalSec())}`;
  paintSegments();
  $('#done').hidden = false;
  play('success');
  tap('success');
  setNeedles(0);
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
  stage.setBusy(false);
  rail.classList.add('err');
  $('#deck-title').textContent = 'tape jammed';
  $('#deck-note').textContent = 'nothing lost, go back and try again';
  setRail(100, 'stopped');
  setNeedles(0);
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
  saveBtn.setAttribute('download', `${stem}.mp3`);
  saveBtn.href = api(`/api/export/${jobId}/download?name=${encodeURIComponent(stem)}`);
}
nameField.addEventListener('input', syncName);
nameField.addEventListener('change', () => { syncName(); play('tick'); });

playBtn.addEventListener('click', () => {
  stage.listen(audio);
  stage.resume();
  if (audio.paused) audio.play(); else audio.pause();
});

audio.addEventListener('play', () => {
  playBtn.classList.add('on');
  $('#done').classList.add('spinning');
  deck.classList.remove('halt');
  if (openPeek) openPeek();
  play('press');
  startDeckMeters();
});
audio.addEventListener('pause', () => {
  playBtn.classList.remove('on');
  $('#done').classList.remove('spinning');
  deck.classList.add('halt');
  stopDeckMeters();
});
audio.addEventListener('ended', () => {
  playBtn.classList.remove('on');
  $('#done').classList.remove('spinning');
  deck.classList.add('halt');
  stopDeckMeters();
  clearNowPlaying();
  play('droplet');
});
audio.addEventListener('loadedmetadata', () => {
  $('#t-end').textContent = fmt(audio.duration);
});
// timeupdate only fires while playing, so keep the readout honest when someone
// drags the playhead on a paused tape
audio.addEventListener('seeked', () => {
  paintNowPlaying(audio.currentTime);
  counter.textContent = String(Math.floor(audio.currentTime) % 1000).padStart(3, '0');
});
audio.addEventListener('timeupdate', () => {
  const p = audio.duration ? audio.currentTime / audio.duration : 0;
  scrubFill.style.width = `${p * 100}%`;
  $('#t-now').textContent = fmt(audio.currentTime);
  paintNowPlaying(audio.currentTime);
});

// the meters follow the music while it plays, and the deck names the song
function startDeckMeters() {
  stopDeckMeters();
  deckTimer = setInterval(() => {
    const lv = stage.level();
    setNeedles(Math.min(1, lv * 2.6));
    counter.textContent = String(Math.floor(audio.currentTime) % 1000).padStart(3, '0');
    paintNowPlaying(audio.currentTime);
  }, 90);
}
function stopDeckMeters() {
  clearInterval(deckTimer);
  deckTimer = null;
}

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
    const file = new File([blob], `${stem}.mp3`, { type: 'audio/mpeg' });

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
    a.download = `${stem}.mp3`;
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
  $('#rack-note').textContent = 'change what you like, then cut it again';
  showBay('rack');
  play('page');
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
  $('#done').hidden = true;
  $('#jam').hidden = true;
  rail.classList.remove('err');
  nameField.value = 'my mashup';
  paintBench();
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
  // each sleeve says how many songs are on it
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

/* On a phone only the first two sleeves are out, so the home screen stays
   short but never looks empty. On desktop all of them show and this is inert. */
const PEEK_ON_PHONE = 2;
const juke = $('#juke');
const jukeMore = $('#btn-juke-more');
const jukeLabel = jukeMore.querySelector('.juke-more-t');

$('#juke-count').textContent = `+${Math.max(0, MIXES.length - PEEK_ON_PHONE)}`;

jukeMore.addEventListener('click', () => {
  const open = juke.classList.toggle('open');
  jukeMore.setAttribute('aria-expanded', String(open));
  jukeLabel.textContent = open ? 'fewer mixes' : 'more mixes';
  $('#juke-count').textContent = open ? '' : `+${MIXES.length - PEEK_ON_PHONE}`;
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

/* ── keyboard ─────────────────────────────────────────────── */

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (!BAYS.write.classList.contains('off')) $('#btn-read').click();
    else if (!BAYS.rack.classList.contains('off')) $('#btn-cut').click();
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
