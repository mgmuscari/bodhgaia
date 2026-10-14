// Drone deliveries (docs/design/interdependence.md §3): a Community AI Node is a dispatch hub. With Drone Deliveries,
// a driven shopping errand from a home within DRONE_RADIUS of a node is delivered instead (live/agents.ts), and a
// drone flies it — from the node to the home and back, straight, at roof height. Live, renderer-side state.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import type { AmbientState } from './types';
import { mapEpoch } from './network';
import { perSecond } from './tuning';

/** How far (Chebyshev) an AI node's drones reach. */
export const DRONE_RADIUS = 12;
/** Drones in the air at most. */
export const DRONE_CAP = 16;
/** Tiles a substep (a brisk 4 tiles a second). */
export const DRONE_SPEED = perSecond(4);

export interface Drone {
  x: number;
  y: number;
  /** The hub it flies from and back to, and the home it's bound for. */
  hub: { x: number; y: number };
  dest: { x: number; y: number };
  /** Out to the home, or back to the hub. */
  back: boolean;
}

const HUBS = new WeakMap<GameMap, { epoch: number; tiles: number[] }>();
function hubsOf(map: GameMap): number[] {
  const epoch = mapEpoch(map);
  let c = HUBS.get(map);
  if (!c || c.epoch !== epoch) {
    const tiles: number[] = [];
    for (let i = 0; i < map.built.length; i++) if (map.built[i] === BuiltKind.AINode) tiles.push(i);
    HUBS.set(map, (c = { epoch, tiles }));
  }
  return c.tiles;
}

/** The nearest AI-node tile within DRONE_RADIUS of (x, y), as a hub (its tile centre), or null. */
export function droneHub(map: GameMap, x: number, y: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const t of hubsOf(map)) {
    const hx = t % map.width;
    const hy = (t - hx) / map.width;
    const d = Math.max(Math.abs(hx - x), Math.abs(hy - y));
    if (d <= DRONE_RADIUS && d < bestD) [best, bestD] = [{ x: hx, y: hy }, d];
  }
  return best;
}

/** Send a drone from `hub` to `dest` (and back), if the sky has room. */
export function launchDrone(state: AmbientState, hub: { x: number; y: number }, dest: { x: number; y: number }): void {
  const drones = (state.drones ??= []);
  if (drones.length >= DRONE_CAP) return;
  drones.push({ x: hub.x, y: hub.y, hub, dest, back: false });
}

/** Fly the drones a substep: out to the home, back to the hub, gone. */
export function stepDrones(state: AmbientState): void {
  const drones = state.drones;
  if (!drones || drones.length === 0) return;
  state.drones = drones.filter((d) => {
    const to = d.back ? d.hub : d.dest;
    const dx = to.x - d.x;
    const dy = to.y - d.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist <= DRONE_SPEED) {
      d.x = to.x;
      d.y = to.y;
      if (d.back) return false; // home to the hub
      d.back = true;
      return true;
    }
    // straight toward it (Manhattan-normalised: integer-free but exact — no transcendental Math)
    d.x += (dx / dist) * DRONE_SPEED;
    d.y += (dy / dist) * DRONE_SPEED;
    return true;
  });
}
