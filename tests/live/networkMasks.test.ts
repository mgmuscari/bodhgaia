// P6 — networkMasks tabulates isWalkable / canDrive per tile for A*. It must equal the predicates on
// every tile, after every kind of in-place edit (the cache validates against built + water itself).
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';
import { canDrive, isWalkable, networkMasks } from '../../src/live/network';
import { DIR_DX, DIR_DY } from '../../src/live/geometry';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The first tile (row-major) where the masks disagree with the predicates, or null. */
function firstMismatch(map: GameMap): string | null {
  const { walk, drive } = networkMasks(map);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = map.idx(x, y);
      if (walk[i] !== (isWalkable(map, x, y) ? 1 : 0)) return `walk ${x},${y}`;
      for (let d = 0; d < 4; d++) {
        if (((drive[i]! >> d) & 1) !== (canDrive(map, x, y, x + DIR_DX[d]!, y + DIR_DY[d]!) ? 1 : 0)) return `drive ${x},${y} d${d}`;
      }
    }
  }
  return null;
}

// lane-forming kinds dominate, so edits keep re-classifying divided avenues / freeways around them
const KINDS = [
  BuiltKind.None,
  BuiltKind.RoadStreet,
  BuiltKind.RoadAvenue,
  BuiltKind.RoadAvenue,
  BuiltKind.RoadHighway,
  BuiltKind.RoadHighway,
  BuiltKind.RoadRamp,
  BuiltKind.ParkingLot,
  BuiltKind.PlantedMedian,
  BuiltKind.Rail,
  BuiltKind.Streetcar,
  BuiltKind.HouseSingle,
];

describe('networkMasks: the tabulated walk / drive predicates', () => {
  it('equal isWalkable / canDrive on every tile of a worldgen map, through single-tile edits', () => {
    const world = runPipeline({ seed: 'lotus', width: 56, height: 56 }, [terrainStage(), mosesCenturyStage(), ecoSeedStage()]);
    const map = world.map;
    const rnd = lcg(11);
    expect(firstMismatch(map)).toBeNull();
    // edits ON and BESIDE the road network, where a lane's classification reaches furthest
    const roads: number[] = [];
    for (let i = 0; i < map.width * map.height; i++) if (map.built[i] === BuiltKind.RoadHighway || map.built[i] === BuiltKind.RoadAvenue) roads.push(i);
    expect(roads.length).toBeGreaterThan(20);
    for (let round = 0; round < 60; round++) {
      const at = roads[Math.floor(rnd() * roads.length)]! + Math.floor(rnd() * 5) - 2;
      const i = Math.max(0, Math.min(map.width * map.height - 1, at));
      if (rnd() < 0.15) map.water[i] = map.water[i] === 0 ? 1 : 0;
      else map.built[i] = KINDS[Math.floor(rnd() * KINDS.length)]!;
      expect(firstMismatch(map), `round ${round}`).toBeNull();
    }
  });

  it('follow small clustered edits and wholesale rewrites on random grids (odd sizes: word tails)', () => {
    const rnd = lcg(5);
    for (const [w, h] of [
      [17, 13],
      [31, 9],
      [24, 24],
    ] as const) {
      const map = new GameMap(w, h);
      for (let round = 0; round < 30; round++) {
        const edits = round % 10 === 9 ? w * h : 1 + Math.floor(rnd() * 4);
        const at = Math.floor(rnd() * w * h);
        for (let e = 0; e < edits; e++) {
          const i = edits === w * h ? e : (at + e * (rnd() < 0.5 ? 1 : w)) % (w * h);
          if (rnd() < 0.1) map.water[i] = map.water[i] === 0 ? 1 : 0;
          else map.built[i] = KINDS[Math.floor(rnd() * KINDS.length)]!;
        }
        expect(firstMismatch(map), `${w}x${h} round ${round}`).toBeNull();
      }
    }
  });
});
