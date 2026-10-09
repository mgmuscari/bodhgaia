// Wind turbines turn with their output (Maddy 2026-10-08): a rotor sprite in the pixel pipeline, spinning at a rate
// proportional to the hour's wind (its share of nameplate), each turbine on its own phase.
import { describe, it, expect } from 'vitest';
import { paintSnesAgents, ROTOR_FRAMES, rotorFrame, spinRotor, ROTOR_REVS_PER_SEC } from '../../src/ui/snesAgents';
import type { Pixels } from '../../src/ui/pixelArt';

describe('turbine rotors', () => {
  it('six frames of a three-bladed rotor, each different, centred on an 11×11 sprite', () => {
    const out = new Map<string, Pixels>();
    paintSnesAgents(out);
    const frames = Array.from({ length: ROTOR_FRAMES }, (_, k) => out.get(`@sprite/turbine-rotor/${k}`)!);
    for (const f of frames) {
      expect(f.w).toBe(11);
      expect(f.h).toBe(11);
      expect(f.data[(5 * 11 + 5) * 4 + 3]).toBeGreaterThan(0); // the hub
    }
    const sig = (p: Pixels) => Array.from(p.data).join(',');
    expect(new Set(frames.map(sig)).size).toBe(ROTOR_FRAMES);
  });

  it('turns in proportion to its output: twice the wind, twice the turns; a still hour barely moves', () => {
    const slow = spinRotor(0, 10, 0.5);
    const fast = spinRotor(0, 10, 1.0);
    expect(fast).toBeCloseTo(2 * slow, 9);
    expect(fast).toBeCloseTo(10 * ROTOR_REVS_PER_SEC, 9);
    expect(spinRotor(0.3, 1, 0)).toBe(0.3);
  });

  it('a full turn steps through the frames three times (the rotor repeats every 120°)', () => {
    const seen: number[] = [];
    for (let k = 0; k < 18; k++) seen.push(rotorFrame(k / 18 + 1e-6));
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
  });
});
