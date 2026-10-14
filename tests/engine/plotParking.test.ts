// Multi-tile plots get their own parking (backlog, in 1.0.15; docs/design/multitile-parking.md). A workplace or civic
// plot of 2×2 or more gets a 1-tile parking lot just outside its footprint, beside a street — the plot keeps its
// size, and a car always has somewhere at the door. Worldgen gives every one a lot; a plot the player builds gets one.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, addPlotParking, needsPlotParking, placeParcel, placeTransport } from '../../src/engine/fabric';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';
import { applyTool, toolDef, type Wallet } from '../../src/tools/tools';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';

const lotBeside = (map: GameMap, p: { x: number; y: number; width: number; height: number }): boolean => {
  for (let y = p.y - 1; y <= p.y + p.height; y++) {
    for (let x = p.x - 1; x <= p.x + p.width; x++) {
      if (map.inBounds(x, y) && map.getBuilt(x, y) === BuiltKind.ParkingLot) return true;
    }
  }
  return false;
};

describe('plot parking', () => {
  it('workplaces and civic buildings of 2×2+ need it; homes, greens and small plots do not', () => {
    expect(needsPlotParking(BuiltKind.Industrial, 2, 2)).toBe(true);
    expect(needsPlotParking(BuiltKind.School, 2, 2)).toBe(true);
    expect(needsPlotParking(BuiltKind.CoalPlant, 3, 3)).toBe(true);
    expect(needsPlotParking(BuiltKind.Industrial, 1, 1)).toBe(false);
    expect(needsPlotParking(BuiltKind.Apartments, 2, 2)).toBe(false);
    expect(needsPlotParking(BuiltKind.Park, 2, 2)).toBe(false);
  });

  it('a lot goes beside the plot, on a tile touching a street — the footprint untouched', () => {
    const map = new GameMap(12, 12);
    const parcels = new ParcelStore();
    for (let x = 0; x < 12; x++) placeTransport(map, x, 2, BuiltKind.RoadStreet);
    const i = placeParcel(map, parcels, { x: 4, y: 4, width: 2, height: 2, kind: BuiltKind.Industrial });
    expect(addPlotParking(map, parcels, i)).toBe(true);
    const lots: [number, number][] = [];
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (map.getBuilt(x, y) === BuiltKind.ParkingLot) lots.push([x, y]);
    expect(lots).toHaveLength(1);
    const [lx, ly] = lots[0]!;
    expect(ly).toBe(3); // between the plot and the street
    expect(lx).toBeGreaterThanOrEqual(4);
    expect(lx).toBeLessThanOrEqual(5);
    expect(map.getBuilt(4, 4)).toBe(BuiltKind.Industrial);
    expect(addPlotParking(map, parcels, i)).toBe(false); // already has one
  });

  it('no street beside it, no lot', () => {
    const map = new GameMap(12, 12);
    const parcels = new ParcelStore();
    const i = placeParcel(map, parcels, { x: 4, y: 4, width: 2, height: 2, kind: BuiltKind.Industrial });
    expect(addPlotParking(map, parcels, i)).toBe(false);
  });

  it('worldgen gives every big workplace that has room by a street its lot', () => {
    const w = runPipeline({ seed: 'lotus', width: 96, height: 96 }, [terrainStage(), mosesCenturyStage(), ecoSeedStage()]);
    let big = 0;
    for (const i of w.parcels.aliveIndices()) {
      const p = w.parcels.get(i);
      if (!needsPlotParking(p.kind, p.width, p.height)) continue;
      big++;
      // either it has its lot, or there was no free tile beside a street to put one
      if (!lotBeside(w.map, p)) expect(addPlotParking(w.map, w.parcels, i)).toBe(false);
    }
    expect(big).toBeGreaterThan(0);
  });

  it('a big workplace the player builds comes with its lot', () => {
    const map = new GameMap(12, 12);
    const parcels = new ParcelStore();
    for (let x = 0; x < 12; x++) placeTransport(map, x, 2, BuiltKind.RoadStreet);
    const tech = createTechState(TECH_TREE);
    tech.restore([], 10_000);
    const wallet: Wallet = { funds: 1_000_000 };
    expect(applyTool({ map, parcels }, tech, toolDef(`build-${BuiltKind.CoalPlant}`)!, 4, 4, wallet).ok).toBe(true);
    expect(lotBeside(map, { x: 4, y: 4, width: 3, height: 3 })).toBe(true);
  });
});
