import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState } from '../../src/civic/state';
import { neighborhoodVoice } from '../../src/civic/voice';

describe('neighborhoodVoice', () => {
  it("reads a tile's neighbourhood voice as 0..1, and 0 off any neighbourhood", () => {
    const map = new GameMap(6, 1);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    const id = partition.tileToNeighborhood[0]!;
    civic.setValues(id, { ...civic.getValues(id), voice: 51 });
    expect(neighborhoodVoice(civic, partition, 0)).toBeCloseTo(0.2, 9);
    expect(neighborhoodVoice(civic, partition, 5)).toBe(0); // open land far from any home
  });
});
