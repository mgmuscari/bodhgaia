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
import { plantOutput, plantPollution } from '../growth/power';
import { GATHERING_KINDS } from '../civic/dynamics';
import { influenceOf } from '../ecology/influence';
import { PROTECTED, TENDING, UPKEEP } from '../economy/readings';
import { ECON } from '../economy/model';
import { visitValue } from '../citizens/plots';
import { TravelMode, modeSpec } from '../citizens/modes';
import {
  AMENITY_KINDS,
  COVERAGE_RADIUS,
  GREEN_HEAL_KINDS,
  GREEN_HEAL_RADIUS,
  OCC_HEADROOM,
  REFUGE_KINDS,
  SAFE_RADIUS,
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
      return `Neighbourhood voice +${e.value} per civic tick where people belong (+${(e.value as number) * 2} where belonging is strong)`;
    case 'socialInfra':
      return `Effort capacity +${pct(ECON.capPerInfra * (e.value as number))} (social infrastructure +${e.value})`;
    case 'roadConversions': {
      const names = [BuiltKind.RoadStreet, BuiltKind.RoadAvenue, BuiltKind.PlantedMedian]
        .map((k) => toolDef(`convert-${k}`)?.name)
        .filter((n): n is string => !!n);
      return `Unlocks road conversions: ${names.join(', ')}`;
    }
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
  if (isServiceStation(kind)) effects.push(`Fire & health cover within ${COVERAGE_RADIUS} tiles`);
  if (REFUGE_KINDS.has(kind)) effects.push(`Police won't patrol or arrest within ${SAFE_RADIUS} tiles`);
  if (GATHERING_KINDS.has(kind)) effects.push("Gathering place: its neighbourhood's belonging +1 per civic tick");
  if (kind === BuiltKind.WastewaterWorks) effects.push(`Cleans contaminated water within ${WATER_TREAT_RADIUS} tiles`);
  if (GREEN_HEAL_KINDS.has(kind)) effects.push(`Heals ground pollution within ${GREEN_HEAL_RADIUS} tiles`);
  if (AMENITY_KINDS.has(kind)) effects.push("Raises its neighbours' land value");
  const eco = influenceOf(kind);
  if (eco.soil || eco.flora || eco.fauna) {
    effects.push(`Ecology on its tiles: soil +${eco.soil}, flora +${eco.flora}, fauna +${eco.fauna}`);
  }
  const headroom = OCC_HEADROOM.get(kind);
  if (headroom !== undefined) effects.push(`Home: fills up to ${headroom}× its first residents`);
  if (PROTECTED.has(kind)) effects.push('Rent-protected: residents are never priced out by land value');
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
