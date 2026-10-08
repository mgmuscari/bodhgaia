// App shell: fire (docs/design/disasters.md). Once a game-second it steps the fire (growth/fire.ts) — handing it the
// fires the trucks have put out — and acts on what happened: a new fire gets a truck from the nearest fire station
// (live/trucks.ts), the camera and the news; a home that burns out is a ruin, a few of its people dead and the rest
// unhoused (the census drops the home); the flames are published for the renderer. Disasters off ⇒ nothing new
// ignites (what's burning burns on).

import type { GameMap } from '../engine/map';
import { BuiltKind, type ParcelStore } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import type { Rng } from '../engine/rng';
import type { AmbientState } from '../live/types';
import { createFireState, stepFire } from '../growth/fire';
import { dispatchTruck, roadNear } from '../live/trucks';
import { residentDies } from '../live/death';
import { layField } from '../citizens/field';
import { POLL_MAX } from '../live/tuning';

/** Wall ms between fire steps (BURN_STEPS of them burn a building out: ~45 s). */
export const FIRE_STEP_MS = 1000;
/** A home that burns out loses this share of its people (at least one if anyone was home), at most FIRE_DEATH_MAX. */
export const FIRE_DEATH_SHARE = 0.15;
export const FIRE_DEATH_MAX = 3;
/** Smoke a burning tile lays into the air-pollution field each fire step: the smog overlay draws it, drifting
 *  downwind, and people breathe it like any smog. */
export const FIRE_SMOKE = 60;

/** Each home's vacancy (parcel → 0..1): the share of its baseline people no longer there. A derelict (no baseline)
 *  or unpeopled home is fully abandoned. growth/fire reads it: an abandoned building burns more readily. */
export function homeVacancy(live: AmbientState, map: GameMap): Map<number, number> {
  const out = new Map<number, number>();
  for (const h of live.households ?? []) {
    const t = map.idx(h.x, h.y);
    const id = map.parcel[t]!;
    if (id === 0) continue;
    const occ = live.occupancy.get(t) ?? 0;
    out.set(id - 1, h.count <= 0 ? 1 : Math.min(1, Math.max(0, 1 - occ / h.count)));
  }
  return out;
}

export interface FireDeps {
  world: { map: GameMap; parcels: ParcelStore };
  live: AmbientState;
  rng: Rng;
  /** The in-game hour (ignition is drawn once per hour); undefined ⇒ no ignition. */
  hour(): number | undefined;
  disastersOn(): boolean;
  markDirty(): void;
  refreshHouseholds(): void;
  news(text: string): void;
}

export interface FireController {
  frame(now: number): void;
  /** Light a building (tests, live checks). */
  ignite(parcel: number): void;
  /** Is anything burning? */
  active(): boolean;
}

export function createFireController(deps: FireDeps): FireController {
  const { world, live } = deps;
  const { map, parcels } = world;
  const fires = createFireState();
  const lit: number[] = [];
  let last = 0;

  const footprint = (i: number): { x: number; y: number; w: number; h: number } => {
    const p = parcels.get(i);
    return { x: p.x, y: p.y, w: p.width, h: p.height };
  };
  const sendTruck = (i: number): void => {
    const f = footprint(i);
    const to = roadNear(map, f.x, f.y, f.w, f.h);
    if (!to) return;
    const stations = parcels
      .aliveIndices()
      .filter((s) => parcels.kindAt(s) === BuiltKind.FireStation)
      .map((s) => ({ s, d: Math.abs(parcels.get(s).x - f.x) + Math.abs(parcels.get(s).y - f.y) }))
      .sort((a, b) => a.d - b.d || a.s - b.s);
    for (const { s } of stations) {
      const st = footprint(s);
      const from = roadNear(map, st.x, st.y, st.w, st.h);
      if (from && dispatchTruck(live, map, from, to, i)) return;
    }
  };

  return {
    active: () => fires.burning.size > 0,
    ignite(i) {
      if (!parcels.isAlive(i) || fires.burning.has(i)) return;
      fires.burning.set(i, { age: 0 });
      lit.push(i);
    },
    frame(now) {
      if (now - last < FIRE_STEP_MS) return;
      last = now;
      const quenched = live.quenched ?? new Set<number>();
      live.quenched = new Set();
      const hour = deps.disastersOn() ? deps.hour() : undefined;
      const vacancy = hour !== undefined && hour !== fires.lastHour ? homeVacancy(live, map) : undefined; // only on the hour's draw
      const ev = stepFire(world, fires, deps.rng, { hour, quenched, vacancy });

      for (const i of [...lit.splice(0), ...ev.ignited]) {
        if (!fires.burning.has(i)) continue;
        live.events?.push({ kind: 'fire', ...footprint(i) });
        deps.news('Fire!');
        sendTruck(i);
      }
      for (const b of ev.burntOut) {
        if (zoneTypeOf(b.kind) === ZoneType.Residential) {
          const anchor = map.idx(b.x, b.y);
          const occ = Math.floor(live.occupancy.get(anchor) ?? 0);
          const dead = occ <= 0 ? 0 : Math.min(FIRE_DEATH_MAX, Math.max(1, Math.round(occ * FIRE_DEATH_SHARE)));
          if (dead > 0) live.occupancy.set(anchor, (live.occupancy.get(anchor) ?? 0) - dead);
          for (let k = 0; k < dead; k++) residentDies(live, b.x + (k % b.w), b.y + (Math.floor(k / b.w) % b.h));
          deps.news('A fire burned a home to ruin');
        } else deps.news('A fire left a building in ruins');
      }
      if (ev.burntOut.length > 0) deps.refreshHouseholds();
      if (ev.burntOut.length > 0 || ev.quenched.length > 0) deps.markDirty();
      live.burning = [...fires.burning.keys()].filter((i) => parcels.isAlive(i)).map(footprint);
      for (const b of live.burning) {
        for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) layField(live.pollution, map.idx(b.x + dx, b.y + dy), FIRE_SMOKE, POLL_MAX);
      }
    },
  };
}
