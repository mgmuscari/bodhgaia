// Live-layer MOTION + COLLISION: congestion slow-down, the per-substep mover grid, right-of-way
// serials, the gap/box checks that hold a vehicle back, the grid-following advance, committed-path
// stepping, and the jam relief rungs (re-route, U-turn). Cut verbatim from ui/ambientContent.ts.

import type { GameMap } from '../engine/map';
import { PILEUP_K, PILEUP_MIN, RECENT_CAP, STUCK_ESCAPE, STUCK_REPATH, STUCK_UTURN } from './tuning';
import { DIR_DX, DIR_DY, LANE, laneOffset, opposite } from './geometry';
import type { AmbientState, Mover } from './types';
import { roadPath } from './pathing';
import { canDrive, isJunctionTile } from './network';
import { legPaceFactor } from './poses';

/** Speed multiplier (0..1] for `count` cars sharing a tile (count includes the car itself). 1 for a
 *  lone car; falls off as 1/(1 + PILEUP_K·(count−1)); floored at PILEUP_MIN so traffic crawls through
 *  a jam rather than freezing. Pure. */
export function congestionSpeedMult(count: number): number {
  if (count <= 1) return 1;
  const mult = 1 / (1 + PILEUP_K * (count - 1));
  return mult < PILEUP_MIN ? PILEUP_MIN : mult;
}

/** How many cars on a tile actually pile up against a car heading `dir`, given the tile's per-direction
 *  car histogram `dirCounts` ([N,E,S,W]). Cars heading the OPPOSITE way are just PASSING (oncoming
 *  traffic on a two-way road) — they don't make a jam — so they're excluded; same-direction and
 *  orthogonal cars (a queue or a crossing) DO count (Maddy). The car itself is included (same-dir).
 *  Pure. */
export function congestionCount(dirCounts: readonly number[], dir: number): number {
  let total = 0;
  for (const n of dirCounts) total += n;
  return total - (dirCounts[(dir + 2) % 4] ?? 0); // drop the opposite-heading cars
}

/**
 * Gridlock relief: a path-following vehicle held at a tile centre for STUCK_REPATH substeps (and every
 * STUCK_REPATH after) re-plans from where it stands to the same destination, with the tile it is stuck
 * behind priced out — so it finds a way round the jam instead of waiting on it forever (Maddy
 * 2026-09-30). Returns true iff it took a new route. Pure given (map, traffic).
 */
export function rerouteIfStuck(map: GameMap, car: Mover, traffic: ReadonlyMap<number, number>): boolean {
  const stuck = car.stuck ?? 0;
  if (!car.path || stuck < STUCK_REPATH || stuck % STUCK_REPATH !== 0) return false;
  if (car.x !== Math.round(car.x) || car.y !== Math.round(car.y)) return false; // re-plan from a tile centre only
  const goal = car.path[car.path.length - 1]!;
  const gx = goal % map.width;
  const gy = (goal - gx) / map.width;
  const avoid = new Map(traffic);
  avoid.set(map.idx(car.tx, car.ty), 1e6); // the tile it's stuck behind
  const path = roadPath(map, car.x, car.y, gx, gy, avoid);
  if (!path || path.length < 2 || path.includes(map.idx(car.tx, car.ty))) return false;
  const nx = path[1]! % map.width;
  const ny = (path[1]! - nx) / map.width;
  car.tx = nx;
  car.ty = ny;
  commitHeading(car, nx > car.x ? 1 : nx < car.x ? 3 : ny > car.y ? 2 : 0);
  car.path = path;
  car.leg = 2;
  return true;
}

/**
 * Jam rung 2: a path-following vehicle held STUCK_UTURN substeps — typically MID-LEG in a queue, where a
 * re-plan can't start — turns back toward the tile its leg started from (when driving that edge in
 * reverse is legal; never on a one-way lane) and re-plans from there to the same destination, with the
 * jammed tile priced out. Returns true iff it turned.
 */
export function uTurnIfStuck(map: GameMap, car: Mover, traffic: ReadonlyMap<number, number>): boolean {
  if (!car.path || (car.stuck ?? 0) < STUCK_UTURN) return false;
  const fx = car.tx - DIR_DX[car.dir]!;
  const fy = car.ty - DIR_DY[car.dir]!;
  if (!map.inBounds(fx, fy) || !canDrive(map, car.tx, car.ty, fx, fy)) return false; // no driving back here
  const goal = car.path[car.path.length - 1]!;
  const gx = goal % map.width;
  const gy = (goal - gx) / map.width;
  const avoid = new Map(traffic);
  avoid.set(map.idx(car.tx, car.ty), 1e6);
  const path = roadPath(map, fx, fy, gx, gy, avoid);
  if (!path || path.includes(map.idx(car.tx, car.ty))) return false;
  car.tx = fx;
  car.ty = fy;
  commitHeading(car, opposite(car.dir));
  car.path = path;
  car.leg = 1; // on reaching (fx, fy), path[1] is next
  car.stuck = 0;
  return true;
}

/** True when no moving vehicle's centre sits within `r` of (x, y) — a departure point is free to pull
 *  out onto (so cars leaving a lot don't all materialise on the same spot). */
export function spaceClear(grid: Map<number, Mover[]>, mapW: number, x: number, y: number, r = 0.6): boolean {
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const cell = grid.get((Math.round(y) + dj) * mapW + (Math.round(x) + di));
      if (!cell) continue;
      for (const o of cell) if (Math.abs(o.x - x) < r && Math.abs(o.y - y) < r) return false;
    }
  }
  return true;
}

/** Commit a mover to a new heading, remembering the one it turned from (for moverPose's turn arc). */
export function commitHeading(m: Mover, nd: number): void {
  m.prevDir = m.dir;
  m.dir = nd;
}

// --- Motion --------------------------------------------------------------

/** Advance one grid-following mover by `speed`, recommitting at the target tile.
 *  `map`/`rng` are captured by `pickNext` (the per-kind junction seam); the mover's
 *  bounded `recent` history is updated on arrival and passed to `pickNext` for loop
 *  avoidance. Returns false when the mover is boxed in / isolated (pickNext < 0) so the
 *  caller despawns it instead of leaving it frozen or circling; true otherwise. */
/** Bucket moving vehicles by the tile their centre sits on, for the O(1)-neighbourhood collision check.
 *  Rebuilt each substep before any vehicle moves (a one-substep-stale read is fine at these speeds). */
export function buildMoverGrid(movers: readonly Mover[], mapW: number): Map<number, Mover[]> {
  const g = new Map<number, Mover[]>();
  for (const m of movers) {
    const k = Math.round(m.y) * mapW + Math.round(m.x);
    const arr = g.get(k);
    if (arr) arr.push(m);
    else g.set(k, [m]);
  }
  return g;
}

/** A vehicle's yield priority: its id, else the serial the substep assigned it (assignSerials). */
export function priority(m: Mover): number {
  return m.id ?? m.serial ?? 0;
}

/** Give every vehicle without one a stable serial, in sim order, from the state's counter — so yield
 *  tie-breaks are deterministic per seed (a module-level counter leaked across runs). */
export function assignSerials(state: AmbientState, movers: readonly Mover[]): void {
  for (const m of movers) if (m.serial === undefined) m.serial = state.serialNext++;
}

/** True when another vehicle occupies the bounding-box space just ahead of `m` (at the lane-offset
 *  sprite positions), so `m` must pause rather than overlap it (Maddy: movers can't overlap; pause for
 *  space ahead → queues). STRICT: anything in the claim box stops you, whatever its heading or priority
 *  — the old "cross traffic yields only to higher ids" let a higher-id car turn straight INTO a stopped
 *  queue and stack on it (Maddy 2026-09-30, the ramp at (115,40)). Two vehicles on the very same spot
 *  separate: the lower-priority one waits. ONCOMING traffic (other lane) sits ≈ 2·LANE to the side,
 *  outside `halfWidth`, so it never blocks. Deadlocks this could leave are broken by the stuck re-plan
 *  (STUCK_REPATH) and, failing that, the one-off squeeze (STUCK_ESCAPE) in advanceMover. */
// `gap` (centre-to-centre) must cover BOTH sprites' length (≈0.58) PLUS the max per-substep step
// (freeway ≈0.24) so a car STOPS before its front overshoots into the car ahead. `halfWidth` stays below
// the oncoming-lane separation (2·LANE ≈ 0.32) and at least a car width (CAR_WIDTH).
export function blockedAhead(grid: Map<number, Mover[]>, mapW: number, m: Mover, gap = 0.85, halfWidth = 0.28): boolean {
  const fdx = DIR_DX[m.dir]!;
  const fdy = DIR_DY[m.dir]!;
  const mlo = laneOffset(m.dir);
  const mx = m.x + mlo.dx; // rendered (sprite) position
  const my = m.y + mlo.dy;
  const ti = Math.round(mx + fdx * gap);
  const tj = Math.round(my + fdy * gap);
  const pdx = DIR_DX[(m.dir + 1) & 3]!; // perpendicular unit (lateral)
  const pdy = DIR_DY[(m.dir + 1) & 3]!;
  const mprio = priority(m);
  for (let dj = -2; dj <= 2; dj++) {
    for (let di = -2; di <= 2; di++) {
      const cell = grid.get((tj + dj) * mapW + (ti + di));
      if (!cell) continue;
      for (const o of cell) {
        if (o === m) continue;
        const olo = laneOffset(o.dir);
        const dx = o.x + olo.dx - mx;
        const dy = o.y + olo.dy - my;
        if (Math.abs(dx * pdx + dy * pdy) >= halfWidth) continue; // not in my lane (oncoming / side lanes)
        const fwd = dx * fdx + dy * fdy; // distance ahead of m
        if (Math.abs(fwd) <= 0.02) {
          if (priority(o) > mprio) return true; // fused on one spot → the lower priority waits
          continue;
        }
        if (fwd > 0 && fwd <= gap) return true; // anything in the claim box ahead stops me
      }
    }
  }
  return false;
}

/** DON'T BLOCK THE BOX (Maddy 2026-10-01: gridlock). A car heading INTO a junction waits outside it until
 *  its exit — the tile after the junction on its path — has room in its lane: a car stopped inside a
 *  junction blocks every crossing direction, and the queues that makes block the next junction. Checked by
 *  standing a virtual car in the junction facing the exit and asking blockedAhead. A car already inside
 *  always clears it; mid-block, or without a committed path, the rule doesn't apply. */
export function boxBlocked(grid: Map<number, Mover[]>, map: GameMap, m: Mover): boolean {
  if (!m.path || m.leg === undefined) return false;
  const cx = Math.round(m.x);
  const cy = Math.round(m.y);
  if ((cx === m.tx && cy === m.ty) || isJunctionTile(map, cx, cy) || !isJunctionTile(map, m.tx, m.ty)) return false;
  const exit = m.path[m.leg];
  if (exit === undefined) return false;
  const ex = exit % map.width;
  const ey = (exit - ex) / map.width;
  const dir = ex > m.tx ? 1 : ex < m.tx ? 3 : ey > m.ty ? 2 : 0;
  return blockedAhead(grid, map.width, { x: m.tx, y: m.ty, dir, tx: m.tx, ty: m.ty }, 1.0);
}

export function advanceMover(
  m: Mover,
  speed: number,
  map: GameMap,
  pickNext: (x: number, y: number, fromDir: number, recent: readonly number[]) => number,
  blocked?: (m: Mover) => boolean,
  lateral = LANE,
  /** Keep pace round a turn arc (vehicles are drawn on one); walkers walk straight legs and keep their own pace. */
  paced = true,
): boolean {
  if (blocked?.(m)) {
    // space ahead occupied → pause this substep (alive, just waiting) — unless it has waited so long
    // that this is a true circular deadlock, which one car must break by squeezing through
    m.stuck = (m.stuck ?? 0) + 1;
    if (m.stuck < STUCK_ESCAPE) return true;
  }
  m.stuck = 0;
  if (paced) speed *= legPaceFactor(m, lateral); // a turn leg's drawn arc is shorter/longer than a tile — keep pace
  const dist = Math.abs(m.tx - m.x) + Math.abs(m.ty - m.y);
  if (dist <= speed) {
    // Arrive at the target tile centre, record it, and recommit to the next leg.
    m.x = m.tx;
    m.y = m.ty;
    const recent = (m.recent ??= []);
    recent.push(map.idx(m.tx, m.ty));
    if (recent.length > RECENT_CAP) recent.shift();
    const fromDir = opposite(m.dir);
    const nd = pickNext(m.tx, m.ty, fromDir, recent);
    if (nd < 0) return false; // isolated, or boxed in by its own path → despawn
    commitHeading(m, nd);
    m.tx = m.x + DIR_DX[nd]!;
    m.ty = m.y + DIR_DY[nd]!;
  } else {
    m.x += DIR_DX[m.dir]! * speed;
    m.y += DIR_DY[m.dir]! * speed;
  }
  return true;
}

/** A trip-car's next-leg picker (the `pickNext` for advanceMover): head to the next tile
 *  on the committed path, advancing the leg cursor; -1 when the path is exhausted (the car
 *  has arrived → despawn). Path tiles are adjacent, so the heading is their delta. */
export function pathStep(map: GameMap, car: Mover, x: number, y: number): number {
  const path = car.path!;
  const leg = car.leg!;
  if (leg >= path.length) return -1;
  const next = path[leg]!;
  const nx = next % map.width;
  const ny = (next - nx) / map.width;
  car.leg = leg + 1;
  if (nx > x) return 1;
  if (nx < x) return 3;
  if (ny > y) return 2;
  if (ny < y) return 0;
  return -1; // non-adjacent (shouldn't happen on a committed path) → despawn
}
