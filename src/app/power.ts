// App shell: the power controller. The grid is a live DERIVED field (flood-fill from plants over the built
// layer, capacity vs demand → which consumers are powered), solved for the current in-game hour (time-varying
// demand + rolling blackouts). Re-solved on placement, on the civic cadence, and once per new in-game hour from
// the frame loop; each solve is published to the renderer (unpowered consumers get a red pip). Derived from the
// hashed built layer → never hashed itself. Readers hold the controller and call grid() — never a snapshot.

import type { GameMap } from '../engine/map';
import type { ParcelStore } from '../engine/fabric';
import { computePowerGrid, type PowerGrid } from '../growth/power';
import { gameClock } from '../ui/lighting';

export interface PowerDeps {
  map: GameMap;
  parcels: ParcelStore;
  /** Receives the powered anchors after every solve (renderer.setPowerGrid). */
  publish: (poweredAnchors: Set<number>) => void;
  /** Wall-clock seconds the in-game clock reads (default performance.now() / 1000). */
  nowSec?: () => number;
}

export interface PowerController {
  /** The current grid (replaced by every solve). */
  grid(): PowerGrid;
  /** Re-solve for the current hour and publish; true iff capacity/demand/powered count changed. */
  recompute(): boolean;
  /** Re-solve iff the in-game hour at `nowMs` differs from the last solve's; true iff that solve changed. */
  maybeResolveHour(nowMs: number): boolean;
}

const signature = (g: PowerGrid): string => `${g.capacity}/${g.demand}/${g.poweredAnchors.size}`;

export function createPowerController(deps: PowerDeps): PowerController {
  const { map, parcels, publish } = deps;
  const nowSec = deps.nowSec ?? ((): number => performance.now() / 1000);
  const clock0 = gameClock(nowSec());
  let grid = computePowerGrid(map, parcels, clock0);
  let sig = signature(grid);
  let slot = clock0.slot;
  publish(grid.poweredAnchors);

  const recompute = (): boolean => {
    const clock = gameClock(nowSec());
    slot = clock.slot;
    grid = computePowerGrid(map, parcels, clock);
    publish(grid.poweredAnchors);
    const next = signature(grid);
    const changed = next !== sig;
    sig = next;
    return changed;
  };

  return {
    grid: () => grid,
    recompute,
    maybeResolveHour: (nowMs) => gameClock(nowMs / 1000).slot !== slot && recompute(),
  };
}
