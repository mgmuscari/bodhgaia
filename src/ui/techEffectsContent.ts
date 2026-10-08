// Tech effect text: what each tech does to the simulation, in exact numbers, for the Commons panel.
// Pure content (no DOM, no transcendental Math — on the architecture guard's pure-ui allowlist).
//
// Nothing here is a second copy of a coefficient. A practice's lines render its declared effects
// (tech/effects.ts) against the base values the sim runs on; a building's lines read its kind's rows
// in the sim's own tables (power, coverage, refuge, gathering, ecology, housing, travel modes). Change
// a number in the sim and the panel follows.

import { BuiltKind, isServiceStation, isTransportKind } from '../engine/fabric';
import { GameMap } from '../engine/map';
import { NODE_EFFECTS, type Effect } from '../tech/effects';
import type { TechNode } from '../tech/tree';
import { MAKER_RADIUS, MAKER_REPAIR } from '../growth/revival';
import { POND_REACH } from '../growth/flood';
import {
  BATTERY_CAPACITY,
  BATTERY_RATE,
  LOCAL_GRID_RADIUS,
  ROOF_SOLAR_FROM,
  ROOF_SOLAR_TO,
  SMART_GRID_CUT,
  SMART_GRID_FROM,
  SMART_GRID_RADIUS,
  SMART_GRID_TO,
  plantOutput,
  plantPollution,
} from '../growth/power';
import { GATHERING_KINDS } from '../civic/dynamics';
import { influenceOf } from '../ecology/influence';
import { PAVED_CAP, SOIL_RECOVERY } from '../ecology/tick';
import { COMMUNE_COMMERCE_SHARE, RAIL_COMMERCE_LIFT, RAIL_COMMERCE_RADIUS, BAZAAR_LIFT, BAZAAR_RADIUS, COMMUNE_REGEN, COMPOST_RADIUS, COMPOST_TENDING, LAND_TRUST_RADIUS, PROTECTED, TENDING, UPKEEP } from '../economy/readings';
import { ECON } from '../economy/model';
import { visitValue } from '../citizens/plots';
import { VILLAGE_RESIDENTS } from '../citizens/census';
import { TravelMode, modeSpec } from '../citizens/modes';
import {
  ADU_HOUSE_HEADROOM,
  AMENITY_KINDS,
  FRESH_FOOD_PULL,
  FRESH_FOOD_RADIUS,
  PARKLET_RADIUS,
  PARKLET_SHIFT,
  BIKE_RANGE,
  OCC_FLOOR,
  COVERAGE_RADIUS,
  GREEN_HEAL_KINDS,
  GREEN_HEAL_RADIUS,
  OCC_HEADROOM,
  REFUGE_KINDS,
  SAFE_RADIUS,
  RAIL_NOISE,
  RAIL_NOISE_RADIUS,
  TRAFFIC_MAX,
  WALK_RANGE,
  WATER_TREAT_RADIUS,
} from '../live/tuning';
import { pedCost } from '../live/pathing';
import { toolDef } from '../tools/tools';

export interface EffectLines {
  /** What it changes in the simulation. */
  effects: string[];
  /** What it costs to keep (money upkeep or tending effort). */
  costs: string[];
}

const num = (v: number): string => String(Math.round(v * 100) / 100);
const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** One declared effect as a sentence. */
function practiceLine(e: Effect): string {
  switch (e.key) {
    case 'walkStretch':
      return `People walk up to ${num(WALK_RANGE * (e.value as number))} tiles before riding (was ${WALK_RANGE})`;
    case 'voicePerTick':
      return `Neighbourhood voice +${e.value} per civic tick where people belong (+${(e.value as number) * 2} where belonging is strong) — voice protects homes from rent and welcomes the unhoused back`;
    case 'socialInfra':
      return `Effort capacity +${pct(ECON.capPerInfra * (e.value as number))} (social infrastructure +${e.value})`;
    case 'roadConversions': {
      const names = [BuiltKind.RoadStreet, BuiltKind.RoadAvenue, BuiltKind.PlantedMedian]
        .map((k) => toolDef(`convert-${k}`)?.name)
        .filter((n): n is string => !!n);
      return `Unlocks road conversions: ${names.join(', ')}`;
    }
    case 'landTrust':
      return `Homes within ${LAND_TRUST_RADIUS} tiles of a co-op, commune or healing commons are rent-protected`;
    case 'tendingMul':
      return `The commons need ${pct(1 - (e.value as number))} less tending effort`;
    case 'craftInfra':
      return `Each maker space and bazaar adds ${pct(ECON.capPerInfra * (e.value as number))} effort capacity`;
    case 'taxPainMul':
      return `Taxes cost ${pct(1 - (e.value as number))} less approval`;
    case 'burnoutHealMul':
      return `Burnout recovers ${num(e.value as number)}× as fast`;
    case 'bikeStretch':
      return `People cycle up to ${num(BIKE_RANGE * (e.value as number))} tiles before driving (was ${BIKE_RANGE})`;
    case 'arrestRelease':
      return `${pct(e.value as number)} of police stops go to a circle instead of an arrest`;
    case 'droneShopDrop':
      return `${pct(e.value as number)} of driven shopping trips are delivered instead`;
    case 'occFloor':
      return `Neighbours take people in: no home falls below ${pct(e.value as number)} of its residents (was ${pct(OCC_FLOOR)})`;
    case 'industryVisit':
      return `A day at worker-owned industry costs ${-(e.value as number)} wellbeing (was ${-visitValue(BuiltKind.Industrial)})`;
    case 'spillRate':
      return `Worker-owned works spill ${pct(1 - (e.value as number))} less often — the people who run them live downwind`;
    case 'homeDayDemand':
      return `Rooftop solar: homes draw ${pct(1 - (e.value as number))} less power ${ROOF_SOLAR_FROM}:00–${ROOF_SOLAR_TO}:00`;
    case 'renewableOutput':
      return `Hydro, wind and solar plants make ${pct((e.value as number) - 1)} more power`;
    case 'localGrids':
      return `In a blackout, homes within ${LOCAL_GRID_RADIUS} tiles of an energy node are kept lit first`;
    case 'soilRecovery':
      return `Open soil recovers ${num(SOIL_RECOVERY * (e.value as number))} a tick (was ${SOIL_RECOVERY})`;
    case 'pavedSoilCap':
      return `Soil under pavement can heal to ${e.value} (was ${PAVED_CAP})`;
  }
}

/** A practice's effects, one sentence each ([] if it declares none). */
export function practiceEffectLines(id: string): string[] {
  return (NODE_EFFECTS[id] ?? []).map(practiceLine);
}

/** The route cost a walker sees on a bare tile of `kind` (a plain street with no traffic is 0.55). */
function walkCost(kind: number, traffic = 0): number {
  const m = new GameMap(1, 1);
  m.built[0] = kind;
  return pedCost(m, 0, 0, undefined, new Map([[0, traffic]]));
}

const STREET_WALK = `${num(walkCost(BuiltKind.RoadStreet))}–${num(walkCost(BuiltKind.RoadStreet, TRAFFIC_MAX))}`;

/** The travel modes that ride fast on `kind` (not driving). */
const RIDDEN_BY = [TravelMode.Bike, TravelMode.Streetcar, TravelMode.ElevatedRail].map(modeSpec);

/** A built kind's effects and running costs, read from the sim's tables. */
export function kindEffectLines(kind: BuiltKind): EffectLines {
  const effects: string[] = [];
  const out = plantOutput(kind);
  if (out > 0) effects.push(`Generates ${out} power${plantPollution(kind) > 0 ? ', with smoke' : ', no smoke'}`);
  if (kind === BuiltKind.EnergyNode) effects.push(`Battery: banks up to ${BATTERY_CAPACITY} of its grid's surplus, gives back up to ${BATTERY_RATE} an hour when power runs short`);
  if (kind === BuiltKind.SolarPlant) effects.push('Follows the sun: full at noon, half at 09:00 and 15:00, nothing 18:00–06:00');
  if (kind === BuiltKind.WindTurbine) effects.push('Gusts hour to hour (0.4–1.6× its rating), blowing harder 20:00–06:00');
  if (isServiceStation(kind)) effects.push(`Fire & health cover within ${COVERAGE_RADIUS} tiles`);
  if (REFUGE_KINDS.has(kind)) effects.push(`Police won't patrol or arrest within ${SAFE_RADIUS} tiles`);
  if (GATHERING_KINDS.has(kind)) effects.push("Gathering place: its neighbourhood's belonging +1 per civic tick");
  if (kind === BuiltKind.WastewaterWorks) effects.push(`Cleans contaminated water within ${WATER_TREAT_RADIUS} tiles`);
  if (kind === BuiltKind.RetentionPond) effects.push(`Keeps the land within ${POND_REACH} tiles from flooding`);
  if (GREEN_HEAL_KINDS.has(kind)) effects.push(`Heals ground pollution within ${GREEN_HEAL_RADIUS} tiles`);
  if (AMENITY_KINDS.has(kind)) effects.push("Raises its neighbours' land value");
  const eco = influenceOf(kind);
  if (eco.soil || eco.flora || eco.fauna) {
    effects.push(`Ecology on its tiles: soil +${eco.soil}, flora +${eco.flora}, fauna +${eco.fauna}`);
  }
  if (kind === BuiltKind.Parklet) effects.push(`Takes the curb's parking: homes within ${PARKLET_RADIUS} tiles drive ${pct(PARKLET_SHIFT)} fewer trips`);
  if (kind === BuiltKind.VerticalFarm) effects.push(`Fresh food: homes within ${FRESH_FOOD_RADIUS} tiles hold their residents (+${FRESH_FOOD_PULL} pull)`);
  if (kind === BuiltKind.ADU) effects.push(`Built in a house's back yard: that house can fill to ${ADU_HOUSE_HEADROOM}× (was ${OCC_HEADROOM.get(BuiltKind.HouseSingle)}×)`);
  if (kind === BuiltKind.AINode) {
    effects.push(`Smart grid: homes within ${SMART_GRID_RADIUS} tiles draw ${pct(SMART_GRID_CUT)} less power ${SMART_GRID_FROM}:00–${SMART_GRID_TO}:00`);
  }
  if (kind === BuiltKind.Commune) {
    effects.push('Its residents work at home and own no cars');
    effects.push(`Doubles as a market: neighbours shop here; taxed at ${pct(COMMUNE_COMMERCE_SHARE)} of a shop its size`);
  }
  if (kind === BuiltKind.MakerSpace) effects.push(`Fix-it shop: buildings within ${MAKER_RADIUS} tiles regain ${MAKER_REPAIR} condition every civic tick`);
  if (kind === BuiltKind.ElevatedRail) {
    effects.push(`Stations: shops within ${RAIL_COMMERCE_RADIUS} tiles of the line pay ${pct(RAIL_COMMERCE_LIFT - 1)} more tax`);
    effects.push(`Noise: homes within ${RAIL_NOISE_RADIUS} tiles of the line lose ${RAIL_NOISE} pull`);
  }
  if (kind === BuiltKind.CompostHub) effects.push(`Gardens and vertical farms within ${COMPOST_RADIUS} tiles need ${pct(1 - COMPOST_TENDING)} less tending`);
  if (kind === BuiltKind.Bazaar) effects.push(`Draws a crowd: shops within ${BAZAAR_RADIUS} tiles pay ${pct(BAZAAR_LIFT - 1)} more tax`);
  if (kind === BuiltKind.Commune) effects.push(`Pooled lives: its households give ${COMMUNE_REGEN}× the effort`);
  if (kind === BuiltKind.TinyHomes) effects.push(`Shelters ${VILLAGE_RESIDENTS} of the city's unhoused — and only them`);
  const headroom = OCC_HEADROOM.get(kind);
  if (headroom !== undefined && headroom > 1) effects.push(`Home: fills up to ${headroom}× its first residents`);
  if (PROTECTED.has(kind)) effects.push('Rent-protected: residents are never priced out by land value');
  if (kind === BuiltKind.CoopHousing || kind === BuiltKind.Commune) effects.push('Makes room for the unhoused: re-homes them at the full rate, organised neighbourhood or not');
  const visit = visitValue(kind);
  if (visit > 0) effects.push(`Visitors bring home +${visit} wellbeing`);
  for (const m of RIDDEN_BY) {
    if (m.network.has(kind)) effects.push(`${m.label[0]!.toUpperCase()}${m.label.slice(1)} travel at ${m.networkSpeed}× walking speed`);
  }
  if (kind === BuiltKind.QuietStreet || kind === BuiltKind.Promenade || kind === BuiltKind.BikePath) {
    effects.push(`No cars; walkers prefer it (route cost ${num(walkCost(kind))} vs a street's ${STREET_WALK} with traffic)`);
  }

  const costs: string[] = [];
  const upkeep = UPKEEP.get(kind);
  if (upkeep !== undefined) costs.push(`Upkeep: $${num(upkeep)}/${isTransportKind(kind) ? 'tile/' : ''}hour`);
  const tending = TENDING.get(kind);
  if (tending !== undefined) costs.push(`Tending: ${num(tending)} effort/hour`);
  return { effects, costs };
}

/** Everything a node does: its practice effects, then each granted building's. */
export function nodeEffectLines(node: TechNode): EffectLines {
  const effects = practiceEffectLines(node.id);
  const costs: string[] = [];
  for (const k of node.grants.kinds ?? []) {
    const l = kindEffectLines(k);
    effects.push(...l.effects);
    costs.push(...l.costs);
  }
  return { effects, costs };
}
