// Live-layer TRAINS: spawning trains onto the rail network (scaled to its length) and stepping one
// along the rails. Cut verbatim from ui/ambientContent.ts.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import { TRAIN_CAP, TRAIN_LEN, TRAIN_RAIL_PER, TRAIN_SPEED } from './tuning';
import { DIR_DX, DIR_DY, opposite } from './geometry';
import type { AmbientState, Train } from './types';
import { nextRailStep, railTraversable } from './network';
import { syncTrainLegs } from './poses';

/** Top the train fleet up toward one per {@link TRAIN_RAIL_PER} rail tiles (capped). When below
 *  target, scans for rail tiles that have a rail neighbour (so the train can move) and seeds one
 *  there — all cells stacked on the start tile, stretching out as it rides. The scan runs only while
 *  under target (trains persist + shuttle), so it's idle once the network is populated. */
export function spawnTrains(state: AmbientState, map: GameMap, rng: Rng): void {
  let railCount = 0;
  const starts: number[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!railTraversable(map, x, y)) continue;
      railCount++;
      // a viable start has at least one rail neighbour to roll onto
      for (let d = 0; d < 4; d++) {
        if (railTraversable(map, x + DIR_DX[d]!, y + DIR_DY[d]!)) {
          starts.push(map.idx(x, y));
          break;
        }
      }
    }
  }
  const target = Math.min(TRAIN_CAP, Math.floor(railCount / TRAIN_RAIL_PER));
  if (state.trains.length >= target || starts.length === 0) return;
  const idx = starts[rng.nextInt(starts.length)]!;
  const sx = idx % map.width;
  const sy = (idx - sx) / map.width;
  const dir = nextRailStep(map, sx, sy, -1, rng); // any rail neighbour (no incoming heading)
  if (dir < 0) return;
  state.trains.push({
    cells: [idx],
    hx: sx,
    hy: sy,
    tx: sx + DIR_DX[dir]!,
    ty: sy + DIR_DY[dir]!,
    dir,
  });
}

/** Advance a train along its rail; returns false when it should despawn (its head tile is no longer
 *  rail, or the line vanished under it). On reaching its target tile it pushes that tile onto the head
 *  and drops the tail (the cars trace the track), then picks the next rail step (U-turn at a dead-end
 *  → shuttles back). */
export function stepTrain(map: GameMap, t: Train, rng: Rng): boolean {
  if (!railTraversable(map, Math.round(t.hx), Math.round(t.hy))) return false;
  const dist = Math.abs(t.tx - t.hx) + Math.abs(t.ty - t.hy);
  if (dist <= TRAIN_SPEED) {
    t.hx = t.tx;
    t.hy = t.ty;
    const head = map.idx(t.tx, t.ty);
    if (t.cells[0] !== head) {
      t.cells.unshift(head);
      if (t.cells.length > TRAIN_LEN) t.cells.pop();
    }
    const nd = nextRailStep(map, t.tx, t.ty, opposite(t.dir), rng);
    if (nd < 0) return false; // isolated stub → despawn
    t.dir = nd;
    t.tx = t.tx + DIR_DX[nd]!;
    t.ty = t.ty + DIR_DY[nd]!;
  } else {
    t.hx += DIR_DX[t.dir]! * TRAIN_SPEED;
    t.hy += DIR_DY[t.dir]! * TRAIN_SPEED;
  }
  syncTrainLegs(t, map.width);
  return true;
}
