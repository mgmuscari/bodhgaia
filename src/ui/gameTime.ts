// Game time: the one clock the sun, the night, the power grid, the economy and the live layer read. It is wall
// time (performance.now) plus an offset, so the opening can begin the city at night (bodhgaia-opening.md) and
// the day runs on from there. Pure but for the module's offset; no DOM.

import { DAYSPEED } from './lighting';

/** Wall seconds in one in-game hour. */
const HOUR_SEC = (2 * Math.PI) / (DAYSPEED * 24);
let offsetSec = 0;

/** In-game seconds at wall time `wallMs` (default now). */
export function gameSec(wallMs: number = performance.now()): number {
  return wallMs / 1000 + offsetSec;
}

/** Make wall time `wallMs` the start of in-game `hour` (0..23); time runs on from there. */
export function setGameHour(hour: number, wallMs: number = performance.now()): void {
  const sinceSix = (((hour - 6) % 24) + 24) % 24; // gameClock reads 06:00 at game second 0
  offsetSec = sinceSix * HOUR_SEC + 1e-6 - wallMs / 1000;
}

/** Back to plain wall time (tests). */
export function resetGameTime(): void {
  offsetSec = 0;
}
