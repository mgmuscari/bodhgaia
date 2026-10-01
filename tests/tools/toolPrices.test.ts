import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, isCommonsKind } from '../../src/engine/fabric';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { toolDef, toolPrice, previewTool, applyTool, FUNDS_PER_COST, type Wallet } from '../../src/tools/tools';

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
