// The instrument set, baked in code (PURE). Each contract instrument is what an SNES sound driver would load: a
// tiny sample at 32 kHz — a seamless loop (optionally behind a short attack transient), or a one-shot — run
// through the Gaussian low-pass and the BRR codec, with an ADSR and a root frequency to pitch it from.
//
// Loops are ADDITIVE over integer bins of the loop length (bin = 32000 / L Hz), so they wrap with no seam even
// with detuned chorus partials (a second copy one bin up = a slow, SNES-cheap ensemble beat). Everything is
// seeded, so the bytes are identical on every machine.

import type { InstrumentId } from '../contract';
import { SAMPLE_RATE, brrQuantise, gaussianFilter, midiToHz, mulberry32 } from './dsp';
import type { Envelope } from './envelope';

export interface NoiseFilter {
  type: 'bandpass' | 'lowpass';
  q: number;
  minHz: number;
  maxHz: number;
}

export interface InstrumentSample {
  id: InstrumentId;
  /** −1..1 at SAMPLE_RATE. */
  data: Float32Array;
  /** The pitch the sample sounds at playback rate 1. */
  rootHz: number;
  loop: boolean;
  /** Loop region in samples (multiples of 16, the BRR block); for one-shots 0 / length. */
  loopStart: number;
  loopEnd: number;
  envelope: Envelope;
  /** Mix gain at velocity 1 (balances the set). */
  gain: number;
  /** Noise instruments play at rate 1; the note's pitch sets this filter's centre instead. */
  noise?: NoiseFilter;
}

/** The note pitch → the noise filter's centre, clamped to the instrument's band. */
export function noiseFilterHz(s: InstrumentSample, pitch: number): number {
  const f = s.noise!;
  return Math.max(f.minHz, Math.min(f.maxHz, midiToHz(pitch)));
}

// — building blocks —

interface Partial {
  bin: number;
  amp: number;
}

/** Sum of sines at integer bins of `len` — periodic over `len` by construction. Phases are seeded. */
function additive(len: number, partials: Partial[], seed: number): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(len);
  for (const p of partials) {
    if (p.amp === 0) continue;
    const w = (2 * Math.PI * p.bin) / len;
    const ph = rnd() * 2 * Math.PI;
    // rotate a phasor instead of calling sin per sample (re-anchored every 1024 steps to stop drift)
    for (let i0 = 0; i0 < len; i0 += 1024) {
      let re = Math.cos(w * i0 + ph);
      let im = Math.sin(w * i0 + ph);
      const cr = Math.cos(w);
      const ci = Math.sin(w);
      const end = Math.min(len, i0 + 1024);
      for (let i = i0; i < end; i++) {
        out[i] = out[i]! + p.amp * im;
        const nr = re * cr - im * ci;
        im = re * ci + im * cr;
        re = nr;
      }
    }
  }
  return out;
}

/** A harmonic series on root bin `r`: amp(k) for k = 1..n (bins below Nyquist only). Detune `d` moves the
 *  root by d bins (every harmonic k·(r+d)) — a constant-cents shift that stays periodic. */
function harmonics(r: number, n: number, amp: (k: number) => number, d = 0, len = 0): Partial[] {
  const out: Partial[] = [];
  for (let k = 1; k <= n; k++) {
    const bin = k * (r + d);
    if (len && (bin * SAMPLE_RATE) / len >= 15000) break;
    out.push({ bin, amp: amp(k) });
  }
  return out;
}

/** Resonance weight of frequency `hz` under formants [centre, bandwidth, gain]. */
function formant(hz: number, fs: readonly (readonly [number, number, number])[]): number {
  let g = 0;
  for (const [c, bw, gain] of fs) g += gain / (1 + ((hz - c) / bw) ** 2);
  return g;
}

function normalise(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i]! * peak) / m;
  return x;
}

interface Spec {
  /** The loop (periodic) or the one-shot body. */
  body: Float32Array;
  loop: boolean;
  rootHz: number;
  envelope: Envelope;
  gain: number;
  /** A non-looped transient before the loop: f(i) for i in 0..len-1, faded to 0 at the junction. */
  attack?: { len: number; f: (i: number) => number };
  noise?: NoiseFilter;
}

/** Assemble a spec into the sample the S-DSP would hold: [attack | loop], Gaussian-softened, BRR-crunched. */
function finish(id: InstrumentId, s: Spec): InstrumentSample {
  const L = s.body.length;
  const body = gaussianFilter(s.body, s.loop);
  let data: Float32Array;
  let loopStart = 0;
  if (s.attack) {
    const A = s.attack.len;
    data = new Float32Array(A + L);
    for (let i = 0; i < A; i++) {
      const fade = (1 - i / A) ** 2;
      data[i] = body[(((i - A) % L) + L) % L]! + s.attack.f(i) * fade; // the loop's own past, plus the hit
    }
    data.set(body, A);
    loopStart = A;
  } else {
    data = body;
  }
  data = brrQuantise(normalise(data));
  return {
    id,
    data,
    rootHz: s.rootHz,
    loop: s.loop,
    loopStart: s.loop ? loopStart : 0,
    loopEnd: data.length,
    envelope: s.envelope,
    gain: s.gain,
    ...(s.noise ? { noise: s.noise } : {}),
  };
}

// Loop lengths: 8192 samples (256 ms, bin 3.906 Hz) for most; 16384 (512 ms, bin 1.953 Hz) for the slow ensembles.
const L8 = 8192;
const L16 = 16384;
const hzOf = (bin: number, len: number): number => (bin * SAMPLE_RATE) / len;

/** A bright, decaying noise "hit" (hammer, pluck, mallet) for attack transients. */
function hit(seed: number, decay: number, tone = 0, toneHz = 0): (i: number) => number {
  const rnd = mulberry32(seed);
  let lp = 0;
  return (i) => {
    lp += 0.5 * (rnd() * 2 - 1 - lp);
    const n = lp * Math.exp(-i / decay);
    return tone ? n + tone * Math.sin((2 * Math.PI * toneHz * i) / SAMPLE_RATE) * Math.exp(-i / (decay * 2)) : n;
  };
}

/** One-shot body: f(i) for n samples. */
function oneShot(n: number, f: (i: number) => number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = f(i);
  return out;
}

const SPECS: Record<InstrumentId, () => Spec> = {
  piano: () => ({
    body: additive(L8, harmonics(128, 16, (k) => (k === 1 ? 1 : 0.7 / k ** 1.4), 0, L8), 11),
    loop: true,
    rootHz: hzOf(128, L8),
    envelope: { attack: 0.003, decay: 0.9, sustain: 0.12, release: 0.3 },
    gain: 0.55,
    attack: { len: 1024, f: hit(12, 90, 0.4, 2000) },
  }),
  harp: () => ({
    body: additive(L8, harmonics(128, 12, (k) => 1 / k ** 2), 21),
    loop: true,
    rootHz: hzOf(128, L8),
    envelope: { attack: 0.002, decay: 0.7, sustain: 0, release: 0.4 },
    gain: 0.6,
    attack: { len: 512, f: hit(22, 40) },
  }),
  strings: () => {
    const saw = (k: number) => 1 / k;
    return {
      body: additive(L16, [...harmonics(128, 20, saw), ...harmonics(128, 20, saw, 1)], 31),
      loop: true,
      rootHz: hzOf(128, L16),
      envelope: { attack: 0.14, decay: 0.6, sustain: 0.85, release: 0.4 },
      gain: 0.4,
    };
  },
  flute: () => {
    const rnd = mulberry32(41);
    const breath: Partial[] = [];
    for (let j = 0; j < 120; j++) breath.push({ bin: 60 + Math.floor(rnd() * 400), amp: 0.006 });
    return {
      body: additive(L8, [{ bin: 128, amp: 1 }, { bin: 256, amp: 0.22 }, { bin: 384, amp: 0.08 }, ...breath], 42),
      loop: true,
      rootHz: hzOf(128, L8),
      envelope: { attack: 0.06, decay: 0.3, sustain: 0.9, release: 0.12 },
      gain: 0.5,
    };
  },
  oboe: () => {
    const fs = [[1100, 350, 1], [2700, 500, 0.45]] as const;
    return {
      body: additive(L8, harmonics(128, 18, (k) => 0.15 / k + formant(k * hzOf(128, L8), fs), 0, L8), 51),
      loop: true,
      rootHz: hzOf(128, L8),
      envelope: { attack: 0.03, decay: 0.3, sustain: 0.9, release: 0.1 },
      gain: 0.42,
    };
  },
  horn: () => ({
    body: additive(L8, harmonics(64, 14, (k) => Math.exp(-0.45 * (k - 1))), 61),
    loop: true,
    rootHz: hzOf(64, L8),
    envelope: { attack: 0.06, decay: 0.5, sustain: 0.8, release: 0.2 },
    gain: 0.5,
  }),
  organ: () => {
    const bars: [number, number][] = [[1, 1], [2, 0.7], [3, 0.45], [4, 0.4], [6, 0.2], [8, 0.25]];
    return {
      body: additive(L8, bars.map(([m, a]) => ({ bin: 128 * m, amp: a })), 71),
      loop: true,
      rootHz: hzOf(128, L8),
      envelope: { attack: 0.006, decay: 0.1, sustain: 1, release: 0.07 },
      gain: 0.32,
    };
  },
  choir: () => {
    // 'aah': F1 800, F2 1150, F3 2900, three voices a hair apart
    const fs = [[800, 120, 1], [1150, 140, 0.7], [2900, 250, 0.25]] as const;
    const v = (d: number) => harmonics(128, 40, (k) => (0.08 / k + formant(k * hzOf(128 + d, L16), fs)) / k ** 0.3, d, L16);
    return {
      body: additive(L16, [...v(0), ...v(1), ...v(-1)], 81),
      loop: true,
      rootHz: hzOf(128, L16),
      envelope: { attack: 0.25, decay: 0.5, sustain: 0.9, release: 0.5 },
      gain: 0.4,
    };
  },
  bell: () => ({
    body: additive(L8, [[1, 1], [2, 0.55], [2.76, 0.6], [5.4, 0.25], [8.93, 0.15]].map(([r, a]) => ({ bin: Math.round(128 * r!), amp: a! })), 91),
    loop: true,
    rootHz: hzOf(128, L8),
    envelope: { attack: 0.002, decay: 1.4, sustain: 0, release: 0.9 },
    gain: 0.45,
    attack: { len: 256, f: hit(92, 20) },
  }),
  marimba: () => ({
    body: additive(L8, [{ bin: 128, amp: 1 }, { bin: 500, amp: 0.3 }, { bin: 1178, amp: 0.06 }], 101),
    loop: true,
    rootHz: hzOf(128, L8),
    envelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.12 },
    gain: 0.65,
    attack: { len: 512, f: hit(102, 30, 0.3, 4000) },
  }),
  bass: () => ({
    body: additive(L8, harmonics(32, 12, (k) => 0.62 ** (k - 1)), 111),
    loop: true,
    rootHz: hzOf(32, L8),
    envelope: { attack: 0.004, decay: 0.6, sustain: 0.55, release: 0.12 },
    gain: 0.7,
    attack: { len: 512, f: hit(112, 25) },
  }),
  pluck: () => ({
    body: additive(L8, harmonics(128, 20, (k) => (k % 2 ? 1 : 0.6) / k ** 1.2, 0, L8), 121),
    loop: true,
    rootHz: hzOf(128, L8),
    envelope: { attack: 0.002, decay: 0.32, sustain: 0, release: 0.15 },
    gain: 0.55,
    attack: { len: 512, f: hit(122, 35) },
  }),
  pad: () => {
    const soft = (k: number) => 1 / k ** 1.7;
    return {
      body: additive(L16, [...harmonics(128, 16, soft), ...harmonics(128, 16, soft, 1), ...harmonics(128, 16, soft, -1)], 131),
      loop: true,
      rootHz: hzOf(128, L16),
      envelope: { attack: 0.6, decay: 1.0, sustain: 0.9, release: 1.0 },
      gain: 0.36,
    };
  },
  chant: () => {
    // a soft open vowel between 'ah' and 'oh' (F1 ≈ 600, F2 ≈ 950, a faint F3), low male-ish root, two voices
    // a hair apart and a breath — suited to unhurried recitation
    const fs = [[600, 110, 1], [950, 140, 0.55], [2450, 220, 0.12]] as const;
    const v = (d: number) => harmonics(80, 34, (k) => (0.05 / k + formant(k * hzOf(80 + d, L16), fs)) / k ** 0.6, d, L16);
    const rnd = mulberry32(141);
    const breath: Partial[] = [];
    for (let j = 0; j < 80; j++) breath.push({ bin: 200 + Math.floor(rnd() * 600), amp: 0.004 });
    return {
      body: additive(L16, [...v(0), ...v(1), ...breath], 142),
      loop: true,
      rootHz: hzOf(80, L16),
      envelope: { attack: 0.15, decay: 0.6, sustain: 0.9, release: 0.35 },
      gain: 0.5,
    };
  },
  click: () => {
    const rnd = mulberry32(151);
    return {
      body: oneShot(1600, (i) => Math.sin((2 * Math.PI * 1800 * i) / SAMPLE_RATE) * Math.exp(-i / 220) + (rnd() * 2 - 1) * 0.6 * Math.exp(-i / 60)),
      loop: false,
      rootHz: midiToHz(72),
      envelope: { attack: 0.001, decay: 1, sustain: 1, release: 0.01 },
      gain: 0.5,
    };
  },
  thud: () => {
    let ph = 0;
    const rnd = mulberry32(161);
    return {
      body: oneShot(8000, (i) => {
        const t = i / SAMPLE_RATE;
        ph += (2 * Math.PI * (55 + 70 * Math.exp(-t / 0.04))) / SAMPLE_RATE;
        return (Math.sin(ph) + (rnd() * 2 - 1) * 0.3 * Math.exp(-t / 0.008)) * Math.exp(-t / 0.06);
      }),
      loop: false,
      rootHz: midiToHz(36),
      envelope: { attack: 0.001, decay: 1, sustain: 1, release: 0.03 },
      gain: 0.8,
    };
  },
  chime: () => ({
    body: additive(L8, [[1, 1], [2, 0.6], [3, 0.35], [4.16, 0.3], [5.43, 0.18]].map(([r, a]) => ({ bin: Math.round(256 * r!), amp: a! })), 171),
    loop: true,
    rootHz: hzOf(256, L8),
    envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.6 },
    gain: 0.4,
    attack: { len: 256, f: hit(172, 12) },
  }),
  noise: () => {
    const rnd = mulberry32(181);
    return {
      body: oneShot(L16, () => rnd() * 2 - 1),
      loop: true,
      rootHz: 440,
      envelope: { attack: 0.02, decay: 1, sustain: 1, release: 0.2 },
      gain: 0.35,
      noise: { type: 'bandpass', q: 0.8, minHz: 80, maxHz: 12000 },
    };
  },
  rumble: () => {
    const parts: Partial[] = [];
    for (let b = 8; b <= 160; b++) parts.push({ bin: b, amp: 1 / Math.sqrt(b) });
    return {
      body: additive(L16, parts, 191),
      loop: true,
      rootHz: 440,
      envelope: { attack: 0.05, decay: 1, sustain: 1, release: 0.4 },
      gain: 0.6,
      noise: { type: 'lowpass', q: 0.7, minHz: 40, maxHz: 800 },
    };
  },
  chirp: () => {
    let ph = 0;
    const n = 4480;
    const f0 = midiToHz(96);
    return {
      body: oneShot(n, (i) => {
        const t = i / n;
        const sweep = 0.8 + 0.5 * Math.sin(Math.PI * t); // up and back down
        const warble = 1 + 0.06 * Math.sin(2 * Math.PI * 38 * (i / SAMPLE_RATE));
        ph += (2 * Math.PI * f0 * sweep * warble) / SAMPLE_RATE;
        return Math.sin(ph) * Math.sin(Math.PI * t) ** 2;
      }),
      loop: false,
      rootHz: f0,
      envelope: { attack: 0.002, decay: 1, sustain: 1, release: 0.02 },
      gain: 0.35,
    };
  },
};

/** Bake one instrument's sample (deterministic; the engine caches the result). */
export function bakeInstrument(id: InstrumentId): InstrumentSample {
  return finish(id, SPECS[id]());
}
