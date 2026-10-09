import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, isCommonsKind, placeParcel } from '../../src/engine/fabric';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { toolDef, toolPrice, previewTool, applyTool, chargeFor, FUNDS_PER_COST, type Wallet } from '../../src/tools/tools';

// The economy splits what things cost (Maddy 2026-09-30): the built fabric — roads, zones, plants,
// services — is paid from the treasury; the commons (gardens, parklets…) is raised with communal effort.
const world = () => ({ map: new GameMap(16, 16), parcels: new ParcelStore() });

describe('tool prices', () => {
  it('commons kinds are the ones neighbours tend', () => {
    expect(isCommonsKind(BuiltKind.CommunityGarden)).toBe(true);
    expect(isCommonsKind(BuiltKind.HouseSingle)).toBe(false);
    expect(isCommonsKind(BuiltKind.RoadStreet)).toBe(false);
  });

  it('the fabric costs funds; the commons costs effort', () => {
    const house = toolDef('build-16')!;
    expect(toolPrice(house)).toEqual({ effort: 0, funds: house.cost * FUNDS_PER_COST });
    const garden = toolDef('build-49')!;
    expect(toolPrice(garden)).toEqual({ effort: garden.cost, funds: 0 });
  });

  it('with a wallet, a road needs funds, not effort', () => {
    const w = world();
    const tech = createTechState(TECH_TREE);
    tech.effort = 0;
    const road = toolDef('build-1')!;
    expect(previewTool(w, tech, road, 3, 3, { funds: 0 }).reason).toBe('funds');
    expect(previewTool(w, tech, road, 3, 3, { funds: 10_000 }).valid).toBe(true);
  });

  it('applying debits the right purse', () => {
    const w = world();
    const tech = createTechState(TECH_TREE);
    tech.effort = 500;
    const wallet: Wallet = { funds: 10_000 };
    expect(applyTool(w, tech, toolDef('build-1')!, 3, 3, wallet).ok).toBe(true);
    expect(wallet.funds).toBe(10_000 - toolPrice(toolDef('build-1')!).funds);
    expect(tech.effort).toBe(500); // a road takes no communal effort
  });

  it('without a wallet, tools keep the old effort pricing (tests, tools elsewhere)', () => {
    const tech = createTechState(TECH_TREE);
    tech.effort = 0;
    expect(previewTool(world(), tech, toolDef('build-1')!, 3, 3).reason).toBe('effort');
  });
});

// Ways out of a deficit (Maddy 2026-10-01: "once you run out of funds there's no way to start restoration")
import { VOLUNTEER_DOLLARS_PER_EFFORT, FREEWAY_SALVAGE } from '../../src/tools/tools';

describe('volunteer labour stands in for funds on community works', () => {
  it('a broke city can still raise a clinic: its site rises on volunteer effort instead of funds (Maddy 2026-10-08)', () => {
    const w = world();
    const tech = createTechState(TECH_TREE);
    tech.effort = 1000;
    const clinic = toolDef('build-33')!;
    const full = clinic.cost * FUNDS_PER_COST;
    const wallet: Wallet = { funds: 100 };
    expect(previewTool(w, tech, clinic, 3, 3, wallet).valid).toBe(true);
    const r = applyTool(w, tech, clinic, 3, 3, wallet);
    expect(r.ok).toBe(true);
    expect(r.site).toMatchObject({ kind: 33, pay: 'effort', effort: Math.ceil(full / VOLUNTEER_DOLLARS_PER_EFFORT) });
    expect(wallet.funds).toBe(100); // nothing up front — the work is paid as it rises
    expect(tech.effort).toBe(1000);
  });

  it('in debt, it is all effort — and too little effort still refuses', () => {
    const tech = createTechState(TECH_TREE);
    tech.effort = 1;
    const wind = toolDef('build-28')!;
    expect(previewTool(world(), tech, wind, 3, 3, { funds: -5000 }).reason).toBe('effort');
  });

  it('the profit-making fabric gets no volunteers: industry still needs funds', () => {
    const tech = createTechState(TECH_TREE);
    tech.effort = 10_000;
    expect(previewTool(world(), tech, toolDef('build-21')!, 3, 3, { funds: 0 }).reason).toBe('funds');
  });
});

describe('freeway removal pays (salvage, and the upkeep stops)', () => {
  it('bulldozing a freeway tile credits salvage, even when broke; the salvage is under the build price', () => {
    const w = world();
    for (let y = 0; y < 16; y++) w.map.setBuilt(5, y, BuiltKind.RoadHighway);
    const tech = createTechState(TECH_TREE);
    tech.effort = 0;
    const wallet: Wallet = { funds: -2000 };
    expect(applyTool(w, tech, toolDef('bulldoze')!, 5, 5, wallet).ok).toBe(true);
    expect(w.map.getBuilt(5, 5)).toBe(BuiltKind.None);
    expect(wallet.funds).toBe(-2000 + FREEWAY_SALVAGE);
    expect(FREEWAY_SALVAGE).toBeLessThan(toolDef('build-3')!.cost * FUNDS_PER_COST);
  });

  it('demolishing anything else when broke is volunteer work', () => {
    const w = world();
    w.map.setBuilt(5, 5, BuiltKind.RoadStreet);
    const tech = createTechState(TECH_TREE);
    tech.effort = 50;
    const wallet: Wallet = { funds: 0 };
    expect(applyTool(w, tech, toolDef('bulldoze')!, 5, 5, wallet).ok).toBe(true);
    expect(tech.effort).toBeLessThan(50);
  });
});

// Maddy 2026-10-07: "it should cost effort to bulldoze housing, civic services and commercial. half cost of effort
// for industrial". Tearing down where people live, are cared for, or trade takes the community's effort (the
// building's own build price, in effort); industry half that. Roads, lots and the precinct keep their ordinary price.
describe('demolition costs effort', () => {
  const site = (kind: BuiltKind, w = 1, h = 1) => {
    const ww = world();
    placeParcel(ww.map, ww.parcels, { x: 3, y: 3, width: w, height: h, kind });
    return ww;
  };
  const charge = (ww: ReturnType<typeof world>, funds = 10_000) => chargeFor(ww, toolDef('bulldoze')!, 3, 3, { funds });

  it('a home, a shop, a clinic: their build price in effort, no funds', () => {
    expect(charge(site(BuiltKind.HouseSingle))).toEqual({ effort: toolDef(`build-${BuiltKind.HouseSingle}`)!.cost, funds: 0 });
    expect(charge(site(BuiltKind.CommercialStrip))).toEqual({ effort: toolDef(`build-${BuiltKind.CommercialStrip}`)!.cost, funds: 0 });
    expect(charge(site(BuiltKind.Clinic, 2, 2))).toEqual({ effort: toolDef(`build-${BuiltKind.Clinic}`)!.cost, funds: 0 });
  });

  it('industry costs half', () => {
    expect(charge(site(BuiltKind.Industrial))).toEqual({ effort: toolDef(`build-${BuiltKind.Industrial}`)!.cost / 2, funds: 0 });
  });

  it('homes with no build tool (apartments, projects) still cost effort, by footprint', () => {
    const c = charge(site(BuiltKind.Apartments, 2, 2));
    expect(c.funds).toBe(0);
    expect(c.effort).toBeGreaterThan(charge(site(BuiltKind.HouseSingle)).effort);
  });

  it('a road, a parking lot and the precinct keep their ordinary price', () => {
    const road = world();
    road.map.setBuilt(3, 3, BuiltKind.RoadStreet);
    expect(charge(road)).toEqual(toolPrice(toolDef('bulldoze')!));
    expect(charge(site(BuiltKind.ParkingLot))).toEqual(toolPrice(toolDef('bulldoze')!));
    expect(charge(site(BuiltKind.Precinct, 2, 2))).toEqual(toolPrice(toolDef('bulldoze')!));
  });

  it('without the effort, the demolition is refused', () => {
    const ww = site(BuiltKind.HouseSingle);
    const tech = createTechState(TECH_TREE);
    tech.effort = 1;
    expect(previewTool(ww, tech, toolDef('bulldoze')!, 3, 3, { funds: 10_000 }).reason).toBe('effort');
  });
});
