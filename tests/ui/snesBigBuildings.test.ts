import { describe, it, expect } from 'vitest';
import { paintBuilding, emissionOf } from '../../src/ui/snesBuildings';
import { C } from '../../src/ui/snesPalette';
import { BuiltKind } from '../../src/engine/fabric';
import type { Pixels } from '../../src/ui/pixelArt';

// The large assets are real site plans, not one block on a bare lot (Maddy 2026-09-30: "really nice
// sprites with an appropriate industrial or commercial look"). Footprints are the ones the game places
// (tools.ts / worldgen moses.ts).
const BIG: ReadonlyArray<readonly [string, number, number, number]> = [
  ['coal', BuiltKind.CoalPlant, 3, 3],
  ['gas', BuiltKind.GasPlant, 3, 3],
  ['nuclear', BuiltKind.NuclearPlant, 4, 4],
  ['hydro', BuiltKind.HydroPlant, 2, 2],
  ['industrial', BuiltKind.Industrial, 3, 3],
  ['offices', BuiltKind.Offices, 2, 2],
  ['commercial', BuiltKind.CommercialStrip, 2, 1],
];

const histogram = (p: Pixels): Map<number, number> => {
  const h = new Map<number, number>();
  for (let i = 0; i < p.data.length; i += 4) {
    const k = (p.data[i]! << 16) | (p.data[i + 1]! << 8) | p.data[i + 2]!;
    h.set(k, (h.get(k) ?? 0) + 1);
  }
  return h;
};

describe('large buildings are built-up site plans', () => {
  for (const [name, kind, w, h] of BIG) {
    it(`${name} ${w}×${h}: no colour (a bare lot) dominates, and the drawing is detailed`, () => {
      for (const v of [0, 1]) {
        const p = paintBuilding(kind, w * 16, h * 16, v, 0);
        const hist = histogram(p);
        const top = Math.max(...hist.values());
        expect(top / (p.w * p.h), `${name} v${v} dominant colour share`).toBeLessThan(0.4);
        expect(hist.size, `${name} v${v} colours`).toBeGreaterThanOrEqual(12);
      }
    });
  }

  it('the gas plant has no full-width stripes (pipe runs are routed between units, not ruled across)', () => {
    const p = paintBuilding(BuiltKind.GasPlant, 48, 48, 0, 0);
    const pipe = new Set([C.gold, C.flower, C.lineYellow].map((c) => (c[0] << 16) | (c[1] << 8) | c[2]));
    for (let y = 0; y < p.h; y++) {
      let n = 0;
      for (let x = 0; x < p.w; x++) {
        const i = (y * p.w + x) * 4;
        if (pipe.has((p.data[i]! << 16) | (p.data[i + 1]! << 8) | p.data[i + 2]!)) n++;
      }
      expect(n / p.w, `row ${y}`).toBeLessThan(0.7);
    }
  });

  it('power plants keep blinking stack beacons; offices and shops light their windows', () => {
    for (const kind of [BuiltKind.CoalPlant, BuiltKind.GasPlant]) {
      expect(emissionOf(paintBuilding(kind, 48, 48, 0, 0), kind, 1).blink, `kind ${kind}`).not.toBeNull();
    }
    for (const [kind, w, h] of [[BuiltKind.Offices, 32, 32], [BuiltKind.CommercialStrip, 32, 16]] as const) {
      expect(emissionOf(paintBuilding(kind, w, h, 0, 0), kind, 1).lit, `kind ${kind}`).not.toBeNull();
    }
  });

  it('every footprint 1..4 × 1..4 still paints (painters scale down gracefully)', () => {
    for (const [, kind] of BIG) {
      for (let w = 1; w <= 4; w++) for (let h = 1; h <= 4; h++) {
        const p = paintBuilding(kind, w * 16, h * 16, 0, 0);
        expect([p.w, p.h]).toEqual([w * 16, h * 16]);
      }
    }
  });
});
