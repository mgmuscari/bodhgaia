import { describe, it, expect } from 'vitest';
import { openingContentFor } from '../../src/app/opening';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';
import { cityName } from '../../src/engine/names';
import { createRng } from '../../src/engine/rng';
import { parseChronicle } from '../../src/worldgen/chronicle';
import { buildReport } from '../../src/worldgen/report';
import { ecologyReport } from '../../src/ecology/report';
import { statLines, eraLine, ecologyStatLine } from '../../src/ui/openingContent';

describe('openingContentFor: the opening overlay content from a generated world', () => {
  const seed = 'lotus';
  const world = runPipeline({ seed, width: 64, height: 64 }, [terrainStage(), mosesCenturyStage(), ecoSeedStage()]);
  const content = openingContentFor(world, seed);

  it('names the city from the seed (the same name the toolbar shows)', () => {
    expect(content.name).toBe(cityName(createRng(seed).fork('city-name')));
  });

  it('has one line per chronicle era, its places measured on this map', () => {
    const chronicle = parseChronicle(world.log);
    expect(content.eras).toEqual(chronicle.entries.map((e) => eraLine(e, { w: 64, h: 64 })));
    expect(content.eras.length).toBeGreaterThan(0);
  });

  it('lists the report stats, then the ecology wound line when there is one', () => {
    const base = statLines(buildReport(world));
    const eco = ecologyStatLine(ecologyReport(world));
    expect(content.stats).toEqual(eco !== null ? [...base, eco] : base);
  });

  it('carries a non-empty challenge', () => {
    expect(content.challenge.length).toBeGreaterThan(0);
  });
});
