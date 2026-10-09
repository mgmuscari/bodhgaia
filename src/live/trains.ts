// Live-layer TRAINS: spawning trains onto the rail network (scaled to its length) and stepping one
// along the rails. Cut verbatim from ui/ambientContent.ts.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import { CAR_STRAIGHT_WEIGHT, TRAIN_CAP, TRAIN_EVERY, TRAIN_LEN, TRAIN_SPEED, TRAM_EVERY } from './tuning';
import { DIR_DX, DIR_DY, opposite } from './geometry';
import type { AmbientState, Train } from './types';
import { pickStep } from './network';
import { DWELL, familyOf, transitFor, type LineFamily } from './transit';
import { syncTrainLegs } from './poses';

/** Cars per vehicle: a tram is short. */
export const TRAM_LEN = 2;

/** Tiles a substep: trams at street pace, trains fast between their few stations (Maddy 2026-10-08). */
export function vehicleSpeed(family: 'tram' | 'rail'): number {
  return family === 'tram' ? TRAIN_SPEED : TRAIN_SPEED * 2.5;
}

/** Can a vehicle of `family` ride the tile at (x, y)? */
export function trackTraversable(map: GameMap, x: number, y: number, family: LineFamily): boolean {
  return map.inBounds(x, y) && familyOf(map.built[map.idx(x, y)]!) === family;
}

/** Top every line's fleet up (docs/design/transit.md): at least one vehicle per line, one per TRAM_EVERY (trams) or
 *  TRAIN_EVERY (trains) of its tiles, TRAIN_CAP in all — trams on streetcar track, trains on rail and elevated rail. A new
 *  vehicle starts stacked on a line tile it can roll on from, and stretches out as it rides. */
export function spawnTransit(state: AmbientState, map: GameMap, rng: Rng): void {
  const { lines, lineOf } = transitFor(map);
  if (lines.length === 0 || state.trains.length >= TRAIN_CAP) return;
  const running = new Map<number, number>();
  for (const t of state.trains) {
    const l = lineOf[map.idx(Math.round(t.hx), Math.round(t.hy))] ?? -1;
    if (l >= 0) running.set(l, (running.get(l) ?? 0) + 1);
  }
  for (const line of lines) {
    const want = Math.max(1, Math.floor(line.tiles.length / (line.family === 'tram' ? TRAM_EVERY : TRAIN_EVERY)));
    if ((running.get(line.id) ?? 0) >= want) continue;
    const starts = line.tiles.filter((t) => {
      const x = t % map.width;
      const y = (t - x) / map.width;
      for (let d = 0; d < 4; d++) if (trackTraversable(map, x + DIR_DX[d]!, y + DIR_DY[d]!, line.family)) return true;
      return false;
    });
    if (starts.length === 0) continue;
    const idx = starts[rng.nextInt(starts.length)]!;
    const sx = idx % map.width;
    const sy = (idx - sx) / map.width;
    const dir = pickStep(map, sx, sy, -1, rng, (nx, ny) => trackTraversable(map, nx, ny, line.family), CAR_STRAIGHT_WEIGHT);
    if (dir < 0) continue;
    state.trains.push({ cells: [idx], hx: sx, hy: sy, tx: sx + DIR_DX[dir]!, ty: sy + DIR_DY[dir]!, dir, family: line.family });
    return; // one a substep
  }
}

/** The old name: the fleet is every line's now. */
export const spawnTrains = spawnTransit;

/** Advance a train along its rail; returns false when it should despawn (its head tile is no longer
 *  rail, or the line vanished under it). On reaching its target tile it pushes that tile onto the head
 *  and drops the tail (the cars trace the track), then picks the next rail step (U-turn at a dead-end
 *  → shuttles back). */
export function stepTrain(map: GameMap, t: Train, rng: Rng): boolean {
  const family = t.family ?? 'rail';
  const speed = vehicleSpeed(family);
  if (!trackTraversable(map, Math.round(t.hx), Math.round(t.hy), family)) return false;
  if ((t.dwell ?? 0) > 0) {
    t.dwell!--; // halted at a stop
    syncTrainLegs(t, map.width);
    return true;
  }
  const dist = Math.abs(t.tx - t.hx) + Math.abs(t.ty - t.hy);
  if (dist <= speed) {
    t.hx = t.tx;
    t.hy = t.ty;
    const head = map.idx(t.tx, t.ty);
    if (t.cells[0] !== head) {
      t.cells.unshift(head);
      if (t.cells.length > (family === 'tram' ? TRAM_LEN : TRAIN_LEN)) t.behind = t.cells.pop();
    }
    const nd = pickStep(map, t.tx, t.ty, opposite(t.dir), rng, (nx, ny) => trackTraversable(map, nx, ny, family), CAR_STRAIGHT_WEIGHT);
    if (nd < 0) return false; // isolated stub → despawn
    t.dir = nd;
    t.tx = t.tx + DIR_DX[nd]!;
    t.ty = t.ty + DIR_DY[nd]!;
    // a stop: halt here (once — then on). Only now, with the next tile chosen: the cars are placed by progress
    // toward it, and a vehicle halted before choosing was drawn a whole tile ahead (Maddy: trams snapped to stops)
    if (transitFor(map).stopAt.has(head) && t.lastStop !== head) {
      t.lastStop = head;
      t.dwell = DWELL;
    }
  } else {
    t.hx += DIR_DX[t.dir]! * speed;
    t.hy += DIR_DY[t.dir]! * speed;
  }
  syncTrainLegs(t, map.width);
  return true;
}
