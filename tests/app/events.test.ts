import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState } from '../../src/civic/state';
import { createAmbientState, setHouseholds } from '../../src/live/types';
import { handleEvents, DEATH_BELONGING } from '../../src/app/events';
import { GRIEF_HEALTH } from '../../src/live/tuning';

function city() {
  const map = new GameMap(12, 12);
  const parcels = new ParcelStore();
  placeParcel(map, parcels, { x: 3, y: 3, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  const partition = computeNeighborhoods(map);
  const civic = createCivicState(partition);
  const live = createAmbientState();
  setHouseholds(live, [{ x: 3, y: 3, count: 3 }]);
  const log: string[] = [];
  const deps = {
    map,
    live,
    civic,
    partition: () => partition,
    mourn: (n: number) => log.push(`mourn ${n}`),
    news: (t: string) => log.push(`news ${t}`),
  };
  return { map, partition, civic, live, log, deps };
}

describe('handleEvents', () => {
  it('a death is mourned: costs, the neighbourhood’s belonging, grief at home, the news', () => {
    const c = city();
    const id = c.partition.tileToNeighborhood[c.map.idx(3, 3)]!;
    const before = c.civic.getValues(id).belonging;
    handleEvents([{ kind: 'death', x: 3, y: 4, w: 1, h: 1 }], c.deps);
    expect(c.log).toEqual(['mourn 1', 'news A resident died on the street']);
    expect(c.civic.getValues(id).belonging).toBe(before - DEATH_BELONGING);
    expect(c.live.buildingHealth.get(c.map.idx(3, 3))).toBe(-GRIEF_HEALTH);
  });

  it('several deaths are mourned together and reported as one line', () => {
    const c = city();
    handleEvents([{ kind: 'death', x: 3, y: 4, w: 1, h: 1 }, { kind: 'death', x: 9, y: 9, w: 1, h: 1 }], c.deps);
    expect(c.log).toEqual(['mourn 2', 'news 2 residents died on the street']);
  });

  it('an arrest costs nothing here (the police layer already records its harm)', () => {
    const c = city();
    handleEvents([{ kind: 'arrest', x: 3, y: 4, w: 2, h: 1 }], c.deps);
    expect(c.log).toEqual([]);
  });
});
