// Seeing transit used (Maddy 2026-10-08: "trouble seeing whether anyone uses streetcars or trains"): riders aboard
// show as heads in the cars' windows, more as it fills; each stop has a sign at its platform.
import { describe, it, expect } from 'vitest';
import { paintSnesAgents } from '../../src/ui/snesAgents';
import { windowsLit, WINDOWS } from '../../src/ui/snesAgents';
import { ridersAboard, PER_CAR } from '../../src/live/riders';
import { createAmbientState, type Ped, type Train } from '../../src/live/types';
import type { Pixels } from '../../src/ui/pixelArt';

const differing = (a: Pixels, b: Pixels): number => {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) n++;
  return n;
};

describe('riders seen aboard', () => {
  it('a car shows a head in more windows as it fills — none empty, every window full', () => {
    expect(windowsLit(0)).toBe(0);
    expect(windowsLit(1)).toBe(1); // one rider is seen
    expect(windowsLit(PER_CAR / 2)).toBeGreaterThan(1);
    expect(windowsLit(PER_CAR)).toBe(WINDOWS);
    expect(windowsLit(PER_CAR * 3)).toBe(WINDOWS);
  });

  it('the sprites carry those heads: a fuller car has more of its windows changed', () => {
    const out = new Map<string, Pixels>();
    paintSnesAgents(out);
    for (const base of ['@sprite/tram/car/2', '@sprite/tram/head/2', '@sprite/train/car/2']) {
      const empty = out.get(`${base}/0`)!;
      expect(empty, base).toBeDefined();
      expect(differing(empty, out.get(`${base}/1`)!)).toBeGreaterThan(0);
      expect(differing(empty, out.get(`${base}/${WINDOWS}`)!)).toBeGreaterThan(differing(empty, out.get(`${base}/1`)!));
    }
    expect(out.get('@sprite/transit-stop/tram')).toBeDefined();
    expect(out.get('@sprite/transit-stop/rail')).toBeDefined();
  });

  it('counts who is aboard each vehicle', () => {
    const state = createAmbientState();
    const v = { cells: [0], hx: 0, hy: 0, tx: 1, ty: 0, dir: 1, family: 'tram' } as Train;
    state.trains.push(v);
    const aboard = (stage: 'riding' | 'waiting') => ({ x: 0, y: 0, dir: 1, tx: 0, ty: 0, ride: { stage, vehicle: v } }) as unknown as Ped;
    state.peds.push(aboard('riding'), aboard('riding'), aboard('waiting'));
    expect(ridersAboard(state).get(v)).toBe(2);
  });
});
