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
  REHOME_FRESH,
  REHOME_WELCOME,
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
    for (const v of state.occupancy.values()) state.unhoused += v; // every home gone: its people too
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
    let cur = state.occupancy.get(t);
    if (cur === undefined) {
      // the opening census is seeded full; a home BUILT since opens empty and fills (rehoming.md)
      if (state.occPasses === 0) cur = h.count;
      else {
        cur = 0;
        (state.freshHomes ??= new Set()).add(t);
      }
    }
    const raw = occupancySignal(
      sampleField(state.landValue, t),
      sampleField(state.pollution, t),
      state.buildingHealth.get(t) ?? 0,
    );
    // a new home (or the opening) takes its conditions as normal
    const was = settling ? raw : (state.occExpect.get(t) ?? raw);
    let occ = moveFromPool(state, cur, occupancyStep(cur, floor, cap, raw - was));
    // Re-homing into room below the home's baseline: a fresh home fills at REHOME_FRESH (from the pool,
    // else from people moving to the city); any home is welcomed back at REHOME_WELCOME × its voice.
    const room = h.count - occ;
    if (room > 0) {
      const welcome = state.welcome?.get(t) ?? 0;
      const moved = state.freshHomes?.has(t)
        ? Math.min(room, REHOME_FRESH * h.count)
        : Math.min(room, state.unhoused, REHOME_WELCOME * welcome * h.count);
      occ = moveFromPool(state, occ, occ + moved);
    }
    if (occ >= h.count) state.freshHomes?.delete(t);
    next.set(t, occ);
    expect.set(t, was + (raw - was) * OCC_EXPECT_RATE);
  }
  // a home torn down puts its residents out
  for (const [t, v] of state.occupancy) if (!next.has(t)) state.unhoused += v;
  state.occupancy = next;
  state.occExpect = expect;
  state.occPasses += 1;
}

/** A home's occupancy moving `cur` → `to`: a loss goes to the unhoused; a gain is drawn from them first (the
 *  rest are people moving to the city). Returns `to`. */
function moveFromPool(state: AmbientState, cur: number, to: number): number {
  if (to < cur) state.unhoused += cur - to;
  else if (to > cur) state.unhoused = Math.max(0, state.unhoused - (to - cur));
  return to;
}

/** The inherited housing crisis: open each home emptied by INHERITED_VACANCY × its redline grade, floored at
 *  OCC_FLOOR — the displaced are the city's opening unhoused population. Called by seedDecay (the city starts
 *  decayed); a resumed game's saved occupancy overwrites it. */
export function seedInheritedOccupancy(state: AmbientState, map: GameMap): void {
  for (const h of state.households ?? []) {
    const t = map.idx(h.x, h.y);
    const grade = map.redline[t]! / 255;
    const raw = h.count * (1 - INHERITED_VACANCY * grade);
    const left = raw < h.count * OCC_FLOOR ? h.count * OCC_FLOOR : raw;
    state.occupancy.set(t, left);
    state.unhoused += h.count - left; // the displaced are the opening's unhoused
  }
}

/** Rent displacement (rehoming.md): take `amount` people out of real homes into the unhoused — unprotected
 *  homes on the dearest land first (weighted by land value × what the home can lose × its unprotected share),
 *  never below a home's floor. `protectionAt` is each home's protection 0..1 (economy/readings
 *  homeProtections). Returns how many were actually displaced (less than `amount` when homes are at their
 *  floors or protected). */
export function displaceFromHomes(state: AmbientState, map: GameMap, amount: number, protectionAt: (tile: number) => number): number {
  if (!(amount > 0)) return 0;
  const homes: { t: number; spare: number; w: number }[] = [];
  let total = 0;
  for (const h of state.households ?? []) {
    const t = map.idx(h.x, h.y);
    const occ = state.occupancy.get(t);
    if (occ === undefined) continue;
    const spare = occ - h.count * state.practices.occFloor;
    const open = 1 - protectionAt(t);
    if (spare <= 0 || open <= 0) continue;
    const w = spare * open * (sampleField(state.landValue, t) + 1);
    homes.push({ t, spare, w });
    total += w;
  }
  let moved = 0;
  for (const h of homes) {
    const take = Math.min(h.spare, (amount * h.w) / total);
    state.occupancy.set(h.t, state.occupancy.get(h.t)! - take);
    moved += take;
  }
  state.unhoused += moved;
  return moved;
}
