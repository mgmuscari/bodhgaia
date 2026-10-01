import { describe, it, expect } from 'vitest';
import {
  builtRenderKey,
  renderKeyspace,
  footprintCellKey,
  variantKey,
  surfaceVariantIndex,
  type FootprintPos,
} from '../../src/ui/renderKey';
import { BuiltKind, isTransportKind } from '../../src/engine/fabric';

const POSITIONS: FootprintPos[] = ['c', 'e', 'k'];
const TIERS = [0, 1];

// Every named placeable kind (None excluded).
const PLACEABLE = Object.values(BuiltKind).filter((k) => k !== BuiltKind.None);

describe('builtRenderKey totality + membership', () => {
  const keyspace = new Set(renderKeyspace());

  it('returns a non-empty key in renderKeyspace for every placeable kind across its dims', () => {
    for (const kind of PLACEABLE) {
      if (isTransportKind(kind)) {
        for (let mask = 0; mask < 16; mask++) {
          const key = builtRenderKey(kind, mask, 'c', 0);
          expect(key, `kind ${kind} mask ${mask}`).toBeTruthy();
          expect(keyspace.has(key), `kind ${kind} mask ${mask} -> ${key} not in keyspace`).toBe(true);
        }
      } else {
        for (const pos of POSITIONS) {
          for (const tier of TIERS) {
            const key = builtRenderKey(kind, 0, pos, tier);
            expect(key, `kind ${kind} pos ${pos} tier ${tier}`).toBeTruthy();
            expect(keyspace.has(key), `kind ${kind} -> ${key} not in keyspace`).toBe(true);
          }
        }
      }
    }
  });
});

describe('renderKeyspace shape', () => {
  it('has no duplicates', () => {
    const ks = renderKeyspace();
    expect(new Set(ks).size).toBe(ks.length);
  });

  it('is order-stable across calls', () => {
    expect(renderKeyspace()).toEqual(renderKeyspace());
  });
});

describe('QuietStreet(7) renders into the road set (missing-style regression)', () => {
  it('keys road-7-{mask} and enumerates the full road-7 mask set', () => {
    const keyspace = new Set(renderKeyspace());
    expect(builtRenderKey(BuiltKind.QuietStreet, 5, 'c', 0)).toBe('road-7-5');
    for (let m = 0; m < 16; m++) {
      expect(keyspace.has(`road-7-${m}`), `road-7-${m} missing from keyspace`).toBe(true);
    }
  });
});

describe('Park(61) + RewildedLand(62) render into the building set', () => {
  const keyspace = new Set(renderKeyspace());

  it('keys b-61/b-62 and enumerates the full pos×tier sets', () => {
    expect(builtRenderKey(BuiltKind.Park, 0, 'c', 0)).toBe('b-61-c-0');
    expect(builtRenderKey(BuiltKind.RewildedLand, 0, 'e', 1)).toBe('b-62-e-1');
    for (const pos of POSITIONS) {
      for (const tier of TIERS) {
        expect(keyspace.has(`b-61-${pos}-${tier}`), `b-61-${pos}-${tier} missing`).toBe(true);
        expect(keyspace.has(`b-62-${pos}-${tier}`), `b-62-${pos}-${tier} missing`).toBe(true);
      }
    }
  });
});

describe('builtRenderKey kind → prefix mapping', () => {
  it('maps each transport kind to its category prefix (mask used, pos/tier ignored)', () => {
    expect(builtRenderKey(BuiltKind.RoadStreet, 1, 'c', 0)).toBe('road-1-1');
    expect(builtRenderKey(BuiltKind.RoadAvenue, 2, 'e', 1)).toBe('road-2-2'); // pos/tier ignored
    expect(builtRenderKey(BuiltKind.RoadHighway, 3, 'c', 0)).toBe('road-3-3');
    expect(builtRenderKey(BuiltKind.Rail, 2, 'c', 0)).toBe('rail-2');
    expect(builtRenderKey(BuiltKind.Streetcar, 8, 'c', 0)).toBe('streetcar-8');
    expect(builtRenderKey(BuiltKind.ElevatedRail, 6, 'c', 0)).toBe('elev-6');
    expect(builtRenderKey(BuiltKind.BikePath, 4, 'c', 0)).toBe('bike-4');
    expect(builtRenderKey(BuiltKind.Promenade, 9, 'c', 0)).toBe('ped-9');
  });

  it('maps buildings to b-{kind}-{pos}-{tier} (mask ignored)', () => {
    expect(builtRenderKey(BuiltKind.HouseSingle, 7, 'e', 1)).toBe('b-16-e-1');
    expect(builtRenderKey(BuiltKind.Parklet, 0, 'k', 0)).toBe('b-48-k-0');
    expect(builtRenderKey(BuiltKind.HealingCommons, 0, 'c', 1)).toBe('b-60-c-1');
  });

  it('is deterministic for equal inputs', () => {
    expect(builtRenderKey(BuiltKind.Rail, 3, 'c', 0)).toBe(builtRenderKey(BuiltKind.Rail, 3, 'c', 0));
    expect(builtRenderKey(BuiltKind.Parklet, 0, 'e', 1)).toBe(builtRenderKey(BuiltKind.Parklet, 0, 'e', 1));
  });
});

describe('builtRenderKey wide-body variant', () => {
  it('appends -w only for road kinds when wide=true', () => {
    expect(builtRenderKey(BuiltKind.RoadAvenue, 15, 'c', 0, true)).toBe('road-2-15-w');
    expect(builtRenderKey(BuiltKind.RoadHighway, 7, 'c', 0, true)).toBe('road-3-7-w');
    expect(builtRenderKey(BuiltKind.RoadStreet, 3, 'c', 0, true)).toBe('road-1-3-w');
  });

  it('defaults wide=false: 4-arg calls and explicit false are unchanged', () => {
    expect(builtRenderKey(BuiltKind.RoadAvenue, 15, 'c', 0)).toBe('road-2-15');
    expect(builtRenderKey(BuiltKind.RoadAvenue, 15, 'c', 0, false)).toBe('road-2-15');
  });

  it('ignores wide for QuietStreet(7) — it never widens (no road-7-*-w)', () => {
    expect(builtRenderKey(BuiltKind.QuietStreet, 5, 'c', 0, true)).toBe('road-7-5');
  });

  it('ignores wide for rail/transit and building kinds', () => {
    expect(builtRenderKey(BuiltKind.Rail, 2, 'c', 0, true)).toBe('rail-2');
    expect(builtRenderKey(BuiltKind.Streetcar, 8, 'c', 0, true)).toBe('streetcar-8');
    expect(builtRenderKey(BuiltKind.HouseSingle, 0, 'e', 1, true)).toBe('b-16-e-1');
  });
});

describe('renderKeyspace wide-body enumeration', () => {
  const keyspace = new Set(renderKeyspace());

  it('enumerates road-{k}-{m}-w for kinds 1–3 across all 16 masks', () => {
    for (const k of [1, 2, 3]) {
      for (let m = 0; m < 16; m++) {
        expect(keyspace.has(`road-${k}-${m}-w`), `road-${k}-${m}-w missing`).toBe(true);
      }
    }
    // Spot-checks from the PRP.
    expect(keyspace.has('road-2-15-w')).toBe(true);
    expect(keyspace.has('road-3-0-w')).toBe(true);
  });

  it('excludes QuietStreet wide keys (road-7-*-w) but keeps plain road-7-{m}', () => {
    const quietWide = renderKeyspace().filter((k) => k.startsWith('road-7-') && k.endsWith('-w'));
    expect(quietWide).toEqual([]);
    for (let m = 0; m < 16; m++) {
      expect(keyspace.has(`road-7-${m}`), `road-7-${m} missing`).toBe(true);
    }
  });
});

describe('footprintCellKey (segmented multi-tile, tileset-only)', () => {
  it('encodes kind, footprint size, cell col/row, and tier', () => {
    expect(footprintCellKey(BuiltKind.Apartments, 2, 2, 0, 1, 0)).toBe('b-17-2x2-c0-r1-0');
    expect(footprintCellKey(BuiltKind.Projects, 2, 3, 1, 2, 1)).toBe('b-18-2x3-c1-r2-1');
  });

  it('distinguishes cells, sizes, and tiers (no collisions across a footprint)', () => {
    const seen = new Set<string>();
    for (const [w, h] of [[2, 2], [2, 3]] as const) {
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          for (const tier of [0, 1]) {
            const k = footprintCellKey(BuiltKind.HouseSingle, w, h, col, row, tier);
            expect(seen.has(k)).toBe(false);
            seen.add(k);
          }
        }
      }
    }
  });

  it('is NEVER part of renderKeyspace — a procedural atlas can never form it (forces fallback)', () => {
    const space = new Set(renderKeyspace());
    expect(space.has(footprintCellKey(BuiltKind.HouseSingle, 1, 1, 0, 0, 0))).toBe(false);
    expect(space.has(footprintCellKey(BuiltKind.Apartments, 2, 2, 0, 0, 0))).toBe(false);
  });
});

describe('variantKey + surfaceVariantIndex (tile-map variant cycling, anti-plaid)', () => {
  it('variantKey appends #v and never collides with a base key', () => {
    expect(variantKey('road-1-5', 2)).toBe('road-1-5#2');
    expect(variantKey('road-1-5-w', 0)).toBe('road-1-5-w#0');
    expect(variantKey('@surface/road', 3)).toBe('@surface/road#3');
    expect(variantKey('road-1-5', 0).includes('#')).toBe(true); // '#' absent from base keys
  });

  it('surfaceVariantIndex is deterministic and always in [0, count)', () => {
    for (let x = 0; x < 24; x++) {
      for (let y = 0; y < 24; y++) {
        const v = surfaceVariantIndex(x, y, 4);
        expect(v).toBe(surfaceVariantIndex(x, y, 4)); // deterministic
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(4);
      }
    }
  });

  it('collapses to 0 when there is 0 or 1 variant (no cycling)', () => {
    expect(surfaceVariantIndex(3, 7, 1)).toBe(0);
    expect(surfaceVariantIndex(3, 7, 0)).toBe(0);
  });

  it('actually cycles — every variant appears, and it is NOT a trivial checkerboard/banding', () => {
    const counts = [0, 0, 0, 0];
    let neighborDiffers = 0;
    let total = 0;
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        counts[surfaceVariantIndex(x, y, 4)]!++;
        if (surfaceVariantIndex(x, y, 4) !== surfaceVariantIndex(x + 1, y, 4)) neighborDiffers++;
        total++;
      }
    }
    for (const c of counts) expect(c).toBeGreaterThan(0); // all 4 used
    // Not a strict 2-coloring: horizontal neighbors differ a healthy fraction of the time, but not
    // every single time (which would be a regular stripe) — a spread hash, not a pattern.
    expect(neighborDiffers).toBeGreaterThan(total * 0.4);
    expect(neighborDiffers).toBeLessThan(total); // not a perfect stripe
  });
});

import { variantCounts, pickVariantKey } from '../../src/ui/renderKey';

describe('variantCounts / pickVariantKey (hash-cycled tile variants)', () => {
  it('counts each base key plus its #n variants', () => {
    const counts = variantCounts(['grass-0', 'grass-0#1', 'grass-0#2', 'forest-1', 'forest-1#1', 'ocean-0']);
    expect(counts.get('grass-0')).toBe(3);
    expect(counts.get('forest-1')).toBe(2);
    expect(counts.has('ocean-0')).toBe(false); // no variants → not listed (plain lookup)
  });

  it('only counts a contiguous run #1..#n (a gap would pick a missing tile)', () => {
    const counts = variantCounts(['grass-0', 'grass-0#1', 'grass-0#3']);
    expect(counts.get('grass-0')).toBe(2);
  });

  it('pickVariantKey returns the base or one of its variants, deterministically by position', () => {
    const counts = variantCounts(['grass-0', 'grass-0#1', 'grass-0#2', 'grass-0#3']);
    const seen = new Set<string>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) seen.add(pickVariantKey('grass-0', x, y, counts));
    expect(seen).toEqual(new Set(['grass-0', 'grass-0#1', 'grass-0#2', 'grass-0#3']));
    expect(pickVariantKey('grass-0', 3, 5, counts)).toBe(pickVariantKey('grass-0', 3, 5, counts));
    expect(pickVariantKey('lake-0', 3, 5, counts)).toBe('lake-0'); // no variants → base
  });
});

import { blobMask, BLOB_MASKS, BLOB } from '../../src/ui/renderKey';

describe('blobMask — 8-neighbour edge masks for terrain edge overlays', () => {
  const none = { n: false, e: false, s: false, w: false, ne: false, se: false, sw: false, nw: false };

  it('encodes sides as N=1 E=2 S=4 W=8', () => {
    expect(blobMask({ ...none, n: true })).toBe(BLOB.N);
    expect(blobMask({ ...none, n: true, e: true, s: true, w: true })).toBe(BLOB.N | BLOB.E | BLOB.S | BLOB.W);
  });

  it('keeps a corner only when both of its sides are clear (a lone diagonal contact)', () => {
    expect(blobMask({ ...none, ne: true })).toBe(BLOB.NE);
    expect(blobMask({ ...none, ne: true, n: true })).toBe(BLOB.N); // the N edge already covers NE
    expect(blobMask({ ...none, sw: true, n: true })).toBe(BLOB.N | BLOB.SW);
  });

  it('there are exactly 47 normalized masks, all distinct, and every blobMask result is one of them', () => {
    expect(BLOB_MASKS.length).toBe(47);
    expect(new Set(BLOB_MASKS).size).toBe(47);
    const all = new Set(BLOB_MASKS);
    for (let raw = 0; raw < 256; raw++) {
      const m = blobMask({
        n: !!(raw & 1), e: !!(raw & 2), s: !!(raw & 4), w: !!(raw & 8),
        ne: !!(raw & 16), se: !!(raw & 32), sw: !!(raw & 64), nw: !!(raw & 128),
      });
      expect(all.has(m), `raw ${raw} → ${m}`).toBe(true);
    }
  });
});

import { emissionKey, variantIndexOf } from '../../src/ui/renderKey';

describe('emissionKey / variantIndexOf', () => {
  it('keys a whole-footprint emission map by kind, size and tier under @emit/', () => {
    expect(emissionKey(16, 2, 1, 0)).toBe('@emit/b-16-2x1-0');
  });
  it('reads the variant index back off a picked key (0 for the base)', () => {
    expect(variantIndexOf('b-16-1x1-c0-r0-0')).toBe(0);
    expect(variantIndexOf('b-16-1x1-c0-r0-0#3')).toBe(3);
  });
});
