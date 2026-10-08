// City readings: the live city boiled down to the aggregates the economy model (model.ts) runs on. Headless
// like the rest of src/economy — the city hands in plain accessors (occupancy per parcel anchor, land value
// per tile), the same discipline growth uses for occupancy. The per-kind upkeep and tending tables are
// TUNING DATA (balanced in play); their tested contract is relative (a highway costs more than a street).

import type { GameMap } from '../engine/map';
import { BuiltKind, isTransportKind, type ParcelStore } from '../engine/fabric';
import type { CityReading } from './model';

/** Money upkeep per in-game hour: per tile for transport, per parcel for buildings. */
export const UPKEEP: ReadonlyMap<number, number> = new Map<number, number>([
  [BuiltKind.RoadStreet, 0.05],
  [BuiltKind.RoadAvenue, 0.09],
  [BuiltKind.RoadHighway, 0.25], // highways are expensive to keep — the overbuilding trap
  [BuiltKind.RoadRamp, 0.2],
  [BuiltKind.QuietStreet, 0.03],
  [BuiltKind.Rail, 0.12],
  [BuiltKind.Streetcar, 0.1],
  [BuiltKind.ElevatedRail, 0.2],
  [BuiltKind.BikePath, 0.01],
  [BuiltKind.Promenade, 0.02],
  [BuiltKind.Civic, 1.5],
  [BuiltKind.FireStation, 2],
  [BuiltKind.Clinic, 2],
  [BuiltKind.Library, 1.2],
  [BuiltKind.School, 2],
  [BuiltKind.Precinct, 2.5],
  [BuiltKind.CoalPlant, 6],
  [BuiltKind.GasPlant, 5],
  [BuiltKind.HydroPlant, 3],
  [BuiltKind.NuclearPlant, 10],
  [BuiltKind.WindTurbine, 0.6],
  [BuiltKind.SolarPlant, 2],
  [BuiltKind.FusionPlant, 8],
  [BuiltKind.WastewaterWorks, 2],
  [BuiltKind.EnergyNode, 0.8],
  [BuiltKind.AINode, 1.5],
]);

/** Effort per in-game hour to keep a commons work alive — neighbours tending it. */
export const TENDING: ReadonlyMap<number, number> = new Map<number, number>([
  [BuiltKind.Parklet, 0.04],
  [BuiltKind.CommunityGarden, 0.1],
  [BuiltKind.CompostHub, 0.08],
  [BuiltKind.Park, 0.06],
  [BuiltKind.RewildedLand, 0.02], // wild land mostly tends itself
  [BuiltKind.HealingCommons, 0.12],
  [BuiltKind.Bazaar, 0.08],
  [BuiltKind.MakerSpace, 0.08],
  [BuiltKind.VerticalFarm, 0.1],
  [BuiltKind.TinyHomes, 0.1], // neighbours keep the village running
]);

const RESIDENTIAL = new Set<number>([
  BuiltKind.HouseSingle,
  BuiltKind.Apartments,
  BuiltKind.Projects,
  BuiltKind.ADU,
  BuiltKind.CoopHousing,
  BuiltKind.Commune,
  BuiltKind.TinyHomes,
]);
const COMMERCIAL = new Set<number>([BuiltKind.CommercialStrip, BuiltKind.Offices, BuiltKind.Bazaar, BuiltKind.MakerSpace]);
const INDUSTRIAL = new Set<number>([BuiltKind.Industrial]);
/** Homes on land held in common — rent can't chase land value there. */
export const PROTECTED: ReadonlySet<number> = new Set<number>([BuiltKind.CoopHousing, BuiltKind.Commune, BuiltKind.TinyHomes]);
/** Places neighbours gather and organise (matches civic dynamics' gathering kinds). */
const GATHERING = new Set<number>([
  BuiltKind.Bazaar,
  BuiltKind.MakerSpace,
  BuiltKind.HealingCommons,
  BuiltKind.CommunityGarden,
  BuiltKind.Civic,
  BuiltKind.Park,
]);
/** Tax base per occupied unit at full land value, by class (commerce and industry assess higher). Calibrated
 *  on three seeds so an inherited city opens a little in deficit at 7% (lotus ~0.94 of upkeep, harbor ~0.97,
 *  oak ~0.65) — measured once the live fields have SETTLED (~3 min in: road decay, wear and smog ramp from
 *  zero and halve land value; the t=0 calibration left lotus at 0.38 — Maddy 2026-10-01, ×2.4 for r and c).
 *  Its Moses-era road network costs more
 *  to keep than the disinvested tax base brings in — the highways are part of the bill. Industry is assessed
 *  per job with NO land-value factor (its own smoke zeroes the land under it, so a land-value assessment
 *  made every works pay $0 — Maddy 2026-10-01); `i` is 7.65 × ~0.25, a works' typical land value elsewhere. */
export const BASE_PER_UNIT = { r: 10.2, c: 24.5, i: 1.9 } as const;
/** Jobs a shop or works holds per density level, at full condition (occupancy counts households only). */
const JOBS_PER_DENSITY = 6;

/** The practices' economy effects (resolved tech-side, tech/effects.ts — passed as plain values, so the
 *  economy never imports tech). */
export interface EconomyPractices {
  /** Community Land Trust: homes within LAND_TRUST_RADIUS of a co-op, commune or healing commons are protected. */
  landTrust: boolean;
  /** Multiplier on the commons' tending effort (Gift Circles). */
  tendingMul: number;
  /** Social infrastructure each maker space and bazaar adds (Craft Fairs). */
  craftInfra: number;
  /** Multiplier on how much taxes weigh on approval (Participatory Budgeting). */
  taxPainMul: number;
  /** Multiplier on burnout's recovery (Shared Table). */
  burnoutHealMul: number;
}

export const NEUTRAL_ECONOMY_PRACTICES: Readonly<EconomyPractices> = Object.freeze({
  landTrust: false,
  tendingMul: 1,
  craftInfra: 0,
  taxPainMul: 1,
  burnoutHealMul: 1,
});

/** A building's reach: every parcel whose footprint comes within `r` tiles (Chebyshev) of a parcel of one of
 *  `kinds`. Returns the predicate; cheap when there are none. */
export function reachOf(parcels: ParcelStore, kinds: ReadonlySet<number>, r: number): (p: { x: number; y: number; width: number; height: number }) => boolean {
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const i of parcels.aliveIndices()) {
    const a = parcels.get(i);
    if (kinds.has(a.kind)) boxes.push({ x0: a.x - r, y0: a.y - r, x1: a.x + a.width - 1 + r, y1: a.y + a.height - 1 + r });
  }
  if (boxes.length === 0) return () => false;
  return (p) => boxes.some((b) => p.x <= b.x1 && p.x + p.width - 1 >= b.x0 && p.y <= b.y1 && p.y + p.height - 1 >= b.y0);
}

/** Compost Hub: the gardens and farms within this reach need COMPOST_TENDING of their tending. */
export const COMPOST_RADIUS = 4;
export const COMPOST_TENDING = 0.5;
const COMPOSTED: ReadonlySet<number> = new Set<number>([BuiltKind.CommunityGarden, BuiltKind.VerticalFarm]);
/** Bazaar: the shops within this reach are assessed BAZAAR_LIFT × (the bazaar draws a crowd). */
export const BAZAAR_RADIUS = 4;
export const BAZAAR_LIFT = 1.25;
/** Elevated Rail: shops within RAIL_COMMERCE_RADIUS (Chebyshev) of the line are assessed RAIL_COMMERCE_LIFT×. */
export const RAIL_COMMERCE_RADIUS = 2;
export const RAIL_COMMERCE_LIFT = 1.25;

/** Is there elevated rail (ground or deck) within `r` of a parcel's footprint? */
function nearElevatedRail(map: GameMap, p: { x: number; y: number; width: number; height: number }, r: number): boolean {
  for (let y = Math.max(0, p.y - r); y <= Math.min(map.height - 1, p.y + p.height - 1 + r); y++) {
    for (let x = Math.max(0, p.x - r); x <= Math.min(map.width - 1, p.x + p.width - 1 + r); x++) {
      const i = map.idx(x, y);
      if (map.built[i] === BuiltKind.ElevatedRail || map.deck[i] === BuiltKind.ElevatedRail) return true;
    }
  }
  return false;
}

/** Commune: its workshops are assessed at this share of a commercial lot of its size (it doubles as a market). */
export const COMMUNE_COMMERCE_SHARE = 0.5;

/** Commune: its households regenerate effort COMMUNE_REGEN × (pooled lives, pooled time). */
export const COMMUNE_REGEN = 2;

/** How far (Chebyshev, from the anchor's footprint) a Land Trust's protection reaches. */
export const LAND_TRUST_RADIUS = 4;
/** The places a Land Trust holds land around. */
export const LAND_TRUST_ANCHORS: ReadonlySet<number> = new Set<number>([BuiltKind.CoopHousing, BuiltKind.Commune, BuiltKind.HealingCommons]);
/** The kinds Craft Fairs counts. */
export const CRAFT_KINDS: ReadonlySet<number> = new Set<number>([BuiltKind.Bazaar, BuiltKind.MakerSpace]);

export interface CityInputs {
  map: GameMap;
  parcels: ParcelStore;
  /** Live households/workers at a parcel's anchor tile. */
  occupancyAt(anchorTile: number): number | undefined;
  /** Live land value 0..255 at a tile. */
  landValueAt(tile: number): number | undefined;
  /** Wellbeing, normalised 0..1. */
  wellbeing: number;
  /** Social infrastructure from capabilities (circles, assemblies…), added to the gathering places. */
  extraInfra: number;
  harms: CityReading['harms'];
  repairs: number;
  /** The practices in force (absent ⇒ none). */
  practices?: EconomyPractices;
  /** How organised the neighbourhood at a tile is, 0..1 (civic voice ÷ 255): tenant organising protects its
   *  homes from displacement (rehoming.md). Absent ⇒ 0 everywhere. */
  voiceAt?(tile: number): number;
}

/** How protected a home is from being priced out, 0..1: held in common (co-op, commune), on Land Trust land,
 *  or organised — the best of the three. */
export function homeProtection(kind: number, inTrust: boolean, voice: number): number {
  if (PROTECTED.has(kind) || inTrust) return 1;
  return voice < 0 ? 0 : voice > 1 ? 1 : voice;
}

/** Each home's protection by anchor tile — what readCity counts and what rent displacement spares. */
export function homeProtections(inp: CityInputs): Map<number, number> {
  const { map, parcels } = inp;
  const pr = inp.practices ?? NEUTRAL_ECONOMY_PRACTICES;
  const trustBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  if (pr.landTrust) {
    for (const i of parcels.aliveIndices()) {
      const a = parcels.get(i);
      if (!LAND_TRUST_ANCHORS.has(a.kind)) continue;
      const r = LAND_TRUST_RADIUS;
      trustBoxes.push({ x0: a.x - r, y0: a.y - r, x1: a.x + a.width - 1 + r, y1: a.y + a.height - 1 + r });
    }
  }
  const out = new Map<number, number>();
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    if (!RESIDENTIAL.has(p.kind)) continue;
    const anchor = map.idx(p.x, p.y);
    const inTrust = trustBoxes.some((b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1);
    out.set(anchor, homeProtection(p.kind, inTrust, inp.voiceAt?.(anchor) ?? 0));
  }
  return out;
}

export function readCity(inp: CityInputs): CityReading {
  const { map, parcels } = inp;
  const pr = inp.practices ?? NEUTRAL_ECONOMY_PRACTICES;
  const protection = homeProtections(inp);
  const composted = reachOf(parcels, new Set([BuiltKind.CompostHub]), COMPOST_RADIUS);
  const nearBazaar = reachOf(parcels, new Set([BuiltKind.Bazaar]), BAZAAR_RADIUS);
  let communeHouseholds = 0;
  let crafts = 0;
  let households = 0;
  let protectedHouseholds = 0;
  const base = { r: 0, c: 0, i: 0 };
  let upkeep = 0;
  let tending = 0;
  let gathering = 0;
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    const anchor = map.idx(p.x, p.y);
    const occ = inp.occupancyAt(anchor) ?? 0;
    const lv = (inp.landValueAt(anchor) ?? 0) / 255;
    if (RESIDENTIAL.has(p.kind)) {
      households += occ;
      if (p.kind === BuiltKind.Commune) {
        communeHouseholds += occ;
        const jobs = p.density * JOBS_PER_DENSITY * (p.condition / 255) * p.width * p.height;
        base.c += jobs * lv * BASE_PER_UNIT.c * COMMUNE_COMMERCE_SHARE;
      }
      protectedHouseholds += occ * (protection.get(anchor) ?? 0);
      base.r += occ * lv * BASE_PER_UNIT.r;
    } else if (COMMERCIAL.has(p.kind) || INDUSTRIAL.has(p.kind)) {
      // a workplace's tax base is its jobs: density, scaled by how well the building is kept
      const jobs = p.density * JOBS_PER_DENSITY * (p.condition / 255) * p.width * p.height;
      if (COMMERCIAL.has(p.kind)) {
        const crowd = p.kind !== BuiltKind.Bazaar && nearBazaar(p) ? BAZAAR_LIFT : 1;
        const line = nearElevatedRail(map, p, RAIL_COMMERCE_RADIUS) ? RAIL_COMMERCE_LIFT : 1;
        base.c += jobs * lv * BASE_PER_UNIT.c * crowd * line;
      }
      else base.i += jobs * BASE_PER_UNIT.i; // assessed on output: industry's land value is its own victim
    }
    upkeep += UPKEEP.get(p.kind) ?? 0;
    tending += (TENDING.get(p.kind) ?? 0) * (COMPOSTED.has(p.kind) && composted(p) ? COMPOST_TENDING : 1);
    if (GATHERING.has(p.kind)) gathering++;
    if (CRAFT_KINDS.has(p.kind)) crafts++;
  }
  // transport upkeep is per tile (a road is paid for by its length)
  for (let t = 0; t < map.built.length; t++) {
    const k = map.built[t]!;
    if (k !== 0 && isTransportKind(k)) upkeep += UPKEEP.get(k) ?? 0;
  }
  return {
    households,
    wellbeing: inp.wellbeing,
    landValue: meanLandValue(inp, map),
    protectedShare: households > 0 ? protectedHouseholds / households : 0,
    base,
    upkeep,
    tending: tending * pr.tendingMul,
    socialInfra: gathering + inp.extraInfra + crafts * pr.craftInfra,
    harms: inp.harms,
    repairs: inp.repairs,
    regenHouseholds: households + communeHouseholds * (COMMUNE_REGEN - 1),
    taxPainMul: pr.taxPainMul,
    burnoutHealMul: pr.burnoutHealMul,
  };
}

/** Mean land value 0..1 over the homes (what rent follows). */
function meanLandValue(inp: CityInputs, map: GameMap): number {
  let sum = 0;
  let n = 0;
  for (const i of inp.parcels.aliveIndices()) {
    const p = inp.parcels.get(i);
    if (!RESIDENTIAL.has(p.kind)) continue;
    sum += (inp.landValueAt(map.idx(p.x, p.y)) ?? 0) / 255;
    n++;
  }
  return n > 0 ? sum / n : 0;
}
