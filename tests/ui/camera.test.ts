import { describe, it, expect } from 'vitest';
import { Camera, BASE_TILE, MIN_ZOOM, MAX_ZOOM } from '../../src/ui/camera';

function makeCamera(overrides: Partial<ConstructorParameters<typeof Camera>[0]> = {}) {
  return new Camera({
    mapWidth: 128,
    mapHeight: 128,
    viewportWidth: 640,
    viewportHeight: 480,
    x: 10,
    y: 10,
    zoom: 2,
    ...overrides,
  });
}

describe('Camera transforms', () => {
  it('tileSize is zoom * BASE_TILE', () => {
    const cam = makeCamera({ zoom: 3 });
    expect(cam.tileSize).toBe(3 * BASE_TILE);
  });

  it('worldToScreen/screenToWorld round-trip at every zoom level', () => {
    for (const zoom of [1, 2, 3, 4]) {
      const cam = makeCamera({ zoom, x: 12, y: 7 });
      const wx = 40.5;
      const wy = 22.25;
      const s = cam.worldToScreen(wx, wy);
      const w = cam.screenToWorld(s.sx, s.sy);
      expect(w.wx).toBeCloseTo(wx, 6);
      expect(w.wy).toBeCloseTo(wy, 6);
    }
  });
});

describe('Camera zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    // Large map, interior point -> clamping does not interfere.
    const cam = new Camera({
      mapWidth: 256,
      mapHeight: 256,
      viewportWidth: 640,
      viewportHeight: 480,
      x: 100,
      y: 100,
      zoom: 2,
    });
    const sx = 320;
    const sy = 240;
    const before = cam.screenToWorld(sx, sy);
    cam.zoomAt(sx, sy, +1);
    expect(cam.zoom).toBe(3);
    const after = cam.screenToWorld(sx, sy);
    expect(after.wx).toBeCloseTo(before.wx, 6);
    expect(after.wy).toBeCloseTo(before.wy, 6);
  });

  it('clamps zoom at the min and max levels', () => {
    const cam = makeCamera({ zoom: 1 });
    cam.zoomAt(0, 0, -1);
    expect(cam.zoom).toBe(1);

    const cam2 = makeCamera({ zoom: 4 });
    cam2.zoomAt(0, 0, +1);
    expect(cam2.zoom).toBe(4);
  });

  it('steps zoom one integer level at a time', () => {
    const cam = makeCamera({ zoom: 2 });
    cam.zoomAt(100, 100, +1);
    expect(cam.zoom).toBe(3);
    cam.zoomAt(100, 100, +1);
    expect(cam.zoom).toBe(4);
    cam.zoomAt(100, 100, -1);
    expect(cam.zoom).toBe(3);
  });
});

describe('Camera pan clamping', () => {
  // zoom 2 -> tileSize 32; viewport 640x480 -> 20x15 visible tiles;
  // maxX = 128 - 20 = 108, maxY = 128 - 15 = 113.
  it('clamps at the left/top edges', () => {
    const cam = makeCamera({ x: 50, y: 50 });
    cam.pan(100000, 100000); // huge positive screen drag -> camera toward origin
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
  });

  it('clamps at the right/bottom edges', () => {
    const cam = makeCamera({ x: 50, y: 50 });
    cam.pan(-100000, -100000);
    expect(cam.x).toBeCloseTo(108, 6);
    expect(cam.y).toBeCloseTo(113, 6);
  });

  it('pans freely within bounds', () => {
    const cam = makeCamera({ x: 50, y: 50 });
    cam.pan(-32, -32); // one tile worth at zoom 2
    expect(cam.x).toBeCloseTo(51, 6);
    expect(cam.y).toBeCloseTo(51, 6);
  });
});

describe('Camera setViewport', () => {
  it('re-clamps an out-of-bounds position when the viewport grows', () => {
    // zoom 2 -> tileSize 32. Small 320px viewport -> 10 tiles visible,
    // maxX = maxY = 128 - 10 = 118, so x,y sit exactly on the far edge.
    const cam = new Camera({
      mapWidth: 128,
      mapHeight: 128,
      viewportWidth: 320,
      viewportHeight: 320,
      x: 118,
      y: 118,
      zoom: 2,
    });
    expect(cam.x).toBeCloseTo(118, 6);
    expect(cam.y).toBeCloseTo(118, 6);

    // Growing to 640px -> 20 tiles visible, maxX = maxY = 108. The prior
    // edge position is now out of bounds and must be re-clamped.
    cam.setViewport(640, 640);
    expect(cam.viewportWidth).toBe(640);
    expect(cam.viewportHeight).toBe(640);
    expect(cam.x).toBeCloseTo(108, 6);
    expect(cam.y).toBeCloseTo(108, 6);
  });
});

describe('Camera visibleTileRange', () => {
  it('reports the inclusive visible tile bounds, clamped to the map', () => {
    const cam = makeCamera({ x: 10, y: 10, zoom: 2 });
    const r = cam.visibleTileRange();
    expect(r.x0).toBe(10);
    expect(r.y0).toBe(10);
    expect(r.x1).toBeLessThanOrEqual(127);
    expect(r.y1).toBeLessThanOrEqual(127);
    expect(r.x1).toBeGreaterThan(r.x0);
  });
});

describe('Camera centerOn (zoom-to-location API)', () => {
  it('puts the target world tile at the viewport centre (interior, unclamped)', () => {
    const cam = makeCamera({ x: 0, y: 0, zoom: 2 });
    cam.centerOn(64, 64);
    const c = cam.screenToWorld(cam.viewportWidth / 2, cam.viewportHeight / 2);
    expect(c.wx).toBeCloseTo(64, 6);
    expect(c.wy).toBeCloseTo(64, 6);
  });

  it('sets zoom when given, rounded and clamped to [MIN_ZOOM, MAX_ZOOM]', () => {
    const cam = makeCamera();
    cam.centerOn(64, 64, 4);
    expect(cam.zoom).toBe(4);
    cam.centerOn(64, 64, 9);
    expect(cam.zoom).toBe(MAX_ZOOM);
    cam.centerOn(64, 64, 0);
    expect(cam.zoom).toBe(MIN_ZOOM);
    cam.centerOn(64, 64, 2.6);
    expect(cam.zoom).toBe(3);
  });

  it('leaves zoom unchanged when omitted', () => {
    const cam = makeCamera({ zoom: 3 });
    cam.centerOn(64, 64);
    expect(cam.zoom).toBe(3);
  });

  it('clamps the view to the map at the corners', () => {
    const cam = makeCamera({ zoom: 2 });
    cam.centerOn(0, 0);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    cam.centerOn(1e6, 1e6);
    const ts = cam.tileSize;
    expect(cam.x).toBeCloseTo(cam.mapWidth - cam.viewportWidth / ts, 6);
    expect(cam.y).toBeCloseTo(cam.mapHeight - cam.viewportHeight / ts, 6);
  });
});

describe('Camera.tileOrigin — seamless tile placement', () => {
  it('consecutive tiles abut exactly (no 1-px background seams from float error)', () => {
    const cam = new Camera({ mapWidth: 128, mapHeight: 128, viewportWidth: 1512, viewportHeight: 716, zoom: 3 });
    // a camera offset whose products land a hair either side of integers (seen live: y = 6.5416…)
    cam.centerOn(45, 14, 3);
    (cam as unknown as { y: number }).y = 6.541666666666667;
    (cam as unknown as { x: number }).x = 29.25;
    const ts = cam.tileSize;
    for (let t = 0; t < 40; t++) {
      expect(cam.tileOrigin(t + 1, t + 1).dy - cam.tileOrigin(t, t).dy, `row ${t}`).toBe(ts);
      expect(cam.tileOrigin(t + 1, t + 1).dx - cam.tileOrigin(t, t).dx, `col ${t}`).toBe(ts);
    }
  });

  // Maddy 2026-10-08, Windows on a 5K display: tile seams. At a fractional display scale (125–225%) a whole CSS pixel
  // is a fraction of a device pixel, so tiles snapped to CSS pixels still met mid-pixel. They snap to device pixels.
  it('at a fractional display scale, every tile edge lands on a whole device pixel and tiles still abut', () => {
    // any scale, the odd ones too: 110%, 133%, and the not-quite values Chrome on Windows reports (Maddy 2026-10-08,
    // 1.0.1 still had a seam every 4 tiles: a tile was N.25 device px wide, so origins could snap but not abut)
    for (const dpr of [1.1, 1.25, 1.3333333, 1.5, 1.75, 2.2000000476837, 2.25, 2.5, 2.6666667, 3]) {
      for (const zoom of [1, 2, 3, 4]) {
        const cam = new Camera({ mapWidth: 128, mapHeight: 128, viewportWidth: 1400, viewportHeight: 800, zoom, dpr });
        (cam as unknown as { x: number }).x = 29.3171;
        (cam as unknown as { y: number }).y = 6.5419;
        const ts = cam.tileSize;
        for (let t = 0; t < 30; t++) {
          const o = cam.tileOrigin(t, t);
          expect(Math.abs(o.dx * dpr - Math.round(o.dx * dpr)), `dpr ${dpr} zoom ${zoom} col ${t}`).toBeLessThan(1e-6);
          expect(Math.abs(o.dy * dpr - Math.round(o.dy * dpr)), `dpr ${dpr} zoom ${zoom} row ${t}`).toBeLessThan(1e-6);
          expect(Math.abs(ts * dpr - Math.round(ts * dpr)), `dpr ${dpr} zoom ${zoom}: whole device px a tile`).toBeLessThan(1e-6);
          expect(cam.tileOrigin(t + 1, t + 1).dx - o.dx).toBeCloseTo(ts, 9);
          expect(cam.tileOrigin(t + 1, t + 1).dy - o.dy).toBeCloseTo(ts, 9);
        }
      }
    }
  });

  it('matches floor(worldToScreen) away from float noise', () => {
    const cam = new Camera({ mapWidth: 64, mapHeight: 64, viewportWidth: 800, viewportHeight: 600, zoom: 2 });
    const { sx, sy } = cam.worldToScreen(10, 7);
    expect(cam.tileOrigin(10, 7)).toEqual({ dx: Math.floor(sx), dy: Math.floor(sy) });
  });
});

// Mobile (Maddy 2026-10-08): zoom 1 shows a phone ~24 tiles of 128. On a sharp screen the camera zooms further out,
// down to one art pixel per device pixel (½ on a 2× screen, ⅓ on a 3×) — still crisp, the whole city in view.
import { zoomLevels } from '../../src/ui/camera';

describe('zooming out past 1 on sharp screens', () => {
  it('the levels a display offers: ½ from 2×, ⅓ from 3×, never below one device pixel an art pixel', () => {
    expect(zoomLevels(1)).toEqual([1, 2, 3, 4]);
    expect(zoomLevels(1.5)).toEqual([1, 2, 3, 4]);
    expect(zoomLevels(2)).toEqual([0.5, 1, 2, 3, 4]);
    expect(zoomLevels(3)).toEqual([1 / 3, 0.5, 1, 2, 3, 4]);
  });

  it('zooming out from 1 on a 2× screen reaches ½, where an art pixel is one device pixel; then stops', () => {
    const cam = new Camera({ mapWidth: 128, mapHeight: 128, viewportWidth: 390, viewportHeight: 700, zoom: 1, dpr: 2 });
    cam.zoomAt(100, 100, -1);
    expect(cam.zoom).toBe(0.5);
    expect((cam.tileSize * 2) / BASE_TILE).toBe(1);
    cam.zoomAt(100, 100, -1);
    expect(cam.zoom).toBe(0.5);
    cam.zoomAt(100, 100, +1);
    expect(cam.zoom).toBe(1);
  });

  it('on a 1× screen, 1 is still the floor', () => {
    const cam = new Camera({ mapWidth: 128, mapHeight: 128, viewportWidth: 800, viewportHeight: 600, zoom: 1, dpr: 1 });
    cam.zoomAt(100, 100, -1);
    expect(cam.zoom).toBe(1);
  });

  it('a zoom asked for (a save from a phone, a tour stop) snaps to one this display offers', () => {
    expect(new Camera({ mapWidth: 64, mapHeight: 64, viewportWidth: 800, viewportHeight: 600, zoom: 0.5, dpr: 1 }).zoom).toBe(1);
    const cam = new Camera({ mapWidth: 64, mapHeight: 64, viewportWidth: 800, viewportHeight: 600, zoom: 2, dpr: 3 });
    cam.centerOn(10, 10, 0.3);
    expect(cam.zoom).toBeCloseTo(1 / 3, 9);
    cam.centerOn(10, 10, 2.4);
    expect(cam.zoom).toBe(2);
  });

  it('a whole map smaller than the screen sits in the middle of it, not pinned to the corner', () => {
    const cam = new Camera({ mapWidth: 64, mapHeight: 64, viewportWidth: 1400, viewportHeight: 800, zoom: 0.5, dpr: 2 });
    const ts = cam.tileSize; // 8 css px: the map is 512 px across
    expect(cam.x).toBeCloseTo((64 - 1400 / ts) / 2, 9);
    expect(cam.y).toBeCloseTo((64 - 800 / ts) / 2, 9);
  });
});

describe('moving to a display of another scale', () => {
  it('a zoom the new display can’t offer snaps to one it can', () => {
    const cam = new Camera({ mapWidth: 64, mapHeight: 64, viewportWidth: 800, viewportHeight: 600, zoom: 0.5, dpr: 2 });
    expect(cam.zoom).toBe(0.5);
    cam.setDpr(1);
    expect(cam.zoom).toBe(1);
  });
});
