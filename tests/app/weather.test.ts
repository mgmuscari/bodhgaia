// Weather (docs/design/disasters.md, floods): storms on a seeded schedule — some heavy — that the city sees,
// hears and is washed by. The flood reads the heavy ones.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { createRng } from '../../src/engine/rng';
import { createAmbientState } from '../../src/live/types';
import { createWeather, STORM_GAP_MS, STORM_MS, HEAVY_STORM_MS, STORM_WASH_MS } from '../../src/app/weather';
import { soundSnapshot } from '../../src/app/sound';

function sky(seed = 'w') {
  const map = new GameMap(20, 20);
  const live = createAmbientState();
  let washes = 0;
  const w = createWeather({ live, map, rng: createRng(seed).fork('weather'), wash: () => washes++ });
  return { live, w, washes: () => washes };
}

describe('weather', () => {
  it('is dry at first, then storms come and go on a schedule', () => {
    const s = sky();
    s.w.frame(0);
    expect(s.live.rain).toBeUndefined();
    let storms = 0;
    let wasRaining = false;
    for (let t = 0; t <= 10 * STORM_GAP_MS[1]; t += 500) {
      s.w.frame(t);
      const raining = s.live.rain !== undefined;
      if (raining && !wasRaining) storms++;
      wasRaining = raining;
    }
    const meanCycle = (STORM_GAP_MS[0] + STORM_GAP_MS[1]) / 2 + (2 * STORM_MS + HEAVY_STORM_MS) / 3;
    const expected = (10 * STORM_GAP_MS[1]) / meanCycle; // ~12.5
    expect(storms).toBeGreaterThanOrEqual(Math.floor(expected * 0.6));
    expect(storms).toBeLessThanOrEqual(Math.ceil(expected * 1.4));
  });

  it('some storms are heavy, and last longer', () => {
    const lengths = { light: [] as number[], heavy: [] as number[] };
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const s = sky(seed);
      let start = -1;
      for (let t = 0; t <= 8 * STORM_GAP_MS[1]; t += 250) {
        s.w.frame(t);
        const r = s.live.rain;
        if (r && start < 0) start = t;
        if (!r && start >= 0) {
          (s.w.lastWasHeavy() ? lengths.heavy : lengths.light).push(t - start);
          start = -1;
        }
      }
    }
    expect(lengths.heavy.length).toBeGreaterThan(0);
    expect(lengths.light.length).toBeGreaterThan(lengths.heavy.length);
    for (const l of lengths.light) expect(Math.abs(l - STORM_MS)).toBeLessThanOrEqual(500);
    for (const l of lengths.heavy) expect(Math.abs(l - HEAVY_STORM_MS)).toBeLessThanOrEqual(500);
  });

  it('a storm washes the air while it lasts, and can be called (demos)', () => {
    const s = sky();
    s.w.frame(0);
    s.w.storm(true);
    for (let t = 0; t <= HEAVY_STORM_MS; t += 250) s.w.frame(t);
    expect(s.washes()).toBeGreaterThanOrEqual(Math.floor(HEAVY_STORM_MS / STORM_WASH_MS) - 1);
  });

  it('the rain is heard', () => {
    const s = sky();
    s.w.frame(0);
    s.w.storm(false);
    s.w.frame(10);
    expect(soundSnapshot(s.live, { x0: 0, y0: 0, x1: 20, y1: 20 }, false).rain).toBe(true);
  });
});
