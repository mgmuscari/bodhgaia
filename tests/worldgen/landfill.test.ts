// The landfill (Maddy 2026-10-21: "the depots should feed a landfill or something"): where the city's garbage goes —
// sited, like the dirty power plants, on the most redlined frontage: the service went to the greenlined districts, the
// burden to the redlined. History built it; the player doesn't (they cap it).
import { describe, it, expect } from 'vitest';
import { createCity } from '../../src/app/city';
import { BuiltKind } from '../../src/engine/fabric';
import { ZoneType, zoneTypeOf } from '../../src/engine/zone';
import { builtKindName } from '../../src/engine/builtNames';
import { isWalkable } from '../../src/live/network';
import { toolDef } from '../../src/tools/tools';
import { UPKEEP } from '../../src/economy/readings';
import { BUILDING_PAINTERS } from '../../src/ui/snesBuildings';
import { GameMap } from '../../src/engine/map';

describe('the landfill', () => {
  it('is a fenced dump, named, kept up by the city, never in the build menu', () => {
    const k = BuiltKind.Landfill;
    expect(builtKindName(k)).toBe('Landfill');
    const map = new GameMap(4, 4);
    map.built[map.idx(1, 1)] = k;
    expect(isWalkable(map, 1, 1)).toBe(false);
    expect(zoneTypeOf(k)).toBe(ZoneType.None);
    expect(toolDef(`build-${k}`)).toBeUndefined();
    expect(UPKEEP.get(k) ?? 0).toBeGreaterThan(0);
    expect(BUILDING_PAINTERS.has(k)).toBe(true);
  });

  for (const seed of ['lotus', 'a', 'b']) {
    it(`a new city has one, on redlined ground (${seed})`, () => {
      const { world } = createCity({ seed, size: { width: 128, height: 128 }, save: null });
      const map = world.map;
      const fills = world.parcels.aliveIndices().map((i) => world.parcels.get(i)).filter((p) => p.kind === BuiltKind.Landfill);
      expect(fills).toHaveLength(1);
      expect([fills[0]!.width, fills[0]!.height]).toEqual([3, 3]);
      const grades: number[] = [];
      for (const i of world.parcels.aliveIndices()) {
        const p = world.parcels.get(i);
        if (zoneTypeOf(p.kind) === ZoneType.Residential) grades.push(map.redline[map.idx(p.x, p.y)]!);
      }
      grades.sort((a, b) => a - b);
      expect(map.redline[map.idx(fills[0]!.x, fills[0]!.y)]!).toBeGreaterThan(grades[grades.length >> 1]!);
    });
  }
});
