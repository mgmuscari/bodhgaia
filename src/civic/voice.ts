// A tile's neighbourhood voice as 0..1 — how organised the people there are (rehoming.md): tenant organising
// protects their homes from displacement, and an organised neighbourhood welcomes the unhoused back. Pure
// (the architecture guard scans src/civic).

import type { NeighborhoodMap } from './neighborhoods';
import type { CivicState } from './state';

export function neighborhoodVoice(civic: CivicState, partition: NeighborhoodMap, tile: number): number {
  const id = partition.tileToNeighborhood[tile] ?? 0;
  if (id === 0 || id > civic.count()) return 0;
  return civic.getValues(id).voice / 255;
}
