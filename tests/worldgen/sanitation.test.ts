// Sanitation in a new city (Maddy 2026-10-21: "new cities should have sanitation but underserved"): like the fire
// stations and clinics, the city's depot was provided to the greenlined districts — the redlined ones, where the
// evictions come, are beyond its trucks' reach. The player extends the service to repair it.
import { describe, it, expect } from 'vitest';
import { createCity } from '../../src/app/city';
import { BuiltKind } from '../../src/engine/fabric';
import { DEPOT_REACH } from '../../src/live/garbage';
import { ZoneType, zoneTypeOf } from '../../src/engine/zone';

describe('a new city\'s sanitation', () => {
  for (const seed of ['lotus', 'a', 'b']) {
    it(`has a depot, sited on greenlined ground, leaving redlined homes beyond its reach (${seed})`, () => {
      const { world } = createCity({ seed, size: { width: 128, height: 128 }, save: null });
      const map = world.map;
      const depots: number[] = [];
      for (const i of world.parcels.aliveIndices()) {
        const p = world.parcels.get(i);
        if (p.kind === BuiltKind.SanitationDepot) depots.push(map.idx(p.x, p.y));
      }
      expect(depots.length).toBeGreaterThanOrEqual(1);
      expect(depots.length).toBeLessThanOrEqual(2); // underserved: a depot or two for the whole city
      // homes, and how redlined their ground is
      const homes: { t: number; grade: number }[] = [];
      for (const i of world.parcels.aliveIndices()) {
        const p = world.parcels.get(i);
        if (zoneTypeOf(p.kind) === ZoneType.Residential) homes.push({ t: map.idx(p.x, p.y), grade: map.redline[map.idx(p.x, p.y)]! });
      }
      const grades = homes.map((h) => h.grade).sort((a, b) => a - b);
      const median = grades[grades.length >> 1]!;
      for (const d of depots) expect(map.redline[d]!).toBeLessThanOrEqual(median); // the greenlined side
      const reached = (t: number) => depots.some((d) => Math.abs((d % map.width) - (t % map.width)) + Math.abs(Math.floor(d / map.width) - Math.floor(t / map.width)) <= DEPOT_REACH);
      const redlined = homes.filter((h) => h.grade > median);
      const unserved = redlined.filter((h) => !reached(h.t)).length / Math.max(1, redlined.length);
      expect(unserved).toBeGreaterThan(0.3); // a good share of the redlined homes out of reach
    });
  }
});
