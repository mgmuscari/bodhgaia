// Maddy 2026-10-12: "clinics dispatch ambulances that can save residents from dying — dying residents have some amount
// of time before they actually die in which an ambulance can save them". A death is first a collapse: the person lies
// where they fell for a minute. Unreached, they die as before; reached, they are carried back where they belong.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { residentCollapses, stepDeaths, rescueResident } from '../../src/live/death';
import { DYING_WINDOW, seconds } from '../../src/live/tuning';

describe('a collapse, then a minute', () => {
  it('the window is a minute', () => {
    expect(DYING_WINDOW).toBe(seconds(60));
  });

  it('collapsed, they are not yet dead: no death counted, no memorial', () => {
    const state = createAmbientState();
    state.events = [];
    residentCollapses(state, 5, 5, { home: 77 });
    expect(state.dying).toHaveLength(1);
    expect(state.deaths ?? 0).toBe(0);
    expect(state.events.map((e) => e.kind)).toEqual(['collapse']);
  });

  it('unreached for the whole minute, they die where they lie', () => {
    const state = createAmbientState();
    residentCollapses(state, 5, 5, { home: 77 });
    for (let i = 0; i < DYING_WINDOW - 1; i++) stepDeaths(state);
    expect(state.deaths ?? 0).toBe(0);
    stepDeaths(state);
    expect(state.deaths).toBe(1);
    expect(state.dying).toHaveLength(0);
    expect(state.fallen).toEqual([{ x: 5, y: 5, t: 0 }]);
  });

  it('carried off in time, the minute stops counting for them', () => {
    const state = createAmbientState();
    residentCollapses(state, 5, 5, { home: 77 });
    state.dying![0]!.carried = true;
    for (let i = 0; i < DYING_WINDOW * 2; i++) stepDeaths(state);
    expect(state.deaths ?? 0).toBe(0);
  });
});

describe('saved, they go back where they belong', () => {
  const map = () => {
    const m = new GameMap(20, 20);
    m.setBuilt(3, 3, BuiltKind.HouseSingle);
    return m;
  };
  it('a resident goes home: the household counts them again', () => {
    const m = map();
    const state = createAmbientState();
    const home = m.idx(3, 3);
    state.occupancy.set(home, 1);
    residentCollapses(state, 5, 5, { home });
    rescueResident(state, m, state.dying![0]!);
    expect(state.occupancy.get(home)).toBe(2);
    expect(state.rescues).toBe(1);
  });
  it('a home that is gone (burnt to ruin) takes no one back: they are unhoused, near it', () => {
    const m = map();
    m.setBuilt(3, 3, BuiltKind.Ruin);
    const state = createAmbientState();
    const home = m.idx(3, 3);
    residentCollapses(state, 5, 5, { home });
    rescueResident(state, m, state.dying![0]!);
    expect(state.unhoused).toBe(1);
    expect(state.campIn?.get(home)).toBe(1);
  });
  it('someone from a camp returns to the unhoused, at that camp', () => {
    const m = map();
    const state = createAmbientState();
    const camp = m.idx(9, 9);
    residentCollapses(state, 9, 9, { camp });
    rescueResident(state, m, state.dying![0]!);
    expect(state.unhoused).toBe(1);
    expect(state.campIn?.get(camp)).toBe(1);
  });
});
