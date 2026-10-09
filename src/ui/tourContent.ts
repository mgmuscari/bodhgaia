// The opening's second act (bodhgaia-opening.md §3): the camera tours the city while the vows appear. Pure — no
// DOM, no transcendental Math (pure-ui allowlist): where the tour stops, and the eased glide between stops.

import type { GameMap } from '../engine/map';
import { Water } from '../engine/map';
import type { ParcelStore } from '../engine/fabric';

export interface TourStop {
  x: number;
  y: number;
  zoom: number;
}

/** The best window (side `r*2+1`) by `score(tile)`, scanning on a stride; its centre, or null if all score 0. */
function bestWindow(map: GameMap, r: number, score: (i: number) => number): { x: number; y: number } | null {
  const stride = 2;
  let best = 0;
  let at: { x: number; y: number } | null = null;
  for (let cy = r; cy < map.height - r; cy += stride) {
    for (let cx = r; cx < map.width - r; cx += stride) {
      let s = 0;
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) s += score(map.idx(x, y));
      if (s > best) {
        best = s;
        at = { x: cx, y: cy };
      }
    }
  }
  return at;
}

/** Four stops: the heart of the city (densest building), the greenest ground, the busiest waterfront, then the
 *  whole city, wide (centred on everything built). A stop the map lacks falls back to the map's centre. */
export function tourStops(map: GameMap, parcels: ParcelStore): TourStop[] {
  void parcels; // the parcel layer on the map carries the footprints
  const centre = { x: map.width >> 1, y: map.height >> 1 };
  const built = (i: number): number => (map.parcel[i] !== 0 ? 1 : 0);
  const heart = bestWindow(map, 5, built) ?? centre;
  const green = bestWindow(map, 4, (i) => (map.water[i] === Water.None ? map.floraVitality[i]! : 0)) ?? centre;
  const shore = (i: number): number => {
    if (map.parcel[i] === 0) return 0;
    const x = i % map.width;
    const y = (i - x) / map.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
      if (map.inBounds(x + dx, y + dy) && map.water[map.idx(x + dx, y + dy)] !== Water.None) return 1;
    }
    return 0;
  };
  const water = bestWindow(map, 4, shore) ?? centre;
  // the whole city: the centre of everything built (the map's own middle may be open water)
  let x0 = map.width;
  let y0 = map.height;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < map.parcel.length; i++) {
    if (map.parcel[i] === 0) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const city = x1 >= 0 ? { x: (x0 + x1) >> 1, y: (y0 + y1) >> 1 } : centre;
  return [
    { ...heart, zoom: 2 },
    { ...green, zoom: 3 },
    { ...water, zoom: 2 },
    { ...city, zoom: 1 },
  ];
}

/** The point `t` (0..1, clamped) of the way from `a` to `b`, eased in and out (smoothstep). */
export function glide(a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const e = u * u * (3 - 2 * u);
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
}

/** Where to look first: the middle of the built city (the mean of its buildings' centres), or the map's middle if
 *  nothing is built — not the map's corner, which framed empty wilderness with the city clipped at the edge. */
export function cityFocus(map: GameMap, parcels: ParcelStore): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    sx += p.x + p.width / 2;
    sy += p.y + p.height / 2;
    n++;
  }
  return n === 0 ? { x: map.width / 2, y: map.height / 2 } : { x: sx / n, y: sy / n };
}
