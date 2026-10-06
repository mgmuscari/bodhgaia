// Pan/zoom camera. Pure math (no DOM) so it is fully unit-testable; the
// renderer and input layers are thin shells over this. World coordinates are
// in tiles (fractional allowed); screen coordinates are in CSS pixels. A tile
// is BASE_TILE * zoom pixels wide, with zoom an integer in [1, 4] for crisp
// pixel-art scaling.

import { clamp } from '../engine/clamp';

export const BASE_TILE = 16;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface CameraOptions {
  mapWidth: number;
  mapHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  x?: number;
  y?: number;
  zoom?: number;
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

  constructor(opts: CameraOptions) {
    this.mapWidth = opts.mapWidth;
    this.mapHeight = opts.mapHeight;
    this.viewportWidth = opts.viewportWidth;
    this.viewportHeight = opts.viewportHeight;
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.zoom = clamp(Math.round(opts.zoom ?? 2), MIN_ZOOM, MAX_ZOOM);
    this.clampPosition();
  }

  get tileSize(): number {
    return this.zoom * BASE_TILE;
  }

  worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
    const ts = this.tileSize;
    return { sx: (wx - this.x) * ts, sy: (wy - this.y) * ts };
  }

  /**
   * Integer screen origin of tile (tx, ty) for the tile grid. floor(worldToScreen) alone lets float
   * error land one tile at 165.9999 → 165 and its neighbour at 166.0000001 → 166, opening a 1-px
   * background seam between rows; a sub-pixel epsilon snaps both onto the true integer edge.
   */
  tileOrigin(tx: number, ty: number): { dx: number; dy: number } {
    const ts = this.tileSize;
    return { dx: Math.floor((tx - this.x) * ts + 1e-6), dy: Math.floor((ty - this.y) * ts + 1e-6) };
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
    const next = clamp(this.zoom + (dir > 0 ? 1 : -1), MIN_ZOOM, MAX_ZOOM);
    if (next === this.zoom) return;
    const before = this.screenToWorld(sx, sy);
    this.zoom = next;
    const ts = this.tileSize;
    this.x = before.wx - sx / ts;
    this.y = before.wy - sy / ts;
    this.clampPosition();
  }

  /** Center the view on world tile (wx, wy), optionally setting the zoom first
   *  (rounded to an integer and clamped to [MIN_ZOOM, MAX_ZOOM]). The position is
   *  clamped to the map, so a target near an edge lands as close to centre as the
   *  map allows. The zoom-to-location API behind `window.bodhitropolis.focus`. */
  centerOn(wx: number, wy: number, zoom?: number): void {
    if (zoom !== undefined) this.zoom = clamp(Math.round(zoom), MIN_ZOOM, MAX_ZOOM);
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
    const maxX = Math.max(0, this.mapWidth - this.viewportWidth / ts);
    const maxY = Math.max(0, this.mapHeight - this.viewportHeight / ts);
    this.x = clamp(this.x, 0, maxX);
    this.y = clamp(this.y, 0, maxY);
  }
}
