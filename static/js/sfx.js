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
