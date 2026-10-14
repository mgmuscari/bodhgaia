// Maddy 2026-10-13: "Residents at home should park their cars on the street in excess of 1". A household's cars stay
// with it: one off the street (the driveway), the rest at the kerb near home while they're at home. Someone driving
// off takes one of them; communes and tiny homes own none.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState, setHouseholds, type Ped } from '../../src/live/types';
import { householdCars, syncHomeCars, HOME_KERB_MAX } from '../../src/live/homeCars';
import { ensureOwnedCar } from '../../src/live/agents';
import { stepCar } from '../../src/live/cars';

function street(kind: BuiltKind = BuiltKind.HouseSingle, residents = 6) {
  const map = new GameMap(20, 10);
  const parcels = new ParcelStore();
  for (let x = 0; x < 20; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  placeParcel(map, parcels, { x: 8, y: 3, width: 1, height: 2, kind });
  const state = createAmbientState(createRng('home').fork('a'));
  const home = map.idx(8, 3);
  state.occupancy.set(home, residents);
  setHouseholds(state, [{ x: 8, y: 3, count: residents }]);
  return { map, state, home };
}
const atHome = (s: ReturnType<typeof street>) => s.state.cars.filter((c) => c.atHome === s.home);

describe('a household keeps its cars', () => {
  it('a house owns about a car for two residents, three at most; communes and tiny homes none', () => {
    expect(householdCars(BuiltKind.HouseSingle, 6)).toBe(3);
    expect(householdCars(BuiltKind.HouseSingle, 2)).toBe(1);
    expect(householdCars(BuiltKind.HouseSingle, 20)).toBe(3);
    expect(householdCars(BuiltKind.Commune, 30)).toBe(0);
    expect(householdCars(BuiltKind.TinyHomes, 30)).toBe(0);
  });

  it('beyond the first (the driveway), they park at the kerb near home', () => {
    const s = street();
    syncHomeCars(s.state, s.map);
    const cars = atHome(s);
    expect(cars).toHaveLength(2); // three cars, one in the driveway
    for (const c of cars) {
      expect(c.parked).toBe(true);
      expect(c.curbSlot).toBeDefined();
      expect(Math.abs(Math.round(c.x) - 8) + Math.abs(Math.round(c.y) - 5)).toBeLessThanOrEqual(6);
    }
    syncHomeCars(s.state, s.map); // stable: no more, no fewer
    expect(atHome(s)).toHaveLength(2);
  });

  it('a kerb car stays put — it is no passing car that leaves on its dwell', () => {
    const s = street();
    syncHomeCars(s.state, s.map);
    const c = atHome(s)[0]!;
    const at = [c.x, c.y];
    const rng = createRng('stay').fork('s');
    for (let k = 0; k < 2000; k++) expect(stepCar(s.state, s.map, rng, {} as never, c)).toBe(true);
    expect([c.x, c.y]).toEqual(at);
  });

  it('someone driving off from home takes one of them, and the kerb holds one fewer', () => {
    const s = street();
    syncHomeCars(s.state, s.map);
    const before = s.state.cars.length;
    const p = { x: 8, y: 4, dir: 0, tx: 8, ty: 4, homeTile: s.home } as Ped;
    s.state.peds.push(p);
    const car = ensureOwnedCar(s.state, p, s.map)!;
    expect(car.owned).toBe(true);
    expect(car.atHome).toBeUndefined();
    expect(s.state.cars.length).toBe(before); // claimed, not a new car
    syncHomeCars(s.state, s.map);
    expect(atHome(s)).toHaveLength(1); // the car out is one of the household's
  });

  it('a big household parks at most HOME_KERB_MAX at the kerb', () => {
    const s = street(BuiltKind.Apartments, 200);
    syncHomeCars(s.state, s.map);
    expect(atHome(s).length).toBeLessThanOrEqual(HOME_KERB_MAX);
  });
});

// Maddy 2026-10-13: "housing with good access to transit may have its car count decremented as residents cease to
// own cars". Near a stop a household sheds its cars over time — to none within TRANSIT_NEAR, to half within
// TRANSIT_REACH; elsewhere it keeps them.
import { BuiltKind as BK } from '../../src/engine/fabric';
import { carsOwnedAt, TRANSIT_NEAR, TRANSIT_REACH } from '../../src/live/homeCars';
describe('homes near transit give up cars', () => {
  function line(homeY: number) {
    const map = new GameMap(30, 40);
    const parcels = new ParcelStore();
    for (let y = 0; y < 40; y++) placeTransport(map, 10, y, BK.RoadStreet); // a street
    for (let x = 0; x < 30; x++) map.setBuilt(x, 2, BK.Streetcar); // a tram line along the top, its kerb the platforms
    for (let x = 0; x < 30; x++) placeTransport(map, x, 3, BK.RoadStreet);
    placeParcel(map, parcels, { x: 11, y: homeY, width: 1, height: 1, kind: BK.HouseSingle });
    const state = createAmbientState(createRng('tr').fork('a'));
    const home = map.idx(11, homeY);
    state.occupancy.set(home, 6);
    setHouseholds(state, [{ x: 11, y: homeY, count: 6 }]);
    return { map, state, home };
  }
  const run = (s: ReturnType<typeof line>, n: number) => {
    for (let k = 0; k < n; k++) syncHomeCars(s.state, s.map);
    return carsOwnedAt(s.state, s.home);
  };

  it('beside a stop, a household sheds its cars over time, to none — not all at once', () => {
    const s = line(4);
    expect(run(s, 1)).toBe(3);
    const mid = run(s, 120);
    expect(mid).toBeLessThan(3);
    expect(run(s, 600)).toBe(0);
  });
  it('a little further off, to half', () => {
    const s = line(2 + TRANSIT_NEAR + 2);
    expect(TRANSIT_NEAR + 2).toBeLessThanOrEqual(TRANSIT_REACH);
    expect(run(s, 600)).toBe(2); // half of three, rounded up
  });
  it('far from any stop it keeps them', () => {
    const s = line(2 + TRANSIT_REACH + 6);
    expect(run(s, 600)).toBe(3);
  });
});
