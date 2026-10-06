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
  WALKABLE_STRETCH,
  WALK_RANGE,
  WEAR_MAX,
} from './tuning';
import { DIR_DX, DIR_DY } from './geometry';
import { canDrive, carPassable, isParkable, isWalkable, isWearable } from './network';

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

/** A* over the drivable road network from (sx,sy) to (gx,gy): the committed least-cost route a
 *  car-agent follows (so it never circles), preferring freeways and avoiding congestion via
 *  driveTileCost. Returns tile indices start-first (inclusive of both ends), or null if no route /
 *  the search bound is hit. Pure: array open-list + Maps + abs heuristic (allowlist-safe). */
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
  const goal = map.idx(gx, gy);
  if (start === goal) return [start];
  const gScore = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const open: Array<{ i: number; x: number; y: number; f: number }> = [
    { i: start, x: sx, y: sy, f: Math.abs(sx - gx) + Math.abs(sy - gy) },
  ];
  let iters = 0;
  while (open.length > 0 && iters++ < ROAD_PATH_MAX_ITERS) {
    let bi = 0; // pop lowest f (linear scan — road frontiers stay small)
    for (let k = 1; k < open.length; k++) if (open[k]!.f < open[bi]!.f) bi = k;
    const cur = open.splice(bi, 1)[0]!;
    if (cur.i === goal) {
      const path = [goal];
      let p = goal;
      while (came.has(p)) {
        p = came.get(p)!;
        path.push(p);
      }
      return path.reverse();
    }
    const baseG = gScore.get(cur.i)!;
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + DIR_DX[d]!;
      const ny = cur.y + DIR_DY[d]!;
      if (!canDrive(map, cur.x, cur.y, nx, ny)) continue; // directed edges: one-way + limited-access
      const ni = map.idx(nx, ny);
      const ng = baseG + driveTileCost(map, nx, ny, traffic);
      if (ng < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, ng);
        came.set(ni, cur.i);
        open.push({ i: ni, x: nx, y: ny, f: ng + (Math.abs(nx - gx) + Math.abs(ny - gy)) * 0.5 });
      }
    }
  }
  return null;
}

/**
 * A* over the WALKABLE set from (sx,sy) toward (gx,gy), ending at the nearest walkable tile within
 * one of the target (the DOOR — building tiles aren't walkable, peds stop adjacent). The committed
 * least-cost FOOT route — the pedestrian twin of {@link roadPath} — so a citizen routes AROUND
 * buildings and freeways instead of dithering in a greedy local minimum at a wall (the bug Maddy
 * saw: peds piling up + heading home "to nowhere" when a destination sat behind a barrier). Cost via
 * {@link pedCost} (promenades cheap, stroads/smog dear → the route still prefers the calm/green
 * city). Returns tile indices start-first, or null if no foot route / the search bound is hit. Pure
 * (allowlist-safe): array open-list + Maps + abs heuristic, no rng.
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
  const start = map.idx(sx, sy);
  const atDoor = (x: number, y: number): boolean => Math.abs(x - gx) + Math.abs(y - gy) <= 1;
  if (atDoor(sx, sy)) return [start];
  const gScore = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const open: Array<{ i: number; x: number; y: number; f: number }> = [
    { i: start, x: sx, y: sy, f: Math.abs(sx - gx) + Math.abs(sy - gy) },
  ];
  let iters = 0;
  while (open.length > 0 && iters++ < ROAD_PATH_MAX_ITERS) {
    let bi = 0; // pop lowest f (linear scan — foot frontiers stay small)
    for (let k = 1; k < open.length; k++) if (open[k]!.f < open[bi]!.f) bi = k;
    const cur = open.splice(bi, 1)[0]!;
    if (atDoor(cur.x, cur.y)) {
      const path = [cur.i];
      let p = cur.i;
      while (came.has(p)) {
        p = came.get(p)!;
        path.push(p);
      }
      return path.reverse();
    }
    const baseG = gScore.get(cur.i)!;
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + DIR_DX[d]!;
      const ny = cur.y + DIR_DY[d]!;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = map.idx(nx, ny);
      const ng = baseG + pedCost(map, nx, ny, wear, traffic, pollution);
      if (ng < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, ng);
        came.set(ni, cur.i);
        open.push({ i: ni, x: nx, y: ny, f: ng + (Math.abs(nx - gx) + Math.abs(ny - gy)) * 0.5 });
      }
    }
  }
  return null;
}

/** A direction-NEUTRAL spread hash of a tile index, for breaking distance/score TIES without the
 *  upper-left bias a row-major scan + strict `<` produces (adjacent tiles hash far apart). Keeps
 *  destination choice deterministic (no rng) — just unbiased across the map. Integer ops only
 *  (allowlist-safe). */
export function tieHash(i: number): number {
  return Math.imul(i ^ 0x9e3779b1, 0x85ebca6b) >>> 0;
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
export function chooseMode(map: GameMap, ox: number, oy: number, dx: number, dy: number, jam = 0, walkable = false): TravelMode {
  const d = Math.abs(ox - dx) + Math.abs(oy - dy);
  // a jammed road makes a longer walk or ride worth it (up to twice as far in a full jam)
  const stretch = 1 + (jam < 0 ? 0 : jam > 1 ? 1 : jam);
  // Walkable Streets (crossings, shade, slower cars): people walk half as far again
  if (d <= WALK_RANGE * stretch * (walkable ? WALKABLE_STRETCH : 1)) return TravelMode.Walk;
  for (const mode of MODE_CHOICE_ORDER) {
    if (mode === TravelMode.Bike) {
      // A medium leg cycles (you can bike a street); bike-friendly infra just makes it faster/nicer
      // via the routing cost. So cyclists appear from the start and grow as the player calms streets.
      if (d <= BIKE_RANGE * stretch) return TravelMode.Bike;
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
