// Live-layer WIND: the world's prevailing wind, seeded from the ambient rng (leaf module — tuning
// table + the Rng type only). Cut verbatim from ui/ambientContent.ts; createAmbientState reads it.

import type { Rng } from '../engine/rng';
import { WIND_DIRS } from './tuning';

/** The world's prevailing wind as an integer unit vector, drawn from the (seeded) ambient rng so it
 *  is consistent per world seed and NEVER touches the sim/worldgen streams. Defaults to a westerly
 *  (blowing due east) when no rng is supplied, so the no-arg `createAmbientState()` stays usable. */
export function prevailingWind(rng?: Rng): { dx: number; dy: number } {
  const [dx, dy] = rng ? WIND_DIRS[rng.nextInt(WIND_DIRS.length)]! : WIND_DIRS[2]!;
  return { dx, dy };
}
