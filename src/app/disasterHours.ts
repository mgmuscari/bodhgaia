// App shell: how many times this game hour's crashes, violent crime and spills are drawn (engine/mode.ts
// disasterDraws — standard once; gentle only in some hours; hard twice in many). One count per hour (a slot that
// counts up across days), from its own rng stream so no other draw shifts.

import type { Rng } from '../engine/rng';
import { disasterDraws, type CityMode } from '../engine/mode';

export interface DisasterHours {
  /** The draws for hour-slot `slot` (asked again in the same slot: the same count). */
  draws(slot: number): number;
}

export function createDisasterHours(mode: CityMode, rng: Rng): DisasterHours {
  let at = Number.NaN;
  let n = 1;
  return {
    draws(slot) {
      if (mode.difficulty === 'standard') return 1;
      if (slot !== at) {
        at = slot;
        n = disasterDraws(mode, rng.nextInt(100));
      }
      return n;
    },
  };
}
