import { describe, it, expect } from 'vitest';
import { envelopeAt, envelopeSchedule, releaseSchedule, releaseEnd, type Envelope, type EnvEvent } from '../../src/audio/synth/envelope';

// The S-DSP ADSR shape: a LINEAR attack, an EXPONENTIAL decay toward the sustain level, then a LINEAR release
// to silence. envelopeAt is the curve; envelopeSchedule is the same curve as WebAudio automation events, so
// the engine shell only replays them (and the tests below check the two agree).

const env: Envelope = { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.2 };

/** Evaluate a WebAudio automation list the way an AudioParam would (set / linear ramp / setTarget). */
function evalEvents(events: EnvEvent[], t: number): number {
  let v = 0;
  let prevT = -Infinity;
  let prevV = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.kind === 'set') {
      if (t < e.t) return v;
      v = e.v;
    } else if (e.kind === 'linear') {
      if (t < e.t) return prevV + ((e.v - prevV) * (t - prevT)) / (e.t - prevT);
      v = e.v;
    } else {
      const next = events[i + 1];
      const end = next ? next.t : Infinity;
      if (t < e.t) return v;
      const tt = Math.min(t, end);
      const start = v;
      v = e.v + (start - e.v) * Math.exp(-(tt - e.t) / e.tau);
      if (t < end) return v;
    }
    prevT = e.t;
    prevV = v;
  }
  return v;
}

describe('envelopeAt (the ADSR curve)', () => {
  it('rises linearly from 0 to the peak over the attack', () => {
    expect(envelopeAt(env, 0, 0.8)).toBe(0);
    expect(envelopeAt(env, 0.01, 0.8)).toBeCloseTo(0.4, 9);
    expect(envelopeAt(env, 0.02, 0.8)).toBeCloseTo(0.8, 9);
  });
  it('decays exponentially toward sustain × peak and never below it', () => {
    const a = envelopeAt(env, 0.02 + 0.3, 1);
    expect(a).toBeCloseTo(0.5 + 0.5 * Math.exp(-1), 9);
    expect(envelopeAt(env, 10, 1)).toBeCloseTo(0.5, 6);
    expect(envelopeAt(env, 10, 1)).toBeGreaterThanOrEqual(0.5);
  });
  it('releases linearly from the level at gate-off to 0 over `release`', () => {
    const off = 1;
    const lvl = envelopeAt(env, off, 1);
    expect(envelopeAt(env, off + 0.1, 1, off)).toBeCloseTo(lvl / 2, 9);
    expect(envelopeAt(env, off + 0.2, 1, off)).toBe(0);
    expect(envelopeAt(env, off + 5, 1, off)).toBe(0);
  });
  it('gate-off during the attack releases from the partial level', () => {
    expect(envelopeAt(env, 0.01, 1, 0.01)).toBeCloseTo(0.5, 9);
    expect(envelopeAt(env, 0.11, 1, 0.01)).toBeCloseTo(0.25, 9);
  });
  it('sustain 0 is a plucked/struck decay to silence', () => {
    const pluck: Envelope = { attack: 0.002, decay: 0.4, sustain: 0, release: 0.1 };
    expect(envelopeAt(pluck, 5, 1)).toBeLessThan(0.001);
  });
});

describe('envelopeSchedule (the same curve as automation events)', () => {
  it('agrees with envelopeAt everywhere, with and without a gate-off', () => {
    for (const stop of [undefined, 0.5, 0.01]) {
      const ev = envelopeSchedule(env, 2, 0.7, stop === undefined ? undefined : 2 + stop);
      for (let t = 0; t < 1.5; t += 0.0037) {
        expect(evalEvents(ev, 2 + t)).toBeCloseTo(envelopeAt(env, t, 0.7, stop), 6);
      }
    }
  });
  it('starts with a set to 0 at the start time and is time-ordered', () => {
    const ev = envelopeSchedule(env, 3, 1, 4);
    expect(ev[0]).toEqual({ kind: 'set', t: 3, v: 0 });
    for (let i = 1; i < ev.length; i++) expect(ev[i]!.t).toBeGreaterThanOrEqual(ev[i - 1]!.t);
  });
  it('release from an arbitrary later stop: set the current level, ramp to 0', () => {
    const ev = releaseSchedule(env, 0, 1, 0.8);
    expect(ev).toEqual([
      { kind: 'set', t: 0.8, v: envelopeAt(env, 0.8, 1) },
      { kind: 'linear', t: 1.0, v: 0 },
    ]);
    expect(releaseEnd(env, 0.8)).toBeCloseTo(1.0, 9);
  });
  it('a zero-length attack/release is clamped to a click-free minimum', () => {
    const hard: Envelope = { attack: 0, decay: 0.1, sustain: 1, release: 0 };
    const ev = envelopeSchedule(hard, 0, 1, 1);
    for (const e of ev) expect(Number.isFinite(e.v)).toBe(true);
    expect(envelopeAt(hard, 0.0001, 1)).toBeGreaterThan(0);
    expect(releaseEnd(hard, 1)).toBeGreaterThan(1);
  });
});
