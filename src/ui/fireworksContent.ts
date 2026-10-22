// Fireworks (PURE — pure-ui allowlist; interdependence §6, Maddy 2026-10-21): at a festival's night, bursts over the
// park in the light pipeline — one art pixel per spark, palette colours, drawn after the lighting pass so they glow.
// A burst launches every BURST_EVERY_MS (jittered), rises as a single spark with a short trail, then opens into a
// ring of sparks that grows, sags and thins. Deterministic in (seed, time); integer math and a fixed direction
// table — no transcendental Math.

import { BASE_TILE } from './camera';
import { hash2, type RGB } from './pixelArt';
import { C } from './snesPalette';

export const BURST_EVERY_MS = 900;
export const BURST_LIFE_MS = 1900;
const RISE_MS = 450;
/** Up to this much later than its slot a burst goes up (ms). */
const JITTER_MS = 400;
/** The burst colours: warm gold, red, sky blue, leaf green, white. */
export const SPARK_COLOURS: readonly RGB[] = [C.flower, C.signal, C.roofBlueHi, C.leafHi, C.petal];
/** Twelve directions round a circle, ×8 (integer: an octagon-ish ring that reads as round at this size). */
const DIRS: readonly (readonly [number, number])[] = [
  [8, 0], [7, 4], [4, 7], [0, 8], [-4, 7], [-7, 4], [-8, 0], [-7, -4], [-4, -7], [0, -8], [4, -7], [7, -4],
];

export interface Spark {
  /** World art pixels (BASE_TILE per tile). */
  x: number;
  y: number;
  colour: RGB;
}

/** Burst k's launch time (ms) for festival `seed`. */
const launchAt = (seed: number, k: number): number => k * BURST_EVERY_MS + (hash2(k, 1, seed) % JITTER_MS);

/** The sparks in the sky over `site` (tiles) at time `t` (ms) for festival `seed`; `only` draws just burst k. */
export function fireworkSparks(site: { x: number; y: number; w: number; h: number }, seed: number, t: number, only?: number): Spark[] {
  const out: Spark[] = [];
  const kLast = Math.floor(t / BURST_EVERY_MS);
  const kFirst = Math.max(0, Math.floor((t - BURST_LIFE_MS - JITTER_MS) / BURST_EVERY_MS));
  const X0 = site.x * BASE_TILE;
  const Y0 = site.y * BASE_TILE;
  const W = site.w * BASE_TILE;
  const H = site.h * BASE_TILE;
  for (let k = kFirst; k <= kLast; k++) {
    if (only !== undefined && k !== only) continue;
    const age = t - launchAt(seed, k);
    if (age < 0 || age >= BURST_LIFE_MS) continue;
    const h = hash2(k, 2, seed);
    const gx = X0 + (h % Math.max(1, W)); // launched from the park
    const gy = Y0 + H - 2;
    const peak = 30 + ((h >>> 8) % 28); // art px above the ground
    const colour = SPARK_COLOURS[(h >>> 16) % SPARK_COLOURS.length]!;
    if (age < RISE_MS) {
      const y = gy - Math.floor((peak * age) / RISE_MS);
      out.push({ x: gx, y, colour: C.flower }, { x: gx, y: y + 2, colour: C.gold }); // the shell and its trail
      continue;
    }
    const a = age - RISE_MS; // ms since it opened
    const span = BURST_LIFE_MS - RISE_MS;
    const radius = 4 + Math.floor((12 * a) / span) + ((h >>> 20) % 4); // grows to ~16 px
    const sag = Math.floor((6 * a * a) / (span * span)); // falls as it fades
    const cy = gy - peak;
    for (let i = 0; i < DIRS.length; i++) {
      // thinning: past half its life a spark drops out, a different few each 100 ms (twinkle)
      if (a > span / 2 && hash2(i, Math.floor(a / 100), h) % span < a - span / 2) continue;
      const [dx, dy] = DIRS[i]!;
      out.push({ x: gx + Math.floor((dx * radius) / 8), y: cy + Math.floor((dy * radius) / 8) + sag, colour });
      // an inner ring, half the radius, while it's fresh
      if (a < span / 3 && i % 2 === 0) out.push({ x: gx + Math.floor((dx * radius) / 16), y: cy + Math.floor((dy * radius) / 16) + sag, colour: C.petal });
    }
  }
  return out;
}

/** How many bursts of festival `seed` launch in (t0, t1] ms — the host plays one soft pop each. */
export function launchesBetween(seed: number, t0: number, t1: number): number {
  if (t1 <= t0) return 0;
  let n = 0;
  for (let k = Math.max(0, Math.floor((t0 - JITTER_MS) / BURST_EVERY_MS)); k <= Math.floor(t1 / BURST_EVERY_MS); k++) {
    const at = launchAt(seed, k);
    if (at > t0 && at <= t1) n++;
  }
  return n;
}
