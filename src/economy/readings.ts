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
]);

const RESIDENTIAL = new Set<number>([
  BuiltKind.HouseSingle,
  BuiltKind.Apartments,
  BuiltKind.Projects,
  BuiltKind.ADU,
  BuiltKind.CoopHousing,
  BuiltKind.Commune,
]);
const COMMERCIAL = new Set<number>([BuiltKind.CommercialStrip, BuiltKind.Offices, BuiltKind.Bazaar, BuiltKind.MakerSpace]);
const INDUSTRIAL = new Set<number>([BuiltKind.Industrial]);
/** Homes on land held in common — rent can't chase land value there. */
const PROTECTED = new Set<number>([BuiltKind.CoopHousing, BuiltKind.Commune]);
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
 *  oak ~0.65): its Moses-era road network costs more
 *  to keep than the disinvested tax base brings in — the highways are part of the bill. */
export const BASE_PER_UNIT = { r: 4.25, c: 10.2, i: 7.65 } as const;
/** Jobs a shop or works holds per density level, at full condition (occupancy counts households only). */
const JOBS_PER_DENSITY = 6;

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
}

export function readCity(inp: CityInputs): CityReading {
  const { map, parcels } = inp;
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
      if (PROTECTED.has(p.kind)) protectedHouseholds += occ;
      base.r += occ * lv * BASE_PER_UNIT.r;
    } else if (COMMERCIAL.has(p.kind) || INDUSTRIAL.has(p.kind)) {
      // a workplace's tax base is its jobs: density, scaled by how well the building is kept
      const jobs = p.density * JOBS_PER_DENSITY * (p.condition / 255) * p.width * p.height;
      if (COMMERCIAL.has(p.kind)) base.c += jobs * lv * BASE_PER_UNIT.c;
      else base.i += jobs * lv * BASE_PER_UNIT.i;
    }
    upkeep += UPKEEP.get(p.kind) ?? 0;
    tending += TENDING.get(p.kind) ?? 0;
    if (GATHERING.has(p.kind)) gathering++;
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
    tending,
    socialInfra: gathering + inp.extraInfra,
    harms: inp.harms,
    repairs: inp.repairs,
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
