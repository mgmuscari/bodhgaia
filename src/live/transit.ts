// Transit lines and stops (docs/design/transit.md). A line is a connected run of track of one family — trams on
// Streetcar track, trains on Rail and ElevatedRail — and stops sit along it every STOP_SPACING tiles, at a track
// tile with a walkable neighbour off the track: the platform people wait on. Pure reads of the map, deterministic,
// never hashed; the live layer recomputes them when the fabric changes.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import { isWalkable } from './network';
import { DIR_DX, DIR_DY } from './geometry';

export type LineFamily = 'tram' | 'rail';

export interface Stop {
  /** Which line (index into the lines). */
  line: number;
  /** The track tile a vehicle halts on. */
  track: number;
  /** The walkable tile beside it where riders wait. */
  platform: number;
}

export interface Line {
  id: number;
  family: LineFamily;
  /** Its track tiles, in the order a walk from its lowest tile reaches them. */
  tiles: number[];
  stops: Stop[];
}

/** Track tiles between stops (Manhattan, at least). */
export const STOP_SPACING = 8;

/** The line family a track kind belongs to, or null if it isn't track. */
export function familyOf(kind: number): LineFamily | null {
  if (kind === BuiltKind.Streetcar) return 'tram';
  if (kind === BuiltKind.Rail || kind === BuiltKind.ElevatedRail) return 'rail';
  return null;
}

/** A walkable tile beside track tile (x, y) that is not itself track — a platform — or -1. Neighbours are tried
 *  in a fixed order (south, north, east, west) so stops never depend on scan direction. */
function platformBeside(map: GameMap, x: number, y: number): number {
  for (const d of [2, 0, 1, 3]) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny) || familyOf(map.built[map.idx(nx, ny)]!) !== null) continue;
    if (isWalkable(map, nx, ny)) return map.idx(nx, ny);
  }
  return -1;
}

/** Every transit line on the map, with its stops. */
export function transitLines(map: GameMap): Line[] {
  const seen = new Uint8Array(map.width * map.height);
  const lines: Line[] = [];
  for (let start = 0; start < seen.length; start++) {
    const family = familyOf(map.built[start]!);
    if (family === null || seen[start]) continue;
    const tiles: number[] = [];
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const t = queue.shift()!;
      tiles.push(t);
      const x = t % map.width;
      const y = (t - x) / map.width;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d]!;
        const ny = y + DIR_DY[d]!;
        if (!map.inBounds(nx, ny)) continue;
        const n = map.idx(nx, ny);
        if (!seen[n] && familyOf(map.built[n]!) === family) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }
    const id = lines.length;
    const stops: Stop[] = [];
    for (const t of tiles) {
      const x = t % map.width;
      const y = (t - x) / map.width;
      const near = stops.some((s) => {
        const sx = s.track % map.width;
        return Math.abs(sx - x) + Math.abs((s.track - sx) / map.width - y) < STOP_SPACING;
      });
      if (near) continue;
      const platform = platformBeside(map, x, y);
      if (platform >= 0) stops.push({ line: id, track: t, platform });
    }
    lines.push({ id, family, tiles, stops });
  }
  return lines;
}
