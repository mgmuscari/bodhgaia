// App shell: the opening challenge overlay — assemble its content from the generated world (pure) and
// mount it over the live map (DOM). The map input stays attached beneath; the overlay captures pointer
// events until the player dismisses it (Begin / Enter / Escape), then `onDone` runs.

import type { WorldState } from '../worldgen/pipeline';
import { parseChronicle } from '../worldgen/chronicle';
import { buildReport } from '../worldgen/report';
import { ecologyReport } from '../ecology/report';
import { cityName } from '../engine/names';
import { createRng } from '../engine/rng';
import { statLines, eraLine, challengeText, ecologyStatLine } from '../ui/openingContent';
import { mountOpening, type OpeningContent } from '../ui/opening';

/** The overlay's plain-data content for `world` (generated from `seed`). Pure — no DOM. */
export function openingContentFor(world: WorldState, seed: string): OpeningContent {
  const name = cityName(createRng(seed).fork('city-name'));
  const chronicle = parseChronicle(world.log);
  const report = buildReport(world);
  // The eco-seed wound's DISPLAY half: surface it as a real opening stat line, omitted (null) on the
  // degenerate all-water / no-highway path.
  const ecoLine = ecologyStatLine(ecologyReport(world));
  return {
    name,
    eras: chronicle.entries.map((e) => eraLine(e, { w: world.map.width, h: world.map.height })),
    stats: ecoLine !== null ? [...statLines(report), ecoLine] : statLines(report),
    challenge: challengeText(name, report, chronicle),
  };
}

/** Mount the opening overlay over the live map; `onDone` runs once the player dismisses it. */
export function mountOpeningFor(world: WorldState, seed: string, onDone: () => void, buttonLabel?: string): void {
  mountOpening(document.body, openingContentFor(world, seed), onDone, buttonLabel);
}
