// Headlight casting (PURE — pure-ui allowlist). Each lamp throws a ray forward from the front bumper and
// stops at the first thing it meets — another vehicle or a person (an oriented body), or a building wall
// — instead of laying a fixed beam over everything (Maddy 2026-09-30). What it hits gets lit: the GPU
// glow cuts the cone at `cut` and splashes a wall; the sprite layer lights the near side of a hit body.
// The march steps one art pixel at a time, so every cut lands on the art grid (artGrid.ts).

import type { GameMap } from '../engine/map';
import { BuiltKind, isTransportKind } from '../engine/fabric';
import { ART_PX } from './artGrid';

/** How far a headlight reaches (tiles). */
export const BEAM_REACH = 1.7;
/** Lamp placement from the body centre: forward to the bumper, and out to each side. */
const LAMP_FORWARD = 0.18;
const LAMP_SIDE = 0.11;

/** A sprite body light can stop at: centre, unit heading, length × width (tiles); `lights` = it casts. */
export interface Body {
  x: number;
  y: number;
  hx: number;
  hy: number;
  len: number;
  wid: number;
  lights: boolean;
}

/** One lamp's ray: origin, unit direction, how far it got, and what stopped it. */
export interface Beam {
  x: number;
  y: number;
  fx: number;
  fy: number;
  cut: number;
  hit: 'none' | 'body' | 'wall';
  /** The body index it stopped at (hit === 'body'), else -1. */
  target: number;
  /** Which body cast it. */
  source: number;
}

/** How brightly a body is lit, and the direction the light travels (to light its near side). */
export interface Lit {
  light: number;
  fx: number;
  fy: number;
  /** The body whose lamp lights it most. */
  source: number;
}

/** Built kinds that are open ground — light passes over them (parks, gardens, lots, medians). */
const OPEN_KINDS: ReadonlySet<number> = new Set([
  BuiltKind.ParkingLot,
  BuiltKind.Parklet,
  BuiltKind.CommunityGarden,
  BuiltKind.Park,
  BuiltKind.RewildedLand,
]);

/** A structure that stops light: any built parcel that isn't transport or open ground. */
function wallAt(map: GameMap, tx: number, ty: number): boolean {
  const k = map.built[map.idx(tx, ty)]!;
  return k !== BuiltKind.None && !isTransportKind(k) && !OPEN_KINDS.has(k);
}

function inside(b: Body, x: number, y: number): boolean {
  const dx = x - b.x;
  const dy = y - b.y;
  const along = dx * b.hx + dy * b.hy;
  const across = -dx * b.hy + dy * b.hx;
  return Math.abs(along) <= b.len / 2 && Math.abs(across) <= b.wid / 2;
}

/** Cast every lit body's two headlights against the map and the other bodies. */
export function castHeadlights(map: GameMap, bodies: readonly Body[], reach = BEAM_REACH): { beams: Beam[]; lit: Map<number, Lit> } {
  // bucket bodies by every tile their bounding circle touches, so a ray step checks only its own tile
  const W = map.width;
  const grid = new Map<number, number[]>();
  bodies.forEach((b, i) => {
    const r = Math.sqrt(b.len * b.len + b.wid * b.wid) / 2;
    for (let ty = Math.floor(b.y - r); ty <= Math.floor(b.y + r); ty++) {
      for (let tx = Math.floor(b.x - r); tx <= Math.floor(b.x + r); tx++) {
        if (!map.inBounds(tx, ty)) continue;
        const k = ty * W + tx;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
    }
  });

  const beams: Beam[] = [];
  const lit = new Map<number, Lit>();
  const step = 1 / ART_PX;
  bodies.forEach((b, src) => {
    if (!b.lights) return;
    const sx = -b.hy; // the body's right-hand side
    const sy = b.hx;
    for (const side of [-1, 1]) {
      const x = b.x + b.hx * LAMP_FORWARD + sx * LAMP_SIDE * side;
      const y = b.y + b.hy * LAMP_FORWARD + sy * LAMP_SIDE * side;
      const beam: Beam = { x, y, fx: b.hx, fy: b.hy, cut: reach, hit: 'none', target: -1, source: src };
      for (let n = 1; n * step <= reach + 1e-9; n++) {
        const d = n * step;
        const px = x + b.hx * d;
        const py = y + b.hy * d;
        const tx = Math.floor(px);
        const ty = Math.floor(py);
        if (!map.inBounds(tx, ty)) {
          beam.cut = d;
          break;
        }
        if (wallAt(map, tx, ty)) {
          beam.cut = d;
          beam.hit = 'wall';
          break;
        }
        const hitBody = (grid.get(ty * W + tx) ?? []).find((j) => j !== src && inside(bodies[j]!, px, py));
        if (hitBody !== undefined) {
          beam.cut = d;
          beam.hit = 'body';
          beam.target = hitBody;
          const light = 1 - d / reach; // nearer is brighter
          const prev = lit.get(hitBody);
          if (!prev || light > prev.light) lit.set(hitBody, { light, fx: b.hx, fy: b.hy, source: src });
          break;
        }
      }
      beams.push(beam);
    }
  });
  return { beams, lit };
}
