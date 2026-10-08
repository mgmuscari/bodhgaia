import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { createAmbientState } from '../../src/live/types';
import { worstSpots, TUTORIAL, type TutorialStep } from '../../src/ui/tutorialContent';

function city() {
  const map = new GameMap(60, 60);
  const parcels = new ParcelStore();
  const live = createAmbientState();
  for (let x = 10; x < 14; x++) live.pollution.set(map.idx(x, 10), 200); // smog
  live.policeViolence.set(map.idx(40, 12), 180); // police violence
  live.camps = new Map(); // an encampment (live/camps.ts)
  for (let x = 20; x < 24; x++) live.camps.set(map.idx(x, 40), 10);
  for (let x = 45; x < 49; x++) placeParcel(map, parcels, { x, y: 45, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 20 }); // decay
  placeParcel(map, parcels, { x: 5, y: 50, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 250 });
  live.waterPollution.set(map.idx(55, 5), 220); // poisoned water
  return { map, parcels, live };
}

describe('worstSpots: the city’s worst places, read from the live city', () => {
  it('finds the smog, the police violence, the encampment, the decay and the poisoned water', () => {
    const { map, parcels, live } = city();
    const spots = worstSpots(map, parcels, live);
    const near = (k: string, x: number, y: number) => {
      const s = spots.find((p) => p.kind === k)!;
      expect(s, k).toBeDefined();
      expect(Math.abs(s.x - x) + Math.abs(s.y - y), k).toBeLessThanOrEqual(3);
    };
    near('smog', 11.5, 10);
    near('police', 40, 12);
    near('unhoused', 21.5, 40);
    near('decay', 46.5, 45);
    near('water', 55, 5);
    for (const s of spots) expect(s.caption.length).toBeGreaterThan(10);
  });

  it('skips what the city does not have', () => {
    const map = new GameMap(20, 20);
    expect(worstSpots(map, new ParcelStore(), createAmbientState())).toEqual([]);
  });
});

describe('the tutorial script', () => {
  const says = TUTORIAL.filter((s): s is Extract<TutorialStep, { kind: 'say' }> => s.kind === 'say').map((s) => s.text);

  it('greets the planner, shows the mess, asks how it got this bad, then walks the interface', () => {
    expect(says.slice(0, 4)).toEqual(['Greetings, Planner.', 'You do not live here.', "You don't even live in this reality.", 'Look at this place! What a mess.']);
    const kinds = TUTORIAL.map((s) => s.kind);
    expect(kinds.indexOf('spots')).toBe(4);
    expect(kinds.indexOf('indict')).toBeGreaterThan(kinds.indexOf('spots'));
    expect(says).toContain('How did things get this bad??');
    expect(says).toContain('There is a lot of work to do here…');
    expect(kinds.filter((k) => k === 'ui').length).toBeGreaterThanOrEqual(6);
  });

  it('every interface step points at an element and explains it', () => {
    for (const s of TUTORIAL) if (s.kind === 'ui') expect(s.target.length > 0 && s.text.length > 20).toBe(true);
  });
});
