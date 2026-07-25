/* Sound + vibration, behind one mute switch. */

import { bind, play as cue, setEnabled } from '/vendor/cuelume/index.js';
import { WebHaptics } from '/vendor/web-haptics/index.mjs';

const KEY = 'deck.muted';
let muted = localStorage.getItem(KEY) === '1';

setEnabled(!muted);
bind();

const haptics = new WebHaptics({ showSwitch: false });

export function play(name) {
  if (!muted) cue(name);
}

export function tap(pattern = 'light') {
  if (muted) return;
  try { haptics.trigger(pattern); } catch { /* device has no vibrate, fine */ }
}

export function isMuted() { return muted; }

export function setMuted(v) {
  muted = v;
  localStorage.setItem(KEY, v ? '1' : '0');
  setEnabled(!v);
}

/* Every .push and .dome squishes when pressed. One delegated listener so it
   also covers buttons rendered later. */
export function wireSquish() {
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.push, .dome, .sticker, .jcard, .tbtn');
    if (!el) return;
    tap('selection');
    if (el.classList.contains('push')) {
      el.classList.remove('squish');
      requestAnimationFrame(() => el.classList.add('squish'));
      el.addEventListener('animationend', () => el.classList.remove('squish'), { once: true });
    }
  });
}

/* Phones have no hover, so every hover flourish would simply never happen
   there. Pressing one of these adds .poked for a moment and the stylesheet
   mirrors the hover rule onto it. */
const FIDGETY = [
  '.brass', '.signature', '.cassette', '.tapedeck', '.plate', '.lcd',
  '.jcard', '.sticker', '.bay', '.strip', '.credits', '.tag', '.send',
].join(',');

export function wireTouchFidget() {
  if (matchMedia('(hover: hover)').matches) return; // mouse already covered

  document.addEventListener('pointerdown', (e) => {
    // innermost first, then let the nearest useful ancestor react too
    let el = e.target.closest(FIDGETY);
    let hops = 0;
    while (el && hops < 2) {
      poke(el);
      el = el.parentElement?.closest(FIDGETY);
      hops++;
    }
  }, { passive: true });
}

function poke(el) {
  if (el.dataset.poking) return;
  el.dataset.poking = '1';
  el.classList.add('poked');
  setTimeout(() => {
    el.classList.remove('poked');
    delete el.dataset.poking;
  }, 900);
}
