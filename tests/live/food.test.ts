// The food chain's flows (docs/design/interdependence.md §2, step 3b). Each in-game hour: gardens and farms grow
// food; a producer beside a pantry or bank feeds it (×ADJACENT_BONUS), else the nearest pantry within PANTRY_FEED,
// else the nearest bank within BANK_REACH; a bank shares its stock out to the emptiest pantries within BANK_REACH
// (each a delivery — the vans); a stocked pantry feeds the homes within PANTRY_REACH, and a garden or farm the homes
// within GROW_REACH. Homes fed have food access — part of neighbourhood health.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { foodHour, ADJACENT_BONUS, BANK_REACH, PRODUCE, type FoodState } from '../../src/live/food';

function world() {
  const map = new GameMap(60, 30);
  const parcels = new ParcelStore();
  return { map, parcels };
}
const home = (w: ReturnType<typeof world>, x: number, y: number) => placeParcel(w.map, w.parcels, { x, y, width: 1, height: 1, kind: BuiltKind.HouseSingle });
const residents = () => 4;
const hour = (w: ReturnType<typeof world>, food: FoodState) => foodHour(food, w.map, w.parcels, residents);

describe('food access', () => {
  it('no pantry, no garden: no food access', () => {
    const w = world();
    const h = home(w, 5, 5);
    const r = hour(w, { stock: new Map() });
    expect(r.access.has(w.map.idx(5, 5))).toBe(false);
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it('a garden feeds the homes right round it', () => {
    const w = world();
    home(w, 5, 5);
    placeParcel(w.map, w.parcels, { x: 7, y: 5, width: 1, height: 1, kind: BuiltKind.CommunityGarden });
    expect(hour(w, { stock: new Map() }).access.has(w.map.idx(5, 5))).toBe(true);
  });

  it('a garden beside a pantry stocks it (with the bonus), and the pantry feeds the homes within reach', () => {
    const w = world();
    home(w, 20, 5);
    placeParcel(w.map, w.parcels, { x: 24, y: 5, width: 1, height: 1, kind: BuiltKind.Pantry });
    placeParcel(w.map, w.parcels, { x: 25, y: 5, width: 1, height: 1, kind: BuiltKind.CommunityGarden });
    const food: FoodState = { stock: new Map() };
    const r = hour(w, food);
    expect(r.access.has(w.map.idx(20, 5))).toBe(true);
    // stocked by the garden's harvest with the bonus, less what the home took
    expect(food.stock.get(w.map.idx(24, 5))!).toBeGreaterThan(0);
    expect(food.stock.get(w.map.idx(24, 5))!).toBeLessThanOrEqual(PRODUCE.get(BuiltKind.CommunityGarden)! * ADJACENT_BONUS);
  });

  it('a pantry with nothing coming in runs dry, and its homes lose access', () => {
    const w = world();
    home(w, 20, 5);
    placeParcel(w.map, w.parcels, { x: 24, y: 5, width: 1, height: 1, kind: BuiltKind.Pantry });
    const food: FoodState = { stock: new Map([[w.map.idx(24, 5), 1]]) };
    expect(hour(w, food).access.has(w.map.idx(20, 5))).toBe(true); // the last of it
    let r = hour(w, food);
    for (let k = 0; k < 10; k++) r = hour(w, food);
    expect(r.access.has(w.map.idx(20, 5))).toBe(false);
  });

  it('a food bank gathers from a farm in reach and delivers to its pantries — the deliveries the vans drive', () => {
    const w = world();
    home(w, 50, 20);
    const pantryTile = w.map.idx(48, 20);
    placeParcel(w.map, w.parcels, { x: 48, y: 20, width: 1, height: 1, kind: BuiltKind.Pantry });
    placeParcel(w.map, w.parcels, { x: 30, y: 10, width: 2, height: 2, kind: BuiltKind.FoodBank });
    placeParcel(w.map, w.parcels, { x: 22, y: 10, width: 2, height: 2, kind: BuiltKind.UrbanFarm }); // far from the pantry
    expect(48 - 30).toBeLessThanOrEqual(BANK_REACH);
    const food: FoodState = { stock: new Map() };
    let delivered = 0;
    let fed = false;
    for (let k = 0; k < 3; k++) {
      const r = hour(w, food);
      delivered += r.deliveries.filter((d) => d.to === pantryTile).length;
      fed ||= r.access.has(w.map.idx(50, 20));
    }
    expect(delivered).toBeGreaterThan(0);
    expect(fed).toBe(true);
  });

  it('is deterministic', () => {
    const run = () => {
      const w = world();
      home(w, 20, 5);
      placeParcel(w.map, w.parcels, { x: 24, y: 5, width: 1, height: 1, kind: BuiltKind.Pantry });
      placeParcel(w.map, w.parcels, { x: 28, y: 5, width: 1, height: 1, kind: BuiltKind.CommunityGarden });
      const food: FoodState = { stock: new Map() };
      const out = [];
      for (let k = 0; k < 5; k++) out.push([...hour(w, food).access], [...food.stock]);
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });
});
