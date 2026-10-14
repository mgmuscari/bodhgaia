// Lane pairings (docs/design/interdependence.md §9): civic and commons buildings belong to the tech lanes, and pair
// with their neighbours — two that pair, within PAIR_REACH tiles (footprint to footprint), each get the pairing's
// bonus. One table, one rule; the systems that carry each bonus ask `pairedWith`, and the placement preview reads the
// table to show what a building would pair with. PURE — reads the built layer only.

import type { GameMap } from './map';
import { BuiltKind, type ParcelStore } from './fabric';
import { builtKindName } from './builtNames';

/** How near (Chebyshev, footprint to footprint) two buildings pair. */
export const PAIR_REACH = 2;

export interface Pairing {
  a: number;
  b: number;
  /** The bonus, as the preview and the tech panel say it. */
  bonus: string;
}

export const PAIRINGS: readonly Pairing[] = [
  { a: BuiltKind.Library, b: BuiltKind.MakerSpace, bonus: 'the maker space reaches twice as far' },
  { a: BuiltKind.Library, b: BuiltKind.School, bonus: 'the school teaches twice as fast' },
  { a: BuiltKind.CompostHub, b: BuiltKind.CommunityGarden, bonus: 'the garden grows a quarter more' },
  { a: BuiltKind.CompostHub, b: BuiltKind.UrbanFarm, bonus: 'the farm grows a quarter more' },
  { a: BuiltKind.HealingCommons, b: BuiltKind.Clinic, bonus: 'a collapse the clinic answers lasts 15 s longer' },
  { a: BuiltKind.Bazaar, b: BuiltKind.MakerSpace, bonus: 'craft fairs come twice as often' },
  { a: BuiltKind.AINode, b: BuiltKind.FoodBank, bonus: 'the food bank delivers by drone' },
  { a: BuiltKind.CoopHousing, b: BuiltKind.Pantry, bonus: 'the pantry serves two tiles further' },
];

/** The pairings a kind takes part in. */
export function pairsFor(kind: number): Pairing[] {
  return PAIRINGS.filter((p) => p.a === kind || p.b === kind);
}

/** Is there a `partner` building within PAIR_REACH of the footprint (x, y, w, h)? */
export function pairedWith(map: GameMap, f: { x: number; y: number; w: number; h: number }, partner: number): boolean {
  for (let y = f.y - PAIR_REACH; y < f.y + f.h + PAIR_REACH; y++) {
    for (let x = f.x - PAIR_REACH; x < f.x + f.w + PAIR_REACH; x++) {
      if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) continue;
      if (map.inBounds(x, y) && map.built[map.idx(x, y)] === partner) return true;
    }
  }
  return false;
}

/** The neighbourhood ids (by `tileToNeighborhood`) where an `a` building pairs with a `b`. */
export function pairedHoods(map: GameMap, parcels: ParcelStore, tileToNeighborhood: ArrayLike<number>, a: number, b: number): Set<number> {
  const out = new Set<number>();
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    if (p.kind !== a || !pairedWith(map, { x: p.x, y: p.y, w: p.width, h: p.height }, b)) continue;
    const id = tileToNeighborhood[map.idx(p.x, p.y)] ?? 0;
    if (id > 0) out.add(id);
  }
  return out;
}

/** What placing `kind` at footprint `f` would pair with: the partner tiles in reach (to light) and a line per pairing
 *  (`Pairs with the Library: …`). */
export function pairPreview(map: GameMap, kind: number, f: { x: number; y: number; w: number; h: number }): { tiles: number[]; lines: string[] } {
  const tiles: number[] = [];
  const lines: string[] = [];
  for (const p of pairsFor(kind)) {
    const partner = p.a === kind ? p.b : p.a;
    let found = false;
    for (let y = f.y - PAIR_REACH; y < f.y + f.h + PAIR_REACH; y++) {
      for (let x = f.x - PAIR_REACH; x < f.x + f.w + PAIR_REACH; x++) {
        if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) continue;
        if (!map.inBounds(x, y) || map.built[map.idx(x, y)] !== partner) continue;
        tiles.push(map.idx(x, y));
        found = true;
      }
    }
    if (found) lines.push(`Pairs with the ${builtKindName(partner as BuiltKind)}: ${p.bonus}`);
  }
  return { tiles, lines };
}
