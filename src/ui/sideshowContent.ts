// Sideshows (PURE — pure-ui allowlist; Maddy 2026-10-21): car sideshows at a hard-pressed neighbourhood's crossing.
// Where each car spinning donuts is at a moment — a tight circle round its own spot in the crossing, the body slewed
// inward of its path like a drift — and how dark the tire marks it leaves read. Integer tables, no transcendental Math.

import { hash2 } from './pixelArt';
import { AGENT_TINTS } from './snesAgents';

/** Sixteen points round a circle, ×8, clockwise from east (screen y-down). */
const CIRCLE: readonly (readonly [number, number])[] = [
  [8, 0], [7, 3], [6, 6], [3, 7], [0, 8], [-3, 7], [-6, 6], [-7, 3],
  [-8, 0], [-7, -3], [-6, -6], [-3, -7], [0, -8], [3, -7], [6, -6], [7, -3],
];
/** Each car's spot in the crossing, by how many cars, as offsets from its centre in tenths of a tile. */
const SPOTS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 0]],
  [[-5, 0], [5, 0]],
  [[-5, -4], [5, -4], [0, 5]],
  [[-5, -5], [5, -5], [-5, 5], [5, 5]],
];
/** The donut's radius (tiles) and how long one turn takes (ms, a little longer for each car after the first). */
const RADIUS = 0.3;
const TURN_MS = 1100;

export interface DonutPose {
  /** Tile coordinates of the car's centre. */
  x: number;
  y: number;
  /** Heading, 0 = N, clockwise (snesAgents dir8). */
  dir8: number;
  /** Body colour (snesAgents car tint). */
  tint: number;
}

/** The cars of a sideshow over `site` (the crossing grown by a tile) at time `t` ms. */
export function donutPoses(site: { x: number; y: number; w: number; h: number }, cars: number, seed: number, t: number): DonutPose[] {
  const n = Math.max(1, Math.min(SPOTS.length, cars));
  const cx = site.x + site.w / 2;
  const cy = site.y + site.h / 2;
  const spread = Math.min(1, (Math.min(site.w, site.h) - 2) / 2); // a lone crossing keeps its cars close
  return SPOTS[n - 1]!.map(([ox, oy], i) => {
    const turn = TURN_MS + i * 170;
    const step = Math.floor((((t + i * 313) % turn) + turn) % turn * 16 / turn);
    const clockwise = i % 2 === 0;
    const p = clockwise ? step : (16 - step) % 16; // where on its circle, 0 = east
    const [dx, dy] = CIRCLE[p]!;
    // the radial's heading is 2 + p/2 (in 45°); the path runs 90° round from it, the body slewed 45° further in
    const dir8 = ((clockwise ? 5 + (p >> 1) : (p >> 1) - 1) % 8 + 8) % 8;
    return {
      x: cx + (ox / 10) * spread + (dx / 8) * RADIUS,
      y: cy + (oy / 10) * spread + (dy / 8) * RADIUS,
      dir8,
      tint: hash2(i, 5, seed) % AGENT_TINTS,
    };
  });
}

/** How dark a crossing tile's tire marks read (0 none … 3 a dark tangle) for its mark stock (0..255). */
export function skidLevel(skids: number): number {
  return skids >= 200 ? 3 : skids >= 100 ? 2 : skids >= 30 ? 1 : 0;
}
