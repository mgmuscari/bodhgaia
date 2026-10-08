// One frame's mover poses, culled to the view BEFORE posing and computed once for both renderers.
//
// Posing is the expensive part of drawing an agent (pedPose / carPose blend the mover's pose with its
// pre-substep snapshot), and it used to run for every agent on the map — and 3–4× per car per frame
// across the Canvas2D sprite pass and the GPU glow pass. Here each mover near the view is posed once;
// the sprite pass applies its exact on-screen test to the pose, and the glow pass reads the same array.
//
// Pure: no DOM, no transcendental Math.
import { carPose, pedPose, type Pose } from '../live/poses';
import type { AmbientState, Mover } from '../live/types';
import { offStreet } from '../live/types';

/** A draw pose sits strictly less than this many tiles from its mover's raw (x, y) on each axis: the
 *  pose rides at most a tile and a half off the sim position, and an interpolated pose is blended from
 *  a snapshot no further than 1.5 tiles from it (a longer jump is a teleport that takes the new pose). */
export const POSE_REACH = 4;

/** An axis-aligned world-space rectangle, in tiles (inclusive). */
export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The world rect a `cssW`×`cssH` view shows from camera position (camX, camY) at `tileSize` px per
 *  tile, grown by `margin` tiles on every side. */
export function viewRect(camX: number, camY: number, tileSize: number, cssW: number, cssH: number, margin: number): WorldRect {
  return { x0: camX - margin, y0: camY - margin, x1: camX + cssW / tileSize + margin, y1: camY + cssH / tileSize + margin };
}

export function inRect(r: WorldRect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

export interface Posed {
  m: Mover;
  pose: Pose;
}

/** This frame's posed movers near the view, each list in its ambient list's order. */
export interface FramePoses {
  alpha: number;
  cars: Posed[];
  cruisers: Posed[];
  peds: Posed[];
  /** The population sizes it was computed from — a change marks it stale. */
  counts: readonly [number, number, number];
}

/**
 * Pose every car, cruiser and visible pedestrian (not inside a building or riding its car) whose raw
 * position lies within `view` grown by {@link POSE_REACH} — so every mover whose POSE lands in `view`
 * is included (callers still test the pose itself), and the rest are never posed.
 */
export function computeFramePoses(
  ambient: AmbientState,
  view: WorldRect,
  alpha: number,
  onRoadAt: (x: number, y: number) => boolean,
): FramePoses {
  const near: WorldRect = { x0: view.x0 - POSE_REACH, y0: view.y0 - POSE_REACH, x1: view.x1 + POSE_REACH, y1: view.y1 + POSE_REACH };
  const cars: Posed[] = [];
  for (const m of ambient.cars) if (inRect(near, m.x, m.y)) cars.push({ m, pose: carPose(m, alpha) });
  const cruisers: Posed[] = [];
  for (const m of ambient.cruisers) if (inRect(near, m.x, m.y)) cruisers.push({ m, pose: carPose(m, alpha) });
  const peds: Posed[] = [];
  for (const m of ambient.peds) {
    if (offStreet(m)) continue; // inside a building, driving its car, or riding a tram or train
    if (inRect(near, m.x, m.y)) peds.push({ m, pose: pedPose(m, onRoadAt, alpha) });
  }
  return { alpha, cars, cruisers, peds, counts: [ambient.cars.length, ambient.cruisers.length, ambient.peds.length] };
}

const shared = new WeakMap<AmbientState, FramePoses>();

/** Publish this frame's poses for the other render pass to reuse. */
export function shareFramePoses(ambient: AmbientState, fp: FramePoses): void {
  shared.set(ambient, fp);
}

/** The poses last shared for `ambient`, or null if none or they no longer describe it (another
 *  interpolation point, or the population changed since). */
export function sharedFramePoses(ambient: AmbientState, alpha: number): FramePoses | null {
  const fp = shared.get(ambient);
  if (!fp || fp.alpha !== alpha) return null;
  const [c, k, p] = fp.counts;
  return c === ambient.cars.length && k === ambient.cruisers.length && p === ambient.peds.length ? fp : null;
}
