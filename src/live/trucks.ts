// Fire trucks (docs/design/disasters.md): the host dispatches one from the nearest fire station when a fire starts.
// It drives the road network (roadPath) to the fire, sprays for SPRAY_SUBSTEPS, reports the fire out
// (state.quenched — the host hands it to the fire step), then drives home and is gone. Live layer: writes only its
// own state.

import type { GameMap } from '../engine/map';
import { isRoadKind } from '../engine/fabric';
import type { AmbientState, Truck } from './types';
import { roadPath } from './pathing';
import { advanceMover, commitHeading, pathStep } from './motion';
import { SPRAY_SUBSTEPS, TRUCK_SPEED, TURNOUT_SUBSTEPS } from './tuning';

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

/** Board a truck onto a road route (a mover on its first leg, as a car boards its trip); false if the route is
 *  too short to drive. */
function board(t: Truck, path: readonly number[], map: GameMap): boolean {
  if (path.length < 2) return false;
  const p0x = path[0]! % map.width;
  const p0y = (path[0]! - p0x) / map.width;
  const p1x = path[1]! % map.width;
  const p1y = (path[1]! - p1x) / map.width;
  t.x = p0x;
  t.y = p0y;
  t.tx = p1x;
  t.ty = p1y;
  commitHeading(t, p1x > p0x ? 1 : p1x < p0x ? 3 : p1y > p0y ? 2 : 0);
  t.path = path;
  t.leg = 2; // path[0]=start, path[1]=the committed next tile; pathStep targets path[2] next
  t.recent = undefined;
  return true;
}

/** Send a truck from the road at `from` (by its station) to the road at `to` (by the fire). False if no road
 *  route joins them. */
export function dispatchTruck(state: AmbientState, map: GameMap, from: { x: number; y: number }, to: { x: number; y: number }, target: number): boolean {
  const path = roadPath(map, from.x, from.y, to.x, to.y, state.traffic);
  if (!path) return false;
  const t: Truck = { x: from.x, y: from.y, dir: 1, tx: from.x, ty: from.y, call: 'to-fire', target, spray: 0, home: from, turnout: TURNOUT_SUBSTEPS };
  if (path.length >= 2) board(t, path, map);
  else t.call = 'spraying'; // the station is at the fire's door
  if (t.call === 'spraying') t.spray = SPRAY_SUBSTEPS;
  (state.trucks ??= []).push(t);
  return true;
}

/** Drive one substep along the committed route (the shared mover, in its lane, ignoring the traffic it has right
 *  of way over); true once it has arrived. */
function drive(t: Truck, map: GameMap): boolean {
  if (!t.path) return true;
  return !advanceMover(t, TRUCK_SPEED, map, (x, y) => pathStep(map, t, x, y));
}

/** One substep for every truck out. */
export function stepTrucks(state: AmbientState, map: GameMap): void {
  if (!state.trucks?.length) return;
  const still: Truck[] = [];
  for (const t of state.trucks) {
    if (t.call === 'to-fire') {
      if ((t.turnout ?? 0) > 0) t.turnout!--;
      else if (drive(t, map)) {
        t.call = 'spraying';
        t.spray = SPRAY_SUBSTEPS;
      }
      still.push(t);
    } else if (t.call === 'spraying') {
      if (--t.spray <= 0) {
        (state.quenched ??= new Set()).add(t.target);
        const back = roadPath(map, Math.round(t.x), Math.round(t.y), t.home.x, t.home.y, state.traffic);
        if (!back || !board(t, back, map)) continue; // nowhere to go home to (or already there): it simply leaves
        t.call = 'home';
      }
      still.push(t);
    } else if (!drive(t, map)) still.push(t); // home: gone once it's back
  }
  state.trucks = still;
}
