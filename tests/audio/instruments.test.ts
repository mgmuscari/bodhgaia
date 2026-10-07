import { describe, it, expect } from 'vitest';
import { INSTRUMENTS, type InstrumentId } from '../../src/audio/contract';
import { bakeInstrument, noiseFilterHz } from '../../src/audio/synth/instruments';
import { SAMPLE_RATE } from '../../src/audio/synth/dsp';

// Every contract instrument is a tiny SNES-style sample baked in code: a short loop (or a one-shot) at 32 kHz,
// Gaussian-softened and BRR-crunched, with its own ADSR and a root frequency for pitching.

const ONE_SHOTS: InstrumentId[] = ['click', 'thud', 'chirp'];
const NOISES: InstrumentId[] = ['noise', 'rumble'];
const INHARMONIC: InstrumentId[] = ['bell', 'chime', 'marimba'];

const baked = new Map(INSTRUMENTS.map((id) => [id, bakeInstrument(id)]));
const get = (id: InstrumentId) => baked.get(id)!;

const rms = (x: Float32Array, a = 0, b = x.length): number => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, b - a));
};

/** Normalised autocorrelation of the loop at lag `p` (circular). */
const loopCorr = (x: Float32Array, a: number, b: number, p: number): number => {
  const n = b - a;
  let xy = 0;
  let xx = 0;
  for (let i = 0; i < n; i++) {
    const u = x[a + i]!;
    const v = x[a + ((i + p) % n)]!;
    xy += u * v;
    xx += u * u;
  }
  return xy / xx;
};

/** Spectral centroid (Hz) of the loop over harmonic bins up to 8 kHz (a naive DFT is enough here). */
const centroid = (x: Float32Array, a: number, b: number): number => {
  const n = b - a;
  let num = 0;
  let den = 0;
  for (let hz = 50; hz < 8000; hz += 25) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * hz) / SAMPLE_RATE;
    for (let i = 0; i < n; i += 2) {
      re += x[a + i]! * Math.cos(w * i);
      im += x[a + i]! * Math.sin(w * i);
    }
    const m = Math.hypot(re, im);
    num += m * hz;
    den += m;
  }
  return num / den;
};

describe('the instrument set', () => {
  it('bakes every contract instrument', () => {
    for (const id of INSTRUMENTS) expect(get(id), id).toBeDefined();
  });

  for (const id of INSTRUMENTS) {
    describe(id, () => {
      const s = get(id);
      it('is a tiny, finite, non-silent, unclipped sample', () => {
        expect(s.data.length).toBeGreaterThan(256);
        expect(s.data.length).toBeLessThanOrEqual(0.6 * SAMPLE_RATE);
        let peak = 0;
        for (const v of s.data) {
          expect(Number.isFinite(v)).toBe(true);
          peak = Math.max(peak, Math.abs(v));
        }
        expect(peak).toBeLessThanOrEqual(1);
        expect(peak).toBeGreaterThan(0.3);
        expect(rms(s.data)).toBeGreaterThan(0.02);
      });
      it('has a usable envelope, gain and root', () => {
        const e = s.envelope;
        for (const v of [e.attack, e.decay, e.release]) expect(v).toBeGreaterThanOrEqual(0);
        expect(e.sustain).toBeGreaterThanOrEqual(0);
        expect(e.sustain).toBeLessThanOrEqual(1);
        expect(s.gain).toBeGreaterThan(0);
        expect(s.gain).toBeLessThanOrEqual(1);
        expect(s.rootHz).toBeGreaterThan(20);
      });
      if (ONE_SHOTS.includes(id)) {
        it('is a one-shot that decays to silence', () => {
          expect(s.loop).toBe(false);
          expect(rms(s.data, s.data.length - 64)).toBeLessThan(0.02);
        });
      } else {
        it('loops on BRR block boundaries, seamlessly', () => {
          expect(s.loop).toBe(true);
          expect(s.loopStart % 16).toBe(0);
          expect(s.loopEnd % 16).toBe(0);
          expect(s.loopStart).toBeGreaterThanOrEqual(0);
          expect(s.loopEnd).toBeLessThanOrEqual(s.data.length);
          expect(s.loopEnd - s.loopStart).toBeGreaterThanOrEqual(1024);
          let maxStep = 0;
          for (let i = s.loopStart + 1; i < s.loopEnd; i++) maxStep = Math.max(maxStep, Math.abs(s.data[i]! - s.data[i - 1]!));
          const seam = Math.abs(s.data[s.loopStart]! - s.data[s.loopEnd - 1]!);
          expect(seam).toBeLessThanOrEqual(maxStep * 1.5 + 0.01);
        });
      }
      if (!ONE_SHOTS.includes(id) && !NOISES.includes(id) && !INHARMONIC.includes(id)) {
        it('repeats at its root period (it is in tune)', () => {
          const p = Math.round(SAMPLE_RATE / s.rootHz);
          expect(loopCorr(s.data, s.loopStart, s.loopEnd, p)).toBeGreaterThan(0.85);
        });
      }
    });
  }

  it('is deterministic (same bytes every bake)', () => {
    for (const id of INSTRUMENTS) expect(Array.from(bakeInstrument(id).data)).toEqual(Array.from(get(id).data));
  });

  it('noise instruments map pitch to a bounded filter centre; tonal ones have none', () => {
    for (const id of NOISES) {
      const s = get(id);
      expect(s.noise).toBeDefined();
      const lo = noiseFilterHz(s, 0);
      const hi = noiseFilterHz(s, 127);
      expect(lo).toBeGreaterThanOrEqual(s.noise!.minHz);
      expect(hi).toBeLessThanOrEqual(s.noise!.maxHz);
      expect(noiseFilterHz(s, 69)).toBeGreaterThan(lo);
    }
    expect(get('piano').noise).toBeUndefined();
    expect(get('rumble').noise!.maxHz).toBeLessThan(get('noise').noise!.maxHz);
  });

  it('timbres sit where their names say', () => {
    const c = (id: InstrumentId) => centroid(get(id).data, get(id).loopStart, get(id).loopEnd);
    // the chant is a soft vowel — darker than the reedy oboe and the bowed strings
    expect(c('chant')).toBeLessThan(c('oboe'));
    expect(c('chant')).toBeLessThan(c('strings'));
    // the flute is purer than the strings; the bass is low
    expect(c('flute')).toBeLessThan(c('strings'));
    expect(get('bass').rootHz).toBeLessThan(get('piano').rootHz / 2);
    expect(c('rumble')).toBeLessThan(c('noise'));
  });

  it('struck/plucked voices die away; held voices sustain', () => {
    for (const id of ['piano', 'harp', 'pluck', 'bell', 'marimba', 'chime'] as const) {
      expect(get(id).envelope.sustain, id).toBeLessThanOrEqual(0.2);
    }
    for (const id of ['strings', 'organ', 'flute', 'choir', 'pad', 'chant'] as const) {
      expect(get(id).envelope.sustain, id).toBeGreaterThanOrEqual(0.7);
    }
    expect(get('pad').envelope.attack).toBeGreaterThan(get('piano').envelope.attack);
  });
});
