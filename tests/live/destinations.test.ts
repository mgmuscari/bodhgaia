// Trips spread (Maddy 2026-10-08: a district streamed to one shop): a citizen picks among the nearest few places of a
// kind — weighted to the nearest, never one much further off — not always the single nearest.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { nearestOfCategory } from '../../src/live/pathing';
import { StopCategory } from '../../src/citizens/itinerary';

function shops() {
  const map = new GameMap(60, 20);
  const parcels = new ParcelStore();
  for (const x of [20, 23, 26, 29]) placeParcel(map, parcels, { x, y: 10, width: 1, height: 1, kind: BuiltKind.CommercialStrip });
  placeParcel(map, parcels, { x: 55, y: 10, width: 1, height: 1, kind: BuiltKind.CommercialStrip }); // far off
  return map;
}

describe('trips spread over the nearest few places', () => {
  it('different trips from one spot go to different nearby shops, mostly the nearest, never the far one', () => {
    const map = shops();
    const counts = new Map<number, number>();
    for (let k = 0; k < 400; k++) {
      const p = nearestOfCategory(map, 18, 10, StopCategory.Shop, undefined, Math.imul(k + 1, 2654435761))!;
      counts.set(p.x, (counts.get(p.x) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThanOrEqual(3);
    expect(counts.has(55)).toBe(false);
    expect(counts.get(20)!).toBeGreaterThan(counts.get(29) ?? 0);
  });

  it('with no trip to spread it is still the single nearest', () => {
    expect(nearestOfCategory(shops(), 18, 10, StopCategory.Shop)!.x).toBe(20);
  });
});
