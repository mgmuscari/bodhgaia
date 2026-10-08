// Disaster demos (DEV only: `?demo=fire|spill|disasters`): stage each disaster in a fresh city so it can be seen
// without waiting for it — a fire a short drive from a fire station (the truck comes and puts it out), then a spill
// at the most redlined works (the cloud drifts downwind). The camera goes to each. Serve it on a port of its own:
// a demo fire can leave a mark on the city.

import type { GameMap } from '../engine/map';
import { BuiltKind, type ParcelStore } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import type { AmbientState } from '../live/types';
import { startSpill } from '../live/spills';
import { floodPlain } from '../growth/flood';
import { crash as crashCar } from '../live/accidents';
import { createRng } from '../engine/rng';

export type DemoKind = 'fire' | 'spill' | 'flood' | 'crash' | 'party' | 'fair' | 'festival' | 'protest' | 'uprising' | 'disasters';

type World = { map: GameMap; parcels: ParcelStore };

/** A home 12–25 tiles (Manhattan) from a fire station — far enough to watch it burn and the truck drive — the
 *  nearest such. */
export function pickFireSite(world: World): number | null {
  const { parcels } = world;
  const all = parcels.aliveIndices().map((i) => ({ i, p: parcels.get(i) }));
  const stations = all.filter((a) => a.p.kind === BuiltKind.FireStation);
  let best: number | null = null;
  let bestD = Infinity;
  for (const a of all) {
    if (zoneTypeOf(a.p.kind) !== ZoneType.Residential) continue;
    for (const s of stations) {
      const d = Math.abs(a.p.x - s.p.x) + Math.abs(a.p.y - s.p.y);
      if (d >= 12 && d <= 25 && d < bestD) {
        bestD = d;
        best = a.i;
      }
    }
  }
  return best;
}

/** The industrial works on the most redlined ground. */
export function pickWorks(world: World): number | null {
  const { map, parcels } = world;
  let best: number | null = null;
  let bestG = -1;
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    if (zoneTypeOf(p.kind) !== ZoneType.Industrial) continue;
    const g = map.redline[map.idx(p.x, p.y)]!;
    if (g > bestG) {
      bestG = g;
      best = i;
    }
  }
  return best;
}

export interface DemoDeps {
  world: World;
  live: AmbientState;
  ignite(parcel: number): void;
  /** Put the camera on (x, y). */
  view(x: number, y: number): void;
  /** Start a storm now (app/weather.ts). */
  storm?(heavy: boolean): void;
  /** Hold a community gathering now, and say where (app/community.ts). */
  party?(kind?: 'block-party' | 'craft-fair' | 'festival' | 'protest' | 'uprising'): { x: number; y: number } | null;
}

/** Ms after the first frame before the first disaster (the city settles), and between a fire and the spill (the
 *  truck has come and gone). */
const SETTLE_MS = 3000;
const FIRE_TO_SPILL_MS = 40000;

export function createDemo(kind: DemoKind, deps: DemoDeps): { frame(now: number): void } {
  const { world, live } = deps;
  const fire = (): void => {
    const i = pickFireSite(world);
    if (i === null) return;
    const p = world.parcels.get(i);
    deps.ignite(i);
    deps.view(p.x + p.width / 2, p.y + p.height / 2);
  };
  const spill = (): void => {
    const i = pickWorks(world);
    if (i === null) return;
    const p = world.parcels.get(i);
    startSpill(live, world.map, p);
    // look a little downwind, where the cloud is going
    deps.view(p.x + p.width / 2 + live.wind.dx * 3, p.y + p.height / 2 + live.wind.dy * 3);
  };
  const flood = (): void => {
    deps.storm?.(true);
    // look at the plain where the most buildings stand in it
    const plain = floodPlain(world.map);
    let best: { x: number; y: number } | null = null;
    let bestN = -1;
    for (const [t, d] of plain) {
      if (d < 2 || d > 4) continue;
      const x = t % world.map.width;
      const y = (t - x) / world.map.width;
      let n = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (world.map.inBounds(x + dx, y + dy) && world.map.parcel[world.map.idx(x + dx, y + dy)] !== 0) n++;
      if (n > bestN) {
        bestN = n;
        best = { x, y };
      }
    }
    if (best) deps.view(best.x, best.y);
  };
  const crash = (): void => {
    // the moving through-car on the most jammed road
    let pick: (typeof live.cars)[number] | null = null;
    let worst = -1;
    for (const c of live.cars) {
      if (c.parked || c.abandoned || c.wreck !== undefined || (c.owned && c.path === undefined)) continue;
      const t = live.traffic.get(world.map.idx(Math.round(c.x), Math.round(c.y))) ?? 0;
      if (t > worst) {
        worst = t;
        pick = c;
      }
    }
    if (!pick) return;
    crashCar(live, world.map, createRng('demo').fork('crash'), pick);
    deps.view(pick.x, pick.y);
  };
  const steps: { at: number; run: () => void }[] =
    kind === 'fire' ? [{ at: SETTLE_MS, run: fire }]
    : kind === 'spill' ? [{ at: SETTLE_MS, run: spill }]
    : kind === 'flood' ? [{ at: SETTLE_MS, run: flood }]
    : kind === 'crash' ? [{ at: SETTLE_MS, run: crash }]
    : kind === 'party' || kind === 'fair' || kind === 'festival' || kind === 'protest' || kind === 'uprising' ? [{ at: SETTLE_MS, run: () => {
        const at = deps.party?.(kind === 'fair' ? 'craft-fair' : kind === 'party' ? 'block-party' : kind);
        if (at) deps.view(at.x, at.y);
      } }]
    : [
        { at: SETTLE_MS, run: fire },
        { at: SETTLE_MS + FIRE_TO_SPILL_MS, run: spill },
        { at: SETTLE_MS + 2 * FIRE_TO_SPILL_MS, run: crash },
        { at: SETTLE_MS + 3 * FIRE_TO_SPILL_MS, run: flood },
      ];
  let start: number | undefined;
  return {
    frame(now) {
      start ??= now;
      while (steps.length > 0 && now - start >= steps[0]!.at) steps.shift()!.run();
    },
  };
}
