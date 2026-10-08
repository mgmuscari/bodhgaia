// Fire trucks (docs/design/disasters.md): the host dispatches one from the nearest fire station when a fire starts.
// It drives the road network (roadPath) to the fire, sprays for SPRAY_SUBSTEPS, reports the fire out
// (state.quenched — the host hands it to the fire step), then drives home and is gone. Live layer: writes only its
// own state.

import type { GameMap } from '../engine/map';
import { isRoadKind } from '../engine/fabric';
import type { AmbientState, Truck } from './types';
import { roadPath } from './pathing';
import { SPRAY_SUBSTEPS, TRUCK_SPEED } from './tuning';

/** The nearest road tile to the footprint (x, y, w, h), within 3 tiles, or null. */
export function roadNear(map: GameMap, x: number, y: number, w: number, h: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let yy = y - 3; yy < y + h + 3; yy++) {
    for (let xx = x - 3; xx < x + w + 3; xx++) {
      if (!map.inBounds(xx, yy) || !isRoadKind(map.built[map.idx(xx, yy)]!)) continue;
      const dx = xx < x ? x - xx : xx >= x + w ? xx - (x + w - 1) : 0;
      const dy = yy < y ? y - yy : yy >= y + h ? yy - (y + h - 1) : 0;
      const d = dx + dy;
      if (d < bestD) {
        bestD = d;
        best = { x: xx, y: yy };
      }
    }
  }
  return best;
}

/** Send a truck from the road at `from` (by its station) to the road at `to` (by the fire). False if no road
 *  route joins them. */
export function dispatchTruck(state: AmbientState, map: GameMap, from: { x: number; y: number }, to: { x: number; y: number }, target: number): boolean {
  const path = roadPath(map, from.x, from.y, to.x, to.y, state.traffic);
  if (!path) return false;
  (state.trucks ??= []).push({ x: from.x, y: from.y, hx: 1, hy: 0, path, i: 1, phase: 'to-fire', target, spray: 0, home: from });
  return true;
}

/** Move a truck one substep along its route; true when it has arrived. */
function drive(t: Truck, map: GameMap): boolean {
  if (t.i >= t.path.length) return true;
  const n = t.path[t.i]!;
  const nx = n % map.width;
  const ny = (n - nx) / map.width;
  const dx = nx - t.x;
  const dy = ny - t.y;
  const dist = Math.abs(dx) + Math.abs(dy);
  if (dist <= TRUCK_SPEED) {
    t.x = nx;
    t.y = ny;
    t.i++;
    return t.i >= t.path.length;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    t.x += Math.sign(dx) * TRUCK_SPEED;
    t.hx = Math.sign(dx);
    t.hy = 0;
  } else {
    t.y += Math.sign(dy) * TRUCK_SPEED;
    t.hx = 0;
    t.hy = Math.sign(dy);
  }
  return false;
}

/** One substep for every truck out. */
export function stepTrucks(state: AmbientState, map: GameMap): void {
  if (!state.trucks?.length) return;
  const still: Truck[] = [];
  for (const t of state.trucks) {
    if (t.phase === 'to-fire') {
      if (drive(t, map)) {
        t.phase = 'spraying';
        t.spray = SPRAY_SUBSTEPS;
      }
      still.push(t);
    } else if (t.phase === 'spraying') {
      if (--t.spray <= 0) {
        (state.quenched ??= new Set()).add(t.target);
        const back = roadPath(map, Math.round(t.x), Math.round(t.y), t.home.x, t.home.y, state.traffic);
        if (!back) continue; // nowhere to go home to: it simply leaves
        t.phase = 'home';
        t.path = back;
        t.i = 1;
      }
      still.push(t);
    } else if (!drive(t, map)) still.push(t); // home: gone once it's back
  }
  state.trucks = still;
}
