// Live-layer PATHING + MODE CHOICE: the per-mode tile costs (walking ground, wear, fuel), the
// committed A* routes cars (roadPath) and walkers (walkPath) follow, the greedy step for the rest,
// the nearest-destination scans (direction-neutral tie-breaks), and how a citizen picks a travel
// mode. Cut verbatim from ui/ambientContent.ts; pure given the map + the live fields passed in.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import { visitValue } from '../citizens/plots';
import { type StopCategory, stopCategoryOf } from '../citizens/itinerary';
import { MODE_CHOICE_ORDER, TravelMode, modeRidesNetwork, modeSpec } from '../citizens/modes';
import { sampleField } from '../citizens/field';
import {
  PARKLET_RADIUS,
  PARKLET_SHIFT,
  BIKE_RANGE,
  CITIZEN_TRIP_RADIUS,
  CONGESTION_WEIGHT,
  EVAPORATION,
  FUEL_BURN_BASE,
  FUEL_BURN_BEATEN,
  FUEL_BURN_LUSH,
  FUEL_BURN_MIN,
  FUEL_REFUEL_BASE,
  FUEL_REFUEL_PER_VALUE,
  JAM_RADIUS,
  LASTMILE_RADIUS,
  LV_MAX,
  LV_PULL,
  MODE_INFRA_RADIUS,
  PED_BEATEN,
  PED_GROUND_BASE,
  PED_GROUND_MIN,
  PED_LOT,
  PED_LUSH,
  PED_POLL_WEIGHT,
  POLL_MAX,
  ROAD_PATH_MAX_ITERS,
  TRAFFIC_MAX,
  WALK_RANGE,
  WEAR_MAX,
} from './tuning';
import { DIR_DX, DIR_DY } from './geometry';
import { carPassable, closedTiles, isParkable, isWalkable, isWearable, networkMasks, reachedPlot } from './network';

/** The nearest pedestrian-walkable tile to (x, y) within `maxR` (ring search, the tile itself
 *  first), or null if none is in reach. Rescues a ped that was placed OFF the walkable set — on
 *  water, a freeway, or a plot — back onto solid ground rather than leaving it stranded mid-water
 *  (Maddy: pedestrians crossing water / freeways). The self-heal seam for ped placement. */
export function nearestWalkable(
  map: GameMap,
  x: number,
  y: number,
  maxR = 8,
): { x: number; y: number } | null {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring at Chebyshev distance r
        if (isWalkable(map, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

/** A pedestrian's PREFERENCE cost for a walkable tile (lower = nicer): promenades best, then
 *  calm streets, then a LOCAL street by inverse traffic density, then open ground, with stroads
 *  (avenues) worst. So peds drift onto promenades and shun busy stroads where the route allows.
 *  WILD ground (empty land) is terrain-aware via `wear`: lush is dear, a beaten desire path cheap
 *  (foot traffic self-reinforces paths). */
export function pedCost(
  map: GameMap,
  x: number,
  y: number,
  wear?: ReadonlyMap<number, number>,
  traffic?: ReadonlyMap<number, number>,
  pollution?: ReadonlyMap<number, number>,
): number {
  const i = map.idx(x, y);
  const k = map.built[i]!;
  // Smog drifts over every tile — a polluted block is unpleasant on foot whatever its surface.
  const smog = ((pollution?.get(i) ?? 0) / POLL_MAX) * PED_POLL_WEIGHT;
  let base: number;
  if (k === BuiltKind.Promenade) base = 0.3;
  else if (k === BuiltKind.QuietStreet || k === BuiltKind.BikePath) base = 0.5;
  else if (k === BuiltKind.RoadStreet || k === BuiltKind.RoadAvenue) {
    // LIVE agent traffic makes a street worse on foot — but a local street has a sidewalk (+1 at most);
    // a stroad's traffic weighs double
    const load = (traffic?.get(i) ?? 0) / TRAFFIC_MAX;
    base = k === BuiltKind.RoadStreet ? 0.55 + load : 2.0 + load * 2;
  } else if (k === BuiltKind.None) {
    // wild ground: lush growth (high flora) is hard going; a beaten path (high wear) is easy.
    const flora = map.floraVitality[i]! / 255;
    const worn = (wear?.get(i) ?? 0) / WEAR_MAX;
    base = Math.max(PED_GROUND_MIN, PED_GROUND_BASE + flora * PED_LUSH - worn * PED_BEATEN);
  } else if (k === BuiltKind.ParkingLot) base = PED_LOT;
  else base = 0.9; // transit / built greens (a walk through the park is the point)
  return base + smog;
}

/** Which travel modes follow a COMMITTED walkPath (vs the greedy mode-cost step): the GROUND modes
 *  over the walkable set — Walk and Bike. They route around barriers instead of dithering in a local
 *  minimum (Maddy: looping cyclists). Transit (streetcar/elevated) rides a fixed line and Drive uses
 *  the road A* (roadPath), so they keep their own movement. */
export function usesCommittedPath(mode: TravelMode): boolean {
  return mode === TravelMode.Walk || mode === TravelMode.Bike;
}

/** Fuel a citizen spends on one substep at (x,y) — the SPEND side of the fuel economy, twinned with
 *  `pedCost`'s routing: a beaten desire path is cheap, lush wild ground dear, pavement/built nominal.
 *  So citizens go further on worn paths (and the network of paths reinforces itself). */
export function fuelBurn(map: GameMap, wear: ReadonlyMap<number, number>, x: number, y: number): number {
  const i = map.idx(x, y);
  if (map.built[i] !== BuiltKind.None || map.water[i] !== 0) return FUEL_BURN_BASE; // paved/built/edge
  const flora = map.floraVitality[i]! / 255;
  const worn = (wear.get(i) ?? 0) / WEAR_MAX;
  return Math.max(FUEL_BURN_MIN, FUEL_BURN_BASE + flora * FUEL_BURN_LUSH - worn * FUEL_BURN_BEATEN);
}

/** Fuel a successful visit to a plot of `kind` hands back — the REFILL side: scaled by the plot's
 *  status/use (`visitValue`), floored at 0 so a grim industrial visit refuels ~nothing while a
 *  healing commons tops the tank right up. */
export function refuelFor(kind: number): number {
  return Math.max(0, FUEL_REFUEL_BASE + visitValue(kind) * FUEL_REFUEL_PER_VALUE);
}

/** Can a citizen on `mode` occupy the tile at (x,y)? A driver is PAVEMENT-ONLY (roads + parking,
 *  no median) — it can't cross wild ground or a promenade; every other mode travels over the
 *  pedestrian-walkable set, which already includes transit tiles (a rider boards by walking onto
 *  the line, then rides it fast). */
export function modeCanEnter(mode: TravelMode, map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  return modeSpec(mode).pavementOnly ? carPassable(map, x, y) : isWalkable(map, x, y);
}

/** A mode's routing COST for a tile (lower = preferred): cheap ON the mode's network so the mover
 *  hugs the bike path / tram line / rail / road; off-network it pays the pedestrian preference
 *  cost (a driver, being pavement-only, is always on its road network). */
export function modeCost(
  mode: TravelMode,
  map: GameMap,
  x: number,
  y: number,
  wear?: ReadonlyMap<number, number>,
  traffic?: ReadonlyMap<number, number>,
  pollution?: ReadonlyMap<number, number>,
): number {
  const k = map.built[map.idx(x, y)]!;
  if (modeRidesNetwork(mode, k)) return modeSpec(mode).networkCost;
  return modeSpec(mode).pavementOnly
    ? modeSpec(mode).networkCost
    : pedCost(map, x, y, wear, traffic, pollution);
}

/** A routed citizen's next grid step toward (tgtx, tgty) for travel `mode` (default Walk): the
 *  mode-enterable, non-recent 4-neighbour that most reduces Manhattan distance, broken by the
 *  mode's routing cost (so a rider hugs its line, a driver its roads). Returns -1 when within one
 *  tile of the target (arrived) OR when boxed in. Axis-aligned → no diagonals. */
export function nextStepToward(
  map: GameMap,
  x: number,
  y: number,
  tgtx: number,
  tgty: number,
  recent?: readonly number[],
  wear?: ReadonlyMap<number, number>,
  mode: TravelMode = TravelMode.Walk,
  traffic?: ReadonlyMap<number, number>,
  pollution?: ReadonlyMap<number, number>,
): number {
  if (Math.abs(x - tgtx) + Math.abs(y - tgty) <= 1) return -1; // at / adjacent to the target
  let best = -1;
  let bestScore = 1e9;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!modeCanEnter(mode, map, nx, ny)) continue;
    if (recent && recent.includes(map.idx(nx, ny))) continue;
    // Distance dominates (still reaches the target); the mode cost hugs lines / shuns stroads + jams + smog.
    const score =
      Math.abs(nx - tgtx) + Math.abs(ny - tgty) + modeCost(mode, map, nx, ny, wear, traffic, pollution);
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** A driving tile's PATHFINDING cost (lower = preferred): freeways are cheap (fast through-routes),
 *  avenues a bit cheaper than streets, and LIVE congestion (the traffic the agents themselves lay)
 *  adds cost so cars route AROUND jams. This is what makes a car-agent prefer the freeway and avoid
 *  a clogged street — the macro traffic pattern emerges from the agents, not an aggregate field. */
export function driveTileCost(map: GameMap, x: number, y: number, traffic?: ReadonlyMap<number, number>): number {
  const i = map.idx(x, y);
  const k = map.built[i]!;
  let c = k === BuiltKind.RoadHighway ? 0.5 : k === BuiltKind.RoadAvenue ? 0.8 : 1; // freeways fast
  if (traffic) c += ((traffic.get(i) ?? 0) / TRAFFIC_MAX) * CONGESTION_WEIGHT; // shun jams
  return c;
}

// ---- A* core: a binary heap over a node pool + typed-array scores reused across calls ----------------
//
// The original search kept its open list in an array, popped the FIRST lowest-f entry by linear scan
// (splice keeps insertion order), and kept gScore / came-from in Maps. This is the same search, faster:
// each push appends a NODE to a pool, so a node's pool index is its insertion sequence, and the heap
// orders nodes by (f, sequence) — popping exactly what the scan popped, stale duplicates included, so
// the iteration bound cuts off at the same point. gScore / came-from live in typed arrays sized to the
// map, valid where `stamp` equals this search's generation (no clearing between calls).

let cells = 0;
let gen = 0;
let stamp = new Uint32Array(0);
let gScore = new Float64Array(0);
let came = new Int32Array(0);
let nodeTile = new Int32Array(256);
let nodeF = new Float64Array(256);
let heap = new Int32Array(256);
let nodeLen = 0;
let heapLen = 0;

/** Start a search over `n` tiles: a fresh generation (typed arrays reallocated on a new map size). */
function beginSearch(n: number): void {
  if (n !== cells) {
    cells = n;
    stamp = new Uint32Array(n);
    gScore = new Float64Array(n);
    came = new Int32Array(n);
    gen = 0;
  }
  if (gen === 0xffffffff) {
    stamp.fill(0);
    gen = 0;
  }
  gen++;
  nodeLen = 0;
  heapLen = 0;
}

/** Is node `a` popped before node `b`: lower f, then earlier insertion. */
function before(a: number, b: number): boolean {
  const fa = nodeF[a]!;
  const fb = nodeF[b]!;
  return fa < fb || (fa === fb && a < b);
}

function pushNode(tile: number, f: number): void {
  if (nodeLen === nodeTile.length) {
    const t = new Int32Array(nodeLen * 2);
    t.set(nodeTile);
    nodeTile = t;
    const ff = new Float64Array(nodeLen * 2);
    ff.set(nodeF);
    nodeF = ff;
    const h = new Int32Array(nodeLen * 2);
    h.set(heap);
    heap = h;
  }
  const node = nodeLen++;
  nodeTile[node] = tile;
  nodeF[node] = f;
  let k = heapLen++;
  while (k > 0) {
    const parent = (k - 1) >> 1;
    const pn = heap[parent]!;
    if (!before(node, pn)) break;
    heap[k] = pn;
    k = parent;
  }
  heap[k] = node;
}

/** Pop the next node (its pool index); the heap must be non-empty. */
function popNode(): number {
  const top = heap[0]!;
  const last = heap[--heapLen]!;
  let k = 0;
  for (;;) {
    const l = 2 * k + 1;
    if (l >= heapLen) break;
    const r = l + 1;
    const c = r < heapLen && before(heap[r]!, heap[l]!) ? r : l;
    if (!before(heap[c]!, last)) break;
    heap[k] = heap[c]!;
    k = c;
  }
  if (heapLen > 0) heap[k] = last;
  return top;
}

/** The route start → `end` by walking came-from back to the start (marked −1). */
function tracePath(end: number): number[] {
  const path = [end];
  let p = end;
  while (came[p] !== -1) {
    p = came[p]!;
    path.push(p);
  }
  return path.reverse();
}

/**
 * The shared A*: from (sx,sy) toward (gx,gy) over the road network (`walk` false: canDrive edges,
 * driveTileCost, arrive ON the goal) or the walkable set (`walk` true: isWalkable, pedCost, arrive at
 * the goal PLOT — beside the target tile or any tile of its parcel, i.e. whichever door is cheapest). f = g + Manhattan·0.5; at most ROAD_PATH_MAX_ITERS pops.
 */
function searchPath(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  walk: boolean,
  wear: ReadonlyMap<number, number> | undefined,
  traffic: ReadonlyMap<number, number> | undefined,
  pollution: ReadonlyMap<number, number> | undefined,
): number[] | null {
  const W = map.width;
  const H = map.height;
  const start = map.idx(sx, sy);
  const goal = map.idx(gx, gy);
  // the edge tests read precomputed masks (isWalkable / canDrive, tabulated per map — network.ts)
  const { walk: walkable, drive } = networkMasks(map);
  const closed = closedTiles(map, walk); // under flood water (or, for cars, a street given over to people)
  beginSearch(W * H);
  stamp[start] = gen;
  gScore[start] = 0;
  came[start] = -1;
  pushNode(start, Math.abs(sx - gx) + Math.abs(sy - gy));
  let iters = 0;
  while (heapLen > 0 && iters++ < ROAD_PATH_MAX_ITERS) {
    const ci = nodeTile[popNode()]!;
    const cx = ci % W;
    const cy = (ci - cx) / W;
    if (walk ? reachedPlot(map, cx, cy, gx, gy) : ci === goal) return tracePath(ci);
    const baseG = gScore[ci]!;
    const edges = drive[ci]!;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIR_DX[d]!;
      const ny = cy + DIR_DY[d]!;
      if (walk) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || walkable[ny * W + nx] === 0) continue;
      } else if ((edges & (1 << d)) === 0) continue; // directed edges for cars
      const ni = map.idx(nx, ny);
      if (closed?.has(ni)) continue;
      const ng = baseG + (walk ? pedCost(map, nx, ny, wear, traffic, pollution) : driveTileCost(map, nx, ny, traffic));
      if (stamp[ni] !== gen || ng < gScore[ni]!) {
        stamp[ni] = gen;
        gScore[ni] = ng;
        came[ni] = ci;
        pushNode(ni, ng + (Math.abs(nx - gx) + Math.abs(ny - gy)) * 0.5);
      }
    }
  }
  return null;
}

/** A* over the drivable road network from (sx,sy) to (gx,gy): the committed least-cost route a
 *  car-agent follows (so it never circles), preferring freeways and avoiding congestion via
 *  driveTileCost. Returns tile indices start-first (inclusive of both ends), or null if no route /
 *  the search bound is hit. Pure: heap + typed arrays + abs heuristic (allowlist-safe). */
export function roadPath(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  traffic?: ReadonlyMap<number, number>,
): number[] | null {
  if (!carPassable(map, sx, sy) || !carPassable(map, gx, gy)) return null;
  const start = map.idx(sx, sy);
  if (start === map.idx(gx, gy)) return [start];
  return searchPath(map, sx, sy, gx, gy, false, undefined, traffic, undefined);
}

/**
 * A* over the WALKABLE set from (sx,sy) toward (gx,gy), ending at the cheapest DOOR of the target's
 * plot: a walkable tile beside the target or beside any tile of its parcel (`reachedPlot` — the same
 * test a walker's arrival uses), so a citizen walks up to a big plot's street side rather than round
 * to whichever yard touches its anchor tile. The committed
 * least-cost FOOT route — the pedestrian twin of {@link roadPath} — so a citizen routes AROUND
 * buildings and freeways instead of dithering in a greedy local minimum at a wall (the bug Maddy
 * saw: peds piling up + heading home "to nowhere" when a destination sat behind a barrier). Cost via
 * {@link pedCost} (promenades cheap, stroads/smog dear → the route still prefers the calm/green
 * city). Returns tile indices start-first, or null if no foot route / the search bound is hit. Pure
 * (allowlist-safe): heap + typed arrays + abs heuristic, no rng.
 */
export function walkPath(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  wear?: ReadonlyMap<number, number>,
  traffic?: ReadonlyMap<number, number>,
  pollution?: ReadonlyMap<number, number>,
): number[] | null {
  if (!isWalkable(map, sx, sy)) return null;
  if (reachedPlot(map, sx, sy, gx, gy)) return [map.idx(sx, sy)];
  return searchPath(map, sx, sy, gx, gy, true, wear, traffic, pollution);
}

/** A direction-NEUTRAL spread hash of a tile index, for breaking distance/score TIES without the
 *  upper-left bias a row-major scan + strict `<` produces (adjacent tiles hash far apart). Keeps
 *  destination choice deterministic (no rng) — just unbiased across the map. Integer ops only
 *  (allowlist-safe). */
export function tieHash(i: number): number {
  return Math.imul(i ^ 0x9e3779b1, 0x85ebca6b) >>> 0;
}

/** How far from a plot's anchor tile its parcel footprint is scanned for doors. */
const PLOT_DOOR_SCAN = 6;

/** The DOOR a person steps out of (or into) the plot at (x,y) by: among the walkable tiles beside its
 *  footprint (the whole parcel, or the lone tile), a PAVED one — the street side — before bare yard
 *  ground; then the nearest to the anchor; ties by tieHash (direction-neutral). Null when hemmed in.
 *  (Maddy 2026-10-06: citizens stepped out of their homes' back yards and walked round the lot.) */
export function plotDoor(map: GameMap, x: number, y: number): { x: number; y: number } | null {
  const pid = map.parcel[map.idx(x, y)]!;
  const r = pid === 0 ? 0 : PLOT_DOOR_SCAN;
  let best: { x: number; y: number } | null = null;
  let bestRank = Infinity;
  let bestHash = 0;
  for (let fy = y - r; fy <= y + r; fy++) {
    for (let fx = x - r; fx <= x + r; fx++) {
      if (!map.inBounds(fx, fy)) continue;
      if (pid === 0 ? fx !== x || fy !== y : map.parcel[map.idx(fx, fy)] !== pid) continue;
      for (let d = 0; d < 4; d++) {
        const nx = fx + DIR_DX[d]!;
        const ny = fy + DIR_DY[d]!;
        if (!isWalkable(map, nx, ny)) continue;
        const i = map.idx(nx, ny);
        const rank = (map.built[i] === BuiltKind.None ? 1000 : 0) + Math.abs(nx - x) + Math.abs(ny - y);
        const h = tieHash(i);
        if (rank < bestRank || (rank === bestRank && h < bestHash)) {
          bestRank = rank;
          bestHash = h;
          best = { x: nx, y: ny };
        }
      }
    }
  }
  return best;
}

/** The nearest demand tile (R/C/I/Civic via zoneTypeOf — a place a person walks to/from)
 *  within LASTMILE_RADIUS of (cx, cy), by Manhattan distance; null if none. Ties broken by tieHash
 *  (not scan order) so equidistant choices don't all skew upper-left. */
export function nearestDemandTile(map: GameMap, cx: number, cy: number): { x: number; y: number } | null {
  let bx = -1;
  let by = -1;
  let bestD = 1e9;
  let bestHash = 0;
  for (let y = cy - LASTMILE_RADIUS; y <= cy + LASTMILE_RADIUS; y++) {
    for (let x = cx - LASTMILE_RADIUS; x <= cx + LASTMILE_RADIUS; x++) {
      if (!map.inBounds(x, y)) continue;
      if (zoneTypeOf(map.built[map.idx(x, y)]!) === ZoneType.None) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      const h = tieHash(map.idx(x, y));
      if (d < bestD || (d === bestD && h < bestHash)) {
        bestD = d;
        bestHash = h;
        bx = x;
        by = y;
      }
    }
  }
  return bx < 0 ? null : { x: bx, y: by };
}

/** The nearest plot serving stop `category` (work/shop/lifestyle via stopCategoryOf) within
 *  CITIZEN_TRIP_RADIUS of (cx, cy), by Manhattan distance; null if the district has none. */
export function nearestOfCategory(
  map: GameMap,
  cx: number,
  cy: number,
  category: StopCategory,
  landValue?: ReadonlyMap<number, number>,
): { x: number; y: number } | null {
  let bx = -1;
  let by = -1;
  let bestScore = 1e9;
  let bestHash = 0;
  for (let y = cy - CITIZEN_TRIP_RADIUS; y <= cy + CITIZEN_TRIP_RADIUS; y++) {
    for (let x = cx - CITIZEN_TRIP_RADIUS; x <= cx + CITIZEN_TRIP_RADIUS; x++) {
      if (!map.inBounds(x, y)) continue;
      if (stopCategoryOf(map.built[map.idx(x, y)]!) !== category) continue;
      // Distance, pulled DOWN by the plot's land value: a prized destination justifies up to LV_PULL
      // extra tiles of travel over a drab nearer one — citizens flow toward the nice parts of town.
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      const lv = landValue ? sampleField(landValue, map.idx(x, y)) : 0;
      const score = d - (lv / LV_MAX) * LV_PULL;
      // Ties broken by tieHash, NOT scan order — else every equidistant choice skews upper-left
      // (row-major + strict `<`), which clustered trips toward the map's top-left (Maddy).
      const h = tieHash(map.idx(x, y));
      const better = score < bestScore - 1e-9;
      if (better || (score < bestScore + 1e-9 && h < bestHash)) {
        if (better) bestScore = score;
        bestHash = h;
        bx = x;
        by = y;
      }
    }
  }
  return bx < 0 ? null : { x: bx, y: by };
}

/** Is a tile of `mode`'s network within MODE_INFRA_RADIUS of (cx, cy)? (Is this mode served here?) */
export function infraNear(map: GameMap, cx: number, cy: number, mode: TravelMode): boolean {
  for (let y = cy - MODE_INFRA_RADIUS; y <= cy + MODE_INFRA_RADIUS; y++) {
    for (let x = cx - MODE_INFRA_RADIUS; x <= cx + MODE_INFRA_RADIUS; x++) {
      if (!map.inBounds(x, y)) continue;
      if (modeRidesNetwork(mode, map.built[map.idx(x, y)]!)) return true;
    }
  }
  return false;
}

/** Choose a citizen's travel MODE for a leg origin→dest, after Maddy's rule — drive only when it
 *  is far AND no transit/bike/ped infrastructure serves it. WALK if close; else the best available
 *  active/transit mode whose network serves BOTH ends — rail, then streetcar, then a BIKE for a
 *  medium leg with calm/bike infra at both ends — and DRIVE as the fallback when only car infra
 *  exists. So the car-dependent decayed start (stroads) shifts to bikes/transit as the player
 *  builds them: the congestion → mode-shift → bloom loop. Walks if nothing else fits. */
export function chooseMode(map: GameMap, ox: number, oy: number, dx: number, dy: number, jam = 0, walkStretch = 1, bikeStretch = 1): TravelMode {
  const d = Math.abs(ox - dx) + Math.abs(oy - dy);
  // a jammed road makes a longer walk or ride worth it (up to twice as far in a full jam)
  const stretch = 1 + (jam < 0 ? 0 : jam > 1 ? 1 : jam);
  // Walkable Streets (crossings, shade, slower cars) stretches how far people will walk
  if (d <= WALK_RANGE * stretch * walkStretch) return TravelMode.Walk;
  for (const mode of MODE_CHOICE_ORDER) {
    if (mode === TravelMode.Bike) {
      // A medium leg cycles (you can bike a street); bike-friendly infra just makes it faster/nicer
      // via the routing cost. So cyclists appear from the start and grow as the player calms streets.
      if (d <= BIKE_RANGE * stretch * bikeStretch) return TravelMode.Bike;
      continue;
    }
    // rail / streetcar / drive: available when their network serves BOTH ends of the leg.
    if (infraNear(map, ox, oy, mode) && infraNear(map, dx, dy, mode)) return mode;
  }
  return TravelMode.Walk;
}

/** The worst congestion within JAM_RADIUS of (x, y), 0..1. */
export function jamNear(map: GameMap, traffic: ReadonlyMap<number, number>, x: number, y: number): number {
  let worst = 0;
  for (let dy = -JAM_RADIUS; dy <= JAM_RADIUS; dy++) {
    for (let dx = -JAM_RADIUS; dx <= JAM_RADIUS; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > JAM_RADIUS || !map.inBounds(x + dx, y + dy)) continue;
      const v = traffic.get(map.idx(x + dx, y + dy)) ?? 0;
      if (v > worst) worst = v;
    }
  }
  return worst / TRAFFIC_MAX;
}

/** Does this driving trip evaporate? A deterministic share (EVAPORATION × jam) of trips, picked by hash. */
export function tripEvaporates(jam: number, hash: number): boolean {
  if (jam <= 0) return false;
  const u = (Math.imul((hash ^ 0x2545f491) >>> 0, 0x9e3779b1) >>> 0) % 1000;
  return u < jam * EVAPORATION * 1000;
}

/** Is there a tile of `kind` (on the ground or an overpass deck) within Chebyshev `r` of (x, y)? A bounded box scan. */
export function nearKind(map: GameMap, x: number, y: number, kind: number, r: number): boolean {
  const x0 = Math.max(0, x - r);
  const x1 = Math.min(map.width - 1, x + r);
  const y0 = Math.max(0, y - r);
  const y1 = Math.min(map.height - 1, y + r);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const i = yy * map.width + xx;
      if (map.built[i] === kind || map.deck[i] === kind) return true;
    }
  }
  return false;
}

/** May a household from `homeTile` drive this trip? Commune households own no cars; homes near a parklet (which
 *  took their parking) drive PARKLET_SHIFT fewer trips, picked by `hash`. */
export function homeDrives(map: GameMap, homeTile: number, hash: number): boolean {
  if (map.built[homeTile] === BuiltKind.Commune) return false;
  const x = homeTile % map.width;
  const y = (homeTile - x) / map.width;
  if (!nearKind(map, x, y, BuiltKind.Parklet, PARKLET_RADIUS)) return true;
  const u = (Math.imul((hash ^ 0x27d4eb2f) >>> 0, 0x9e3779b1) >>> 0) % 1000;
  return u >= PARKLET_SHIFT * 1000;
}

/** Is this driven shopping trip delivered instead (Drone Deliveries)? A deterministic `share` of trips, by hash. */
export function tripDelivered(share: number, hash: number): boolean {
  if (share <= 0) return false;
  const u = (Math.imul((hash ^ 0x5bd1e995) >>> 0, 0x9e3779b1) >>> 0) % 1000;
  return u < share * 1000;
}

/** The nearest EMPTY tile (open land, unbuilt, non-water — {@link isWearable}) to (x, y) within
 *  `maxR`, by Chebyshev ring; null if none in reach. Where a derelict gets dumped. */
export function nearestEmptyTile(map: GameMap, x: number, y: number, maxR = 10): { x: number; y: number } | null {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWearable(map, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

/** The nearest tile a citizen's car can REST at + drive from near its home (a non-freeway, dry
 *  street/avenue/parking kerb), or null if the home has no such tile in reach. Uses isParkable so an
 *  owned car never spawns parked on the freeway a home happens to sit beside (Maddy: cars on freeways)
 *  — if only a freeway is near, the citizen walks instead. */
export function nearestDriveStart(map: GameMap, hx: number, hy: number): { x: number; y: number } | null {
  let bx = -1;
  let by = -1;
  let bestD = 1e9;
  for (let y = hy - 4; y <= hy + 4; y++) {
    for (let x = hx - 4; x <= hx + 4; x++) {
      if (!map.inBounds(x, y)) continue;
      if (!isParkable(map, x, y)) continue;
      const d = Math.abs(x - hx) + Math.abs(y - hy);
      if (d < bestD) {
        bestD = d;
        bx = x;
        by = y;
      }
    }
  }
  return bx < 0 ? null : { x: bx, y: by };
}
