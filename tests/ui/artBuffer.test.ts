// The performance pass (Maddy 2026-10-08): the GPU's map and smog passes render one pixel per art pixel — every
// screen pixel inside an art pixel came out the same colour, computed 4× (a phone at zoom 1) to 36× (a desktop at
// zoom 3) over. artBuffer is the geometry: how many art pixels cover the view, the CSS box they stretch to, and the
// shader's mapping from buffer to world and to the cached base.
import { describe, expect, it } from 'vitest';
import { artBuffer } from '../../src/ui/artGrid';
import { Camera } from '../../src/ui/camera';

describe('artBuffer', () => {
  it('one buffer pixel per art pixel, covering the view, stretched to whole art pixels in CSS', () => {
    const cam = new Camera({ mapWidth: 128, mapHeight: 128, viewportWidth: 800, viewportHeight: 600, zoom: 3, dpr: 2 });
    const b = artBuffer(cam, 800, 600);
    const art = cam.tileSize / 16; // 3 css px
    expect(b.w).toBe(Math.ceil(800 / art));
    expect(b.h).toBe(Math.ceil(600 / art));
    expect(b.cssW).toBeCloseTo(b.w * art, 9);
    expect(b.cssW).toBeGreaterThanOrEqual(800);
    expect(b.cssW - 800).toBeLessThan(art);
  });

  it('maps the buffer onto the world from the camera’s drawn origin, and the base over the view', () => {
    const cam = new Camera({ mapWidth: 128, mapHeight: 128, viewportWidth: 800, viewportHeight: 600, zoom: 2, dpr: 2 });
    (cam as unknown as { x: number }).x = 10.0371;
    const b = artBuffer(cam, 800, 600);
    expect(b.origin[0]).toBe(cam.drawX);
    expect(b.view[0]).toBeCloseTo(b.w / 16, 9);
    expect(b.baseView[0]).toBeCloseTo(800 / cam.tileSize, 9);
  });

  it('far less to shade: 36× fewer pixels at zoom 3 on a 2× screen, 4× at zoom 1', () => {
    const at = (zoom: number) => {
      const cam = new Camera({ mapWidth: 512, mapHeight: 512, viewportWidth: 960, viewportHeight: 600, zoom, dpr: 2 });
      const b = artBuffer(cam, 960, 600);
      return (960 * 2 * 600 * 2) / (b.w * b.h);
    };
    expect(at(3)).toBeCloseTo(36, 0);
    expect(at(1)).toBeCloseTo(4, 0);
  });
});
