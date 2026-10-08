// App shell: the live event feed's host (bodhgaia-opening.md). Each frame it drains the live layer's events —
// deaths, arrests (disasters later) — and acts on them: a death is mourned (the city's approval, goodwill and
// effort; the neighbourhood's belonging; grief in the homes nearby; a line in the news), and every event is
// queued for the CCTV inset in the lower right, which shows it for a few seconds at the closest zoom that fits.

import type { GameMap } from '../engine/map';
import type { WorldState } from '../worldgen/pipeline';
import type { CivicState } from '../civic/state';
import type { NeighborhoodMap } from '../civic/neighborhoods';
import type { AmbientState, LiveEvent } from '../live/types';
import { griefAround } from '../live/death';
import { CctvQueue, CCTV_W, CCTV_H, cctvFrame, cctvLabel } from '../ui/cctvContent';
import { Camera } from '../ui/camera';
import { Renderer } from '../ui/renderer';
import type { SkinImages } from '../ui/tilesetLoader';
import { mountCctv } from '../ui/cctv';

/** Belonging a neighbourhood loses when one of its people dies on its streets. */
export const DEATH_BELONGING = 10;

export interface EventCostDeps {
  map: GameMap;
  live: AmbientState;
  civic: CivicState;
  partition(): NeighborhoodMap;
  mourn(deaths: number): void;
  news(text: string): void;
}

/** Act on a batch of events (pure but for the deps it writes through). */
export function handleEvents(events: readonly LiveEvent[], deps: EventCostDeps): void {
  const deaths = events.filter((e) => e.kind === 'death');
  if (deaths.length === 0) return;
  deps.mourn(deaths.length);
  const partition = deps.partition();
  for (const d of deaths) {
    const id = partition.tileToNeighborhood[deps.map.idx(d.x, d.y)] ?? 0;
    if (id > 0 && id <= deps.civic.count()) {
      const v = deps.civic.getValues(id);
      deps.civic.setValues(id, { ...v, belonging: Math.max(0, v.belonging - DEATH_BELONGING) });
    }
    griefAround(deps.live, deps.map, d.x, d.y);
  }
  deps.news(deaths.length === 1 ? 'A resident died on the street' : `${deaths.length} residents died on the street`);
}

export interface EventsDeps extends EventCostDeps {
  world: WorldState;
  skin: SkinImages;
  /** The main view's power grid, mirrored so the feed shows the same lit/dark blocks. */
  powered(): ReadonlySet<number>;
  /** The in-game time for the caption. */
  clock(): string;
  /** Whether the feed may show now (the opening keeps it off). Default on. */
  cctvOn?(): boolean;
}

export interface EventsController {
  /** Drain the feed and draw the inset (call once per frame, after the main render). */
  frame(now: number): void;
}

export function createEventsController(deps: EventsDeps): EventsController {
  deps.live.events = []; // start collecting
  const queue = new CctvQueue();
  const cctv = mountCctv(document.body);
  let renderer: Renderer | null = null;
  let camera: Camera | null = null;
  let shown: LiveEvent | null = null;
  return {
    frame(now) {
      const events = deps.live.events!.splice(0);
      if (events.length > 0) {
        handleEvents(events, deps);
        if (deps.cctvOn?.() !== false) queue.push(events, now); // the opening's own death isn't replayed after
      }
      const ev = deps.cctvOn?.() === false ? null : queue.current(now);
      if (!ev) {
        if (shown) cctv.hide();
        shown = null;
        return;
      }
      if (!renderer) {
        renderer = new Renderer(cctv.canvas, deps.skin);
        renderer.resize(CCTV_W, CCTV_H, window.devicePixelRatio || 1);
        camera = new Camera({ mapWidth: deps.map.width, mapHeight: deps.map.height, viewportWidth: CCTV_W, viewportHeight: CCTV_H });
      }
      if (ev !== shown) {
        const f = cctvFrame(ev, CCTV_W, CCTV_H);
        camera!.centerOn(f.cx, f.cy, f.zoom);
        renderer.invalidateBase();
        renderer.setPowerGrid(new Set(deps.powered()));
        cctv.show(cctvLabel(ev), deps.clock());
        shown = ev;
      }
      renderer.renderFrame(deps.world, camera!, deps.live);
    },
  };
}
