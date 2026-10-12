// Maddy 2026-10-12: clinics dispatch ambulances that can save residents from dying. A collapse calls the nearest
// clinic with a route; the ambulance drives out (roads, and the car-free ways, like a fire truck), takes them aboard,
// and brings them back — then they go home. Too far for the minute, or no clinic at all: they die.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { residentCollapses, stepDeaths } from '../../src/live/death';
import { stepAmbulances } from '../../src/live/ambulances';
import { DYING_WINDOW } from '../../src/live/tuning';

/** A road along y=5, `len` tiles; a clinic at its west end (or none); a house to go home to. */
const town = (len: number, clinic = true) => {
  const map = new GameMap(len + 4, 12);
  for (let x = 0; x < len; x++) map.setBuilt(x, 5, BuiltKind.RoadStreet);
  const parcels = new ParcelStore();
  if (clinic) placeParcel(map, parcels, { x: 0, y: 6, width: 2, height: 2, kind: BuiltKind.Clinic });
  placeParcel(map, parcels, { x: len - 3, y: 3, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  const state = createAmbientState();
  const home = map.idx(len - 3, 3);
  state.occupancy.set(home, 1);
  return { map, state, home };
};

const run = (t: ReturnType<typeof town>, substeps: number) => {
  for (let i = 0; i < substeps; i++) {
    stepDeaths(t.state);
    stepAmbulances(t.state, t.map);
  }
};

describe('ambulances', () => {
  it('a collapse calls the nearest clinic: the ambulance goes out, brings them back, and they go home', () => {
    const t = town(40);
    residentCollapses(t.state, 30, 5, { home: t.home });
    run(t, 1);
    expect(t.state.ambulances).toHaveLength(1);
    run(t, DYING_WINDOW * 2);
    expect(t.state.deaths ?? 0).toBe(0);
    expect(t.state.rescues).toBe(1);
    expect(t.state.occupancy.get(t.home)).toBe(2);
    expect(t.state.ambulances ?? []).toHaveLength(0); // back at the clinic, the call over
  });

  it('too far to reach in the minute: they die, and the ambulance turns back', () => {
    const t = town(260);
    residentCollapses(t.state, 255, 5, { home: t.home });
    run(t, DYING_WINDOW * 4);
    expect(t.state.deaths).toBe(1);
    expect(t.state.rescues ?? 0).toBe(0);
    expect(t.state.ambulances ?? []).toHaveLength(0);
  });

  it('no clinic: no ambulance, and they die', () => {
    const t = town(40, false);
    residentCollapses(t.state, 30, 5, { home: t.home });
    run(t, DYING_WINDOW + 1);
    expect(t.state.ambulances ?? []).toHaveLength(0);
    expect(t.state.deaths).toBe(1);
  });
});
