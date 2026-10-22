// Fireworks (interdependence §6, Maddy 2026-10-21 "Festivity"): at a festival's night, bursts over the park — one
// art pixel per spark, in the palette, drawn after the lighting pass. Pure geometry, deterministic in the time.
import { describe, it, expect } from 'vitest';
import { fireworkSparks, launchesBetween, BURST_EVERY_MS, BURST_LIFE_MS } from '../../src/ui/fireworksContent';
import { BASE_TILE } from '../../src/ui/camera';

const park = { x: 10, y: 20, w: 4, h: 3 };

describe('fireworks', () => {
  it('fills the sky over the park with sparks, never far from it', () => {
    let seen = 0;
    for (let t = 0; t < 10_000; t += 97) {
      for (const s of fireworkSparks(park, 7, t)) {
        seen++;
        expect(s.x).toBeGreaterThanOrEqual((park.x - 2) * BASE_TILE);
        expect(s.x).toBeLessThanOrEqual((park.x + park.w + 2) * BASE_TILE);
        expect(s.y).toBeGreaterThanOrEqual((park.y - 5) * BASE_TILE); // up in the sky over it
        expect(s.y).toBeLessThanOrEqual((park.y + park.h) * BASE_TILE);
        expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true); // on the art grid
      }
    }
    expect(seen).toBeGreaterThan(500);
  });

  it('a burst rises as one spark, then opens into a ring that grows and thins', () => {
    const counts: number[] = [];
    for (let t = 0; t < BURST_LIFE_MS + 400; t += 100) counts.push(fireworkSparks(park, 3, t, 0).length); // burst 0, launch to fade
    expect(counts[1]).toBeLessThanOrEqual(2); // rising: a spark and its trail
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(10); // the ring
    const peak = counts.indexOf(Math.max(...counts));
    expect(Math.min(...counts.slice(peak).filter((n) => n > 0))).toBeLessThan(Math.max(...counts)); // thinning as it fades
  });

  it('is the same picture at the same moment (a festival seed and the clock), and changes with the seed', () => {
    expect(fireworkSparks(park, 5, 4321)).toEqual(fireworkSparks(park, 5, 4321));
    expect(fireworkSparks(park, 5, 4321)).not.toEqual(fireworkSparks(park, 6, 4321));
  });

  it('counts the bursts launched in a span (one sound each)', () => {
    const n = launchesBetween(5, 0, 20 * BURST_EVERY_MS);
    expect(n).toBeGreaterThanOrEqual(18);
    expect(n).toBeLessThanOrEqual(22);
    expect(launchesBetween(5, 1000, 1000)).toBe(0);
  });
});
