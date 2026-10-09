// Pan/zoom camera. Pure math (no DOM) so it is fully unit-testable; the
// renderer and input layers are thin shells over this. World coordinates are
// in tiles (fractional allowed); screen coordinates are in CSS pixels. A tile
// is BASE_TILE * zoom pixels wide, with zoom an integer in [1, 4] for crisp
// pixel-art scaling — and, on a sharp screen, ½ or ⅓ (zoomLevels).

import { clamp } from '../engine/clamp';

export const BASE_TILE = 16;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** Zoom-outs below 1, offered where an art pixel still covers at least one device pixel. */
const FRACTIONAL_ZOOMS = [1 / 3, 1 / 2];

/** The zoom levels a display of `dpr` device px per CSS px offers, out to in: below 1 only down to one art pixel per
 *  device pixel — ½ on a 2× screen, ⅓ on a 3× (Maddy 2026-10-08: a phone at zoom 1 saw ~24 of 128 tiles). */
export function zoomLevels(dpr: number): number[] {
  return [...FRACTIONAL_ZOOMS.filter((z) => z * dpr >= 1 - 1e-9), ...[1, 2, 3, 4].filter((z) => z >= MIN_ZOOM && z <= MAX_ZOOM)];
}

/** The level of `levels` nearest `zoom` (by ratio, so ½ and 1 are as far apart as 1 and 2). */
function nearestLevel(levels: readonly number[], zoom: number): number {
  let best = levels[0]!;
  for (const z of levels) if (Math.abs(Math.log2(z / zoom)) < Math.abs(Math.log2(best / zoom)) - 1e-9) best = z;
  return best;
}

export interface CameraOptions {
  mapWidth: number;
  mapHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  x?: number;
  y?: number;
  zoom?: number;
  /** Device pixels per CSS pixel (window.devicePixelRatio). Default 1. */
  dpr?: number;
}

export interface TileRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Camera {
  /** World tile coordinate at screen (0, 0) — the top-left of the viewport. */
  x: number;
  y: number;
  zoom: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Device pixels per CSS pixel: tile edges snap to whole DEVICE pixels, so a fractional display scale (Windows at
   *  125–225%) never puts an edge mid-pixel (Maddy 2026-10-08: seams on a 5K display). */
  dpr: number;

  constructor(opts: CameraOptions) {
    this.mapWidth = opts.mapWidth;
    this.mapHeight = opts.mapHeight;
    this.viewportWidth = opts.viewportWidth;
    this.viewportHeight = opts.viewportHeight;
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.dpr = opts.dpr && opts.dpr > 0 ? opts.dpr : 1;
    this.zoom = nearestLevel(zoomLevels(this.dpr), opts.zoom ?? 2);
    this.clampPosition();
  }

  /** A tile's edge in CSS px: zoom × BASE_TILE, rounded to a whole number of DEVICE pixels — at a scale where that
   *  isn't whole (a 5K display at 225%, or Windows' not-quite 2.2000000476837), tiles of N.25 device px could never
   *  abut and left a seam every few tiles (Maddy 2026-10-08). At most half a device pixel off the nominal size. */
  get tileSize(): number {
    return Math.max(1, Math.round(this.zoom * BASE_TILE * this.dpr)) / this.dpr;
  }

  worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
    const ts = this.tileSize;
    return { sx: (wx - this.x) * ts, sy: (wy - this.y) * ts };
  }

  /**
   * Integer screen origin of tile (tx, ty) for the tile grid. floor(worldToScreen) alone lets float
   * error land one tile at 165.9999 → 165 and its neighbour at 166.0000001 → 166, opening a 1-px
   * background seam between rows; a sub-pixel epsilon snaps both onto the true integer edge. The integer is in
   * DEVICE pixels (returned in CSS px, so a multiple of 1/dpr): at a fractional scale a whole CSS pixel is not a
   * whole device pixel. Tiles abut whenever tileSize × dpr is whole (every common scale: 1.25, 1.5, 1.75, 2.25…).
   */
  tileOrigin(tx: number, ty: number): { dx: number; dy: number } {
    const ts = this.tileSize;
    const d = this.dpr;
    return { dx: Math.floor((tx - this.x) * ts * d + 1e-6) / d, dy: Math.floor((ty - this.y) * ts * d + 1e-6) / d };
  }

  screenToWorld(sx: number, sy: number): { wx: number; wy: number } {
    const ts = this.tileSize;
    return { wx: this.x + sx / ts, wy: this.y + sy / ts };
  }

  /** Pan by a screen-pixel delta (grab-and-drag: content follows the cursor). */
  pan(dxScreen: number, dyScreen: number): void {
    const ts = this.tileSize;
    this.x -= dxScreen / ts;
    this.y -= dyScreen / ts;
    this.clampPosition();
  }

  /** Zoom one integer step (dir +1 in, -1 out), keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, dir: number): void {
    const levels = zoomLevels(this.dpr);
    const at = levels.indexOf(nearestLevel(levels, this.zoom));
    const next = levels[clamp(at + (dir > 0 ? 1 : -1), 0, levels.length - 1)]!;
    if (next === this.zoom) return;
    const before = this.screenToWorld(sx, sy);
    this.zoom = next;
    const ts = this.tileSize;
    this.x = before.wx - sx / ts;
    this.y = before.wy - sy / ts;
    this.clampPosition();
  }

  /** The window moved to a display of another scale: tiles re-snap to its device pixels, and a zoom it can't offer
   *  (½ on a 1× screen) snaps to one it can. */
  setDpr(dpr: number): void {
    this.dpr = dpr > 0 ? dpr : 1;
    this.zoom = nearestLevel(zoomLevels(this.dpr), this.zoom);
    this.clampPosition();
  }

  /** Center the view on world tile (wx, wy), optionally setting the zoom first
   *  (snapped to the nearest level this display offers — zoomLevels). The position is
   *  clamped to the map, so a target near an edge lands as close to centre as the
   *  map allows. The zoom-to-location API behind `window.bodhgaia.focus`. */
  centerOn(wx: number, wy: number, zoom?: number): void {
    if (zoom !== undefined) this.zoom = nearestLevel(zoomLevels(this.dpr), zoom);
    const ts = this.tileSize;
    this.x = wx - this.viewportWidth / ts / 2;
    this.y = wy - this.viewportHeight / ts / 2;
    this.clampPosition();
  }

  /** Resize the viewport (e.g. on window resize) and re-clamp the position. */
  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.clampPosition();
  }

  /** Inclusive range of tiles currently visible, clamped to the map. */
  visibleTileRange(): TileRange {
    const ts = this.tileSize;
    const x0 = clamp(Math.floor(this.x), 0, this.mapWidth - 1);
    const y0 = clamp(Math.floor(this.y), 0, this.mapHeight - 1);
    const x1 = clamp(Math.floor(this.x + this.viewportWidth / ts), 0, this.mapWidth - 1);
    const y1 = clamp(Math.floor(this.y + this.viewportHeight / ts), 0, this.mapHeight - 1);
    return { x0, y0, x1, y1 };
  }

  private clampPosition(): void {
    const ts = this.tileSize;
    // a map narrower (or shorter) than the screen sits in the middle of it, not pinned to the corner
    const spareX = this.mapWidth - this.viewportWidth / ts;
    const spareY = this.mapHeight - this.viewportHeight / ts;
    this.x = spareX < 0 ? spareX / 2 : clamp(this.x, 0, spareX);
    this.y = spareY < 0 ? spareY / 2 : clamp(this.y, 0, spareY);
  }
}
