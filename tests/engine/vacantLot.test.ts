// Maddy 2026-10-13: "Bulldoze should create vacant lots that slowly recover". What the bulldozer clears is bare
// ground — a vacant lot — that anything may be built on again, the unhoused may camp on, and that grows back to
// open land as its soil heals (the ecology tick heals unsealed ground; the lot clears at VACANT_RECOVERED).
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import {
  BuiltKind,
  ParcelStore,
  bulldozeParcel,
  bulldozeTransportAt,
  canPlaceParcel,
  canPlaceTransport,
  placeParcel,
  placeTransport,
  recoverVacantLots,
  VACANT_RECOVERED,
} from '../../src/engine/fabric';
import { applyTool, previewTool, toolDef, type Wallet } from '../../src/tools/tools';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { ecologyTick } from '../../src/ecology/tick';
import { NEUTRAL_ECOLOGY_PRACTICES } from '../../src/ecology/tick';

function town() {
  const map = new GameMap(12, 12);
  const parcels = new ParcelStore();
  const home = placeParcel(map, parcels, { x: 3, y: 3, width: 2, height: 2, kind: BuiltKind.HouseSingle });
  for (let x = 0; x < 12; x++) placeTransport(map, x, 8, BuiltKind.RoadStreet);
  return { map, parcels, home };
}

describe('the bulldozer leaves a vacant lot', () => {
  it('a building comes down to a vacant lot over its whole footprint, owned by no one', () => {
    const { map, parcels, home } = town();
    expect(bulldozeParcel(map, parcels, home)).toBe(true);
    for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]] as const) {
      expect(map.getBuilt(x, y)).toBe(BuiltKind.VacantLot);
      expect(map.parcel[map.idx(x, y)]).toBe(0);
    }
  });

  it('a street torn up leaves a vacant lot too', () => {
    const { map } = town();
    expect(bulldozeTransportAt(map, 5, 8)).toBe(true);
    expect(map.getBuilt(5, 8)).toBe(BuiltKind.VacantLot);
  });

  it('the bulldoze tool does it, and a vacant lot is nothing more to bulldoze', () => {
    const { map, parcels } = town();
    const world = { map, parcels };
    const tech = createTechState(TECH_TREE);
    tech.restore([], 1000);
    const wallet: Wallet = { funds: 100_000 };
    expect(applyTool(world, tech, toolDef('bulldoze')!, 3, 3, wallet).ok).toBe(true);
    expect(map.getBuilt(4, 4)).toBe(BuiltKind.VacantLot);
    expect(previewTool(world, tech, toolDef('bulldoze')!, 4, 4, wallet).reason).toBe('nothing-to-bulldoze');
  });

  it('anything can be built on a vacant lot', () => {
    const { map, parcels, home } = town();
    bulldozeParcel(map, parcels, home);
    expect(canPlaceParcel(map, 3, 3, 2, 2)).toBe(true);
    expect(canPlaceTransport(map, 3, 3, BuiltKind.RoadStreet)).toBe(true);
    expect(canPlaceTransport(map, 3, 3, BuiltKind.BikePath)).toBe(true);
    expect(placeTransport(map, 3, 3, BuiltKind.BikePath)).toBe(true);
    expect(map.getBuilt(3, 3)).toBe(BuiltKind.BikePath);
  });
});

describe('a vacant lot slowly recovers', () => {
  it('it clears to open land once its soil has healed, not before', () => {
    const { map, parcels, home } = town();
    bulldozeParcel(map, parcels, home);
    const t = map.idx(3, 3);
    map.soilHealth[t] = VACANT_RECOVERED - 1;
    recoverVacantLots(map);
    expect(map.getBuilt(3, 3)).toBe(BuiltKind.VacantLot);
    map.soilHealth[t] = VACANT_RECOVERED;
    recoverVacantLots(map);
    expect(map.getBuilt(3, 3)).toBe(BuiltKind.None);
  });

  it('its soil heals on the ecology tick — it is unsealed ground — so a lot clears in a few minutes, not seconds', () => {
    const { map, parcels, home } = town();
    bulldozeParcel(map, parcels, home);
    let ticks = 0;
    while (map.getBuilt(3, 3) === BuiltKind.VacantLot && ticks < 10_000) {
      ecologyTick(map, NEUTRAL_ECOLOGY_PRACTICES);
      recoverVacantLots(map);
      ticks++;
    }
    expect(map.getBuilt(3, 3)).toBe(BuiltKind.None);
    // the ecology ticks once a second of play: between two and five minutes
    expect(ticks).toBeGreaterThanOrEqual(120);
    expect(ticks).toBeLessThanOrEqual(300);
  });
});

// Maddy 2026-10-13: lots hemmed in by houses and streets never heal — "we'll need to introduce mechanics for that…
// that connects to green techs and related plots". A green within VACANT_SHIELD tiles (a garden, park, rewilded land,
// compost hub, parklet) shields a vacant lot from its neighbours' drag, so its soil heals and it grows back; Soil
// and Soul doubles that reach.
import { VACANT_SHIELD } from '../../src/ecology/tick';
describe('greens heal vacant lots', () => {
  function block(gardenAt: number | null) {
    const map = new GameMap(40, 12);
    const parcels = new ParcelStore();
    for (let x = 0; x < 40; x++) {
      placeTransport(map, x, 0, BuiltKind.RoadStreet);
      placeTransport(map, x, 5, BuiltKind.RoadStreet);
    }
    for (let x = 0; x < 40; x++) for (const y of [1, 2, 3, 4]) placeParcel(map, parcels, { x, y, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const lot = map.idx(20, 2);
    bulldozeParcel(map, parcels, map.parcel[lot]! - 1);
    if (gardenAt !== null) {
      const g = map.parcel[map.idx(gardenAt, 2)]! - 1;
      bulldozeParcel(map, parcels, g);
      map.built[map.idx(gardenAt, 2)] = 0;
      placeParcel(map, parcels, { x: gardenAt, y: 2, width: 1, height: 1, kind: BuiltKind.CommunityGarden });
    }
    return { map, lot };
  }
  const ticks = (map: GameMap, lot: number, practices = NEUTRAL_ECOLOGY_PRACTICES): number => {
    let t = 0;
    while (map.built[lot] === BuiltKind.VacantLot && t < 2000) {
      ecologyTick(map, practices);
      recoverVacantLots(map);
      t++;
    }
    return t;
  };

  it('with no green near, a lot hemmed in by houses and streets does not heal', () => {
    const { map, lot } = block(null);
    expect(ticks(map, lot)).toBe(2000);
  });
  it('a garden within VACANT_SHIELD tiles heals it, in a few minutes', () => {
    const { map, lot } = block(20 + VACANT_SHIELD);
    const t = ticks(map, lot);
    expect(t).toBeLessThan(400);
  });
  it('further off, only Soil and Soul reaches it', () => {
    const far = 20 + VACANT_SHIELD * 2;
    expect(ticks(block(far).map, block(far).lot)).toBe(2000);
    const b = block(far);
    expect(ticks(b.map, b.lot, { soilRecovery: 2, pavedSoilCap: 60, vacantShield: VACANT_SHIELD * 2 })).toBeLessThan(400);
  });
});
