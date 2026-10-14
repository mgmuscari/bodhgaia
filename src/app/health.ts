// App shell: neighbourhood health (civic/health.ts — the hub, interdependence §1), recomputed on the civic cadence
// and read by the Civic overlay's health view, the inspect readout and the community events.

import type { GameMap } from '../engine/map';
import type { ParcelStore } from '../engine/fabric';
import type { NeighborhoodMap } from '../civic/neighborhoods';
import type { CivicState } from '../civic/state';
import { neighbourhoodHealth, type NeighbourhoodHealth } from '../civic/health';
import { parcelJobs } from '../economy/readings';

export interface HealthDeps {
  map: GameMap;
  parcels: ParcelStore;
  civic: CivicState;
  partition(): NeighborhoodMap;
  occupancyAt(tile: number): number | undefined;
  coverage(): ReadonlySet<number>;
  /** The jobs lift a place gets for its schooling (live/school.ts), and a civic tick of the schools' learning. */
  jobsLiftAt?(x: number, y: number): number;
  stepLearning?(): void;
  /** Homes with food access (live/food.ts), once the food chain has run. */
  foodAccess?(): ReadonlySet<number> | undefined;
}

export interface HealthController {
  recompute(): void;
  /** A neighbourhood's health by id (undefined before the first reading, or for no neighbourhood). */
  byId(id: number): NeighbourhoodHealth | undefined;
  /** The health of the neighbourhood at `tile`. */
  at(tile: number): NeighbourhoodHealth | undefined;
}

export function createHealthController(deps: HealthDeps): HealthController {
  let values: NeighbourhoodHealth[] = [];
  const byId = (id: number): NeighbourhoodHealth | undefined => (id > 0 ? values[id - 1] : undefined);
  return {
    recompute: () => {
      deps.stepLearning?.(); // the schools teach a little more each civic tick
      values = neighbourhoodHealth({
        map: deps.map,
        parcels: deps.parcels,
        partition: deps.partition(),
        civic: deps.civic,
        occupancyAt: deps.occupancyAt,
        coverage: deps.coverage(),
        jobsAt: (i) => parcelJobs(deps.parcels.get(i)),
        foodAccess: deps.foodAccess?.(),
        jobsLiftAt: deps.jobsLiftAt,
      });
    },
    byId,
    at: (tile) => byId(deps.partition().tileToNeighborhood[tile] ?? 0),
  };
}
