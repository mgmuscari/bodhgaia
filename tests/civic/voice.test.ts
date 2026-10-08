import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState, SEED_VOICE } from '../../src/civic/state';
import { neighborhoodVoice } from '../../src/civic/voice';

describe('neighborhoodVoice', () => {
  it("reads how organised a tile's neighbourhood is beyond the opening, 0..1 — and 0 off any neighbourhood", () => {
    const map = new GameMap(6, 1);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    const id = partition.tileToNeighborhood[0]!;
    // the opening voice is nobody's organising yet: the inherited crisis holds until the city organises
    expect(civic.getValues(id).voice).toBe(SEED_VOICE);
    expect(neighborhoodVoice(civic, partition, 0)).toBe(0);
    civic.setValues(id, { ...civic.getValues(id), voice: SEED_VOICE + (255 - SEED_VOICE) / 2 });
    expect(neighborhoodVoice(civic, partition, 0)).toBeCloseTo(0.5, 9);
    civic.setValues(id, { ...civic.getValues(id), voice: 10 }); // silenced by policing
    expect(neighborhoodVoice(civic, partition, 0)).toBe(0);
    expect(neighborhoodVoice(civic, partition, 5)).toBe(0); // open land far from any home
  });
});

describe('neighborhoodBelonging (crime: conditions, not cops)', () => {
  it("reads how held a tile's neighbourhood is beyond the opening, 0..1", async () => {
    const { neighborhoodBelonging } = await import('../../src/civic/voice');
    const { SEED_BELONGING } = await import('../../src/civic/state');
    const map = new GameMap(6, 1);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    const id = partition.tileToNeighborhood[0]!;
    expect(neighborhoodBelonging(civic, partition, 0)).toBe(0);
    civic.setValues(id, { ...civic.getValues(id), belonging: SEED_BELONGING + (255 - SEED_BELONGING) / 2 });
    expect(neighborhoodBelonging(civic, partition, 0)).toBeCloseTo(0.5, 9);
    expect(neighborhoodBelonging(civic, partition, 5)).toBe(0);
  });
});
