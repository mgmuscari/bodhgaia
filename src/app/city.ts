// App shell: the city — the world generated from its seed, the tech tree and the civic state, plus the sim deps
// simTick reads. A resumed game (save/store.ts: the CURRENT slot) brings its own seed and size: the world is
// regenerated from the seed, then the saved layers and parcels, grants and civic cells overwrite it — BEFORE
// anything derives from it (the partition, the census, the power grid…).

import { runPipeline, type WorldState } from '../worldgen/pipeline';
import { terrainStage } from '../worldgen/terrain';
import { mosesCenturyStage } from '../worldgen/moses';
import { ecoSeedStage } from '../worldgen/ecoseed';
import { TECH_TREE } from '../tech/tree';
import { createTechState, type TechState } from '../tech/state';
import { computeNeighborhoods } from '../civic/neighborhoods';
import { createCivicState, type CivicState } from '../civic/state';
import type { SimDeps } from '../civic/compose';
import { restoreWorld, restoreTech, restoreCivic, type SaveV1 } from '../save/snapshot';

export interface CityDeps {
  /** The URL / default seed (a save's own seed wins). */
  seed: string;
  /** The settings' world size (a save's own size wins). */
  size: { width: number; height: number };
  save: SaveV1 | null;
}

export interface City {
  seed: string;
  world: WorldState;
  tech: TechState;
  civic: CivicState;
  /** simTick's deps. simTick refreshes `partition` and remaps the civic state on the civic cadence. */
  sim: SimDeps;
}

export function createCity({ seed: urlSeed, size, save }: CityDeps): City {
  const seed = save?.seed ?? urlSeed;
  const world = runPipeline(
    { seed, width: save?.width ?? size.width, height: save?.height ?? size.height },
    [terrainStage(), mosesCenturyStage(), ecoSeedStage()],
  );
  if (save) restoreWorld(world, save.world);
  // communal effort accrues into the tech state each sim tick
  const tech = createTechState(TECH_TREE);
  if (save) restoreTech(tech, save.tech);
  // the neighborhood partition + per-neighborhood belonging / voice / trust
  const partition = computeNeighborhoods(world.map);
  const civic = createCivicState(partition);
  if (save) restoreCivic(civic, save.civic);
  // effortAccrual 'economy': communal effort is the economy's perishable stock (src/economy), not a counter
  const sim: SimDeps = { world, tech, civic, partition, seed, effortAccrual: 'economy' };
  return { seed, world, tech, civic, sim };
}
