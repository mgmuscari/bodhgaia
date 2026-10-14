// Building boosts (Maddy 2026-10-14: "buffed buildings could have a status icon"): ONE answer to "is this building
// boosted, and why" — the simulation that carries each bonus, the map's boosted badge and the inspect readout all
// read it, so the badge can't drift from the effect. A boost is a lane pairing (both partners, engine/pairings.ts) or
// a maker space and industry working together (interdependence §3: the maker is supplied, the works' scrap reused).
// PURE — reads the built layer and the parcels only.

import type { GameMap } from './map';
import { BuiltKind, MAKER_SUPPLY, type ParcelStore } from './fabric';
import { builtKindName } from './builtNames';
import { pairedWith, pairsFor } from './pairings';

/** A footprint (top-left tile and size). */
export interface Foot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The parcels a boost check scans for, gathered once per pass. */
export interface BoostIndex {
  makers: Foot[];
  works: Foot[];
}

const footOf = (p: { x: number; y: number; width: number; height: number }): Foot => ({ x: p.x, y: p.y, w: p.width, h: p.height });

/** Chebyshev distance between two footprints (1 when side by side, 0 when they overlap). */
function gap(a: Foot, b: Foot): number {
  const dx = Math.max(0, a.x - (b.x + b.w - 1), b.x - (a.x + a.w - 1));
  const dy = Math.max(0, a.y - (b.y + b.h - 1), b.y - (a.y + a.h - 1));
  return Math.max(dx, dy);
}

/** The maker spaces and the industrial works, for the maker/industry checks. */
export function boostIndex(parcels: ParcelStore): BoostIndex {
  const makers: Foot[] = [];
  const works: Foot[] = [];
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    if (p.kind === BuiltKind.MakerSpace) makers.push(footOf(p));
    else if (p.kind === BuiltKind.Industrial) works.push(footOf(p));
  }
  return { makers, works };
}

/** Is a maker space at `m` supplied by industry within MAKER_SUPPLY (footprint to footprint)? */
export function makerSupplied(m: Foot, works: readonly Foot[]): boolean {
  return works.some((w) => gap(m, w) <= MAKER_SUPPLY);
}

export const MAKER_SUPPLIED_LINE = 'Supplied by the works nearby: reaches further, mends twice as fast';
export const SCRAP_REUSED_LINE = 'A maker space takes its scrap: half the ground poison';

/** Why parcel `i` is boosted — a line per boost, none if it isn't. */
export function boostsOf(map: GameMap, parcels: ParcelStore, i: number, index?: BoostIndex): string[] {
  const p = parcels.get(i);
  const f = footOf(p);
  const out: string[] = [];
  for (const pair of pairsFor(p.kind)) {
    const partner = pair.a === p.kind ? pair.b : pair.a;
    if (pairedWith(map, f, partner)) out.push(`Pairs with the ${builtKindName(partner as BuiltKind)}: ${pair.bonus}`);
  }
  if (p.kind === BuiltKind.MakerSpace || p.kind === BuiltKind.Industrial) {
    const idx = index ?? boostIndex(parcels);
    if (p.kind === BuiltKind.MakerSpace && makerSupplied(f, idx.works)) out.push(MAKER_SUPPLIED_LINE);
    if (p.kind === BuiltKind.Industrial && idx.makers.some((m) => gap(f, m) <= MAKER_SUPPLY)) out.push(SCRAP_REUSED_LINE);
  }
  return out;
}
