// Parking-lot geometry (cosmetic, pure, allowlisted): every ParkingLot TILE is its own lot, and
// the per-tile stall grid the ambient layer stores parked cars on. Reads the map only — no DOM, no
// rng, no transcendental Math; stable per map so parked cars don't flicker.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';

/** Stall grid per lot TILE: STALL_COLS × STALL_ROWS bays with cars parked EAST-WEST, sized so a whole
 *  car (≈0.44 long × 0.24 wide) fits every bay with no overlap, even across adjacent lot tiles — a 0.5
 *  column pitch holds the length, a ⅓ row pitch the width (Maddy 2026-09-30: bounding boxes, no
 *  overlap; the old 3×3 grid packed 0.44-long cars at a 0.33 pitch). */
export const STALL_COLS = 2;
export const STALL_ROWS = 3;
export const STALLS_PER_TILE = STALL_COLS * STALL_ROWS;

/** A single ParkingLot tile (a 1×1 lot). The x0/y0/x1/y1 box is the tile itself — there is no
 *  multi-tile component, so a lot's box can never spill onto a non-lot tile (Maddy). */
export interface Lot {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Map width, so `tiles` (map indices) can be decomposed to (x,y). */
  w: number;
  tiles: number[];
}

/** Every ParkingLot tile as its OWN 1×1 lot. (Was 4-connected blobs, whose bounding box could span a
 *  road between two arms and put cars mid-street — Maddy: "fine to just have a giant swath of single
 *  tile lots".) A big parking area is simply many adjacent 1×1 lots; capacity + packing are identical. */
export function parkingLots(map: GameMap): Lot[] {
  const lots: Lot[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = map.idx(x, y);
      if (map.built[i] !== BuiltKind.ParkingLot) continue;
      lots.push({ x0: x, y0: y, x1: x, y1: y, w: map.width, tiles: [i] });
    }
  }
  return lots;
}

/** Stall centres in WORLD tile coordinates (pass straight to camera.worldToScreen): a
 *  STALL_COLS×STALL_ROWS sub-grid inside each ACTUAL lot tile (not the bounding box — a
 *  bbox over an L-shaped / split lot spills onto non-lot tiles like a road running through it, which
 *  would put cars mid-street: Maddy "lot bounding box should not spill into non-lot tiles"). Each
 *  stall sits at the same fractional offset within its tile so cars pack cleanly and tile-aligned
 *  regardless of lot shape. Deterministic over the lot's tile list. */
export function parkingStalls(lot: Lot): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const idx of lot.tiles) {
    const tx = idx % lot.w;
    const ty = (idx - tx) / lot.w;
    for (let r = 0; r < STALL_ROWS; r++) {
      for (let c = 0; c < STALL_COLS; c++) {
        out.push({ x: tx + (c + 0.5) / STALL_COLS, y: ty + (r + 0.5) / STALL_ROWS });
      }
    }
  }
  return out;
}
