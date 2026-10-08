// Floods (docs/design/disasters.md): heavy rain lifts the water over the low land beside it — faster where it is
// paved, slower where greens soak it up — damaging what stands there; then it recedes.
import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { createFloodState, floodPlain, stepFlood, FLOOD_DAMAGE } from '../../src/growth/flood';

/** A shore: water in columns 0–2 at elevation 0.34; land rising gently from 0.35 at column 3 by 0.003 a column
 *  (low enough to flood up to column ~11; high ground beyond). */
function shore() {
  const map = new GameMap(30, 10);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 30; x++) {
      const i = map.idx(x, y);
      if (x < 3) {
        map.water[i] = Water.Ocean;
        map.elevation[i] = 0.34;
      } else map.elevation[i] = 0.35 + (x - 3) * 0.003;
    }
  }
  return { map, parcels: new ParcelStore() };
}

describe('the flood plain', () => {
  it('is the low land beside the water, nearest first; high ground and the water itself are not in it', () => {
    const { map } = shore();
    const plain = floodPlain(map);
    expect(plain.get(map.idx(3, 5))).toBe(1); // the shore
    expect(plain.get(map.idx(5, 5))).toBe(3);
    expect(plain.has(map.idx(1, 5))).toBe(false); // water
    expect(plain.has(map.idx(25, 5))).toBe(false); // high ground
  });
});

describe('a flood', () => {
  const run = (world: ReturnType<typeof shore>, hours: { heavy: boolean }[]) => {
    const f = createFloodState(world.map);
    let last = stepFlood(world, f, { hour: 0, heavy: false });
    hours.forEach((h, k) => (last = stepFlood(world, f, { hour: k + 1, heavy: h.heavy })));
    return { f, last };
  };

  it('climbs the plain hour by hour of heavy rain, shore first, and recedes after', () => {
    const w = shore();
    const one = run(w, [{ heavy: true }]).f;
    const four = run(shore(), Array(4).fill({ heavy: true })).f;
    expect(one.flooded.has(w.map.idx(3, 5))).toBe(true);
    expect(four.flooded.size).toBeGreaterThan(one.flooded.size);
    for (const t of four.flooded) expect(t % 30).toBeLessThan(25); // never the high ground
    const after = run(shore(), [...Array(4).fill({ heavy: true }), ...Array(24).fill({ heavy: false })]).f;
    expect(after.flooded.size).toBe(0);
  });

  it('light rain and dry hours flood nothing; ignition is once an hour', () => {
    const w = shore();
    const f = createFloodState(w.map);
    for (let h = 0; h < 10; h++) stepFlood(w, f, { hour: h, heavy: false });
    expect(f.flooded.size).toBe(0);
    stepFlood(w, f, { hour: 10, heavy: true });
    const n = f.flooded.size;
    stepFlood(w, f, { hour: 10, heavy: true }); // same hour: no change
    expect(f.flooded.size).toBe(n);
  });

  it('paving floods sooner; greens soak the water up', () => {
    const paved = shore();
    const green = shore();
    for (let y = 0; y < 10; y++) {
      for (let x = 3; x < 12; x++) {
        paved.map.built[paved.map.idx(x, y)] = BuiltKind.ParkingLot;
        green.map.built[green.map.idx(x, y)] = BuiltKind.Park;
      }
    }
    const hours = Array(3).fill({ heavy: true });
    expect(run(paved, hours).f.flooded.size).toBeGreaterThan(run(green, hours).f.flooded.size);
  });

  it('a building under water loses condition each hour it stands in it', () => {
    const w = shore();
    const home = placeParcel(w.map, w.parcels, { x: 3, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 200 });
    const { last } = run(w, [{ heavy: true }, { heavy: true }]);
    expect(w.parcels.conditionAt(home)).toBe(200 - 2 * FLOOD_DAMAGE);
    expect(last.underWater).toContain(home);
  });
});
