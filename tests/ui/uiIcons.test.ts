import { describe, it, expect } from 'vitest';
import { iconArt, paintUiIcons, UI_ICONS } from '../../src/ui/uiIcons';
import { SNES_PALETTE } from '../../src/ui/snesPalette';

// Pixel icons for the left tool palette (Maddy 2026-09-30: "icons instead of text for buttons").
describe('ui icons', () => {
  const icons = new Map(paintUiIcons());
  it('paints every named icon as a 16×16 sprite on the shared palette', () => {
    for (const name of UI_ICONS) {
      const p = icons.get(`@ui/${name}`);
      expect(p, name).toBeDefined();
      expect([p!.w, p!.h]).toEqual([16, 16]);
      let opaque = 0;
      for (let i = 0; i < p!.data.length; i += 4) {
        if (p!.data[i + 3] === 0) continue;
        opaque++;
        const rgb = [p!.data[i], p!.data[i + 1], p!.data[i + 2]];
        expect(SNES_PALETTE.some((c) => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]), name).toBe(true);
      }
      expect(opaque / 256, `${name} coverage`).toBeGreaterThan(0.12);
      expect(opaque / 256, `${name} coverage`).toBeLessThan(0.85);
    }
  });

  it('every icon is distinct', () => {
    const seen = new Set<string>();
    for (const name of UI_ICONS) seen.add(Array.from(icons.get(`@ui/${name}`)!.data).join(','));
    expect(seen.size).toBe(UI_ICONS.length);
  });
});

// Maddy 2026-10-08: the gear was asymmetrical, police and power sat too high, a civic pawn lost its head, the
// star's point was too small — "make these match the button drawable area": the whole 16×16 canvas.
describe('icons fit the button', () => {
  const icons = new Map(paintUiIcons());
  const bbox = (g: { w: number; h: number; data: Uint8ClampedArray }) => {
    let x0 = 99, y0 = 99, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.data[(y * g.w + x) * 4 + 3]) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1, n };
  };

  it('nothing is cut off: every pixel of the drawing, outline and all, is on the canvas', () => {
    for (const name of UI_ICONS) {
      const whole = bbox(iconArt(name)); // drawn with room to spare
      const fitted = bbox(icons.get(`@ui/${name}`)!);
      expect(fitted.n, name).toBe(whole.n);
    }
  });

  it('every drawing sits centred on the button, within half a pixel', () => {
    for (const name of UI_ICONS) {
      const b = bbox(icons.get(`@ui/${name}`)!);
      expect(Math.abs((b.x0 + b.x1) / 2 - 7.5), `${name} x`).toBeLessThanOrEqual(0.5);
      expect(Math.abs((b.y0 + b.y1) / 2 - 7.5), `${name} y`).toBeLessThanOrEqual(0.5);
    }
  });

  it('the gear and the star are symmetrical about their own centres', () => {
    for (const name of ['settings', 'police'] as const) {
      const g = icons.get(`@ui/${name}`)!;
      const b = bbox(g);
      const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.data[(y * g.w + x) * 4 + 3]! > 0;
      for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) expect(solid(x, y), `${name} (${x},${y})`).toBe(solid(b.x0 + b.x1 - x, y));
    }
  });

  it('the civic pawns each have a head of their own: no head pixel touches the bubble or a body', () => {
    const g = icons.get('@ui/civic')!;
    const cream = [240, 224, 184]; // C.cream, the heads
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= 16 || y >= 16 ? null : g.data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
    const isHead = (c: Uint8ClampedArray | null) => !!c && c[3]! > 0 && c[0] === cream[0] && c[1] === cream[1] && c[2] === cream[2];
    const isInk = (c: Uint8ClampedArray | null) => !!c && c[0] === 24 && c[1] === 24 && c[2] === 40;
    let heads = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (!isHead(at(x, y))) continue;
      heads++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = at(x + dx, y + dy);
        if (n && n[3]! > 0) expect(isHead(n) || isInk(n), `head (${x},${y}) touches (${x + dx},${y + dy})`).toBe(true);
      }
    }
    expect(heads).toBeGreaterThan(10);
  });

  it("the star's top point is as long as its arms", () => {
    const g = icons.get('@ui/police')!;
    const b = bbox(g);
    const cx = (b.x0 + b.x1) / 2;
    let tip = 0; // rows from the top before the star is wider than 3
    for (let y = b.y0 + 1; y <= b.y1; y++) {
      let w = 0;
      for (let x = b.x0; x <= b.x1; x++) {
        const i = (y * g.w + x) * 4;
        const ink = g.data[i] === 24 && g.data[i + 1] === 24 && g.data[i + 2] === 40; // the outline isn't the star
        if (g.data[i + 3] && !ink && Math.abs(x - cx) <= 6) w++;
      }
      if (w > 5) break;
      tip++;
    }
    expect(tip).toBeGreaterThanOrEqual(3);
  });
});
