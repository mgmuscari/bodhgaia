// App shell: floods (docs/design/disasters.md). Once a game-second it steps the flood (growth/flood.ts) with the
// hour's rain — heavy rain floods, with Disasters on — and acts on it: a home under water is evacuated (its people
// join the unhoused for the duration) and they come home when the water goes; the first water brings the camera and
// the news; the flooded tiles are published for the renderer and for routing.

import type { GameMap } from '../engine/map';
import type { ParcelStore } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import type { AmbientState } from '../live/types';
import { createFloodState, stepFlood } from '../growth/flood';
import { closeTiles } from '../live/network';

/** Wall ms between flood steps (the flood itself moves once a game hour). */
export const FLOOD_STEP_MS = 1000;

export interface FloodDeps {
  world: { map: GameMap; parcels: ParcelStore };
  live: AmbientState;
  /** The in-game hour; undefined ⇒ no step. */
  hour(): number | undefined;
  disastersOn(): boolean;
  markDirty(): void;
  news(text: string): void;
}

export function createFloodController(deps: FloodDeps): { frame(now: number): void } {
  const { world, live } = deps;
  const { map, parcels } = world;
  const f = createFloodState(map);
  /** Evacuated homes (anchor tile) → how many people left. */
  const evacuated = new Map<number, number>();
  let last = -Infinity;
  live.flooded = f.flooded;

  return {
    frame(now) {
      if (now - last < FLOOD_STEP_MS) return;
      last = now;
      const wasDry = f.flooded.size === 0;
      const ev = stepFlood(world, f, { hour: deps.hour(), heavy: deps.disastersOn() && live.rain?.heavy === true });
      const under = new Set<number>();
      for (const i of ev.underWater) {
        const p = parcels.get(i);
        if (zoneTypeOf(p.kind) !== ZoneType.Residential) continue;
        const anchor = map.idx(p.x, p.y);
        under.add(anchor);
        if (evacuated.has(anchor)) continue;
        const n = Math.floor(live.occupancy.get(anchor) ?? 0);
        evacuated.set(anchor, n);
        live.occupancy.set(anchor, 0);
        live.unhoused += n;
      }
      for (const [anchor, n] of [...evacuated]) {
        if (under.has(anchor)) continue;
        evacuated.delete(anchor);
        const back = Math.min(n, Math.floor(live.unhoused));
        live.occupancy.set(anchor, (live.occupancy.get(anchor) ?? 0) + back);
        live.unhoused -= back;
      }
      if (wasDry && ev.rose.length > 0) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const t of ev.rose) {
          const x = t % map.width;
          const y = (t - x) / map.width;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
        live.events?.push({ kind: 'flood', x: x0, y: y0, w: Math.min(16, x1 - x0 + 1), h: Math.min(10, y1 - y0 + 1) });
        deps.news(evacuated.size > 0 ? `Flooding by the water — ${evacuated.size} homes evacuated` : 'Flooding by the water');
      }
      if (ev.rose.length > 0 || ev.fell.length > 0) closeTiles(map, f.flooded); // routes go round the water
      if (ev.underWater.length > 0 || ev.rose.length > 0 || ev.fell.length > 0) deps.markDirty();
    },
  };
}
