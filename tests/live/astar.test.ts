// P4 — the heap A* (roadPath / walkPath) must return EXACTLY the path the original linear-scan A*
// returned, on every map: same tie order (first lowest f in insertion order), same iteration bound.
// The original implementations are kept below, verbatim, as the oracle.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';
import { roadPath, walkPath, driveTileCost, pedCost } from '../../src/live/pathing';
import { canDrive, carPassable, isWalkable } from '../../src/live/network';
import { DIR_DX, DIR_DY } from '../../src/live/geometry';
import { ROAD_PATH_MAX_ITERS } from '../../src/live/tuning';

type Fld = ReadonlyMap<number, number> | undefined;

function oracleRoadPath(map: GameMap, sx: number, sy: number, gx: number, gy: number, traffic?: Fld): number[] | null {
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
    let bi = 0;
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
      if (!canDrive(map, cur.x, cur.y, nx, ny)) continue;
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

function oracleWalkPath(
  map: GameMap,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  wear?: Fld,
  traffic?: Fld,
  pollution?: Fld,
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
    let bi = 0;
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

/** A small deterministic LCG (the test's own stream; no engine rng). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A sparse random field over the map (integer values, so cost ties stay common). */
function randomField(map: GameMap, rnd: () => number, density: number, max: number): Map<number, number> {
  const f = new Map<number, number>();
  for (let i = 0; i < map.width * map.height; i++) if (rnd() < density) f.set(i, Math.floor(rnd() * max));
  return f;
}

function worldMap(seed: string, size: number): GameMap {
  const world = runPipeline({ seed, width: size, height: size }, [terrainStage(), mosesCenturyStage(), ecoSeedStage()]);
  // a hand-laid rail line, so at-grade level crossings are exercised too
  for (let x = 0; x < size; x++) placeTransport(world.map, x, Math.floor(size / 3), BuiltKind.Rail);
  return world.map;
}

const KINDS = [
  BuiltKind.None,
  BuiltKind.None,
  BuiltKind.RoadStreet,
  BuiltKind.RoadStreet,
  BuiltKind.RoadAvenue,
  BuiltKind.RoadHighway,
  BuiltKind.ParkingLot,
  BuiltKind.Promenade,
  BuiltKind.QuietStreet,
  BuiltKind.BikePath,
  BuiltKind.Rail,
  BuiltKind.PlantedMedian,
  BuiltKind.HouseSingle,
];

function randomMap(rnd: () => number, w: number, h: number): GameMap {
  const map = new GameMap(w, h);
  for (let i = 0; i < w * h; i++) {
    map.built[i] = KINDS[Math.floor(rnd() * KINDS.length)]!;
    map.floraVitality[i] = Math.floor(rnd() * 4) * 85;
    if (rnd() < 0.05) map.water[i] = 1;
  }
  return map;
}

/** Compare both searches on `pairs` random start/goal pairs, with and without live fields. */
function compareOn(map: GameMap, rnd: () => number, pairs: number): { road: number; walk: number; found: number } {
  const n = map.width * map.height;
  const drivable: number[] = [];
  const walkable: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    if (carPassable(map, x, y)) drivable.push(i);
    if (isWalkable(map, x, y)) walkable.push(i);
  }
  const fields: Array<[Fld, Fld, Fld]> = [
    [undefined, undefined, undefined],
    [randomField(map, rnd, 0.3, 200), randomField(map, rnd, 0.3, 200), randomField(map, rnd, 0.2, 200)],
  ];
  let road = 0;
  let walk = 0;
  let found = 0;
  const pick = (a: number[]): number => (a.length > 0 && rnd() < 0.9 ? a[Math.floor(rnd() * a.length)]! : Math.floor(rnd() * n));
  for (let k = 0; k < pairs; k++) {
    const [wear, traffic, pollution] = fields[k % 2]!;
    const s = pick(drivable);
    const g = pick(drivable);
    const [sx, sy, gx, gy] = [s % map.width, Math.floor(s / map.width), g % map.width, Math.floor(g / map.width)];
    const want = oracleRoadPath(map, sx, sy, gx, gy, traffic);
    expect(roadPath(map, sx, sy, gx, gy, traffic), `roadPath ${sx},${sy}→${gx},${gy}`).toEqual(want);
    road++;
    if (want && want.length > 1) found++;
    const ws = pick(walkable);
    const wg = pick(walkable);
    const [wsx, wsy, wgx, wgy] = [ws % map.width, Math.floor(ws / map.width), wg % map.width, Math.floor(wg / map.width)];
    const wantW = oracleWalkPath(map, wsx, wsy, wgx, wgy, wear, traffic, pollution);
    expect(walkPath(map, wsx, wsy, wgx, wgy, wear, traffic, pollution), `walkPath ${wsx},${wsy}→${wgx},${wgy}`).toEqual(
      wantW,
    );
    walk++;
    if (wantW && wantW.length > 1) found++;
  }
  return { road, walk, found };
}

describe('A* (roadPath / walkPath) returns exactly the original search’s path', () => {
  it('on seeded worldgen maps (real road networks, freeways, level crossings)', () => {
    let found = 0;
    for (const [seed, size] of [
      ['d', 48],
      ['lotus', 64],
      ['a', 40],
      ['moss', 56],
    ] as const) {
      const r = compareOn(worldMap(seed, size), lcg(seed.length * 7919 + size), 60);
      found += r.found;
    }
    expect(found).toBeGreaterThan(100); // the comparison actually exercised real routes
  });

  it('on random grids of every surface (interleaving map sizes, so scratch reuse is exercised)', () => {
    const rnd = lcg(42);
    let found = 0;
    for (let m = 0; m < 24; m++) {
      const map = randomMap(rnd, 12 + Math.floor(rnd() * 40), 8 + Math.floor(rnd() * 30));
      found += compareOn(map, rnd, 20).found;
    }
    expect(found).toBeGreaterThan(50);
  });

  it('on a map edited IN PLACE between searches (P6: the cached walk/drive masks track built + water)', () => {
    // direct writes to map.built / map.water — the way placement and tests mutate the map — must be
    // seen by the very next search: single-tile edits (a lane cut, a median, a road over water), small
    // clusters near freeways (the lane classification reads LANE_SCAN_CAP tiles away), and a wholesale
    // rewrite that changes most of the map at once
    const rnd = lcg(2026);
    for (const [seed, size] of [
      ['lotus', 64],
      ['moss', 48],
    ] as const) {
      const map = worldMap(seed, size);
      const n = size * size;
      let found = 0;
      for (let round = 0; round < 14; round++) {
        found += compareOn(map, rnd, 12).found;
        const edits = round === 9 ? n : 1 + Math.floor(rnd() * 6);
        const at = Math.floor(rnd() * n);
        for (let e = 0; e < edits; e++) {
          const i = round === 9 ? e : Math.min(n - 1, at + Math.floor(rnd() * 3) + Math.floor(rnd() * 3) * size);
          if (rnd() < 0.15) map.water[i] = map.water[i] === 0 ? 1 : 0;
          else map.built[i] = KINDS[Math.floor(rnd() * KINDS.length)]!;
        }
      }
      expect(found).toBeGreaterThan(20);
    }
  });

  it('on uniform open ground (every cost ties) — including searches cut off by the iteration bound', () => {
    const map = new GameMap(90, 90); // all BuiltKind.None, dry: one big walkable field
    const rnd = lcg(7);
    compareOn(map, rnd, 30);
    // a walled-off goal deep in a big field: the search exhausts ROAD_PATH_MAX_ITERS before the field
    for (let x = 60; x <= 70; x++) for (const y of [60, 70]) map.built[map.idx(x, y)] = BuiltKind.HouseSingle;
    for (let y = 60; y <= 70; y++) for (const x of [60, 70]) map.built[map.idx(x, y)] = BuiltKind.HouseSingle;
    expect(oracleWalkPath(map, 2, 2, 65, 65)).toBeNull();
    expect(walkPath(map, 2, 2, 65, 65)).toBeNull();
    // and long corner-to-corner routes over noisy costs — found or cut off, identically
    for (const s of [99, 100, 101]) {
      const wear = randomField(map, lcg(s), 0.5, 200);
      const pollution = randomField(map, lcg(s + 7), 0.3, 200);
      expect(walkPath(map, 0, 0, 89, 89, wear, undefined, pollution)).toEqual(
        oracleWalkPath(map, 0, 0, 89, 89, wear, undefined, pollution),
      );
    }
  });
});
