// How organised a tile's neighbourhood is, 0..1 (rehoming.md): its voice ABOVE the opening level, so the
// inherited crisis holds until the city actually organises (Circles, Participatory Budgeting, Gift Circles…).
// Tenant organising protects those homes from displacement; an organised neighbourhood welcomes the unhoused
// back. Pure (the architecture guard scans src/civic).

import type { NeighborhoodMap } from './neighborhoods';
import { SEED_VOICE, type CivicState } from './state';

export function neighborhoodVoice(civic: CivicState, partition: NeighborhoodMap, tile: number): number {
  const id = partition.tileToNeighborhood[tile] ?? 0;
  if (id === 0 || id > civic.count()) return 0;
  const above = civic.getValues(id).voice - SEED_VOICE;
  return above <= 0 ? 0 : above / (255 - SEED_VOICE);
}
