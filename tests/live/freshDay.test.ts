// A fresh load (Maddy 2026-10-08: "agents should start at a random step in their day, because we get huge swarms
// pathing together"): while the streets fill, each citizen joins their day somewhere along it — not all leaving
// home for work at once.
import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/engine/rng';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';
import { residentialCensus } from '../../src/citizens/census';
import { createAmbientState, setHouseholds } from '../../src/live/types';
import { spawnCitizens } from '../../src/live/agents';

describe('a fresh load staggers the day', () => {
  it('the first citizens out set off from all along their day, not all from home to work', () => {
    const world = runPipeline({ seed: 'r', width: 48, height: 48 }, [terrainStage(), mosesCenturyStage(), ecoSeedStage()]);
    const state = createAmbientState();
    setHouseholds(state, residentialCensus(world.parcels));
    const rng = createRng('fresh').fork('f');
    for (let k = 0; k < 60; k++) spawnCitizens(state, world.map, rng);
    const out = state.peds.filter((p) => p.itinerary !== undefined);
    expect(out.length).toBeGreaterThan(20);
    const firstLeg = out.filter((p) => p.itinStep === 0).length;
    expect(firstLeg / out.length).toBeLessThan(0.6); // most are somewhere later in their day
    const steps = new Set(out.map((p) => (p.phase === 'to-home' ? 'home' : p.itinStep)));
    expect(steps.size).toBeGreaterThanOrEqual(3);
  });
});
