// Live-layer OCCUPANCY field: each home's live population drifting between its floor and capacity
// under land value, smog and the wellbeing its citizens bring home, and the street-population target
// it implies. Cut verbatim from ui/ambientContent.ts; the stepper sets the cadence.

import type { GameMap } from '../../engine/map';
import { sampleField } from '../../citizens/field';
import { liveCaps } from '../caps';
import {
  INHERITED_VACANCY,
  OCC_EXPECT_RATE,
  OCC_FLOOR,
  OCC_HEADROOM,
  OCC_HEALTH_CAP,
  OCC_HEALTH_SCALE,
  OCC_LV_NEUTRAL,
  OCC_POLL_W,
  OCC_RATE,
  OCC_SETTLE_PASSES,
  POLL_MAX,
} from '../tuning';
import type { AmbientState } from '../types';

/** A residential building's occupancy CEILING (pure decision seam): its seeded baseline lifted by a
 *  per-kind headroom — a single house barely densifies, an apartment block holds far more. So a
 *  thriving home fills up toward this without the building itself changing (the deterministic stock
 *  is fixed); a derelict (zero baseline) holds nobody. */
export function capacityOf(kind: number, baseCount: number): number {
  return baseCount * (OCC_HEADROOM.get(kind) ?? 1.5);
}

/** The pull on a home's population (pure): land value above OCC_LV_NEUTRAL attracts residents, below
 *  it sheds them; nearby smog repels; the wellbeing its citizens carry home (building health) tips it
 *  either way. Sign drives grow vs shrink, magnitude scales the rate. */
export function occupancySignal(landValue: number, pollution: number, health: number): number {
  let s = (landValue - OCC_LV_NEUTRAL) / 255; // land value is the anchor
  s -= (pollution / POLL_MAX) * OCC_POLL_W; // smog pushes out
  const h = health / OCC_HEALTH_SCALE; // building health is only a small bounded nudge
  s += h < -OCC_HEALTH_CAP ? -OCC_HEALTH_CAP : h > OCC_HEALTH_CAP ? OCC_HEALTH_CAP : h;
  return s;
}

/** One occupancy drift step (pure): nudge toward the ceiling on a positive signal, toward the floor on
 *  a negative one, clamped to [floor, capacity]. The floor keeps a struggling home populated — a city
 *  thins but never becomes a literal ghost town. */
export function occupancyStep(occ: number, floor: number, capacity: number, signal: number): number {
  const next = occ + signal * OCC_RATE;
  return next < floor ? floor : next > capacity ? capacity : next;
}

/** How many citizens to keep out on their round, from the live total occupancy: a THIRD of the
 *  residents (Maddy), scaling with the city — no flat ceiling, so a populous city fills the streets
 *  and a declining one visibly empties them. The hard perf ceiling is liveCaps.pedCap, applied where peds
 *  actually spawn (spawnCitizens), not here. */
export function spawnTargetFor(totalOccupancy: number): number {
  return Math.round(totalOccupancy / liveCaps.citizenOutDivisor);
}

/** Re-evaluate every home's occupancy from the live conditions at its tile (land value, smog, the
 *  wellbeing its citizens bring home), drifting it toward capacity or empty. Seeded lazily from the
 *  census baseline; rebuilt fresh over the current homes each pass so a demolished home drops out.
 *  Gated to OCC_CADENCE by the caller. Live layer — reads the other live fields, writes only occupancy. */
export function stepOccupancy(state: AmbientState, map: GameMap): void {
  const homes = state.households;
  if (!homes || homes.length === 0) {
    state.occupancy.clear();
    return;
  }
  const next = new Map<number, number>();
  const expect = new Map<number, number>();
  const settling = state.occPasses < OCC_SETTLE_PASSES;
  for (const h of homes) {
    const t = map.idx(h.x, h.y);
    const cap = capacityOf(map.built[t]!, h.count);
    const floor = h.count * state.practices.occFloor; // a home never thins below this fraction of its baseline (Mutual Aid raises it)
    const cur = state.occupancy.get(t) ?? h.count; // seed lazily at the census baseline
    const raw = occupancySignal(
      sampleField(state.landValue, t),
      sampleField(state.pollution, t),
      state.buildingHealth.get(t) ?? 0,
    );
    // a new home (or the opening) takes its conditions as normal
    const was = settling ? raw : (state.occExpect.get(t) ?? raw);
    next.set(t, occupancyStep(cur, floor, cap, raw - was));
    expect.set(t, was + (raw - was) * OCC_EXPECT_RATE);
  }
  state.occupancy = next;
  state.occExpect = expect;
  state.occPasses += 1;
}

/** The inherited housing crisis: open each home emptied by INHERITED_VACANCY × its redline grade, floored at
 *  OCC_FLOOR — the displaced are the city's opening unhoused population. Called by seedDecay (the city starts
 *  decayed); a resumed game's saved occupancy overwrites it. */
export function seedInheritedOccupancy(state: AmbientState, map: GameMap): void {
  for (const h of state.households ?? []) {
    const t = map.idx(h.x, h.y);
    const grade = map.redline[t]! / 255;
    const left = h.count * (1 - INHERITED_VACANCY * grade);
    state.occupancy.set(t, left < h.count * OCC_FLOOR ? h.count * OCC_FLOOR : left);
  }
}
