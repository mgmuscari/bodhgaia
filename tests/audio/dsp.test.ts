import { describe, it, expect } from 'vitest';
import {
  SAMPLE_RATE,
  midiToHz,
  pitchToRate,
  GAUSS_TAPS,
  gaussianFilter,
  brrEncodeBlock,
  brrQuantise,
  ECHO_FIR,
  firGainAt,
  resampleFir,
  echoDelaySeconds,
  mulberry32,
  softClipCurve,
} from '../../src/audio/synth/dsp';

// The S-DSP's pure arithmetic: pitch → playback rate, the Gaussian interpolation's low-pass, the 4-bit BRR
// quantiser (the crunch), and the echo's FIR. All deterministic so samples bake identically everywhere.

const sine = (n: number, period: number, amp = 0.9): Float32Array => {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * i) / period);
  return out;
};

describe('pitch', () => {
  it('runs the S-DSP at 32 kHz', () => {
    expect(SAMPLE_RATE).toBe(32000);
  });
  it('MIDI 69 is A440 and an octave doubles', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 9);
    expect(midiToHz(81)).toBeCloseTo(880, 9);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
  });
  it('playback rate = target Hz / the sample root Hz', () => {
    expect(pitchToRate(69, 440)).toBeCloseTo(1, 12);
    expect(pitchToRate(81, 440)).toBeCloseTo(2, 12);
    expect(pitchToRate(57, 440)).toBeCloseTo(0.5, 12);
    expect(pitchToRate(60, 500)).toBeCloseTo(261.6256 / 500, 5);
  });
});

describe('Gaussian interpolation as a low-pass', () => {
  it('taps are symmetric-ish and sum to 1 (DC preserved)', () => {
    expect(GAUSS_TAPS.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(GAUSS_TAPS[0]).toBeCloseTo(GAUSS_TAPS[2]!, 2);
  });
  it('passes DC, softens Nyquist to about a quarter (the SNES muffle)', () => {
    const dc = gaussianFilter(new Float32Array(64).fill(0.5), true);
    for (const v of dc) expect(v).toBeCloseTo(0.5, 6);
    const nyq = new Float32Array(64).map((_, i) => (i % 2 ? -0.8 : 0.8));
    const out = gaussianFilter(nyq, true);
    const peak = Math.max(...Array.from(out, Math.abs));
    expect(peak).toBeGreaterThan(0.8 * 0.2);
    expect(peak).toBeLessThan(0.8 * 0.35);
  });
  it('wraps circularly for loops (no seam), clamps at the ends for one-shots', () => {
    const x = sine(64, 16);
    const circ = gaussianFilter(x, true);
    const lin = gaussianFilter(x, false);
    expect(circ[0]).not.toBeCloseTo(lin[0]!, 6);
    expect(circ[10]).toBeCloseTo(lin[10]!, 9);
  });
});

describe('BRR quantiser (4-bit nibbles, per-block shift + filter)', () => {
  it('encodes 16 samples into nibbles in [-8, 7] with a shift in [0, 12] and filter 0 or 1', () => {
    const blk = brrEncodeBlock(sine(16, 16), 0);
    expect(blk.nibbles).toHaveLength(16);
    for (const n of blk.nibbles) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(-8);
      expect(n).toBeLessThanOrEqual(7);
    }
    expect(blk.shift).toBeGreaterThanOrEqual(0);
    expect(blk.shift).toBeLessThanOrEqual(12);
    expect([0, 1]).toContain(blk.filter);
  });

  it('adds grit — a full-scale sine is not reproduced exactly — but stays close (SNR > 15 dB)', () => {
    const x = sine(512, 37);
    const y = brrQuantise(x);
    expect(y).toHaveLength(512);
    let err = 0;
    let sig = 0;
    let differs = 0;
    for (let i = 0; i < x.length; i++) {
      const e = y[i]! - x[i]!;
      if (Math.abs(e) > 1e-6) differs++;
      err += e * e;
      sig += x[i]! * x[i]!;
    }
    expect(differs).toBeGreaterThan(64);
    expect(10 * Math.log10(sig / err)).toBeGreaterThan(15);
  });

  it('is deterministic, bounded, NaN-free, and keeps silence silent', () => {
    const x = sine(256, 23, 1);
    const a = brrQuantise(x);
    const b = brrQuantise(x);
    expect(Array.from(a)).toEqual(Array.from(b));
    for (const v of a) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    expect(Array.from(brrQuantise(new Float32Array(32)))).toEqual(new Array(32).fill(0));
  });

  it('pads nothing: a length that is not a multiple of 16 is still handled', () => {
    expect(brrQuantise(sine(40, 10))).toHaveLength(40);
  });
});

describe('the echo (S-DSP feedback delay with an 8-tap FIR in the loop)', () => {
  it('has 8 signed 8-bit taps over 128 (the classic low-pass set)', () => {
    expect(ECHO_FIR).toHaveLength(8);
    for (const c of ECHO_FIR) {
      expect(Number.isInteger(c * 128)).toBe(true);
      expect(c * 128).toBeGreaterThanOrEqual(-128);
      expect(c * 128).toBeLessThanOrEqual(127);
    }
  });
  it('is a low-pass: ~unity at DC, silent at Nyquist, and quieter at 8 kHz than at 1 kHz', () => {
    expect(firGainAt(ECHO_FIR, 0)).toBeGreaterThan(0.95);
    expect(firGainAt(ECHO_FIR, 0)).toBeLessThan(1.1);
    expect(firGainAt(ECHO_FIR, 16000)).toBeLessThan(0.02);
    expect(firGainAt(ECHO_FIR, 8000)).toBeLessThan(firGainAt(ECHO_FIR, 1000) * 0.5);
  });
  it('resamples to the context rate keeping the DC gain (identity at 32 kHz)', () => {
    expect(Array.from(resampleFir(ECHO_FIR, 32000))).toEqual(Array.from(Float32Array.from(ECHO_FIR)));
    for (const rate of [44100, 48000, 96000]) {
      const ir = resampleFir(ECHO_FIR, rate);
      const sum = ir.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(firGainAt(ECHO_FIR, 0), 2);
      expect(ir.length).toBeGreaterThanOrEqual(8);
    }
  });
  it('EDL × 16 ms delay, clamped to the hardware 1..15', () => {
    expect(echoDelaySeconds(7)).toBeCloseTo(0.112, 9);
    expect(echoDelaySeconds(0)).toBeCloseTo(0.016, 9);
    expect(echoDelaySeconds(99)).toBeCloseTo(0.24, 9);
  });
});

describe('softClipCurve (the output safety net after the limiter)', () => {
  it('is the identity in the body, odd, monotonic, and never reaches full scale', () => {
    const c = softClipCurve(1025);
    expect(c).toHaveLength(1025);
    const x = (i: number) => (i / 1024) * 2 - 1;
    for (let i = 0; i < c.length; i++) {
      expect(Math.abs(c[i]!)).toBeLessThan(1);
      expect(c[i]!).toBeCloseTo(-c[c.length - 1 - i]!, 6);
      if (i) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
      if (Math.abs(x(i)) <= 0.5) expect(c[i]!).toBeCloseTo(x(i), 6);
    }
  });
});

describe('mulberry32', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
