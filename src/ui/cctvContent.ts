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

/** The caption under the feed. */
export function cctvLabel(ev: LiveEvent): string {
  return ev.kind === 'death' ? 'A resident has died' : ev.kind === 'fire' ? 'Fire' : ev.kind === 'spill' ? 'Toxic spill' : ev.kind === 'flood' ? 'Flood' : ev.kind === 'crash' ? 'Crash' : ev.kind === 'protest' ? 'Protest' : ev.kind === 'uprising' ? 'Uprising' : 'Arrest';
}

const RANK: Record<LiveEvent['kind'], number> = { death: 0, fire: 1, spill: 1, flood: 1, crash: 1, protest: 1, uprising: 1, arrest: 2 };

/** One event at a time, each for CCTV_MS; deaths go before arrests; arrests thinned to one per ARREST_GAP_MS;
 *  only a few wait. */
export class CctvQueue {
  private showing: { ev: LiveEvent; since: number } | null = null;
  private waiting: LiveEvent[] = [];
  private lastArrest = -Infinity;

  push(events: readonly LiveEvent[], now: number): void {
    for (const ev of events) {
      if (ev.kind === 'arrest') {
        if (now - this.lastArrest < ARREST_GAP_MS) continue;
        this.lastArrest = now;
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
}
