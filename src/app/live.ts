// App shell: the live layer's setup (purely visual, read-only over the world). The ambient state + its own rng
// streams, the city-derived inputs it reads (parking lots, households, dirty-plant emitters), the decay a
// century of car-culture left (and a save's stocks over it), the perf caps, the on/off switch and the ambient
// clock.
//
// SEPARATE rng forks and a SEPARATE clock so ambient timing can never perturb the sim: the sim's clock is owned
// by the sim path alone (its FixedTickLoop clamp owns catch-up), the ambient clock by this layer (stepAmbient's
// clamp owns catch-up). Turning life off restores the legacy dirty-driven render path (the frame loop reads `on`).

import { createRng, type Rng } from '../engine/rng';
import type { GameMap } from '../engine/map';
import type { ParcelStore } from '../engine/fabric';
import { stepAmbient } from '../live/step';
import { applyLiveCaps, type LiveCaps } from '../live/caps';
import { createAmbientState, setParkingLots, setHouseholds, setPlantEmitters, type AmbientState, type LivePractices } from '../live/types';
import { seedDecay } from '../live/fields/pollution';
import { parkingLots, parkingStalls } from '../ui/parkingContent';
import { residentialCensus } from '../citizens/census';
import { plantPollution } from '../growth/power';
import { restoreLive, type SaveV1 } from '../save/snapshot';

/** How far a dirty plant's plume reaches past its footprint, in tiles. */
export const PLUME_RADIUS = 2;

/**
 * The air-pollution emitters of the built layer (PURE): each coal/gas plant smogs its footprint plus a
 * PLUME_RADIUS ring, at its pollution amount, clipped to the map — parcel order, then row-major per plant.
 * The live pollution field (cars + plants) drags land value → occupancy → revival, so dirty power poisons
 * what it powers and renewables read clean.
 */
export function plantEmitters(map: GameMap, parcels: ParcelStore): { tile: number; amount: number }[] {
  const emitters: { tile: number; amount: number }[] = [];
  for (const idx of parcels.aliveIndices()) {
    const p = parcels.get(idx);
    const amt = plantPollution(p.kind);
    if (amt <= 0) continue;
    for (let yy = -PLUME_RADIUS; yy < p.height + PLUME_RADIUS; yy++) {
      for (let xx = -PLUME_RADIUS; xx < p.width + PLUME_RADIUS; xx++) {
        const tx = p.x + xx;
        const ty = p.y + yy;
        if (map.inBounds(tx, ty)) emitters.push({ tile: map.idx(tx, ty), amount: amt });
      }
    }
  }
  return emitters;
}

export interface LiveDeps {
  seed: string;
  map: GameMap;
  parcels: ParcelStore;
  /** The perf ceilings to apply now (settings). */
  caps: Partial<LiveCaps>;
  /** A resumed city's live stocks (put over the seeded decay), or null for a fresh one. */
  saved: SaveV1['live'] | null;
  /** The tech practices' live coefficients (read each step). */
  practices(): LivePractices;
  /** Wall-clock ms (default performance.now). */
  now?(): number;
}

export interface LiveLayer {
  readonly state: AmbientState;
  /** The revival/decay seam's stream (the civic cadence's densify draws) — independent of ambient + sim. */
  readonly revivalRng: Rng;
  /** Ambient life on (default) or off. Turning it ON restarts the clock, so the first dt is small. */
  on: boolean;
  /** Advance the live layer to wall-clock `now` (dt since the last step or clock reset). */
  step(now: number): void;
  /** Restart the ambient clock (a tab coming back) so its dt doesn't jump. */
  resetClock(): void;
  /** Apply new perf ceilings (the settings menu). */
  applyCaps(caps: Partial<LiveCaps>): void;
  /** The lots that STORE the moving cars (cars = trips, lots = storage) — re-read as the player rezones. */
  refreshParkingLots(): void;
  /** The homes the daily-itinerary citizens spawn from — re-read as the city grows/decays. */
  refreshHouseholds(): void;
  /** The dirty-plant smog sources — re-read when a plant is placed or bulldozed. */
  recomputePlantEmitters(): void;
}

export function createLive(deps: LiveDeps): LiveLayer {
  const { seed, map, parcels } = deps;
  const now = deps.now ?? (() => performance.now());
  applyLiveCaps(deps.caps);

  const ambientRng = createRng(seed).fork('ambient');
  // the world's prevailing wind draws from its OWN fork, so it never advances the per-frame ambient stream
  const state = createAmbientState(createRng(seed).fork('ambient-wind'));
  const revivalRng = createRng(seed).fork('revival');
  let lastStep = now();
  let on = true;

  const refreshParkingLots = (): void => {
    setParkingLots(
      state,
      parkingLots(map).map((lot) => ({
        cx: (lot.x0 + lot.x1) / 2,
        cy: (lot.y0 + lot.y1) / 2,
        x0: lot.x0,
        y0: lot.y0,
        x1: lot.x1,
        y1: lot.y1,
        stalls: parkingStalls(lot),
      })),
    );
  };
  const refreshHouseholds = (): void => setHouseholds(state, residentialCensus(parcels));
  const recomputePlantEmitters = (): void => setPlantEmitters(state, plantEmitters(map, parcels));
  refreshParkingLots();
  refreshHouseholds();
  recomputePlantEmitters();

  // The city starts DECAYED: a century of car-culture has already trampled the urban ground into desire paths
  // and polluted the shorelines, before the player arrives to heal it. A resumed city's saved stocks go OVER
  // the seeded decay — so restore strictly after seed.
  seedDecay(state, map);
  if (deps.saved) restoreLive(state, deps.saved);

  return {
    state,
    revivalRng,
    get on() {
      return on;
    },
    set on(next: boolean) {
      on = next;
      if (next) lastStep = now();
    },
    step: (t) => {
      state.practices = deps.practices();
      stepAmbient(state, map, ambientRng, t - lastStep);
      lastStep = t;
    },
    resetClock: () => {
      lastStep = now();
    },
    applyCaps: (caps) => applyLiveCaps(caps),
    refreshParkingLots,
    refreshHouseholds,
    recomputePlantEmitters,
  };
}
