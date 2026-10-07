import { describe, it, expect } from 'vitest';
import { createAmbientState } from '../../src/live/types';
import { soundSnapshot, moodFor } from '../../src/app/sound';

// The sound controller reads the live city cheaply a few times a second: what's in VIEW feeds the ambience (the
// camera is the listener) and the hour picks the music's mood.
describe('the ambience hears what the camera sees', () => {
  it('counts moving cars, walkers and flocks inside the view, normalised 0..1', () => {
    const s = createAmbientState();
    const car = (x: number, y: number, parked = false) => ({ x, y, dir: 0, tx: x, ty: y, parked }) as never;
    s.cars.push(car(5, 5), car(6, 5), car(50, 50), car(5, 6, true));
    s.peds.push({ x: 5, y: 5, phase: 'to-building' } as never, { x: 5, y: 5, phase: 'inside' } as never, { x: 90, y: 90, phase: 'to-home' } as never);
    s.birds.push({ birds: [{ x: 4, y: 4 }] } as never);
    const snap = soundSnapshot(s, { x0: 0, y0: 0, x1: 20, y1: 20 }, false);
    expect(snap.traffic01).toBeGreaterThan(0); // 2 moving cars in view (the parked and the far one don't count)
    expect(snap.traffic01).toBeLessThan(0.2);
    expect(snap.peds01).toBeGreaterThan(0); // 1 walker in view (indoors and far don't count)
    expect(snap.birds01).toBeGreaterThan(0);
    expect(snap.night).toBe(false);
    expect(snap.rain).toBe(false); // no visible weather yet — no rain you can hear but not see
  });

  it('an empty view is silent ambience input', () => {
    const snap = soundSnapshot(createAmbientState(), { x0: 0, y0: 0, x1: 10, y1: 10 }, true);
    expect(snap).toMatchObject({ traffic01: 0, peds01: 0, birds01: 0, night: true });
  });
});

describe('the music follows the day', () => {
  it('day by day, night by night, and calm (the chants) on a night when the city has a healing commons', () => {
    expect(moodFor(12, false)).toBe('day');
    expect(moodFor(22, false)).toBe('night');
    expect(moodFor(3, false)).toBe('night');
    expect(moodFor(22, true)).toBe('calm');
    expect(moodFor(12, true)).toBe('day'); // the chants are for the quiet hours
  });
});

// Maddy 2026-10-07: "police could make a siren noise". A siren wails while a cruiser IN VIEW is chasing —
// panned toward the cruisers, louder with more of them; nothing while they patrol or are out of sight.
import { sirenFor } from '../../src/app/sound';
describe('the siren', () => {
  const view = { x0: 0, y0: 0, x1: 20, y1: 10 };
  const cruiser = (x: number, y: number) => ({ x, y, dir: 0, tx: x, ty: y }) as never;
  it('is silent while patrolling, or with no cruiser in view', () => {
    expect(sirenFor([cruiser(5, 5)], 'scatter', view).on).toBe(false);
    expect(sirenFor([cruiser(50, 50)], 'chase', view).on).toBe(false);
    expect(sirenFor([], 'chase', view).on).toBe(false);
  });
  it('wails during a chase in view, panned toward the cruisers, louder with more of them', () => {
    const one = sirenFor([cruiser(18, 5)], 'chase', view);
    expect(one.on).toBe(true);
    expect(one.pan).toBeGreaterThan(0.5); // far right of the view
    const three = sirenFor([cruiser(2, 5), cruiser(3, 5), cruiser(4, 4)], 'chase', view);
    expect(three.pan).toBeLessThan(-0.5);
    expect(three.level).toBeGreaterThan(one.level);
    expect(three.level).toBeLessThanOrEqual(0.25); // distant, never piercing
  });
});
