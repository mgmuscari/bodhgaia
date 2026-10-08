// Violent crime (docs/design/disasters.md — Maddy: conditions, not cops). Despair makes a street dangerous: the
// encampments of the people the city put out, the buildings left to decay, the record of police violence. Belonging
// and the refuges people build (healing commons, gardens, parks, civic halls, bazaars, maker spaces) make it safe.
// Policing is no protection — its violence is one of the harms. Once an in-game hour, at most one person out on the
// street may be killed, likelier at night; they're mourned like any death. Live layer: reads the world, writes only
// its own state; the host draws with its own rng fork.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import { isBuildingKind, type ParcelStore } from '../engine/fabric';
import type { AmbientState } from './types';
import { residentDies } from './death';
import {
  CRIME_BASE,
  CRIME_BELONGING,
  CRIME_NIGHT,
  CRIME_REFUGE,
  DESPAIR_CAMPS,
  DESPAIR_DECAY,
  DESPAIR_POLICE,
  ENCAMPMENT_WEAR,
  POLICE_VIOLENCE_MAX,
  REFUGE_KINDS,
  SAFE_RADIUS,
} from './tuning';

type World = { map: GameMap; parcels: ParcelStore };

/** How desperate the street at (x, y) is (0 where nothing harms it), given its neighbourhood's belonging (0..1). */
export function despairAt(state: AmbientState, world: World, x: number, y: number, belonging: number): number {
  const { map, parcels } = world;
  let camps = 0;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (map.inBounds(x + dx, y + dy) && (state.wear.get(map.idx(x + dx, y + dy)) ?? 0) >= ENCAMPMENT_WEAR) camps++;
    }
  }
  const seen = new Set<number>();
  let decayed = 0;
  let buildings = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      const id = map.parcel[map.idx(x + dx, y + dy)]!;
      if (id === 0 || seen.has(id)) continue;
      seen.add(id);
      if (!parcels.isAlive(id - 1) || !isBuildingKind(parcels.kindAt(id - 1))) continue;
      buildings++;
      const c = parcels.conditionAt(id - 1);
      if (c < 128) decayed += (128 - c) / 128;
    }
  }
  const police = map.inBounds(x, y) ? (state.policeViolence.get(map.idx(x, y)) ?? 0) / POLICE_VIOLENCE_MAX : 0;
  const harm = DESPAIR_CAMPS * Math.min(1, camps / 6) + DESPAIR_DECAY * (buildings > 0 ? decayed / buildings : 0) + DESPAIR_POLICE * police;
  if (harm <= 0) return 0;
  let refuge = false;
  for (let dy = -SAFE_RADIUS; dy <= SAFE_RADIUS && !refuge; dy++) {
    for (let dx = -SAFE_RADIUS; dx <= SAFE_RADIUS; dx++) {
      if (map.inBounds(x + dx, y + dy) && REFUGE_KINDS.has(map.built[map.idx(x + dx, y + dy)]!)) {
        refuge = true;
        break;
      }
    }
  }
  return harm * (1 - CRIME_BELONGING * Math.min(1, Math.max(0, belonging))) * (refuge ? CRIME_REFUGE : 1);
}

/** Once per in-game hour: may someone out on the street be killed? At most one; true if so. */
export function drawCrime(state: AmbientState, world: World, rng: Rng, hour: number | undefined, night: boolean, belongingAt: (tile: number) => number): boolean {
  if (hour === undefined || hour === state.crimeHour) return false;
  state.crimeHour = hour;
  const { map } = world;
  for (const p of state.peds) {
    if (p.phase === 'inside' || p.phase === 'driving') continue;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (!map.inBounds(x, y)) continue;
    const d = despairAt(state, world, x, y, belongingAt(map.idx(x, y)));
    if (d <= 0 || rng.next() >= CRIME_BASE * d * (night ? CRIME_NIGHT : 1)) continue;
    state.peds = state.peds.filter((q) => q !== p);
    if (p.homeTile !== undefined) state.occupancy.set(p.homeTile, Math.max(0, (state.occupancy.get(p.homeTile) ?? 0) - 1));
    else if (state.unhoused >= 1) state.unhoused -= 1;
    residentDies(state, x, y);
    return true;
  }
  return false;
}
