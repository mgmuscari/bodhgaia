// App shell: weather (docs/design/disasters.md, floods). Storms come on a seeded schedule — a gap of a few minutes
// of play (a game day is ~2.6 min), then rain for STORM_MS, or HEAVY_STORM_MS for the one storm in HEAVY_SHARE that
// is heavy. While a storm lasts the live state carries `rain` (the renderer draws it, the sound plays it, the flood
// reads it) and the air is washed every STORM_WASH_MS. Its own rng fork, on the wall clock: the live layer's rng
// stream is untouched.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import type { AmbientState } from '../live/types';

/** Wall ms between storms (uniform in this range). */
export const STORM_GAP_MS: readonly [number, number] = [180_000, 420_000];
/** How long a storm rains (~4 game hours), and a heavy one (~8). */
export const STORM_MS = 26_000;
export const HEAVY_STORM_MS = 52_000;
/** The share of storms that are heavy (the ones that flood). */
export const HEAVY_SHARE = 1 / 4;
/** A storm washes the air (smog → ground → water) this often. */
export const STORM_WASH_MS = 5_000;

export interface WeatherDeps {
  live: AmbientState;
  map: GameMap;
  rng: Rng;
  /** Wash the air once (the live layer's applyRain). */
  wash(): void;
}

export interface Weather {
  frame(now: number): void;
  /** Start a storm now (demos, live checks). */
  storm(heavy: boolean): void;
  /** Was the latest storm heavy? */
  lastWasHeavy(): boolean;
}

export function createWeather(deps: WeatherDeps): Weather {
  const { live, rng } = deps;
  let now = 0;
  let next: number | undefined;
  let ends = 0;
  let lastWash = 0;
  let heavy = false;
  const gap = (): number => STORM_GAP_MS[0] + rng.next() * (STORM_GAP_MS[1] - STORM_GAP_MS[0]);
  const begin = (h: boolean): void => {
    heavy = h;
    ends = now + (h ? HEAVY_STORM_MS : STORM_MS);
    lastWash = now;
    live.rain = { heavy: h };
  };
  return {
    lastWasHeavy: () => heavy,
    storm(h) {
      begin(h);
    },
    frame(t) {
      now = t;
      next ??= t + gap();
      if (live.rain) {
        if (t - lastWash >= STORM_WASH_MS) {
          lastWash = t;
          deps.wash();
        }
        if (t >= ends) {
          live.rain = undefined;
          next = t + gap();
        }
        return;
      }
      if (t >= next) begin(rng.next() < HEAVY_SHARE);
    },
  };
}
