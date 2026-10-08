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

/** Move the clock FORWARD to the next start of in-game `hour` (0..23) at wall time `wallMs`; time runs on from
 *  there. Never backwards: the economy and the power grid count in-game hours and would stall waiting for a
 *  clock that had gone back. */
export function setGameHour(hour: number, wallMs: number = performance.now()): void {
  const hoursSinceStart = gameSec(wallMs) / HOUR_SEC; // gameClock reads 06:00 at game second 0
  const hourOfDay = (((6 + hoursSinceStart) % 24) + 24) % 24;
  const ahead = (((hour - hourOfDay) % 24) + 24) % 24; // hours forward to the start of `hour`
  offsetSec += ahead * HOUR_SEC + 1e-6;
}

/** Back to plain wall time (tests). */
export function resetGameTime(): void {
  offsetSec = 0;
}
