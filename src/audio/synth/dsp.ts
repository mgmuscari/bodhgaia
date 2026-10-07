// The S-DSP's pure arithmetic (PURE — no WebAudio). The SNES sound chip plays 4-bit BRR-compressed samples at
// 32 kHz, pitched by a playback step and smoothed by a 4-tap Gaussian interpolator, and runs a global echo: a
// feedback delay (EDL × 16 ms) with an 8-tap FIR filter in the loop. These are the pieces the engine bakes into
// its samples and graph; each is deterministic so every instrument renders identically on every machine.

/** The S-DSP's output rate. Every instrument sample is rendered at this rate. */
export const SAMPLE_RATE = 32000;

export function midiToHz(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/** Playback rate that sounds `pitch` from a sample whose rate-1 frequency is `rootHz`. */
export function pitchToRate(pitch: number, rootHz: number): number {
  return midiToHz(pitch) / rootHz;
}

// — Gaussian interpolation —
// The S-DSP interpolates with a 4-tap Gaussian kernel; at the sample points (fraction 0) three taps are live:
// ≈ 372, 1304, 372 of 2048. As a filter over the sample data that is a gentle low-pass (−3.9 dB at a quarter
// of the rate, −11 dB at Nyquist) — the SNES's muffled, warm top end. Applied to the sample data at its own
// rate, it scales with pitch exactly as the hardware's does.

export const GAUSS_TAPS: readonly [number, number, number] = [372 / 2048, 1304 / 2048, 372 / 2048];

/** Smooth `x` with the Gaussian taps. `loop` wraps the ends (a seamless loop); otherwise the ends clamp. */
export function gaussianFilter(x: Float32Array, loop: boolean): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const [a, b, c] = GAUSS_TAPS;
  const at = (i: number): number => {
    if (loop) return x[((i % n) + n) % n]!;
    return x[Math.min(n - 1, Math.max(0, i))]!;
  };
  for (let i = 0; i < n; i++) out[i] = a * at(i - 1) + b * x[i]! + c * at(i + 1);
  return out;
}

// — BRR —
// Bit Rate Reduction: blocks of 16 samples, each a 4-bit signed nibble scaled by a per-block shift, optionally
// predicted from the previous decoded sample (filter 1: p·15/16). The encoder is closed-loop (it predicts from
// what the DECODER will have), picks the filter/shift with the least error, and we keep the decoded result —
// the quantisation noise is the grit.

const FULL = 32768;

export interface BrrBlock {
  nibbles: number[];
  shift: number;
  filter: 0 | 1;
  /** The decoded samples, in −1..1. */
  decoded: Float32Array;
}

/** Encode one block (≤ 16 samples, −1..1) given the decoder's previous output sample `prev` (−1..1). */
export function brrEncodeBlock(block: Float32Array, prev = 0): BrrBlock {
  let best: BrrBlock | null = null;
  let bestErr = Infinity;
  const p0 = Math.round(prev * FULL);
  for (const filter of [0, 1] as const) {
    for (let shift = 0; shift <= 12; shift++) {
      const step = 1 << shift;
      const nibbles: number[] = [];
      const decoded = new Float32Array(block.length);
      let p = p0;
      let err = 0;
      for (let i = 0; i < block.length; i++) {
        const x = Math.round(block[i]! * FULL);
        const pred = filter === 1 ? Math.trunc((p * 15) / 16) : 0;
        const nib = Math.max(-8, Math.min(7, Math.round((x - pred) / step)));
        const d = Math.max(-FULL, Math.min(FULL - 1, nib * step + pred));
        nibbles.push(nib);
        decoded[i] = d / FULL;
        err += (x - d) * (x - d);
        p = d;
      }
      if (err < bestErr) {
        bestErr = err;
        best = { nibbles, shift, filter, decoded };
      }
    }
  }
  return best!;
}

/** Run a whole sample through the BRR codec and return what the S-DSP would play. */
export function brrQuantise(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  let prev = 0;
  for (let i = 0; i < x.length; i += 16) {
    const blk = brrEncodeBlock(x.subarray(i, Math.min(x.length, i + 16)), prev);
    out.set(blk.decoded, i);
    prev = blk.decoded[blk.decoded.length - 1]!;
  }
  return out;
}

// — Echo —
// The classic low-pass FIR many SNES games load into the echo filter (FF 08 17 24 24 17 08 FF, signed, /128):
// a zero at Nyquist and a soft roll-off, so each repeat comes back darker — the unmistakable SNES reverb.

export const ECHO_FIR: readonly number[] = [-1, 8, 23, 36, 36, 23, 8, -1].map((c) => c / 128);

/** Magnitude response of FIR `taps` (at `rate`) at `hz`. */
export function firGainAt(taps: readonly number[], hz: number, rate = SAMPLE_RATE): number {
  const w = (2 * Math.PI * hz) / rate;
  let re = 0;
  let im = 0;
  taps.forEach((c, k) => {
    re += c * Math.cos(w * k);
    im -= c * Math.sin(w * k);
  });
  return Math.hypot(re, im);
}

/** The FIR as an impulse response at the audio context's rate (taps are 1/32000 s apart): linearly
 *  interpolated, then renormalised so the DC gain matches the hardware filter. */
export function resampleFir(taps: readonly number[], toRate: number): Float32Array {
  if (toRate === SAMPLE_RATE) return Float32Array.from(taps);
  const r = SAMPLE_RATE / toRate;
  const len = Math.ceil((taps.length - 1) / r) + 1;
  const ir = new Float32Array(len);
  for (let n = 0; n < len; n++) {
    const pos = n * r;
    const i = Math.floor(pos);
    const f = pos - i;
    ir[n] = (taps[i] ?? 0) * (1 - f) + (taps[i + 1] ?? 0) * f;
  }
  const want = taps.reduce((a, b) => a + b, 0);
  const got = ir.reduce((a, b) => a + b, 0);
  if (got !== 0) for (let n = 0; n < len; n++) ir[n] = ir[n]! * (want / got);
  return ir;
}

/** The echo delay register: EDL × 16 ms, EDL in the hardware's 1..15 (0 is a 4-sample blip on the chip). */
export function echoDelaySeconds(edl: number): number {
  return Math.max(1, Math.min(15, Math.round(edl))) * 0.016;
}

// — Determinism —

/** A tiny seeded PRNG (for noise, phases) — the same sample bytes on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
