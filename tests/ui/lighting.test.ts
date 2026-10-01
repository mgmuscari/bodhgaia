import { describe, it, expect } from 'vitest';
import { dayNightBrightness, DAYSPEED } from '../../src/ui/lighting';

// Shared scene lighting — the single definition the GPU shader (base) and the renderer (sprites) both
// use, so a sprite is lit to the same level as the tile it's on (Maddy 2026-06-20).
describe('lighting (shared GPU/sprite scene lighting)', () => {
  it('day/night brightness stays in [0.45, 1] and is deterministic', () => {
    for (let k = 0; k < 40; k++) {
      const b = dayNightBrightness(k * 3.1);
      expect(b).toBeGreaterThanOrEqual(0.45 - 1e-9);
      expect(b).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(dayNightBrightness(12.34)).toBe(dayNightBrightness(12.34));
    // noon-ish (alt≈1) is brighter than midnight-ish (alt≈-1)
    const noon = dayNightBrightness(Math.PI / 2 / 0.04);
    const night = dayNightBrightness((3 * Math.PI) / 2 / 0.04);
    expect(noon).toBeGreaterThan(night);
  });
});

import { gameClock } from '../../src/ui/lighting';

describe('gameClock — the in-game hour on the day/night wall clock', () => {
  it('starts at sunrise (06:00) on load and reaches noon a quarter-day later', () => {
    const day = (2 * Math.PI) / DAYSPEED; // seconds per in-game day
    expect(gameClock(0).hour).toBe(6);
    expect(gameClock(day / 4 + 0.01).hour).toBe(12);
    expect(gameClock(day / 2 + 0.01).hour).toBe(18);
  });

  it('the slot counts in-game hours monotonically across days', () => {
    const day = (2 * Math.PI) / DAYSPEED;
    expect(gameClock(0).slot).toBe(0);
    expect(gameClock(day + 0.01).slot).toBe(24);
    expect(gameClock(day + 0.01).hour).toBe(6);
  });
});
