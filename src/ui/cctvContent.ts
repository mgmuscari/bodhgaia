// The CCTV inset's content (Maddy 2026-10-07): a small camera feed in the lower right that shows an event —
// a death, an arrest, later a disaster — for a few seconds, at the most zoomed-in view that fits the whole
// event. Pure (no DOM, no transcendental Math — pure-ui allowlist): the framing, the label and the queue.

import type { LiveEvent } from '../live/types';
import { BASE_TILE, MAX_ZOOM, MIN_ZOOM } from './camera';

/** The inset's size in CSS pixels, and how long each event shows. */
export const CCTV_W = 240;
export const CCTV_H = 160;
export const CCTV_MS = 4000;
/** Tiles of margin around the event, each side (half a tile: a single-tile event still gets the closest zoom). */
const MARGIN = 0.5;
/** Arrests are common (a sweep makes several a minute): at most one reaches the feed per this gap. Deaths always do. */
export const ARREST_GAP_MS = 20_000;
/** Evictions likewise (rent puts people out of many homes an hour): one per this gap reaches the feed. */
export const EVICTION_GAP_MS = 30_000;
/** How many events may wait behind the one showing. */
const QUEUE_MAX = 2;

/** The closest zoom whose view (vw × vh px) holds the event plus a tile of margin, centred on it. */
export function cctvFrame(ev: LiveEvent, vw: number, vh: number): { zoom: number; cx: number; cy: number } {
  let zoom = MIN_ZOOM;
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const ts = BASE_TILE * z;
    if (vw / ts >= ev.w + 2 * MARGIN && vh / ts >= ev.h + 2 * MARGIN) {
      zoom = z;
      break;
    }
  }
  return { zoom, cx: ev.x + ev.w / 2, cy: ev.y + ev.h / 2 };
}

/** The main view's zoom when the feed is clicked (the guided tour's close view) — the closest it goes. */
export const GO_TO_ZOOM = 3;
/** The zooms going there may pick, close to far (the camera snaps a fractional one to what the display offers). */
const GO_TO_ZOOMS = [3, 2, 1, 1 / 2, 1 / 3];

/** Where clicking the feed takes the main view (a pane of vw × vh CSS px): the event's centre, at the closest zoom
 *  up to GO_TO_ZOOM that frames all of it — a flood isn't cropped to its middle (Maddy 2026-10-21). */
export function cctvGoTo(ev: LiveEvent, vw: number, vh: number): { x: number; y: number; zoom: number } {
  let zoom = GO_TO_ZOOMS[GO_TO_ZOOMS.length - 1]!;
  for (const z of GO_TO_ZOOMS) {
    const ts = BASE_TILE * z;
    if (vw / ts >= ev.w + 2 * MARGIN && vh / ts >= ev.h + 2 * MARGIN) {
      zoom = z;
      break;
    }
  }
  return { x: ev.x + ev.w / 2, y: ev.y + ev.h / 2, zoom };
}

/** How long the spot stays marked after going there, and its blink (on half of each period). */
export const MARK_MS = 4000;
const MARK_BLINK_MS = 500;
/** The reticle's arms: art pixels long and thick, set this many art pixels outside the event's tiles. */
const ARM = 6;
const THICK = 2;
const GAP = 2;

export interface ArtRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The CCTV reticle marking an event the view just went to (Maddy 2026-10-21: nothing showed WHERE it was): four
 *  corner brackets just outside its tiles, in world ART pixels (BASE_TILE per tile), blinking for MARK_MS after
 *  `since` — null while blinked off and once done. */
export function reticle(ev: LiveEvent, since: number, now: number): ArtRect[] | null {
  const t = now - since;
  if (t < 0 || t >= MARK_MS || Math.floor(t / MARK_BLINK_MS) % 2 === 1) return null;
  const x0 = ev.x * BASE_TILE - GAP - THICK;
  const y0 = ev.y * BASE_TILE - GAP - THICK;
  const x1 = (ev.x + ev.w) * BASE_TILE + GAP + THICK; // exclusive
  const y1 = (ev.y + ev.h) * BASE_TILE + GAP + THICK;
  const out: ArtRect[] = [];
  for (const [cx, sx] of [[x0, 1], [x1, -1]] as const) {
    for (const [cy, sy] of [[y0, 1], [y1, -1]] as const) {
      out.push({ x: sx > 0 ? cx : cx - ARM, y: sy > 0 ? cy : cy - THICK, w: ARM, h: THICK }); // horizontal arm
      out.push({ x: sx > 0 ? cx : cx - THICK, y: sy > 0 ? cy : cy - ARM, w: THICK, h: ARM }); // vertical arm
    }
  }
  return out;
}

/** The caption under the feed. */
export function cctvLabel(ev: LiveEvent): string {
  return LABELS[ev.kind];
}

const LABELS: Record<LiveEvent['kind'], string> = {
  death: 'A resident has died',
  collapse: 'A resident has collapsed',
  rescue: 'An ambulance saved a resident',
  fire: 'Fire',
  spill: 'Toxic spill',
  flood: 'Flood',
  crash: 'Crash',
  walkoff: 'A driver left their car in the jam',
  protest: 'Protest',
  uprising: 'Uprising',
  arrest: 'Arrest',
  party: 'Block party',
  fair: 'Craft fair',
  festival: 'Festival',
  sideshow: 'Sideshow',
  eviction: 'Put out of their home',
};

/** Deaths first, then disasters and protest; arrests and celebrations give way to everything else. */
const RANK: Record<LiveEvent['kind'], number> = { death: 0, collapse: 0, rescue: 1, fire: 1, spill: 1, flood: 1, crash: 1, walkoff: 2, protest: 1, uprising: 1, arrest: 2, party: 2, fair: 2, festival: 2, sideshow: 2, eviction: 2 };

/** One event at a time, each for CCTV_MS; deaths go before arrests; arrests thinned to one per ARREST_GAP_MS;
 *  only a few wait. */
export class CctvQueue {
  private showing: { ev: LiveEvent; since: number } | null = null;
  private waiting: LiveEvent[] = [];
  private lastArrest = -Infinity;
  private lastEviction = -Infinity;

  push(events: readonly LiveEvent[], now: number): void {
    for (const ev of events) {
      if (ev.kind === 'arrest') {
        if (now - this.lastArrest < ARREST_GAP_MS) continue;
        this.lastArrest = now;
      }
      if (ev.kind === 'eviction') {
        if (now - this.lastEviction < EVICTION_GAP_MS) continue;
        this.lastEviction = now;
      }
      this.waiting.push(ev);
    }
    this.waiting.sort((a, b) => RANK[a.kind] - RANK[b.kind]); // stable: arrival order within a kind
    this.waiting.length = Math.min(this.waiting.length, QUEUE_MAX + (this.showing ? 0 : 1));
  }

  /** The event on screen at time `now` (ms), or null. */
  current(now: number): LiveEvent | null {
    if (this.showing && now - this.showing.since >= CCTV_MS) this.showing = null;
    if (!this.showing) {
      const next = this.waiting.shift();
      if (next) this.showing = { ev: next, since: now };
    }
    return this.showing?.ev ?? null;
  }

  /** Take the showing event off the feed (the view went there); the next waiting one follows. */
  dismiss(): void {
    this.showing = null;
  }
}
