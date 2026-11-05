/**
 * sfxRecipes.ts — every game sound (#3), synthesized with Web Audio at play
 * time: no audio files, like the code-drawn textures. Each recipe is a few
 * oscillators and filtered noise with short envelopes, started at `v.t0` into
 * `v.out` (the voice's own bus, see sfx.ts). The numbers here ARE the sounds;
 * the mix dials (volume, limiter, caps) are SFX in layout.ts. Audition them
 * all in the Sound Lab (prototype/sound-lab.html).
 */
import { ACT_TRANSITION, SFX } from './layout';

export type SoundName =
  | 'thwip' | 'charged' | 'missile' | 'bombLaunch' | 'detonate'
  | 'rockBreak' | 'toughDent' | 'refused'
  | 'shieldPop' | 'shipLost' | 'shieldRebuild'
  | 'waveClear' | 'runWon' | 'tryAgain'
  | 'podsAppear' | 'podPickup' | 'podTimeout' | 'modeSwipe'
  | 'flyby'
  | 'bossEnter' | 'bossHit' | 'escortClunk' | 'beamCharge' | 'beamZap' | 'bossDefeated'
  | 'giantThump' | 'giantBurst'
  | 'joinBlip' | 'countBeep' | 'countGo';

/** One voice's timing context: where it starts and its random pitch factor.
 *  `span.end` is where its last envelope ends (s): route() raises it, so a
 *  recipe's length is measured, not typed in. Shared by every later() copy. */
interface V {
  ac: BaseAudioContext;
  out: AudioNode;
  t0: number;
  k: number;
  noise: AudioBuffer;
  span: { end: number };
}
interface Env {
  at?: number;
  attack?: number;
  dur: number;
  gain: number;
}
interface Filt {
  type: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
}
type Pan = number | [number, number];

const SILENT = 0.0001; // exponential ramps can't reach 0

/** Filter → envelope → optional pan → out, and extend the voice's span. Returns the start time. */
function route(v: V, src: AudioNode, e: Env, filt?: Filt, pan?: Pan): number {
  const t = v.t0 + (e.at ?? 0);
  v.span.end = Math.max(v.span.end, t + e.dur);
  let node = src;
  if (filt) {
    const b = v.ac.createBiquadFilter();
    b.type = filt.type;
    b.Q.value = filt.q ?? 1;
    b.frequency.setValueAtTime(filt.f0, t);
    if (filt.f1) b.frequency.exponentialRampToValueAtTime(filt.f1, t + e.dur);
    node.connect(b);
    node = b;
  }
  const g = v.ac.createGain();
  const attack = Math.min(e.attack ?? 0.004, e.dur * 0.9);
  g.gain.setValueAtTime(SILENT, t);
  g.gain.exponentialRampToValueAtTime(e.gain, t + attack);
  g.gain.exponentialRampToValueAtTime(SILENT, t + e.dur);
  node.connect(g);
  node = g;
  if (pan !== undefined) {
    const [p0, p1] = typeof pan === 'number' ? [pan, pan] : pan;
    const p = v.ac.createStereoPanner();
    p.pan.setValueAtTime(p0, t);
    p.pan.linearRampToValueAtTime(p1, t + e.dur);
    node.connect(p);
    node = p;
  }
  node.connect(v.out);
  return t;
}

/** An oscillator gliding f0 → f1 (Hz) over the envelope, optionally with vibrato. */
function tone(
  v: V,
  type: OscillatorType,
  f0: number,
  f1: number,
  e: Env,
  filt?: Filt,
  opts: { pan?: Pan; vib?: { rate: number; depth: number } } = {}
): void {
  const o = v.ac.createOscillator();
  o.type = type;
  const t = route(v, o, e, filt, opts.pan);
  o.frequency.setValueAtTime(f0 * v.k, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1 * v.k, t + e.dur);
  if (opts.vib) {
    const lfo = v.ac.createOscillator();
    const depth = v.ac.createGain();
    lfo.frequency.value = opts.vib.rate;
    depth.gain.value = opts.vib.depth;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + e.dur + 0.05);
  }
  o.start(t);
  o.stop(t + e.dur + 0.05);
}

/** White noise through a filter: booms, whooshes, shatters, clicks. */
function noise(v: V, e: Env, filt: Filt, pan?: Pan): void {
  const s = v.ac.createBufferSource();
  s.buffer = v.noise;
  s.loop = true;
  const t = route(v, s, e, filt, pan);
  s.start(t, Math.random() * (v.noise.duration - 0.1));
  s.stop(t + e.dur + 0.05);
}

/** Little high sine pings scattered over `span` seconds: the sparkly tail. */
function sparkle(v: V, at: number, count: number, lo: number, hi: number, span: number, gain: number, rising = false): void {
  for (let i = 0; i < count; i++) {
    const f = rising ? lo + ((hi - lo) * i) / Math.max(1, count - 1) : lo + Math.random() * (hi - lo);
    tone(v, 'sine', f, f, { at: at + (span * i) / count + Math.random() * 0.02, dur: 0.12, gain });
  }
}

/** A run of notes: [Hz, start s, length s]. */
function notes(v: V, type: OscillatorType, seq: [number, number, number][], gain: number, filt?: Filt): void {
  for (const [f, at, dur] of seq) tone(v, type, f, f, { at, dur, gain, attack: 0.01 }, filt);
}

const later = (v: V, s: number): V => ({ ...v, t0: v.t0 + s });

// Equal-tempered pitches (Hz).
const C4 = 261.63, E4 = 329.63, F4 = 349.23, Fs4 = 369.99, G4 = 392.0;
const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880.0;
const C6 = 1046.5, E6 = 1318.5, G6 = 1568.0;
const SOFT: Filt = { type: 'lowpass', f0: 2600 }; // takes the buzz off square waves

/** A boom: a lowpassed noise crash over a falling sine thump. size 1 = a rock. */
function boom(v: V, size: number): void {
  noise(v, { dur: 0.5 * size, gain: 0.5 }, { type: 'lowpass', f0: 2500, f1: 120 });
  tone(v, 'sine', 140, 38, { dur: 0.45 * size, gain: 0.6 });
}
function bigBoom(v: V): void {
  boom(v, 1.8);
  noise(v, { dur: 1.3, gain: 0.35, attack: 0.05 }, { type: 'lowpass', f0: 500, f1: 60 });
  sparkle(v, 0.08, 10, 1600, 3800, 0.7, 0.05);
}

/** Each recipe plays its sound starting at v.t0. */
export const RECIPES: Record<SoundName, (v: V) => void> = {
  thwip: (v) => {
    tone(v, 'triangle', 1400, 260, { dur: 0.11, gain: 0.35, attack: 0.003 });
    noise(v, { dur: 0.03, gain: 0.08 }, { type: 'highpass', f0: 3000 });
  },
  charged: (v) => {
    tone(v, 'sawtooth', 520, 70, { dur: 0.35, gain: 0.28 }, { type: 'lowpass', f0: 2400, f1: 300, q: 4 });
    tone(v, 'sine', 160, 45, { dur: 0.4, gain: 0.45 });
    noise(v, { dur: 0.08, gain: 0.1 }, { type: 'bandpass', f0: 1500 });
  },
  missile: (v) => {
    noise(v, { dur: 0.45, gain: 0.4, attack: 0.12 }, { type: 'bandpass', f0: 500, f1: 3500, q: 3 });
    tone(v, 'sine', 300, 900, { dur: 0.4, gain: 0.22, attack: 0.05 });
  },
  bombLaunch: (v) => {
    tone(v, 'sine', 180, 620, { dur: 0.14, gain: 0.4 });
    tone(v, 'sine', 620, 400, { at: 0.12, dur: 0.08, gain: 0.2 });
  },
  detonate: bigBoom,
  rockBreak: (v) => {
    boom(v, 1);
    sparkle(v, 0.05, 5, 1800, 3600, 0.35, 0.05);
  },
  toughDent: (v) => {
    tone(v, 'sine', 420, 380, { dur: 0.12, gain: 0.4 });
    tone(v, 'triangle', 840, 800, { dur: 0.06, gain: 0.12 });
  },
  refused: (v) => {
    tone(v, 'triangle', 900, 860, { dur: 0.07, gain: 0.12 }, { type: 'lowpass', f0: 1400 });
  },
  shieldPop: (v) => {
    noise(v, { dur: 0.25, gain: 0.3, attack: 0.002 }, { type: 'highpass', f0: 4000, f1: 2000 });
    tone(v, 'triangle', 1200, 500, { dur: 0.15, gain: 0.1 });
    sparkle(v, 0.01, 6, 2500, 5000, 0.18, 0.07);
  },
  shipLost: (v) => {
    tone(v, 'triangle', 240, 80, { dur: 0.6, gain: 0.35, attack: 0.02 }, { type: 'lowpass', f0: 900, f1: 200 });
    tone(v, 'sine', 120, 45, { dur: 0.6, gain: 0.35, attack: 0.02 });
    noise(v, { dur: 0.4, gain: 0.15 }, { type: 'lowpass', f0: 600, f1: 100 });
  },
  shieldRebuild: (v) => {
    notes(v, 'sine', [[C6, 0, 0.25], [E6, 0.07, 0.25], [G6, 0.14, 0.3]], 0.18);
    notes(v, 'triangle', [[C5, 0, 0.25], [E5, 0.07, 0.25], [G5, 0.14, 0.3]], 0.06);
  },
  waveClear: (v) => {
    notes(v, 'square', [[C5, 0, 0.14], [E5, 0.1, 0.14], [G5, 0.2, 0.14], [C6, 0.3, 0.5]], 0.16, SOFT);
    notes(v, 'triangle', [[C4, 0, 0.3], [G4, 0.3, 0.5]], 0.2);
    sparkle(v, 0.3, 8, 2000, 4200, 0.5, 0.06);
  },
  runWon: (v) => {
    const mel: [number, number, number][] = [
      [G4, 0, 0.12], [C5, 0.12, 0.12], [E5, 0.24, 0.12], [G5, 0.36, 0.24],
      [E5, 0.62, 0.12], [G5, 0.74, 0.12], [C6, 0.86, 0.8],
    ];
    notes(v, 'square', mel, 0.15, SOFT);
    notes(v, 'triangle', mel.map(([f, at, d]) => [f * 2, at, d]), 0.06);
    notes(v, 'triangle', [[C4, 0, 0.6], [G4 / 2, 0.62, 0.24], [C4, 0.86, 0.8]], 0.22);
    sparkle(later(v, 0.86), 0, 14, 2000, 4500, 0.8, 0.04);
  },
  tryAgain: (v) => {
    const f: Filt = { type: 'lowpass', f0: 1500 };
    notes(v, 'triangle', [[G4, 0, 0.28], [Fs4, 0.3, 0.28], [F4, 0.6, 0.28]], 0.2, f);
    tone(v, 'triangle', E4, E4, { at: 0.9, dur: 0.75, gain: 0.2, attack: 0.01 }, f, { vib: { rate: 6, depth: 8 } });
  },
  podsAppear: (v) => sparkle(v, 0, 7, 1500, 3500, 0.4, 0.16, true),
  podPickup: (v) => {
    notes(v, 'square', [[C5, 0, 0.09], [E5, 0.05, 0.09], [G5, 0.1, 0.09], [C6, 0.15, 0.09], [E6, 0.2, 0.25]], 0.18, SOFT);
    sparkle(v, 0.2, 4, 3000, 4500, 0.2, 0.07);
  },
  podTimeout: (v) => tone(v, 'sine', 900, 300, { dur: 0.5, gain: 0.15, attack: 0.1 }),
  modeSwipe: (v) => {
    noise(v, { dur: 0.02, gain: 0.15 }, { type: 'bandpass', f0: 2500, q: 2 });
    tone(v, 'sine', 1400, 1400, { dur: 0.03, gain: 0.08 });
  },
  flyby: (v) => {
    // The colony ship's act flyby (ActTransition): an engine swell that
    // pans with it, rising as it speeds off the right edge and falling as it
    // comes back in from the left, loudest at the wrap.
    const out = ACT_TRANSITION.outMs / 1000;
    const back = ACT_TRANSITION.inMs / 1000;
    const leg = (w: V, dur: number, pan: Pan, rising: boolean) => {
      const env = (gain: number): Env => ({ dur, gain, attack: rising ? dur * 0.95 : 0.01 });
      noise(w, env(0.25), { type: 'bandpass', f0: rising ? 300 : 240, f1: rising ? 240 : 180, q: 1.5 }, pan);
      tone(w, 'sawtooth', rising ? 110 : 97, rising ? 97 : 85, env(0.1), { type: 'lowpass', f0: 600 }, { pan });
      tone(w, 'sine', rising ? 55 : 50, rising ? 50 : 45, env(0.3), undefined, { pan });
    };
    leg(v, out, [0, 0.9], true);
    leg(later(v, out), back, [-0.9, 0], false);
  },
  bossEnter: (v) => {
    noise(v, { dur: 2.2, gain: 0.4, attack: 0.8 }, { type: 'lowpass', f0: 200 });
    tone(v, 'sine', 48, 40, { dur: 2.2, gain: 0.4, attack: 0.8 }, undefined, { vib: { rate: 6, depth: 3 } });
  },
  bossHit: (v) => {
    // Inharmonic partials ring like struck metal.
    const parts: [number, number, number][] = [[520, 0.6, 0.18], [1360, 0.4, 0.1], [2110, 0.3, 0.07], [3080, 0.2, 0.05]];
    for (const [f, dur, gain] of parts) tone(v, 'sine', f, f, { dur, gain, attack: 0.002 });
    noise(v, { dur: 0.02, gain: 0.2 }, { type: 'highpass', f0: 2000 });
  },
  escortClunk: (v) => {
    tone(v, 'square', 150, 95, { dur: 0.12, gain: 0.15 }, { type: 'lowpass', f0: 800 });
    noise(v, { dur: 0.08, gain: 0.2 }, { type: 'lowpass', f0: 500 });
  },
  beamCharge: (v) => {
    // Spans the last SFX.beamWhineMs of the charge, so it ends on the zap.
    const dur = SFX.beamWhineMs / 1000;
    tone(v, 'sawtooth', 180, 1100, { dur, gain: 0.18, attack: 1.5 }, { type: 'lowpass', f0: 600, f1: 3000, q: 6 });
    tone(v, 'sine', 360, 2200, { dur, gain: 0.05, attack: 1.5 }, undefined, { vib: { rate: 12, depth: 15 } });
  },
  beamZap: (v) => {
    tone(v, 'sawtooth', 1800, 90, { dur: 0.25, gain: 0.25 }, { type: 'lowpass', f0: 4000, f1: 400 });
    noise(v, { dur: 0.2, gain: 0.2 }, { type: 'bandpass', f0: 2000, f1: 500 });
  },
  // No fanfare: the boss wave's clear plays waveClear straight after.
  bossDefeated: bigBoom,
  giantThump: (v) => {
    tone(v, 'sine', 95, 40, { dur: 0.25, gain: 0.6 });
    noise(v, { dur: 0.12, gain: 0.3 }, { type: 'lowpass', f0: 400 });
  },
  giantBurst: (v) => {
    bigBoom(v);
    boom(later(v, 0.12), 1.2);
    sparkle(v, 0.2, 12, 1500, 4000, 0.9, 0.05);
  },
  joinBlip: (v) => tone(v, 'sine', 660, 990, { dur: 0.09, gain: 0.25 }),
  countBeep: (v) => {
    tone(v, 'square', 440, 440, { dur: 0.12, gain: 0.08 }, SOFT);
    tone(v, 'sine', 440, 440, { dur: 0.2, gain: 0.2 });
  },
  countGo: (v) => {
    tone(v, 'square', A5, A5, { dur: 0.35, gain: 0.08 }, SOFT);
    tone(v, 'sine', A5, A5, { dur: 0.4, gain: 0.2 });
  },
};
