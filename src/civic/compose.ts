// Composite sim orchestrator: one deterministic step that advances ecology and
// civic in a FIXED order (ecology → civic), owning the
// post-tick report recomputes so the cached means stay coherent across the
// 10/50 cadence boundaries. main.ts calls this once per sim tick and only READS
// `deps` for rendering — the cadence logic and the eco/civic caches live here,
// not in the shell, so the composite is headless-testable (N-tick double-run).
//
// Headless + transcendental-Math-free (the architecture guard scans src/civic). The step
// draws no randomness today (traffic is agent-driven in the live layer, not simulated here).
// Communal effort is NOT accrued here: the stock-and-flow economy (src/economy) owns it.
// Sanctioned dependency direction: civic → engine, ecology, tech (the composite wires them;
// none imports back). NO worldgen edge — `world` is typed STRUCTURALLY as {map, parcels}.

import type { GameMap } from '../engine/map';
import type { ParcelStore } from '../engine/fabric';
import type { TechState } from '../tech/state';
import { ECO_CADENCE } from '../ecology/influence';
import { ecologyTick } from '../ecology/tick';
import { ecologyReport } from '../ecology/report';
import { computeNeighborhoods, type NeighborhoodMap } from './neighborhoods';
import type { CivicState } from './state';
import { civicTick, type CivicCaps } from './dynamics';
import { civicReport } from './report';

/** Civic dynamics run once every CIVIC_CADENCE sim ticks (the slowest cadence). */
export const CIVIC_CADENCE = 50;

/** The structural slice of the world the orchestrator touches (no worldgen edge). */
export interface SimWorld {
  map: GameMap;
  parcels: ParcelStore;
}

/**
 * The mutated-in-place sim state. `partition` is the LIVE NeighborhoodMap
 * (replaced on each civic refresh) that main.ts reads to resolve a repair's
 * (x, y) → neighborhoodId between refreshes. `ecoMeans`/`civicMeans` are the
 * caches the economy's wellbeing reading consumes — undefined until their first
 * recompute (that term then contributes 0, the pre-civic degrade).
 */
export interface SimDeps {
  world: SimWorld;
  tech: TechState;
  civic: CivicState;
  partition: NeighborhoodMap;
  ecoMeans?: { soil: number; flora: number; fauna: number };
  civicMeans?: { belonging: number; voice: number; trust: number };
}

/** What fired this tick — for the shell's dirty-marking. */
export interface SimTickResult {
  ecoTicked: boolean;
  civicTicked: boolean;
}

/**
 * Advance the composite sim by one tick, fixed order ecology → civic:
 *
 *  1. ECOLOGY at tick>0 && %ECO_CADENCE: ecologyTick, THEN recompute ecologyReport
 *     and write `deps.ecoMeans`.
 *  2. CIVIC at tick>0 && %CIVIC_CADENCE: recompute the partition, REMAP the civic
 *     state onto it, run civicTick, THEN recompute civicReport and write
 *     `deps.civicMeans`. The practices' effects are resolved from tech HERE (passed
 *     to dynamics as plain numbers, so civic never imports tech for the consume).
 *
 * Returns the per-tick fire flags. Effort is untouched — the economy owns it.
 */
export function simTick(deps: SimDeps, tick: number): SimTickResult {
  // Traffic is AGENT-DRIVEN (the 1989 aggregate O-D field is retired): the live travelers
  // (citizen cars in the ambient layer) lay a live traffic density as they actually drive, route
  // AROUND it, and pedestrians shun it. Nothing here touches traffic — the seeded WORLD stays
  // reproducible while the dynamic traffic layer emerges from the agents.
  // See docs/decisions/live-agent-layer.md.

  // 1. Ecology cadence → tick + recompute means.
  let ecoTicked = false;
  if (tick > 0 && tick % ECO_CADENCE === 0) {
    ecologyTick(deps.world.map);
    const r = ecologyReport(deps.world);
    deps.ecoMeans = { soil: r.soilMean, flora: r.floraMean, fauna: r.faunaMean };
    ecoTicked = true;
  }

  // 2. Civic cadence → partition refresh, remap, dynamics, recompute means.
  let civicTicked = false;
  if (tick > 0 && tick % CIVIC_CADENCE === 0) {
    const newPartition = computeNeighborhoods(deps.world.map);
    deps.civic.remap(deps.partition, newPartition);
    deps.partition = newPartition;
    const caps: CivicCaps = { voicePerTick: deps.tech.effects().voicePerTick };
    civicTick(deps.world.map, deps.world.parcels, deps.partition, deps.civic, caps, tick);
    const cr = civicReport(deps.civic, deps.partition);
    deps.civicMeans = {
      belonging: cr.belongingMean,
      voice: cr.voiceMean,
      trust: cr.trustMean,
    };
    civicTicked = true;
  }

  return { ecoTicked, civicTicked };
}
