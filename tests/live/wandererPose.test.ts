// Maddy 2026-10-08 (phone, the intro): "the live layer now has tearing issues that jitter against the map as it scrolls".
// The camera followed the night walker's raw position — a step every 1/20 s — while everyone else is drawn between
// steps; at 30 fps a frame carries one step or two, so the map scrolled in uneven jumps under smoothly moving people.
// The walker is drawn between steps like everyone, and the camera follows that drawn position.
import { describe, expect, it } from 'vitest';
import { wandererPose } from '../../src/live/poses';

describe('the night walker is drawn between steps', () => {
  it('blends from where it stood before the latest step to where it stands', () => {
    const w = { x: 10, y: 5, px: 9.8, py: 5 };
    expect(wandererPose(w, 0)).toEqual({ x: 9.8, y: 5 });
    expect(wandererPose(w, 1)).toEqual({ x: 10, y: 5 });
    expect(wandererPose(w, 0.5).x).toBeCloseTo(9.9, 9);
  });
  it('before its first step, it stands where it is', () => {
    expect(wandererPose({ x: 3, y: 4 }, 0.5)).toEqual({ x: 3, y: 4 });
  });
});
