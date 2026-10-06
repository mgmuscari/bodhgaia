// Live-layer BIRDS: flocks spawned over fauna-rich land, steered as a boids flock (cohesion,
// alignment, separation) with an integer-only update. Cut verbatim from ui/ambientContent.ts.

import type { GameMap } from '../engine/map';
import type { Rng } from '../engine/rng';
import { liveCaps } from './caps';
import {
  BIRD_ALIGN,
  BIRD_COHESION,
  BIRD_MAX_SPEED,
  BIRD_SEPARATION,
  BIRD_SEP_RADIUS2,
  FLOCK_MAX,
  FLOCK_MIN,
  SAMPLES_PER_SUBSTEP,
} from './tuning';
import type { AmbientState, Bird, Flock } from './types';
import { birdSpawnAt } from './network';

/** A flock's representative tile = its (in-bounds-clamped) centre of mass. */
export function flockTile(map: GameMap, f: Flock): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  for (const b of f.birds) {
    cx += b.x;
    cy += b.y;
  }
  const n = f.birds.length;
  const x = Math.min(map.width - 1, Math.max(0, Math.floor(cx / n)));
  const y = Math.min(map.height - 1, Math.max(0, Math.floor(cy / n)));
  return { x, y };
}

/** Advance one flock by one boids substep (cohesion + alignment + separation). */
export function advanceFlock(f: Flock): void {
  const n = f.birds.length;
  if (n === 0) return;
  let cx = 0;
  let cy = 0;
  let avx = 0;
  let avy = 0;
  for (const b of f.birds) {
    cx += b.x;
    cy += b.y;
    avx += b.vx;
    avy += b.vy;
  }
  cx /= n;
  cy /= n;
  avx /= n;
  avy /= n;
  for (const b of f.birds) {
    let ax = (cx - b.x) * BIRD_COHESION + (avx - b.vx) * BIRD_ALIGN;
    let ay = (cy - b.y) * BIRD_COHESION + (avy - b.vy) * BIRD_ALIGN;
    for (const o of f.birds) {
      if (o === b) continue;
      const dx = b.x - o.x;
      const dy = b.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < BIRD_SEP_RADIUS2) {
        const d = Math.sqrt(d2);
        ax += (dx / d) * (BIRD_SEPARATION / d);
        ay += (dy / d) * (BIRD_SEPARATION / d);
      }
    }
    b.vx += ax;
    b.vy += ay;
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (sp > BIRD_MAX_SPEED) {
      b.vx = (b.vx / sp) * BIRD_MAX_SPEED;
      b.vy = (b.vy / sp) * BIRD_MAX_SPEED;
    }
    b.x += b.vx;
    b.y += b.vy;
  }
}

/** A fresh random in-bounds tile (2 rng draws). */
export function sampleTile(map: GameMap, rng: Rng): { x: number; y: number } {
  return { x: rng.nextInt(map.width), y: rng.nextInt(map.height) };
}

export function spawnFlocks(state: AmbientState, map: GameMap, rng: Rng): void {
  for (let s = 0; s < SAMPLES_PER_SUBSTEP; s++) {
    if (state.birds.length >= liveCaps.flockCap) return;
    const { x, y } = sampleTile(map, rng);
    if (!birdSpawnAt(map, x, y)) continue;
    const size = FLOCK_MIN + rng.nextInt(FLOCK_MAX - FLOCK_MIN + 1);
    const birds: Bird[] = [];
    for (let i = 0; i < size; i++) {
      birds.push({
        x: x + (rng.next() - 0.5),
        y: y + (rng.next() - 0.5),
        vx: (rng.next() - 0.5) * BIRD_MAX_SPEED,
        vy: (rng.next() - 0.5) * BIRD_MAX_SPEED,
      });
    }
    state.birds.push({ birds });
  }
}
