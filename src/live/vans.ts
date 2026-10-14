// Delivery vans (docs/design/interdependence.md §2): each food-bank run to a pantry this hour (live/food.ts, handed
// over as state.foodRuns) is a van on the roads — out to the pantry, a moment unloading, back to the bank, gone. The
// food has already moved (the flows are hourly); the van is that run made visible. At most VAN_CAP at once.

import type { GameMap } from '../engine/map';
import type { AmbientState, Van } from './types';
import { roadPath } from './pathing';
import { board, drive, roadNear } from './trucks';
import { seconds } from './tuning';
import { BuiltKind } from '../engine/fabric';
import { pairedWith } from '../engine/pairings';
import { launchDrone } from './drones';

export const VAN_CAP = 12;
/** Substeps a van stands at the pantry, unloading (~3 s). */
export const UNLOAD = seconds(3);

const at = (map: GameMap, t: number): { x: number; y: number } => ({ x: t % map.width, y: Math.floor(t / map.width) });

/** Turn this hour's runs into vans (up to VAN_CAP on the road); the runs are taken. */
export function spawnVans(state: AmbientState, map: GameMap): void {
  const runs = state.foodRuns;
  if (!runs || runs.length === 0) return;
  state.foodRuns = [];
  const vans = (state.vans ??= []);
  for (const r of runs) {
    if (vans.length >= VAN_CAP) break;
    const b = at(map, r.from);
    const p = at(map, r.to);
    // a food bank paired with an AI node delivers by drone (lane pairing, interdependence §9)
    if (pairedWith(map, { x: b.x, y: b.y, w: 2, h: 2 }, BuiltKind.AINode)) {
      launchDrone(state, { x: b.x, y: b.y }, p);
      continue;
    }
    const from = roadNear(map, b.x, b.y, 2, 2); // a food bank is 2×2
    const to = roadNear(map, p.x, p.y, 1, 1);
    if (!from || !to) continue;
    const path = roadPath(map, from.x, from.y, to.x, to.y, state.traffic);
    const van: Van = { x: from.x, y: from.y, dir: 1, tx: from.x, ty: from.y, run: 'out', home: from, wait: 0 };
    if (!path || !board(van, path, map)) continue; // no road between them, or they share a door
    vans.push(van);
  }
}

/** Drive the vans a substep: out, unload, back, gone. */
export function stepVans(state: AmbientState, map: GameMap): void {
  const vans = state.vans;
  if (!vans || vans.length === 0) return;
  state.vans = vans.filter((v) => {
    if (v.run === 'out') {
      if (drive(v, map)) {
        v.run = 'unload';
        v.wait = UNLOAD;
        v.path = undefined;
      }
      return true;
    }
    if (v.run === 'unload') {
      if (--v.wait > 0) return true;
      const back = roadPath(map, Math.round(v.x), Math.round(v.y), v.home.x, v.home.y, state.traffic);
      if (!back || !board(v, back, map)) return false; // home already, or no way back: done
      v.run = 'back';
      return true;
    }
    return !drive(v, map); // back at the bank: gone
  });
}
