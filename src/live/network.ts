// Live-layer NETWORK predicates: which tiles cars, pedestrians, trains and birds may occupy, the
// legal car edges (canDrive: lanes, freeway access, level crossings), the junction picks that steer
// grid-following movers, kerb stalls, and the despawn predicates. Cut verbatim from
// ui/ambientContent.ts; pure reads of the map (rng only where a step is chosen).

import type { GameMap } from '../engine/map';
import { BuiltKind, isRoadKind } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import type { Rng } from '../engine/rng';
import { CAR_STRAIGHT_WEIGHT, FAUNA_THRESHOLD, LANE_SCAN_CAP } from './tuning';
import { DIR_DX, DIR_DY, KERB_PULL, STALL_ALONG, opposite } from './geometry';
import type { Car, Ped } from './types';

// --- Pure decision helpers (unit-test seams) -----------------------------

/**
 * Spawn WEIGHT for cars by road class: highway 3 / avenue 2 / street 1, and 0 for
 * quiet streets, rail, buildings and empty land. THE load-bearing ratio contract —
 * an exact, deterministic function with no tolerance.
 */
export function carWeightForRoad(kind: number): number {
  switch (kind) {
    case BuiltKind.RoadHighway:
      return 3;
    case BuiltKind.RoadAvenue:
      return 2;
    case BuiltKind.RoadStreet:
      return 1;
    default:
      return 0;
  }
}

/**
 * Car TRAVERSABILITY: kinds 1..3 (street/avenue/highway). Pinned to isRoadKind, NOT
 * transportCategory (which returns 1 for QuietStreet) — so a car neither spawns on
 * nor moves onto a quiet street. This is the seam that closes the spawn-vs-move gap.
 */
export function isCarRoad(kind: number): boolean {
  return isRoadKind(kind);
}

/** A lane within a divided multi-lane road (a widened avenue/freeway: parallel rows
 *  of the SAME road kind). An `outer` lane is one-way (right-hand traffic) with its
 *  `dir` heading and `outward` road edge; the `through` lane is the interior of a 3+-wide
 *  road and carries traffic BOTH ways along the road's axis (Maddy: middle goes both). The
 *  `median` role is reserved for the future planted no-traffic median (a road-diet upgrade). */
export type FreewayLane =
  | { role: 'outer'; dir: number; outward: number }
  | { role: 'through'; horizontal: boolean }
  | { role: 'median' };

/** Length of the same-kind run from (x, y) in direction (dx, dy), exclusive of the
 *  origin, capped at LANE_SCAN_CAP. */
export function sameRun(map: GameMap, x: number, y: number, k: number, dx: number, dy: number): number {
  let n = 0;
  for (let i = 1; i <= LANE_SCAN_CAP; i++) {
    const nx = x + dx * i;
    const ny = y + dy * i;
    if (!map.inBounds(nx, ny) || !inLaneBand(k, map.built[map.idx(nx, ny)]!)) break;
    n++;
  }
  return n;
}

/**
 * Classify a road tile's place in a divided multi-lane road, or `null` if it is not a
 * clean multi-lane lane — a 1-wide road or a junction where the two same-kind bands are
 * equal (a square crossing). Those fall back to general straight-biased routing, so a
 * car CAN turn there: that is exactly "turns only at a true junction". Read purely from
 * same-kind neighbours (read-only, no rng):
 *   1. Measure the same-kind run length along each axis (capped). The shorter run is the
 *      road's WIDTH axis; the longer is its LENGTH. This ranks correctly at lane ends
 *      and mid-lane alike (an end tile still has the full width band).
 *   2. On the width axis: same-kind road on BOTH sides → `median` (interior of a 3+-wide
 *      road, no traffic). Same-kind on one side only → `outer`: the bare side is the road
 *      `outward` edge (kerb), and the one-way `dir` is the heading whose right-hand side
 *      is that edge (right-hand traffic). So a horizontal freeway's north lane runs west
 *      and its south lane runs east; `laneOffset(dir)` then nudges each carriageway to
 *      its own kerb. Neither side same → 1-wide road → `null`.
 */
export function freewayLane(map: GameMap, x: number, y: number): FreewayLane | null {
  const k = map.built[map.idx(x, y)]!;
  // A planted median is a no-traffic lane in its own right (the road-diet upgrade) — classify it
  // directly so canDrive treats it as a green barrier (no driving on or across it).
  if (k === BuiltKind.PlantedMedian) return { role: 'median' };
  // Only worldgen-WIDENED roads are divided: avenues are 2-wide, highways 3-wide.
  // Streets are 1-wide by construction, so a same-kind street neighbour is a junction
  // arm, never a parallel lane — classifying a street as a lane misreads a staggered
  // street junction as two OPPOSING one-way tiles that oscillate (Maddy degenerate).
  if (k !== BuiltKind.RoadAvenue && k !== BuiltKind.RoadHighway) return null;
  const same = (d: number): boolean => {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    return map.inBounds(nx, ny) && inLaneBand(k, map.built[map.idx(nx, ny)]!);
  };
  const vert = 1 + sameRun(map, x, y, k, 0, -1) + sameRun(map, x, y, k, 0, 1);
  const horiz = 1 + sameRun(map, x, y, k, -1, 0) + sameRun(map, x, y, k, 1, 0);
  if (horiz > vert) {
    // Horizontal road — width is the N–S axis. Outer lanes one-way (right-hand traffic); the
    // interior is a two-way `through` lane (Maddy: south goes east, north goes west, middle both).
    const n = same(0); // North neighbour same-kind?
    const s = same(2); // South neighbour same-kind?
    if (n && s) return { role: 'through', horizontal: true };
    if (s && !n) return { role: 'outer', dir: 3, outward: 0 }; // north lane → West
    if (n && !s) return { role: 'outer', dir: 1, outward: 2 }; // south lane → East
    return null;
  }
  if (vert > horiz) {
    // Vertical road — width is the E–W axis. Interior is a two-way `through` lane (see above).
    const e = same(1); // East neighbour same-kind?
    const w = same(3); // West neighbour same-kind?
    if (e && w) return { role: 'through', horizontal: false };
    if (e && !w) return { role: 'outer', dir: 2, outward: 3 }; // west lane → South
    if (w && !e) return { role: 'outer', dir: 0, outward: 1 }; // east lane → North
    return null;
  }
  return null; // equal bands — a square crossing → general routing (a true junction)
}

/**
 * Pedestrian SUBSTRATE at (x, y): a quiet street, promenade, or parklet tile, OR any
 * tile orthogonally adjacent to a community garden, park, or rewilded land. Peds
 * favour the calm/green city, never the road network.
 */
export function isPedSubstrate(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  // An elevated PROMENADE deck (an overpass) is walkable regardless of what's below — so a promenade
  // overpass carries pedestrians ACROSS a freeway they could never cross at grade.
  if (map.deck[map.idx(x, y)] === BuiltKind.Promenade) return true;
  const k = map.built[map.idx(x, y)]!;
  if (k === BuiltKind.QuietStreet || k === BuiltKind.Promenade || k === BuiltKind.Parklet) {
    return true;
  }
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    const nk = map.built[map.idx(nx, ny)]!;
    if (nk === BuiltKind.CommunityGarden || nk === BuiltKind.Park || nk === BuiltKind.RewildedLand) {
      return true;
    }
  }
  return false;
}

/**
 * Bird-flock spawn predicate: faunaPresence at (x, y) is at or above the threshold
 * (a dead zone — fauna below threshold, including 0 — is excluded).
 */
export function birdSpawnAt(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  return map.faunaPresence[map.idx(x, y)]! >= FAUNA_THRESHOLD;
}

/** Generic junction step: pick a connected passable neighbour direction, excluding
 *  the U-turn `fromDir` unless it is the only option (dead-end). -1 if isolated.
 *
 *  `straightWeight` (default 1 = uniform) biases the choice toward continuing in the
 *  current heading (the direction opposite the U-turn): with N ways open, the
 *  straight option weighs `straightWeight` against 1 for each turn. Cars pass a high
 *  weight so they run a road block and cross junctions instead of looping small
 *  blocks (Maddy playtest); peds keep the uniform default.
 *
 *  `recent` (tile indices recently occupied) drives loop avoidance: options leading to
 *  a recently-visited tile are dropped UNLESS that would leave nothing, in which case
 *  the mover is boxed in by its own path and the step returns -1 (the caller despawns
 *  it rather than letting it circle). A dead-end U-turn is still taken (it is the
 *  `options.length === 0` path, before avoidance). Determinism note: the dead-end and
 *  single-fresh-option paths consume the rng exactly as before, so junction-free maps
 *  are byte-identical when `recent` never prunes. */
export function pickStep(
  map: GameMap,
  x: number,
  y: number,
  fromDir: number,
  rng: Rng,
  passable: (nx: number, ny: number) => boolean,
  straightWeight = 1,
  recent?: readonly number[],
): number {
  const options: number[] = [];
  let uTurn = -1;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    if (!passable(nx, ny)) continue;
    if (d === fromDir) {
      uTurn = d;
      continue;
    }
    options.push(d);
  }
  if (options.length === 0) return uTurn; // dead-end (or -1 if truly isolated)
  // Loop avoidance: prefer options that do not revisit a recent tile. If every option
  // is recent, the mover is boxed in by its own path → -1 (caller despawns it).
  let pool = options;
  if (recent && recent.length > 0) {
    const fresh = options.filter((d) => !recent.includes(map.idx(x + DIR_DX[d]!, y + DIR_DY[d]!)));
    if (fresh.length === 0) return -1;
    pool = fresh;
  }
  // Uniform choice when there's nothing to bias toward: a single option, no weight,
  // or no incoming heading (fromDir < 0, i.e. spawn) — at spawn there is no "straight"
  // to prefer, and keeping the uniform draw makes spawn rng-identical to before.
  if (pool.length === 1 || straightWeight <= 1 || fromDir < 0) {
    return pool[rng.nextInt(pool.length)]!;
  }
  // Weighted junction choice: the straight-ahead direction (opposite the U-turn)
  // outweighs each turn by `straightWeight`, so traffic flows through the corridor.
  const straight = opposite(fromDir);
  let total = 0;
  for (const d of pool) total += d === straight ? straightWeight : 1;
  let r = rng.nextInt(total);
  for (const d of pool) {
    r -= d === straight ? straightWeight : 1;
    if (r < 0) return d;
  }
  return pool[pool.length - 1]!; // unreachable: r < total
}

/** Routing on a divided multi-lane road's outer lane: travel the one-way `dir`; turn
 *  off ONLY where a cross-road meets the outward edge (a true junction); never weave
 *  across to the median/opposite carriageway and never reverse. */
export function freewayStep(
  map: GameMap,
  x: number,
  y: number,
  lane: { dir: number; outward: number },
  rng: Rng,
): number {
  const ax = x + DIR_DX[lane.dir]!;
  const ay = y + DIR_DY[lane.dir]!;
  const aheadRoad = map.inBounds(ax, ay) && isCarRoad(map.built[map.idx(ax, ay)]!);
  const ox = x + DIR_DX[lane.outward]!;
  const oy = y + DIR_DY[lane.outward]!;
  const exitRoad = map.inBounds(ox, oy) && isCarRoad(map.built[map.idx(ox, oy)]!);
  if (aheadRoad && exitRoad) {
    // True junction: mostly stay on the freeway, occasionally take the ramp.
    return rng.nextInt(CAR_STRAIGHT_WEIGHT + 1) === 0 ? lane.outward : lane.dir;
  }
  if (aheadRoad) return lane.dir; // open freeway — straight, no turns, no weaving
  if (exitRoad) return lane.outward; // freeway ended at a ramp — exit
  return lane.dir; // ran out of road — continue off-network, despawn next step
}

/** A car may occupy a road (1..3) or a parking lot — cars cut THROUGH parking (the
 *  accumulated concrete of the over-paved city) rather than routing around it. */
export function carTraversable(kind: number): boolean {
  return isCarRoad(kind) || kind === BuiltKind.ParkingLot || kind === BuiltKind.RoadRamp;
}

/** A freeway-family tile for LANE GEOMETRY: a highway or a ramp. A ramp is a freeway tile that also
 *  meets the surface, so for run-length classification it counts as freeway (it must not break the
 *  lane runs around it), even though canDrive treats the ramp itself as a free interchange. */
export function isFreewayKind(kind: number): boolean {
  return kind === BuiltKind.RoadHighway || kind === BuiltKind.RoadRamp;
}

/** Same lane material for run measurement: identical kinds, or both freeway-family (highway/ramp). */
export function sameLaneKind(a: number, b: number): boolean {
  return a === b || (isFreewayKind(a) && isFreewayKind(b));
}

/** Whether neighbour kind `b` belongs to road `a`'s WIDTH BAND for lane classification: the same
 *  lane material, OR a PlantedMedian. A planted median is a no-traffic lane WITHIN the road, so it
 *  must count toward the road's width — otherwise a road-diet median between two carriageways would
 *  make each carriageway read as a 1-wide road and lose its one-way direction. */
export function inLaneBand(a: number, b: number): boolean {
  return sameLaneKind(a, b) || b === BuiltKind.PlantedMedian;
}

/** An at-grade rail/tram LINE a car may CROSS at a level crossing (it can never drive ALONG it): a
 *  streetcar or a rail line. Lets a cross street cross a tram median at an intersection without the
 *  transit tile blocking it (Maddy: a streetcar in flanking avenues must not block cross traffic). */
export function isLevelCrossable(kind: number): boolean {
  return kind === BuiltKind.Streetcar || kind === BuiltKind.Rail;
}

/** Car traversability for general (non-lane) routing: a road or parking tile that is
 *  NOT a divided road's median. Cars neither spawn on, weave onto, nor turn (at a
 *  junction) onto a median — so the median stays a true no-traffic gap. */
export function carPassable(map: GameMap, x: number, y: number): boolean {
  if (!carTraversable(map.built[map.idx(x, y)]!)) return false;
  const lane = freewayLane(map, x, y);
  return lane === null || lane.role !== 'median';
}

/** A tile a car may come to REST on: a non-freeway street/avenue/parking surface on dry land.
 *  Freeways carry no parking and a road over water is a bridge, not a kerb — both are excluded, so
 *  a car never freezes on a freeway or over water (Maddy: cars parking on freeways). The single
 *  authoritative parking predicate, shared by the kerb search and the owned-car park fallback. */
export function isParkable(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const k = map.built[map.idx(x, y)]!;
  if (!carTraversable(k) || k === BuiltKind.RoadHighway) return false;
  return map.water[map.idx(x, y)] === 0;
}

/** Does (x,y) have a SHOULDER — an orthogonal neighbour that is NOT a drivable road (a kerb edge, a
 *  building/grass/water bank, or the map edge) to pull over against? A car curb-parks on a shoulder so
 *  it sits at the kerb, not stranded in the middle of a wide road/avenue lane (Maddy: "cars parking in
 *  the middle of the street"). A tile ringed by drivable road on all four sides (a lane interior) has
 *  no shoulder and is not a valid street park. */

/**
 * The curb-parking STALLS of a road tile — up to 4 discrete kerb slots, an offset (from the tile
 * centre out to a kerb) per slot. Two stalls on each SHOULDER side (a non-drivable orthogonal
 * neighbour / map edge), capped at 4 total. A tile with NO shoulder — a lane interior of a wide road,
 * all four neighbours drivable — offers NONE, so a car can never double-park in the middle of the
 * street (Maddy: "they keep piling into the middle of the street"). Pure geometry; the kerb-pull keeps
 * each offset < 0.5 on its axis, so a parked car still rounds to its road tile (occupancy by tile+slot).
 */
export function curbStallOffsets(map: GameMap, tx: number, ty: number): Array<{ dir: number; dx: number; dy: number }> {
  const out: Array<{ dir: number; dx: number; dy: number }> = [];
  for (let dir = 0; dir < 4 && out.length < 4; dir++) {
    const nx = tx + DIR_DX[dir]!;
    const ny = ty + DIR_DY[dir]!;
    if (map.inBounds(nx, ny) && carTraversable(map.built[map.idx(nx, ny)]!)) continue; // not a kerb side
    const kx = DIR_DX[dir]! * KERB_PULL;
    const ky = DIR_DY[dir]! * KERB_PULL;
    const px = -DIR_DY[dir]! * STALL_ALONG; // perpendicular to the kerb (along it)
    const py = DIR_DX[dir]! * STALL_ALONG;
    out.push({ dir, dx: kx + px, dy: ky + py });
    if (out.length < 4) out.push({ dir, dx: kx - px, dy: ky - py });
  }
  return out;
}

/** The grid direction (0..3) of the step from (fx,fy) to an orthogonally-adjacent (tx,ty). */
export function moveDir(fx: number, fy: number, tx: number, ty: number): number {
  if (tx > fx) return 1; // East
  if (tx < fx) return 3; // West
  if (ty > fy) return 2; // South
  return 0; // North
}

/** True iff direction `d` runs along a `through` lane's road axis (so a car may travel it). */
export function alongThrough(lane: { horizontal: boolean }, d: number): boolean {
  return lane.horizontal ? d === 1 || d === 3 : d === 0 || d === 2;
}

/**
 * EDGE-aware car passability: may a car move from (fx,fy) to adjacent (tx,ty)? This is what makes a
 * freeway LIMITED-ACCESS (Maddy): you can only move ALONG a freeway (an outer lane in its one-way
 * `dir`, or the two-way `through` middle along the axis), and you can only enter/leave it where it is
 * NOT a clean lane — at a `null` tile, which is exactly a freeway interchange (freeway crosses
 * freeway) or an end. So cross traffic never cuts across a freeway mid-span, but does at interchanges
 * and ends. Off the freeway (at-grade streets/avenues) it is the plain `carPassable` test — those
 * stay permissive (cross traffic / the divided-avenue crossing is handled separately). Direction is
 * only meaningful for adjacent tiles; callers pass 4-neighbours.
 */
export function canDrive(map: GameMap, fx: number, fy: number, tx: number, ty: number): boolean {
  if (!map.inBounds(tx, ty)) return false;
  const toKind = map.built[map.idx(tx, ty)]!;
  if (!carTraversable(toKind)) {
    // Level crossing: a car may CROSS an at-grade tram/rail line STRAIGHT through to the drivable
    // tile beyond (a cross street crossing an avenue's streetcar median), but never drive along it.
    if (isLevelCrossable(toKind)) {
      const d = moveDir(fx, fy, tx, ty);
      const bx = tx + DIR_DX[d]!;
      const by = ty + DIR_DY[d]!;
      return map.inBounds(bx, by) && carTraversable(map.built[map.idx(bx, by)]!);
    }
    return false;
  }
  const fromKind = map.built[map.idx(fx, fy)]!;
  // NJ-style freeway frontage lot (Maddy): a car may move between a freeway and an adjacent PARKING
  // LOT in BOTH directions — the lot is a limited-access on/off, bypassing the lane-direction gate
  // (the kind of freeway-side lot you see in northern NJ). Scoped to lot↔highway so it doesn't
  // reopen general limited-access crossing.
  if (
    (fromKind === BuiltKind.ParkingLot && toKind === BuiltKind.RoadHighway) ||
    (toKind === BuiltKind.ParkingLot && fromKind === BuiltKind.RoadHighway)
  ) {
    return true;
  }
  const fromHwy = fromKind === BuiltKind.RoadHighway;
  const toHwy = map.built[map.idx(tx, ty)] === BuiltKind.RoadHighway;
  if (!fromHwy && !toHwy) {
    // At-grade. A divided AVENUE's outer lane is one-way (like a freeway lane) so committed routes
    // can't drive the wrong way — but UNLIKE a freeway it stays crossable: a cross street may cross
    // it perpendicular (a road continues straight beyond). Non-lane at-grade tiles are free.
    const L = freewayLane(map, tx, ty);
    if (L && L.role === 'outer') {
      const d = moveDir(fx, fy, tx, ty);
      if (d === L.dir) return true; // along the one-way lane
      if (d === opposite(L.dir)) return false; // wrong-way along the avenue
      const bx = tx + DIR_DX[d]!; // perpendicular → only as a straight crossing to a road beyond
      const by = ty + DIR_DY[d]!;
      return map.inBounds(bx, by) && carTraversable(map.built[map.idx(bx, by)]!);
    }
    return true;
  }
  const d = moveDir(fx, fy, tx, ty);
  if (fromHwy) {
    const L = freewayLane(map, fx, fy); // EXIT: leave a freeway only along it (or an outer ramp)
    if (L && L.role === 'outer' && d !== L.dir && d !== L.outward) return false;
    if (L && L.role === 'through' && !alongThrough(L, d)) return false;
  }
  if (toHwy) {
    const L = freewayLane(map, tx, ty); // ENTER: join a freeway only along it (never perpendicular)
    if (L && L.role === 'outer' && d !== L.dir) return false;
    if (L && L.role === 'through' && !alongThrough(L, d)) return false;
  }
  return true; // null freeway tiles (interchange / end) impose no direction → cross/turn freely
}

/**
 * The car motion seam: from road tile (x, y), the chosen connected isRoadKind
 * neighbour direction (0..3). On a divided multi-lane road's outer lane the choice is
 * the one-way `freewayStep` (independent of `fromDir`, including spawn); otherwise it
 * is the general straight-biased junction pick over `carPassable` neighbours (never a
 * median), excluding the U-turn `fromDir` unless it is the only connected road
 * (dead-end), and avoiding tiles in `recent` (loop avoidance — returns -1 if boxed in
 * by its own path). -1 if (x, y) has no road neighbour at all. Deterministic given `rng`.
 */
export function nextRoadStep(
  map: GameMap,
  x: number,
  y: number,
  fromDir: number,
  rng: Rng,
  recent?: readonly number[],
): number {
  const lane = freewayLane(map, x, y);
  if (lane && lane.role === 'outer') {
    return freewayStep(map, x, y, lane, rng); // one-way: cannot loop, no avoidance needed
  }
  // Everything else (the two-way `through` middle, an interchange/end, an at-grade junction) is the
  // straight-biased pick — but over canDrive edges, so a `through` car stays on-axis and a car can
  // only cross/turn onto a freeway where it's an interchange/end (limited access).
  return pickStep(map, x, y, fromDir, rng, (nx, ny) => canDrive(map, x, y, nx, ny), CAR_STRAIGHT_WEIGHT, recent);
}

/** A tile a TRAIN can ride: an at-grade heavy-rail tile (Rail). (Elevated rail / trams are a
 *  follow-up — heavy rail is the train network.) */
export function railTraversable(map: GameMap, x: number, y: number): boolean {
  return map.inBounds(x, y) && map.built[map.idx(x, y)] === BuiltKind.Rail;
}

/** The train motion seam: from rail tile (x, y), the chosen connected rail neighbour direction
 *  (0..3). Strongly straight-biased (a train glides through junctions) over rail edges; NO recent
 *  list, so at a dead-end `pickStep` returns the U-turn and the train SHUTTLES back. -1 only if the
 *  tile has no rail neighbour at all (an isolated stub) → the caller despawns. Deterministic. */
export function nextRailStep(map: GameMap, x: number, y: number, fromDir: number, rng: Rng): number {
  return pickStep(map, x, y, fromDir, rng, (nx, ny) => railTraversable(map, nx, ny), CAR_STRAIGHT_WEIGHT);
}

// --- Despawn predicates --------------------------------------------------

/** A car is gone once the tile under it is no longer traversable — a road or parking
 *  lot (e.g. bulldozed/converted, or driven off the far side of the lot it cut through). */
export function carOffNetwork(map: GameMap, c: Car): boolean {
  if (c.abandoned) return false; // a derelict legitimately sits off the road on an empty tile
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  if (!map.inBounds(x, y)) return true;
  const k = map.built[map.idx(x, y)]!;
  return !carTraversable(k) && !isLevelCrossable(k); // a car mid-crossing a tram/rail line is fine
}

/** A ped is gone once the tile under it is no longer pedestrian substrate. */
export function pedOffNetwork(map: GameMap, p: Ped): boolean {
  return !isPedSubstrate(map, Math.round(p.x), Math.round(p.y));
}

/** A junction: a drivable tile with 3+ drivable neighbours. */
export function isJunctionTile(map: GameMap, x: number, y: number): boolean {
  if (!carPassable(map, x, y)) return false;
  let n = 0;
  for (let d = 0; d < 4; d++) if (carPassable(map, x + DIR_DX[d]!, y + DIR_DY[d]!)) n++;
  return n >= 3;
}

/** Ped-walkable: any in-bounds, non-water tile that is NOT an occupied R/C/I/Civic plot and NOT
 *  a FREEWAY (RoadHighway) — local streets, stroads, transit, PARKING, parks, rewilded greens,
 *  empty land all walk; building footprints + freeways block. Routed pedestrians step across
 *  the walkable set (around plots), so they no longer cut diagonally through buildings. */
export function isWalkable(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  if (map.water[map.idx(x, y)] !== 0) return false; // Water.None === 0
  const k = map.built[map.idx(x, y)]!;
  if (k === BuiltKind.RoadHighway || k === BuiltKind.RoadRamp) return false; // no walking a freeway/ramp
  // A planted median is a no-traffic green BARRIER dividing a road, not a crossing or a park: cars
  // never drive on/across it, and peds must not cut through it either (Maddy: travelers path through
  // dividers/medians). It's an amenity that lifts the corridor, never a foot route or a destination.
  if (k === BuiltKind.PlantedMedian) return false;
  return zoneTypeOf(k) === ZoneType.None;
}

/** Has a ped at (px,py) reached its destination PLOT? Adjacent to the exact target tile, OR — for a
 *  MULTI-TILE footprint — on or adjacent to ANY tile of the same parcel. Maddy: "visiting a multitile
 *  plot should count as entering any of its tiles," so a citizen needn't reach one specific anchor of a
 *  big building/home (it enters whichever tile it gets to). A non-parcel target (a road/bare tile) has
 *  no footprint, so only the exact-tile door counts. */
export function reachedPlot(map: GameMap, px: number, py: number, tx: number, ty: number): boolean {
  if (Math.abs(px - tx) + Math.abs(py - ty) <= 1) return true; // at/adjacent the exact target tile
  const dp = map.parcel[map.idx(tx, ty)]!;
  if (dp === 0) return false; // not a parcel — only the exact door
  const onPlot = (x: number, y: number): boolean => map.inBounds(x, y) && map.parcel[map.idx(x, y)] === dp;
  if (onPlot(px, py)) return true;
  for (let d = 0; d < 4; d++) if (onPlot(px + DIR_DX[d]!, py + DIR_DY[d]!)) return true;
  return false;
}

/** Wild-green ground a desire path forms through: ANY empty land (no road/building) that isn't
 *  water. Empty ground IS the wild green — even bare patches wear and litter under foot traffic
 *  (water is impassable and pollutes instead). Pedestrians crossing these trample them brown. */
export function isWearable(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  return map.built[i] === BuiltKind.None && map.water[i] === 0;
}

/** A car-passable road tile adjacent to (x, y), or -1. */
export function adjacentRoad(map: GameMap, x: number, y: number): number {
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (map.inBounds(nx, ny) && carPassable(map, nx, ny)) return map.idx(nx, ny);
  }
  return -1;
}

/**
 * A pedestrian is despawned when its substrate vanished — UNLESS it's a last-mile walker (a `walkTo`
 * is set; it crosses lots/roads off-grid and self-despawns on arrival) or a hidden DRIVER (`phase
 * 'driving'`; it rides inside its car, off the ped network by design). The driving exemption is
 * EXPLICIT by phase so it can't break if the stale `walkTo` left over from boarding is ever cleared.
 */
export function pedDespawns(map: GameMap, p: Ped): boolean {
  return p.phase !== 'driving' && p.walkTo === undefined && pedOffNetwork(map, p);
}

// --- Precomputed network masks (the A* hot loop) ---------------------------
//
// A* asks the same per-neighbour questions over and over — isWalkable for walkers, canDrive (with its
// freewayLane run scans) for cars — so they are tabulated once per map: `walk[i]` = isWalkable, and
// bit d of `drive[i]` = canDrive from tile i one step in direction d. Both are pure functions of
// map.built + map.water (and the map's bounds). The live layer never sees placement events and the map
// is written directly (`map.built[i] = …`) all over, so the cache can't be told when to refresh: it
// VALIDATES instead — each lookup compares built/water against a private copy, a word at a time (a
// few µs on a 96² map, against a search of hundreds). A changed tile re-derives its own walk entry and
// the drive edges of every tile within MASK_REACH (the furthest canDrive reads: a lane-run scan from
// the far end of the edge); a large change rebuilds the whole table. Exact by construction — the masks
// are the predicates, read through a table.

/** How far (Chebyshev) from an edge's origin canDrive can read: the step, then a freewayLane run scan
 *  of LANE_SCAN_CAP tiles from the far tile. */
const MASK_REACH = LANE_SCAN_CAP + 1;

/** The tabulated predicates for one map: `walk[i]` (isWalkable, 0/1) and `drive[i]` (canDrive from i
 *  in direction d at bit d). Valid until the map's built/water layers next change. */
export interface NetworkMasks {
  readonly walk: Uint8Array;
  readonly drive: Uint8Array;
}

interface MaskCache extends NetworkMasks {
  /** The built/water layers the masks were derived from, and 32-bit word views of them + the map's. */
  built: Uint16Array;
  water: Uint8Array;
  builtWords: Int32Array;
  builtCopyWords: Int32Array;
  waterWords: Int32Array;
  waterCopyWords: Int32Array;
}

const maskCache = new WeakMap<GameMap, MaskCache>();

function driveBits(map: GameMap, x: number, y: number): number {
  let bits = 0;
  for (let d = 0; d < 4; d++) if (canDrive(map, x, y, x + DIR_DX[d]!, y + DIR_DY[d]!)) bits |= 1 << d;
  return bits;
}

function rebuildAll(map: GameMap, c: MaskCache): void {
  c.built.set(map.built);
  c.water.set(map.water);
  const W = map.width;
  for (let i = 0; i < c.walk.length; i++) {
    const x = i % W;
    const y = (i - x) / W;
    c.walk[i] = isWalkable(map, x, y) ? 1 : 0;
    c.drive[i] = driveBits(map, x, y);
  }
}

/** Re-derive the masks around the tiles in `changed` (their copies already updated). */
function rebuildAround(map: GameMap, c: MaskCache, changed: readonly number[]): void {
  const W = map.width;
  const H = map.height;
  for (const i of changed) {
    const cx = i % W;
    const cy = (i - cx) / W;
    c.walk[i] = isWalkable(map, cx, cy) ? 1 : 0;
    const y1 = Math.min(H - 1, cy + MASK_REACH);
    const x1 = Math.min(W - 1, cx + MASK_REACH);
    for (let y = Math.max(0, cy - MASK_REACH); y <= y1; y++) {
      for (let x = Math.max(0, cx - MASK_REACH); x <= x1; x++) c.drive[y * W + x] = driveBits(map, x, y);
    }
  }
}

/** A 32-bit word view of a typed array's whole words (the tail, if any, is compared per element). */
function words(a: Uint8Array | Uint16Array): Int32Array {
  return a.byteOffset % 4 === 0 ? new Int32Array(a.buffer, a.byteOffset, a.byteLength >> 2) : new Int32Array(0);
}

/** Append to `out` every index where `cur` differs from `copy` (`a`/`b` their word views), updating
 *  `copy` as it goes. */
function diffInto(cur: Uint8Array | Uint16Array, copy: Uint8Array | Uint16Array, a: Int32Array, b: Int32Array, out: number[]): void {
  const per = 4 / cur.BYTES_PER_ELEMENT;
  for (let w = 0; w < a.length; w++) {
    if (a[w] === b[w]) continue;
    for (let i = w * per; i < w * per + per; i++) {
      if (cur[i] !== copy[i]) {
        copy[i] = cur[i]!;
        out.push(i);
      }
    }
  }
  for (let i = a.length * per; i < cur.length; i++) {
    if (cur[i] !== copy[i]) {
      copy[i] = cur[i]!;
      out.push(i);
    }
  }
}

/** The network masks for `map`, current with its built/water layers (built on first use, then patched
 *  or rebuilt whenever those layers have changed since the last call). */
export function networkMasks(map: GameMap): NetworkMasks {
  let c = maskCache.get(map);
  if (!c) {
    const n = map.width * map.height;
    const built = new Uint16Array(n);
    const water = new Uint8Array(n);
    c = {
      built,
      water,
      walk: new Uint8Array(n),
      drive: new Uint8Array(n),
      builtWords: words(map.built),
      builtCopyWords: words(built),
      waterWords: words(map.water),
      waterCopyWords: words(water),
    };
    maskCache.set(map, c);
    rebuildAll(map, c);
    return c;
  }
  const changed: number[] = [];
  diffInto(map.built, c.built, c.builtWords, c.builtCopyWords, changed);
  diffInto(map.water, c.water, c.waterWords, c.waterCopyWords, changed);
  if (changed.length === 0) return c;
  const area = (2 * MASK_REACH + 1) * (2 * MASK_REACH + 1);
  if (changed.length * area >= c.walk.length) rebuildAll(map, c);
  else rebuildAround(map, c, changed);
  return c;
}
