// The walk to school (Maddy 2026-10-14: "children walk to school"): at SCHOOL_IN_HOUR, up to PUPILS_PER_SCHOOL children
// set off on foot from homes within SCHOOL_REACH to the school; at SCHOOL_OUT_HOUR they walk home. Each walks the
// pedestrian network and is gone on arriving.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../../src/engine/fabric';
import { createAmbientState, setHouseholds } from '../../src/live/types';
import { schoolRun, stepPupils, PUPILS_PER_SCHOOL, SCHOOL_IN_HOUR, SCHOOL_OUT_HOUR } from '../../src/live/schoolRun';

function town(homes: number) {
  const map = new GameMap(40, 12);
  const parcels = new ParcelStore();
  for (let x = 0; x < 40; x++) placeTransport(map, x, 5, BuiltKind.RoadStreet);
  placeParcel(map, parcels, { x: 4, y: 3, width: 2, height: 2, kind: BuiltKind.School });
  const hs = [];
  for (let k = 0; k < homes; k++) {
    placeParcel(map, parcels, { x: 8 + k, y: 4, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    hs.push({ x: 8 + k, y: 4, count: 4 });
  }
  const state = createAmbientState();
  setHouseholds(state, hs);
  for (const h of hs) state.occupancy.set(map.idx(h.x, h.y), 4);
  return { map, state };
}

describe('the walk to school', () => {
  it('in the morning, children set off for school — at most PUPILS_PER_SCHOOL — once that hour', () => {
    const t = town(PUPILS_PER_SCHOOL + 4);
    schoolRun(t.state, t.map, SCHOOL_IN_HOUR - 1);
    expect(t.state.pupils ?? []).toHaveLength(0);
    schoolRun(t.state, t.map, SCHOOL_IN_HOUR);
    expect(t.state.pupils).toHaveLength(PUPILS_PER_SCHOOL);
    schoolRun(t.state, t.map, SCHOOL_IN_HOUR); // the same hour: no more
    expect(t.state.pupils).toHaveLength(PUPILS_PER_SCHOOL);
  });
  it('they walk to the school and are gone; in the afternoon they walk home', () => {
    const t = town(3);
    schoolRun(t.state, t.map, SCHOOL_IN_HOUR);
    for (let k = 0; k < 20_000 && (t.state.pupils?.length ?? 0) > 0; k++) stepPupils(t.state, t.map);
    expect(t.state.pupils ?? []).toHaveLength(0);
    schoolRun(t.state, t.map, SCHOOL_OUT_HOUR);
    expect(t.state.pupils!.length).toBe(3);
    expect(t.state.pupils!.every((p) => p.going === 'home')).toBe(true);
  });
});
