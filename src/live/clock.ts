// The live layer's substep clock (the scaling pass, Maddy 2026-10-08). Caches that must notice map edits — the routing
// masks and what keys on their epoch (the police's precincts and refuges) — check the map at most once per substep
// while a substep runs, instead of once per caller. Nothing in the live layer writes the map mid-substep (the sim and
// the player edit between substeps), so that misses nothing; outside a substep (an event's dispatch right after the
// sim changed the map) every call checks, as before. The transit cache re-checks by the clock's count.

let ticks = 0;
let running = false;

/** Run `fn` as one substep: the clock advances, and map caches check at most once inside it. */
export function liveSubstep<T>(fn: () => T): T {
  ticks++;
  running = true;
  try {
    return fn();
  } finally {
    running = false;
  }
}

/** Advance the clock one substep without running one (the transit cache's count — tests). */
export function tickLiveClock(): void {
  ticks++;
}

/** Substeps so far. */
export function liveClock(): number {
  return ticks;
}

/** Is a substep running (map caches may reuse this substep's check)? */
export function inLiveSubstep(): boolean {
  return running;
}
