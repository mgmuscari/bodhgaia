import { describe, it, expect } from 'vitest';
import { encampmentLayout } from '../../src/ui/decoration';

// sprite sizes in art pixels (w, h) — tents then junk
const TENT = { w: 7, h: 6 };
const JUNK = { w: 5, h: 4 };

describe('encampmentLayout — integer art-pixel placement inside one 16-px tile', () => {
  it('places every tent + junk piece inside the tile, on whole art pixels, never overlapping', () => {
    for (let hash = 0; hash < 400; hash += 7) {
      for (let tents = 0; tents <= 3; tents++) {
        for (let junk = 0; junk <= 2; junk++) {
          const sizes = [...Array(tents).fill(TENT), ...Array(junk).fill(JUNK)];
          const spots = encampmentLayout(hash, sizes);
          expect(spots.length).toBe(sizes.length);
          spots.forEach((s, i) => {
            expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
            expect(s.x).toBeGreaterThanOrEqual(0);
            expect(s.y).toBeGreaterThanOrEqual(0);
            expect(s.x + sizes[i]!.w).toBeLessThanOrEqual(16);
            expect(s.y + sizes[i]!.h).toBeLessThanOrEqual(16);
          });
          for (let i = 0; i < spots.length; i++) {
            for (let j = i + 1; j < spots.length; j++) {
              const a = spots[i]!;
              const b = spots[j]!;
              const sep = a.x + sizes[i]!.w <= b.x || b.x + sizes[j]!.w <= a.x || a.y + sizes[i]!.h <= b.y || b.y + sizes[j]!.h <= a.y;
              expect(sep, `hash ${hash} ${tents}t ${junk}j: ${i} vs ${j}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('is deterministic per tile hash, and varies between tiles', () => {
    const sizes = [TENT, TENT, JUNK];
    expect(encampmentLayout(42, sizes)).toEqual(encampmentLayout(42, sizes));
    const seen = new Set<string>();
    for (let h = 0; h < 40; h++) seen.add(JSON.stringify(encampmentLayout(h * 977, sizes)));
    expect(seen.size).toBeGreaterThan(3);
  });
});
