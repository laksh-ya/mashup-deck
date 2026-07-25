/* The room behind the console.
   Two vinyl records turning in the dark, drifting stage lights, and a
   spectrum along the floor that reacts to whatever the deck is playing.
   Idles on a slow synthetic wave when nothing is playing. */

const TAU = Math.PI * 2;

export function mountStage(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1;
  let portrait = false;
  let t = 0;
  let raf = null;

  // audio hookup, filled in by listen()
  let analyser = null;
  let freq = null;
  let audioCtx = null;
  let hooked = null;
  let level = 0;          // smoothed overall loudness, drives the lights
  const bars = new Float32Array(64);

  // a nudge into the bars nearest wherever you pressed
  const pokes = new Float32Array(64);
  let busy = 0;      // ramps up while a mix is being built
  let busyOn = false;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    portrait = W < 760;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ── the records ─────────────────────────────────────────── */

  function record(cx, cy, r, spin, tilt) {
    ctx.save();
    ctx.translate(cx, cy);

    // squash slightly so it reads as a disc lying at an angle
    ctx.scale(1, tilt);

    // body
    const body = ctx.createRadialGradient(-r * .3, -r * .3, r * .05, 0, 0, r);
    body.addColorStop(0, '#2a221c');
    body.addColorStop(.55, '#17120e');
    body.addColorStop(1, '#0c0908');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = body;
    ctx.fill();

    // grooves, a touch stronger on a phone so they read at a glance
    const gv = portrait ? 1.8 : 1;
    ctx.lineWidth = 1;
    for (let i = 0; i < 46; i++) {
      const gr = r * (0.30 + (i / 46) * 0.68);
      ctx.beginPath();
      ctx.arc(0, 0, gr, 0, TAU);
      ctx.strokeStyle = `rgba(255,226,190,${(i % 2 ? 0.020 : 0.038) * gv})`;
      ctx.stroke();
    }

    // the sheen sweeping round as it turns
    ctx.rotate(spin);
    const sheen = ctx.createLinearGradient(-r, -r, r, r);
    sheen.addColorStop(0, 'rgba(255,190,120,0)');
    sheen.addColorStop(.42, 'rgba(255,205,150,.10)');
    sheen.addColorStop(.5, 'rgba(255,225,190,.16)');
    sheen.addColorStop(.58, 'rgba(255,205,150,.10)');
    sheen.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = sheen;
    ctx.fill();

    // label + spindle
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.28, 0, TAU);
    ctx.fillStyle = '#c9701f';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.28, 0, TAU);
    ctx.strokeStyle = 'rgba(0,0,0,.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // a wedge on the label so the rotation is legible
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 0.28, -0.34, 0.34);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,220,160,.35)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.035, 0, TAU);
    ctx.fillStyle = '#0b0908';
    ctx.fill();

    ctx.restore();
  }

  /* ── stage lights ────────────────────────────────────────── */

  function light(x, y, r, hue, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${hue},${alpha})`);
    g.addColorStop(1, `rgba(${hue},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* ── the floor spectrum ──────────────────────────────────── */

  /* ── pressing swells the waves ──────────────────────────── */

  // No rings, no rippling. A press just pushes the nearby bars up and they
  // settle back, so the waves fluctuate where you touched and nothing else.
  function poke(x, y, strength = 1) {
    if (reduced) return;
    const centre = Math.round((x / W) * pokes.length);
    const spread = Math.max(3, Math.round(pokes.length * 0.14));
    for (let i = -spread; i <= spread; i++) {
      const j = centre + i;
      if (j < 0 || j >= pokes.length) continue;
      const fall = 1 - Math.abs(i) / (spread + 1);
      pokes[j] = Math.min(1.15, pokes[j] + fall * fall * 0.8 * strength);
    }
  }

  function readAudio() {
    // bleed the pokes away, and breathe while a mix is being built
    for (let i = 0; i < pokes.length; i++) pokes[i] *= 0.93;
    busy += ((busyOn ? 1 : 0) - busy) * 0.05;
    if (analyser) {
      analyser.getByteFrequencyData(freq);
      let sum = 0;
      const n = bars.length;
      // log-ish grouping so bass does not eat the whole display
      for (let i = 0; i < n; i++) {
        const lo = Math.floor(Math.pow(i / n, 1.7) * freq.length * 0.7);
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * freq.length * 0.7));
        let peak = 0;
        for (let j = lo; j < hi; j++) peak = Math.max(peak, freq[j]);
        const v = peak / 255;
        bars[i] += (v - bars[i]) * 0.32;
        sum += bars[i];
      }
      level += (sum / n - level) * 0.12;
    } else {
      // Idle: a slow travelling swell so the room is never dead. While the deck
      // is working it runs faster and taller, so the room looks busy too.
      const speed = 0.012 + busy * 0.03;
      const amp = 0.30 + busy * 0.34;
      for (let i = 0; i < bars.length; i++) {
        const v =
          (Math.sin(t * speed + i * 0.22) * 0.5 + 0.5) *
          (Math.sin(t * (0.005 + busy * 0.012) + i * 0.07) * 0.5 + 0.5);
        bars[i] += (v * amp - bars[i]) * (0.06 + busy * 0.07);
      }
      level += ((0.10 + busy * 0.16) - level) * 0.04;
    }
  }

  function spectrum() {
    // Fewer, fatter bars on a phone. Sixty-four across 390px would be hairlines.
    const n = portrait ? 26 : bars.length;
    const step = bars.length / n;
    const slot = W / n;
    const bw = Math.max(3, slot * (portrait ? 0.62 : 0.52));
    const base = H + 2;
    const maxH = Math.min(300, H * (portrait ? 0.22 : 0.34));

    for (let i = 0; i < n; i++) {
      // when grouped, take the loudest of the bins this bar stands for
      let v = 0;
      let kick = 0;
      for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) {
        v = Math.max(v, bars[j] || 0);
        kick = Math.max(kick, pokes[j] || 0);
      }
      v = Math.min(1.4, v + kick);
      const h = 6 + v * maxH;
      const x = i * slot + (slot - bw) / 2;
      const g = ctx.createLinearGradient(0, base, 0, base - h);
      g.addColorStop(0, `rgba(255,122,47,${portrait ? .58 : .42})`);
      g.addColorStop(.55, 'rgba(255,170,70,.22)');
      g.addColorStop(1, 'rgba(255,210,130,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, base - h, bw, h);
    }
  }

  /* ── frame ───────────────────────────────────────────────── */

  function draw() {
    // room floor
    const room = ctx.createLinearGradient(0, 0, 0, H);
    room.addColorStop(0, '#1c1410');
    room.addColorStop(.45, '#140f0c');
    room.addColorStop(1, '#0d0907');
    ctx.fillStyle = room;
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';

    // Drifting warm lights, brighter when the music is loud. Turned up in
    // portrait, where only narrow bands of the room are on screen.
    const boost = (1 + level * 2.2) * (portrait ? 1.9 : 1);
    light(
      W * (0.22 + Math.sin(t * 0.0034) * 0.1),
      H * (0.1 + Math.cos(t * 0.0027) * 0.06),
      Math.max(W, H) * 0.5,
      '255,150,60', (0.055 * boost).toFixed(3)
    );
    light(
      W * (0.82 + Math.cos(t * 0.0029) * 0.09),
      H * (0.72 + Math.sin(t * 0.0022) * 0.08),
      Math.max(W, H) * 0.46,
      '255,80,40', (0.05 * boost).toFixed(3)
    );
    light(
      W * (0.5 + Math.sin(t * 0.0018) * 0.24),
      H * 0.95,
      Math.max(W, H) * 0.34,
      '70,230,180', (0.028 * boost).toFixed(3)
    );

    ctx.globalCompositeOperation = 'source-over';

    // Records, cropped by the frame. On a phone the cabinet fills nearly the
    // whole width, so instead of parking them off to the sides (where they
    // would never be seen) they peek in from the top edge and the left margin.
    const spin = t * 0.0042;
    if (portrait) {
      const r = W * 0.62;
      record(W * 0.52, -r * 0.58, r, spin, 0.92);
      record(-r * 0.72, H * 0.6, r * 0.85, -spin * 1.3, 0.92);
    } else {
      const rBig = Math.max(W, H) * 0.34;
      record(W * 0.92, H * 0.13, rBig, spin, 0.9);
      record(W * 0.06, H * 0.88, rBig * 0.78, -spin * 1.35, 0.9);
    }

    spectrum();

    // Vignette so the cabinet sits forward. Lighter on a phone, where only thin
    // margins of the room are visible and a heavy vignette would erase them.
    const vig = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.22, W / 2, H * 0.5, Math.max(W, H) * 0.78);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, `rgba(0,0,0,${portrait ? .42 : .72})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  function frame() {
    t += 1;
    readAudio();
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() { if (raf == null && !reduced) raf = requestAnimationFrame(frame); }
  function stop() { if (raf != null) cancelAnimationFrame(raf); raf = null; }

  /* ── public ──────────────────────────────────────────────── */

  // Route a playing <audio> through an analyser so the floor reacts to it.
  function listen(el) {
    if (hooked === el || !window.AudioContext) return;
    try {
      audioCtx = audioCtx || new AudioContext();
      const src = audioCtx.createMediaElementSource(el);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.75;
      freq = new Uint8Array(analyser.frequencyBinCount);
      src.connect(analyser);
      // still has to reach the speakers
      analyser.connect(audioCtx.destination);
      hooked = el;
    } catch {
      analyser = null; // fall back to the idle wave
    }
  }

  function resume() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  resize();
  draw();
  start();

  addEventListener('resize', () => { resize(); if (reduced) draw(); });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  /* Press anywhere and the waves swell under it. Deliberately only on press,
     not on move: a trail that followed the cursor was constant noise. */
  addEventListener('pointerdown', (e) => poke(e.clientX, e.clientY, 1), { passive: true });

  return {
    listen,
    resume,
    level: () => level,
    poke,
    // called while a mix is being cut, so the room gets restless too
    setBusy: (v) => { busyOn = !!v; },
  };
}
