import { describe, it, expect } from 'vitest';
import { INSTRUMENTS } from '../../src/audio/contract';
import { AMBIENCE, BEDS, ambienceTargets, createAmbience, type AmbienceSnapshot } from '../../src/audio/ambience';
import { fakeEngine, type FakeEngine } from './fakeEngine';

const calm: AmbienceSnapshot = { traffic01: 0, peds01: 0, birds01: 0, rain: false, night: false };
const snap = (o: Partial<AmbienceSnapshot>): AmbienceSnapshot => ({ ...calm, ...o });

describe('ambienceTargets (pure)', () => {
  it('keeps every level, rate and pitch in range across the snapshot space', () => {
    for (const t of [0, 0.5, 1])
      for (const b of [0, 1])
        for (const rain of [false, true])
          for (const night of [false, true]) {
            const g = ambienceTargets(snap({ traffic01: t, peds01: t, birds01: b, rain, night, unhoused01: b, healing01: b }));
            for (const bed of BEDS) {
              expect(g[bed].level).toBeGreaterThanOrEqual(0);
              expect(g[bed].level).toBeLessThanOrEqual(AMBIENCE.maxBedLevel);
              expect(g[bed].pitch).toBeGreaterThan(20);
              expect(g[bed].pitch).toBeLessThan(96);
            }
            for (const r of [g.birdRate, g.cricketRate, g.chimeRate]) {
              expect(r).toBeGreaterThanOrEqual(0);
              expect(r).toBeLessThanOrEqual(2);
            }
          }
  });

  it('a calm daytime with nothing in it is just a soft wind', () => {
    const g = ambienceTargets(calm);
    expect(g.wind.level).toBeGreaterThan(0);
    expect(g.traffic.level).toBe(0);
    expect(g.rain.level).toBe(0);
    expect(g.crowd.level).toBe(0);
    expect(g.birdRate + g.cricketRate + g.chimeRate).toBe(0);
  });

  it('the traffic bed follows traffic in level and brightness', () => {
    const lo = ambienceTargets(snap({ traffic01: 0.2 }));
    const hi = ambienceTargets(snap({ traffic01: 0.9 }));
    expect(hi.traffic.level).toBeGreaterThan(lo.traffic.level);
    expect(hi.traffic.pitch).toBeGreaterThan(lo.traffic.pitch);
  });

  it('night quiets the birds and brings the crickets; day has none', () => {
    const day = ambienceTargets(snap({ birds01: 1 }));
    const night = ambienceTargets(snap({ birds01: 1, night: true }));
    expect(night.birdRate).toBeLessThan(day.birdRate / 3);
    expect(night.cricketRate).toBeGreaterThan(0);
    expect(day.cricketRate).toBe(0);
  });

  it('rain sounds only when raining, and hushes the birds', () => {
    const dry = ambienceTargets(snap({ birds01: 1 }));
    const wet = ambienceTargets(snap({ birds01: 1, rain: true }));
    expect(dry.rain.level).toBe(0);
    expect(wet.rain.level).toBeGreaterThan(0);
    expect(wet.birdRate).toBeLessThan(dry.birdRate);
  });

  it('people make a murmur; healing nearby rings the odd chime; exposure sharpens the wind', () => {
    expect(ambienceTargets(snap({ peds01: 1 })).crowd.level).toBeGreaterThan(0);
    expect(ambienceTargets(snap({ healing01: 1 })).chimeRate).toBeGreaterThan(0);
    expect(ambienceTargets(snap({ unhoused01: 1 })).wind.level).toBeGreaterThan(ambienceTargets(calm).wind.level);
  });

  it('clamps out-of-range and NaN inputs', () => {
    const g = ambienceTargets(snap({ traffic01: 7, peds01: NaN, birds01: -3 }));
    expect(g.traffic.level).toBe(ambienceTargets(snap({ traffic01: 1 })).traffic.level);
    expect(g.crowd.level).toBe(0);
    expect(g.birdRate).toBe(0);
  });
});

/** Run the ambience for `seconds` at `hz` updates per second. */
function run(e: FakeEngine, amb: ReturnType<typeof createAmbience>, s: AmbienceSnapshot, seconds: number, hz = 4): void {
  const steps = Math.round(seconds * hz);
  for (let i = 0; i < steps; i++) {
    e.t += 1 / hz;
    amb.update(s);
  }
}
const bedVoices = (e: FakeEngine, pitchBand: (p: number) => boolean, instrument: string) =>
  e.played.filter((v) => v.note.instrument === instrument && v.note.duration === undefined && pitchBand(v.note.pitch));

describe('createAmbience (scheduling)', () => {
  it('plays only contract instruments on the ambience bus; beds are open voices, events are bounded', () => {
    const e = fakeEngine();
    const amb = createAmbience(e, { seed: 1 });
    run(e, amb, snap({ traffic01: 0.6, peds01: 0.5, birds01: 1, rain: true, healing01: 1 }), 30);
    expect(e.played.length).toBeGreaterThan(0);
    for (const v of e.played) {
      expect(INSTRUMENTS).toContain(v.note.instrument);
      expect(v.note.bus).toBe('ambience');
      expect(v.note.velocity).toBeGreaterThan(0);
      expect(v.note.velocity).toBeLessThanOrEqual(1);
      if (v.note.duration !== undefined) expect(v.note.duration).toBeLessThan(3);
    }
  });

  it('a steady city settles: no new bed voices once levels have converged', () => {
    const e = fakeEngine();
    const amb = createAmbience(e, { seed: 2 });
    const s = snap({ traffic01: 0.7 });
    run(e, amb, s, 20);
    const before = e.played.filter((v) => v.note.duration === undefined).length;
    run(e, amb, s, 20);
    expect(e.played.filter((v) => v.note.duration === undefined).length).toBe(before);
  });

  it('a traffic surge ramps — successive bed levels step gently, never jump (no zipper/click)', () => {
    const e = fakeEngine();
    const amb = createAmbience(e, { seed: 3 });
    run(e, amb, snap({ traffic01: 0.05 }), 15);
    run(e, amb, snap({ traffic01: 1 }), 15);
    const levels = e.played.filter((v) => v.note.instrument === 'rumble').map((v) => v.note.velocity);
    expect(levels.length).toBeGreaterThan(3);
    for (let i = 1; i < levels.length; i++) expect(Math.abs(levels[i]! - levels[i - 1]!)).toBeLessThanOrEqual(0.1);
    expect(levels[levels.length - 1]!).toBeCloseTo(ambienceTargets(snap({ traffic01: 1 })).traffic.level, 1);
  });

  it('crossfades: each replacement bed voice releases the one before it, so one rumble sounds at a time', () => {
    const e = fakeEngine();
    const amb = createAmbience(e, { seed: 4 });
    run(e, amb, snap({ traffic01: 0.1 }), 10);
    run(e, amb, snap({ traffic01: 0.9 }), 10);
    const rumbles = e.played.filter((v) => v.note.instrument === 'rumble');
    for (let i = 0; i < rumbles.length - 1; i++) expect(rumbles[i]!.stoppedAt).not.toBeNull();
    expect(rumbles[rumbles.length - 1]!.stoppedAt).toBeNull();
  });

  it('the rain bed fades out and stops when the rain does', () => {
    const e = fakeEngine();
    const amb = createAmbience(e, { seed: 5 });
    run(e, amb, snap({ rain: true }), 10);
    run(e, amb, snap({ rain: false }), 15);
    const rain = bedVoices(e, (p) => p >= 70, 'noise');
    expect(rain.length).toBeGreaterThan(0);
    for (const v of rain) expect(v.stoppedAt).not.toBeNull();
  });

  it('birds sing by day, rarely by night; crickets answer at night', () => {
    const count = (night: boolean, inst: string) => {
      const e = fakeEngine();
      const amb = createAmbience(e, { seed: 6 });
      run(e, amb, snap({ birds01: 1, night }), 120);
      return e.played.filter((v) => v.note.instrument === inst).length;
    };
    const day = count(false, 'chirp');
    expect(day).toBeGreaterThan(20);
    expect(count(true, 'chirp')).toBeLessThan(day / 3);
    expect(count(true, 'click')).toBeGreaterThan(10);
    expect(count(false, 'click')).toBe(0);
  });

  it('is deterministic for a seed', () => {
    const go = () => {
      const e = fakeEngine();
      const amb = createAmbience(e, { seed: 9 });
      run(e, amb, snap({ birds01: 0.8, traffic01: 0.3, healing01: 0.5 }), 40);
      return e.played.map((v) => `${v.note.instrument}@${v.note.at ?? '-'}:${v.note.pitch}`);
    };
    expect(go()).toEqual(go());
  });

  it('a long gap (backgrounded tab) does not burst a backlog of calls', () => {
    const e = fakeEngine();
    const amb = createAmbience(e, { seed: 7 });
    run(e, amb, snap({ birds01: 1, healing01: 1 }), 5);
    const before = e.played.length;
    e.t += 120;
    amb.update(snap({ birds01: 1, healing01: 1 }));
    expect(e.played.length - before).toBeLessThanOrEqual(8);
  });

  it('stop() silences every bed; the next update brings them back', () => {
    const e = fakeEngine();
    const amb = createAmbience(e, { seed: 8 });
    const s = snap({ traffic01: 0.5, rain: true, peds01: 0.5 });
    run(e, amb, s, 10);
    amb.stop();
    for (const v of e.played.filter((x) => x.note.duration === undefined)) expect(v.stoppedAt).not.toBeNull();
    const n = e.played.length;
    run(e, amb, s, 2);
    expect(e.played.filter((v, i) => i >= n && v.note.duration === undefined).length).toBeGreaterThan(0);
  });

  it('tolerates a locked engine and starts the beds once it unlocks', () => {
    const e = fakeEngine();
    e.live = false;
    const amb = createAmbience(e, { seed: 10 });
    expect(() => run(e, amb, snap({ traffic01: 0.5 }), 5)).not.toThrow();
    expect(e.played.length).toBe(0);
    e.live = true;
    run(e, amb, snap({ traffic01: 0.5 }), 2);
    expect(e.played.some((v) => v.note.instrument === 'rumble')).toBe(true);
  });
});
