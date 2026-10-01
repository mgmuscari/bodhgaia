import { describe, it, expect } from 'vitest';
import { paintUiIcons, UI_ICONS } from '../../src/ui/uiIcons';
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
