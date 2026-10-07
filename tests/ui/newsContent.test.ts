import { describe, it, expect } from 'vitest';
import { quarterOf, headlines, type NewsSample } from '../../src/ui/newsContent';

// Maddy 2026-10-07: "the bottom bar could scroll news like arrests, citizens becoming homeless, traffic jams, power
// outages". The news compares the city now with its last sample and turns changes past a threshold into sober,
// local-paper headlines, placed by part of the city. Recoveries are news too.
const W = 100;
const H = 100;
const base: NewsSample = { arrests: [], unhoused: 600, jammed: 0, dark: 0 };

describe('where in the city', () => {
  it('names where a tile is, with its own preposition: downtown, on the north side, in the southwest', () => {
    expect(quarterOf(50, 50, W, H)).toBe('downtown');
    expect(quarterOf(50, 5, W, H)).toBe('on the north side');
    expect(quarterOf(95, 50, W, H)).toBe('on the east side');
    expect(quarterOf(5, 95, W, H)).toBe('in the southwest');
  });
});

describe('headlines', () => {
  it('the first sample is a baseline, not news', () => {
    expect(headlines(null, base, W, H)).toEqual([]);
  });

  it('an arrest is reported where it happened; several on one side are counted', () => {
    expect(headlines(base, { ...base, arrests: [{ x: 95, y: 50 }] }, W, H)).toEqual(['Police take a resident on the east side']);
    expect(headlines(base, { ...base, arrests: [{ x: 50, y: 50 }] }, W, H)).toEqual(['Police take a resident downtown']);
    expect(headlines(base, { ...base, arrests: [{ x: 95, y: 5 }] }, W, H)).toEqual(['Police take a resident in the northeast']);
    const three = { ...base, arrests: [{ x: 95, y: 50 }, { x: 96, y: 52 }, { x: 94, y: 48 }] };
    expect(headlines(base, three, W, H)).toEqual(['3 arrests on the east side']);
  });

  it('people losing their homes, and finding them again', () => {
    expect(headlines(base, { ...base, unhoused: 612 }, W, H)).toEqual(['12 more residents lose their homes']);
    expect(headlines(base, { ...base, unhoused: 592 }, W, H)).toEqual(['8 residents find homes again']);
    expect(headlines(base, { ...base, unhoused: 602 }, W, H)).toEqual([]); // small drifts aren't news
  });

  it('gridlock when traffic jams past the threshold, and when it clears', () => {
    const jam = { ...base, jammed: 40, jamAt: { x: 50, y: 5 } };
    expect(headlines(base, jam, W, H)).toEqual(['Gridlock on the north side']);
    expect(headlines(jam, { ...base, jammed: 5 }, W, H)).toEqual(['Traffic is moving again']);
    expect(headlines(jam, { ...jam, jammed: 45 }, W, H)).toEqual([]); // still jammed: not news again
  });

  it('homes going dark, and the lights coming back', () => {
    const out = { ...base, dark: 23, darkAt: { x: 5, y: 50 } };
    expect(headlines(base, out, W, H)).toEqual(['Power out for 23 homes on the west side']);
    expect(headlines(out, base, W, H)).toEqual(['The power is back on']);
  });

  it('never uses the planning euphemisms as neutral words', () => {
    const all = [
      ...headlines(base, { arrests: [{ x: 1, y: 1 }], unhoused: 700, jammed: 50, jamAt: { x: 1, y: 1 }, dark: 9, darkAt: { x: 1, y: 1 } }, W, H),
      ...headlines({ arrests: [], unhoused: 700, jammed: 50, dark: 9 }, base, W, H),
    ].join(' ');
    expect(all).not.toMatch(/blight|urban renewal|redevelop|revitali|slum/i);
  });
});
