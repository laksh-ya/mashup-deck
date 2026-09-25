import { mountStage } from './stage.js';
import { play as sfx, tap, isMuted, setMuted, wireSquish, wireTouchFidget } from './sfx.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const stage = mountStage($('#stage'));
wireSquish();
wireTouchFidget();

/* ══ about: the same record sleeve as the app ══════════════ */

const muteBtn = $('#btn-mute');
function paintMute() {
  muteBtn.setAttribute('aria-pressed', String(isMuted()));
  muteBtn.setAttribute('aria-label', isMuted() ? 'Turn the button sounds back on' : 'Mute the button sounds');
}
paintMute();
muteBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  paintMute();
  sfx('toggle');
  tap('rigid');
});

const scrim = $('#scrim');
const sleeve = $('#sleeve');
const infoBtn = $('#btn-info');
const closeBtn = $('#btn-about-close');

// each letter of the signature bounces on its own
const sigInk = $('.sig-ink');
sigInk.innerHTML = [...sigInk.textContent].map((ch) => `<span>${ch}</span>`).join('');

let lastFocus = null;

function openAbout() {
  lastFocus = document.activeElement;
  scrim.hidden = false;
  scrim.classList.remove('closing');
  infoBtn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  sfx('bloom');
  tap('medium');
  closeBtn.focus();
  setTimeout(() => sleeve.classList.add('shown'), 380);
}

function closeAbout() {
  if (scrim.hidden) return;
  scrim.classList.add('closing');
  infoBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  sfx('droplet');
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
  if (e.key !== 'Tab') return;
  const stops = sleeve.querySelectorAll('a[href], button:not([disabled])');
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

$('#link-github').addEventListener('click', () => { sfx('page'); tap('light'); });
$('#link-mail').addEventListener('click', () => { sfx('page'); tap('light'); });

$('#link-share').addEventListener('click', async () => {
  const url = location.origin + location.pathname;
  const data = { title: 'Mashup Deck', text: 'make a mashup by describing it', url };
  const toast = $('#share-toast');
  try {
    if (navigator.share) {
      await navigator.share(data);
      sfx('success');
      tap('success');
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.textContent = 'link copied';
    toast.hidden = false;
    sfx('success');
    tap('success');
  } catch (err) {
    if (err?.name === 'AbortError') return;
    toast.textContent = url;
    toast.hidden = false;
    sfx('error');
  }
});

/* ══ install: which computer is this ═══════════════════════ */

function detect() {
  const ua = navigator.userAgent;
  const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  if (/android|iphone|ipad|ipod/i.test(ua) || (/Mac/.test(p) && navigator.maxTouchPoints > 1)) return { os: 'mac', phone: true };
  if (/win/i.test(p) || /windows/i.test(ua)) return { os: 'win' };
  if (/linux|x11|cros/i.test(p + ua)) return { os: 'linux' };
  return { os: 'mac' };
}

function pickOS(os) {
  for (const t of $$('.mode-tab')) {
    const on = t.dataset.os === os;
    t.classList.toggle('is-on', on);
    t.setAttribute('aria-selected', on);
  }
  for (const el of $$('.os')) el.hidden = el.dataset.os !== os;
  for (const el of $$('[data-os-text]')) el.hidden = el.dataset.osText !== os;
}

const me = detect();
pickOS(me.os);
$('#phone-note').hidden = !me.phone;
for (const t of $$('.mode-tab')) t.addEventListener('click', () => { pickOS(t.dataset.os); sfx('toggle'); });

for (const b of $$('.copy')) {
  b.addEventListener('click', async () => {
    const code = b.previousElementSibling;
    try {
      await navigator.clipboard.writeText(code.textContent);
    } catch {
      const r = document.createRange();
      r.selectNodeContents(code);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      return;
    }
    sfx('success');
    b.textContent = 'copied';
    b.classList.add('done');
    clearTimeout(b._t);
    b._t = setTimeout(() => { b.textContent = 'copy'; b.classList.remove('done'); }, 1600);
  });
}

/* ══ video: fill data-youtube on #watch and it plays here ══ */

const vid = $('#watch').dataset.youtube.trim();
if (vid) {
  $('#screen-soon').hidden = true;
  const btn = $('#screen-play');
  btn.hidden = false;
  btn.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(vid)}?autoplay=1&rel=0`;
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    f.allowFullscreen = true;
    f.title = 'Mashup Deck video';
    $('#screen').replaceChildren(f);
  });
}

/* ══ the demo ═══════════════════════════════════════════════
   The app's three steps, run in the browser on three free songs.
   Parsing, trimming, reordering, crossfading and joining all happen
   here for real; only the YouTube search is left out. */

const SONGS = {
  carefree: { title: 'Carefree', match: /care\s*free/i, art: 'linear-gradient(150deg,#ffb347,#ff5f6d)', mono: 'Cf' },
  monkeys: { title: 'Monkeys Spinning Monkeys', match: /monkey/i, art: 'linear-gradient(150deg,#43cea2,#185a9d)', mono: 'Ms' },
  duck: { title: 'Fluffing a Duck', match: /duck|fluff/i, art: 'linear-gradient(150deg,#f7d358,#c56b14)', mono: 'Fd' },
};
const ARTIST = 'Kevin MacLeod';

const CARD = [
  'Carefree from 1:12 to 1:36',
  'then Monkeys Spinning Monkeys from 1:12 to 1:36',
  'then Fluffing a Duck 0:04 to 0:28',
].join('\n');

const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const toSec = (t) => t.replace(/s$/i, '').split(':').reduce((a, b) => a * 60 + Number(b), 0);

// peaks + lengths are precomputed, so the rack draws before any audio arrives
let meta = {};
fetch('media/peaks.json').then((r) => r.json()).then((j) => { meta = j; }).catch(() => {});

/* ── audio ── */

let ctx = null;
let out = null;
const buffers = {};
let loading = null;

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    out = ctx.createAnalyser();
    out.fftSize = 1024;
    out.smoothingTimeConstant = 0.75;
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function loadSongs() {
  if (!loading) {
    audio();
    loading = Promise.all(Object.keys(SONGS).map(async (k) => {
      const data = await fetch(`media/${k}.mp3`).then((r) => r.arrayBuffer());
      buffers[k] = await new Promise((res, rej) => ctx.decodeAudioData(data, res, rej));
      for (const p of $$(`.strip[data-song="${k}"] .photo`)) p.classList.remove('loading');
    }));
  }
  return loading;
}

// one thing plays at a time: a clip preview or the finished mix
let playing = null;
function stopAll() {
  if (!playing) return;
  const p = playing;
  playing = null;
  try { p.src.stop(); } catch {}
  p.done && p.done();
  stage.tap(null);
}
function play(buffer, from, len, done) {
  stopAll();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(out);
  src.start(0, from, len);
  const p = { src, at: ctx.currentTime - from, done };
  src.onended = () => { if (playing === p) stopAll(); };
  playing = p;
  stage.tap(out);
  return p;
}

/* ── 1. write it down ── */

const cue = $('#cue');

async function typeCard() {
  if (reduced) { cue.value = CARD; return; }
  cue.value = '';
  for (const ch of CARD) {
    if (typing === false) return;
    cue.value += ch;
    await wait(ch === '\n' ? 280 : 22 + Math.random() * 38);
  }
}
let typing = null;
new IntersectionObserver((entries, io) => {
  if (entries[0].isIntersecting && typing === null) {
    io.disconnect();
    typing = true;
    typeCard();
  }
}, { threshold: 0.6 }).observe(cue);
// the card is read-only here; say why when someone tries to type on it
let toastT;
function nope() {
  const t = $('#cue-toast');
  t.hidden = false;
  t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop');
  sfx('error'); tap('warning');
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2800);
}
cue.addEventListener('keydown', (e) => { if (!e.metaKey && !e.ctrlKey && !/^(Tab|Arrow|Shift|Home|End)/.test(e.key)) nope(); });
cue.addEventListener('paste', (e) => { e.preventDefault(); nope(); });
cue.addEventListener('pointerdown', () => { if (typing === false || cue.value === CARD) nope(); });

$('#btn-demo').addEventListener('click', () => {
  sfx('page');
  $('#demo').hidden = false;
  $('#demo').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
});

const T = String.raw`(\d{1,2}:\d{2}(?::\d{2})?|\d+)\s*s?`;
const RANGE = new RegExp(`${T}\\s*(?:to|-|–|till|until)\\s*${T}`, 'i');
const STOP = /\b(from|then|this|video|song|track|clip|use|take|the|a|an|full|whole|complete|entire|start to end)\b/gi;

function parse(text) {
  const clips = [];
  for (let line of text.split(/\n|\bthen\b/i)) {
    line = line.trim();
    if (!line) continue;
    const r = line.match(RANGE);
    const name = line.replace(RANGE, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();
    const key = Object.keys(SONGS).find((k) => SONGS[k].match.test(line));
    if (!key) { clips.push({ bad: true, name: name || line }); continue; }
    const dur = meta[key]?.duration || 60;
    let start = 0, end = dur;
    if (r) { start = toSec(r[1]); end = toSec(r[2]); }
    start = Math.min(Math.max(0, start), dur - 1);
    end = Math.min(Math.max(start + 1, end), dur);
    clips.push({ song: key, start, end, dur });
  }
  return clips;
}

/* ── 2. check the tape ── */

let clips = [];
const rack = $('#rack');
const fader = $('#fader');

function show(id) {
  const el = $(id);
  el.hidden = false;
  el.classList.remove('enter');
  void el.offsetWidth;
  el.classList.add('enter');
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

$('#btn-read').addEventListener('click', async () => {
  typing = false;
  cue.value = CARD;
  if (!meta.carefree) {
    meta = await fetch('media/peaks.json').then((r) => r.json());
  }
  sfx('page');
  clips = parse(cue.value);
  loadSongs();
  renderRack();
  $('#bay-deck').hidden = true;
  show('#bay-rack');
});

$('#btn-back').addEventListener('click', () => {
  stopAll();
  sfx('page');
  $('#bay-write').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
});

function renderRack() {
  rack.replaceChildren(...clips.map(strip));
  tally();
}

function tally() {
  const good = clips.filter((c) => !c.bad);
  const fade = fader.value / 1000;
  let total = good.reduce((a, c) => a + (c.end - c.start), 0);
  for (let i = 1; i < good.length; i++) {
    total -= Math.min(fade, good[i - 1].end - good[i - 1].start, good[i].end - good[i].start);
  }
  $('#n-clips').textContent = good.length;
  $('#n-total').textContent = fmt(total);
  $('#btn-cut').disabled = good.length === 0;
}

fader.addEventListener('change', () => { sfx('tick'); tap('selection'); });
fader.addEventListener('input', () => {
  const v = fader.value / 1000;
  $('#fader-val').textContent = v ? `${v.toFixed(1)}s` : 'off';
  tally();
});

function strip(clip) {
  const el = $('#strip-tmpl').content.firstElementChild.cloneNode(true);
  el._clip = clip;

  if (clip.bad) {
    el.classList.add('bad');
    el.querySelector('.photo').remove();
    const body = el.querySelector('.strip-body');
    body.replaceChildren();
    const h = document.createElement('p');
    h.className = 'strip-title';
    h.innerHTML = `<b></b> is not in the demo. The app would find it on YouTube.`;
    h.querySelector('b').textContent = `“${clip.name}”`;
    body.append(h);
  } else {
    const s = SONGS[clip.song];
    el.dataset.song = clip.song;
    const art = el.querySelector('.art');
    art.style.setProperty('--art', s.art);
    art.textContent = s.mono;
    if (!buffers[clip.song]) el.querySelector('.photo').classList.add('loading');
    const title = el.querySelector('.strip-title');
    title.textContent = s.title + ' ';
    const by = document.createElement('small');
    by.textContent = `· ${ARTIST}`;
    title.append(by);
    wireTimes(el, clip);
  }

  el.querySelector('.toss').addEventListener('click', () => {
    if (playing && playing.strip === el) stopAll();
    clips = clips.filter((c) => c !== clip);
    sfx('droplet');
    el.remove();
    tally();
  });
  wireGrip(el);
  return el;
}

function wireTimes(el, clip) {
  const tin = el.querySelector('.t-in');
  const tout = el.querySelector('.t-out');
  const len = el.querySelector('.strip-len');
  const scope = el.querySelector('.scope');
  const sel = el.querySelector('.scope-sel');
  const hIn = el.querySelector('.h-in');
  const hOut = el.querySelector('.h-out');
  const wave = el.querySelector('.wave');
  const hear = el.querySelector('.hear');
  const dur = clip.dur;

  function draw() {
    const peaks = meta[clip.song]?.peaks || [];
    const w = wave.clientWidth, h = wave.clientHeight;
    if (!w) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    wave.width = w * dpr; wave.height = h * dpr;
    const g = wave.getContext('2d');
    g.scale(dpr, dpr);
    const bw = w / peaks.length;
    const a = clip.start / dur, b = clip.end / dur;
    peaks.forEach((p, i) => {
      const x = i * bw, ph = Math.max(1.5, p * (h - 6));
      const inside = i / peaks.length >= a && i / peaks.length <= b;
      g.fillStyle = inside ? '#8a2e06' : 'rgba(90,65,25,.45)';
      g.fillRect(x, (h - ph) / 2, Math.max(1, bw - 1), ph);
    });
  }

  function sync() {
    tin.value = fmt(clip.start);
    tout.value = fmt(clip.end);
    len.textContent = `${Math.round(clip.end - clip.start)}s`;
    const a = (clip.start / dur) * 100, b = (clip.end / dur) * 100;
    sel.style.left = `${a}%`;
    sel.style.width = `${b - a}%`;
    hIn.style.left = `${a}%`;
    hOut.style.left = `${b}%`;
    draw();
    tally();
  }

  function set(start, end) {
    start = Math.max(0, Math.min(start, dur - 1));
    end = Math.min(dur, Math.max(end, start + 1));
    clip.start = Math.round(start);
    clip.end = Math.round(end);
    sync();
  }

  for (const [input, edge] of [[tin, 'start'], [tout, 'end']]) {
    input.addEventListener('change', () => {
      if (!/^\d+(:\d{1,2})*$/.test(input.value.trim())) return sync();
      const v = toSec(input.value.trim());
      edge === 'start' ? set(v, clip.end) : set(clip.start, v);
      sfx('tick');
    });
  }

  // drag a handle, slide the whole selection, or press the rail to move the nearest edge
  function drag(e, mode) {
    e.preventDefault();
    e.stopPropagation();
    const r = scope.getBoundingClientRect();
    const at = (x) => ((x - r.left) / r.width) * dur;
    const t0 = at(e.clientX), s0 = clip.start, e0 = clip.end, width = e0 - s0;
    if (mode === 'rail') mode = Math.abs(t0 - s0) < Math.abs(t0 - e0) ? 'in' : 'out';
    const move = (ev) => {
      const t = at(ev.clientX);
      if (mode === 'in') set(t, clip.end);
      else if (mode === 'out') set(clip.start, t);
      else {
        const s = Math.max(0, Math.min(dur - width, s0 + (t - t0)));
        set(s, s + width);
      }
    };
    if (mode !== 'sel') move(e);
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }
  hIn.addEventListener('pointerdown', (e) => drag(e, 'in'));
  hOut.addEventListener('pointerdown', (e) => drag(e, 'out'));
  sel.addEventListener('pointerdown', (e) => drag(e, 'sel'));
  scope.addEventListener('pointerdown', (e) => drag(e, 'rail'));

  for (const [h, edge] of [[hIn, 'start'], [hOut, 'end']]) {
    h.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const step = d * (e.shiftKey ? 5 : 1);
      sfx('tick');
      edge === 'start' ? set(clip.start + step, clip.end) : set(clip.start, clip.end + step);
    });
  }

  // hear just this slice, with a playhead across the scope
  hear.addEventListener('click', async () => {
    if (playing && playing.strip === el) return stopAll();
    audio();
    hear.lastChild.textContent = 'loading';
    await loadSongs();
    const head = document.createElement('span');
    head.className = 'scope-head';
    scope.append(head);
    hear.classList.add('on');
    hear.lastChild.textContent = 'stop';
    el.classList.add('playing');
    const p = play(buffers[clip.song], clip.start, clip.end - clip.start, () => {
      head.remove();
      hear.classList.remove('on');
      hear.lastChild.textContent = 'hear it';
      el.classList.remove('playing');
    });
    p.strip = el;
    const tick = () => {
      if (playing !== p) return;
      head.style.left = `${((ctx.currentTime - p.at) / dur) * 100}%`;
      requestAnimationFrame(tick);
    };
    tick();
  });

  requestAnimationFrame(sync);
  new ResizeObserver(draw).observe(wave);
}

// reorder by dragging the ridged grip, or with the arrow keys
function wireGrip(el) {
  const grip = el.querySelector('.grip');
  const commit = () => { clips = $$('.strip', rack).map((s) => s._clip); tally(); };

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const grabY = e.clientY;
    const baseTop = el.getBoundingClientRect().top;
    el.classList.add('dragging');
    sfx('press');
    tap('rigid');
    const move = (ev) => {
      el.style.transform = '';
      const want = baseTop + (ev.clientY - grabY);
      const h = el.offsetHeight;
      const prev = el.previousElementSibling, next = el.nextElementSibling;
      if (prev) { const r = prev.getBoundingClientRect(); if (want < r.top + r.height / 2) rack.insertBefore(el, prev); }
      if (next) { const r = next.getBoundingClientRect(); if (want + h > r.top + r.height / 2) rack.insertBefore(next, el); }
      const natural = el.getBoundingClientRect().top;
      el.style.transform = `translateY(${want - natural}px) scale(1.02) rotate(-.6deg)`;
    };
    const up = () => {
      el.classList.remove('dragging');
      el.style.transform = '';
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      commit();
      sfx('droplet');
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  grip.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && el.previousElementSibling) rack.insertBefore(el, el.previousElementSibling);
    else if (e.key === 'ArrowDown' && el.nextElementSibling) rack.insertBefore(el.nextElementSibling, el);
    else return;
    e.preventDefault();
    grip.focus();
    commit();
  });
}

/* ── 3. cut the tape ── */

let mix = null;   // { buffer, segs: [{title, from, to}], fades: [{from, to}] }

async function render(good, fade) {
  const sr = 44100;
  const lens = good.map((c) => c.end - c.start);
  const segs = [];
  const fades = [];
  let t = 0;
  good.forEach((c, i) => {
    if (i > 0) {
      const f = Math.min(fade, lens[i - 1], lens[i]);
      t -= f;
      fades.push({ from: t, to: t + f });
    }
    segs.push({ title: SONGS[c.song].title, from: t, to: t + lens[i] });
    t += lens[i];
  });
  const off = new OfflineAudioContext(2, Math.ceil(t * sr), sr);
  const curve = (n, up) => Float32Array.from({ length: n }, (_, k) => {
    const x = k / (n - 1);
    return up ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2);
  });
  good.forEach((c, i) => {
    const src = off.createBufferSource();
    src.buffer = buffers[c.song];
    const g = off.createGain();
    const s = segs[i];
    const fin = i > 0 ? fades[i - 1] : null;
    const fout = i < good.length - 1 ? fades[i] : null;
    if (fin && fin.to > fin.from) g.gain.setValueCurveAtTime(curve(64, true), fin.from, fin.to - fin.from);
    if (fout && fout.to > fout.from) g.gain.setValueCurveAtTime(curve(64, false), fout.from, fout.to - fout.from);
    src.connect(g).connect(off.destination);
    src.start(s.from, c.start, lens[i]);
  });
  return { buffer: await off.startRendering(), segs, fades };
}

$('#btn-cut').addEventListener('click', async () => {
  const good = clips.filter((c) => !c.bad);
  if (!good.length) return;
  stopAll();
  const btn = $('#btn-cut');
  btn.disabled = true;
  $('#done').hidden = true;
  $('#progress').hidden = false;
  $('#deck-title').textContent = 'cutting';
  show('#bay-deck');

  const msg = $('#deck-msg');
  const fill = $('#rail-fill');
  const steps = good.length + 2;
  const say = async (i, text) => { msg.textContent = text; fill.style.width = `${(i / steps) * 100}%`; await wait(reduced ? 0 : 650); };

  sfx('loading');
  const ready = loadSongs();
  for (let i = 0; i < good.length; i++) {
    await say(i, `(${i + 1}/${good.length}) getting ${SONGS[good[i].song].title}`);
  }
  await ready;
  await say(good.length, 'trimming and joining');
  mix = await render(good, fader.value / 1000);
  await say(good.length + 1, 'writing the mp3');
  fill.style.width = '100%';
  await wait(reduced ? 0 : 300);

  sfx('ready');
  tap('success');
  $('#progress').hidden = true;
  $('#deck-title').textContent = 'your mashup';
  $('#done').hidden = false;
  $('#mix-meta').textContent = `${good.length} songs · ${fmt(mix.buffer.duration)}`;
  $('#t-end').textContent = fmt(mix.buffer.duration);
  $('#t-now').textContent = '0:00';
  $('#scrub-fill').style.width = '0';
  $('#now-title').textContent = mix.segs[0].title;
  drawSegs();
  btn.disabled = false;
});

function drawSegs() {
  const d = mix.buffer.duration;
  const marks = $('#seg-marks');
  marks.replaceChildren();
  mix.segs.forEach((s, i) => {
    const el = document.createElement('span');
    el.className = `seg ${i % 2 ? 'b' : 'a'}`;
    el.style.left = `${(s.from / d) * 100}%`;
    el.style.width = `${((s.to - s.from) / d) * 100}%`;
    marks.append(el);
  });
  for (const f of mix.fades) {
    const el = document.createElement('span');
    el.className = 'seg-fade';
    el.style.left = `${(f.from / d) * 100}%`;
    el.style.width = `${((f.to - f.from) / d) * 100}%`;
    marks.append(el);
  }
}

const playBtn = $('#btn-play');
let pos = 0;

function nowTitle(t) {
  const f = mix.fades.find((x) => t >= x.from && t < x.to);
  if (f) {
    const i = mix.fades.indexOf(f);
    return `${mix.segs[i].title} → ${mix.segs[i + 1].title}`;
  }
  return (mix.segs.find((s) => t >= s.from && t < s.to) || mix.segs[mix.segs.length - 1]).title;
}

function playMix(from) {
  const d = mix.buffer.duration;
  const p = play(mix.buffer, from, d - from, () => {
    playBtn.classList.remove('on');
    $('#cassette').classList.remove('spinning');
  });
  p.mix = true;
  playBtn.classList.add('on');
  $('#cassette').classList.add('spinning');
  const tick = () => {
    if (playing !== p) return;
    pos = Math.min(d, ctx.currentTime - p.at);
    $('#scrub-fill').style.width = `${(pos / d) * 100}%`;
    $('#t-now').textContent = fmt(pos);
    $('#now-title').textContent = nowTitle(pos);
    if (pos >= d - 0.05) pos = 0;
    requestAnimationFrame(tick);
  };
  tick();
}

playBtn.addEventListener('click', () => {
  if (!mix) return;
  audio();
  if (playing && playing.mix) { stopAll(); return; }
  playMix(pos >= mix.buffer.duration - 0.1 ? 0 : pos);
});

$('#scrub').addEventListener('pointerdown', (e) => {
  if (!mix) return;
  const r = e.currentTarget.getBoundingClientRect();
  pos = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * mix.buffer.duration;
  $('#scrub-fill').style.width = `${(pos / mix.buffer.duration) * 100}%`;
  $('#t-now').textContent = fmt(pos);
  $('#now-title').textContent = nowTitle(pos);
  if (playing && playing.mix) playMix(pos);
});

$('#btn-edit').addEventListener('click', () => {
  stopAll();
  sfx('page');
  pos = 0;
  $('#bay-rack').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
});

// the app hands you an mp3; here the browser writes a wav of the same mix
$('#btn-save').addEventListener('click', () => {
  if (!mix) return;
  const b = mix.buffer;
  const n = b.length, chs = 2, bytes = 44 + n * chs * 2;
  const v = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, chs, true);
  v.setUint32(24, b.sampleRate, true); v.setUint32(28, b.sampleRate * chs * 2, true);
  v.setUint16(32, chs * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * chs * 2, true);
  const L = b.getChannelData(0), R = b.getChannelData(1);
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 0x7fff, true);
    v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 0x7fff, true);
  }
  sfx('success');
  const name = ($('#mix-name').value.trim() || 'my mashup').replace(/[^\w\- ]+/g, '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([v], { type: 'audio/wav' }));
  a.download = `${name}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
