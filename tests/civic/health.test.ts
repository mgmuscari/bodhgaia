// Neighbourhood health (docs/design/interdependence.md §1, step 2; Maddy 2026-10-13: "one composite hub"): one score
// per neighbourhood from its parts — belonging/voice/trust, its ground, how well its buildings are kept, work within
// reach, care in reach — each 0..255, the score their mean. Events and (later) petitions and narratives read it.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState } from '../../src/civic/state';
import { neighbourhoodHealth, type HealthInputs } from '../../src/civic/health';

function town(opts: { condition?: number; jobs?: number; soil?: number; covered?: boolean } = {}) {
  const map = new GameMap(20, 12);
  const parcels = new ParcelStore();
  for (let x = 0; x < 20; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  const homes: number[] = [];
  for (let x = 2; x < 8; x++) homes.push(placeParcel(map, parcels, { x, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: opts.condition ?? 200 }));
  const works = placeParcel(map, parcels, { x: 10, y: 3, width: 2, height: 2, kind: BuiltKind.Industrial });
  map.soilHealth.fill(opts.soil ?? 200);
  map.floraVitality.fill(opts.soil ?? 200);
  const partition = computeNeighborhoods(map);
  const civic = createCivicState(partition);
  const occ = new Map<number, number>();
  for (const i of homes) occ.set(map.idx(parcels.get(i).x, parcels.get(i).y), 4);
  const coverage = new Set<number>();
  if (opts.covered) for (let t = 0; t < map.built.length; t++) if (map.parcel[t] !== 0) coverage.add(t);
  const inp: HealthInputs = {
    map,
    parcels,
    partition,
    civic,
    occupancyAt: (t) => occ.get(t),
    coverage,
    jobsAt: (i) => (i === works ? (opts.jobs ?? 30) : 0),
  };
  return { inp, map, partition, homeTile: map.idx(3, 4) };
}

const healthAt = (t: ReturnType<typeof town>) => {
  const id = t.partition.tileToNeighborhood[t.homeTile]!;
  return neighbourhoodHealth(t.inp)[id - 1]!;
};

describe('neighbourhoodHealth', () => {
  it('a score 0..255 per neighbourhood, with its parts', () => {
    const h = healthAt(town());
    expect(h.health).toBeGreaterThanOrEqual(0);
    expect(h.health).toBeLessThanOrEqual(255);
    for (const k of ['civic', 'ground', 'repair', 'work', 'care'] as const) expect(h.parts[k]).toBeDefined();
  });
  it('the health is the mean of its parts', () => {
    const h = healthAt(town());
    const parts = Object.values(h.parts) as number[];
    expect(h.health).toBeCloseTo(parts.reduce((a, b) => a + b, 0) / parts.length, 6);
  });
  it('rises with each part: kept buildings, healthy ground, work in reach, care in reach', () => {
    const base = healthAt(town({ condition: 60, soil: 40, jobs: 0 })).health;
    expect(healthAt(town({ condition: 240, soil: 40, jobs: 0 })).health).toBeGreaterThan(base);
    expect(healthAt(town({ condition: 60, soil: 240, jobs: 0 })).health).toBeGreaterThan(base);
    expect(healthAt(town({ condition: 60, soil: 40, jobs: 30 })).health).toBeGreaterThan(base);
    expect(healthAt(town({ condition: 60, soil: 40, jobs: 0, covered: true })).health).toBeGreaterThan(base);
  });
  it('work counts jobs within reach for the neighbourhood’s workers, capped at all of them', () => {
    expect(healthAt(town({ jobs: 1000 })).parts.work).toBe(255);
    expect(healthAt(town({ jobs: 0 })).parts.work).toBe(0);
  });
});
