// Transit lines and stops (docs/design/transit.md). A line is a connected run of track of one family — trams on
// Streetcar track, trains on Rail and ElevatedRail. Trams stop every STOP_SPACING tiles; trains run long and stop
// only where a road crosses the line or lines join (Maddy 2026-10-08). A stop is a track tile with a walkable
// neighbour off the track: the platform people wait on. Pure reads of the map, deterministic,
// never hashed; the live layer recomputes them when the fabric changes.

import type { GameMap } from '../engine/map';
import { BuiltKind } from '../engine/fabric';
import { isWalkable, railCrossing } from './network';
import { DIR_DX, DIR_DY } from './geometry';

export type LineFamily = 'tram' | 'rail';

export interface Stop {
  /** Which line (index into the lines), and its family. */
  line: number;
  family: LineFamily;
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

/** Where a train stops: a road crossing the line (at grade, or passing under the viaduct) or a junction of lines. */
function railStation(map: GameMap, x: number, y: number): boolean {
  const kindAt = (dx: number, dy: number): number => (map.inBounds(x + dx, y + dy) ? map.built[map.idx(x + dx, y + dy)]! : BuiltKind.None);
  let track = 0;
  for (let d = 0; d < 4; d++) if (familyOf(kindAt(DIR_DX[d]!, DIR_DY[d]!)) === 'rail') track++;
  if (track >= 3) return true;
  return railCrossing(map, x, y);
}

/** Is a stop's platform still a walkable tile beside the line (not built over)? */
function platformOk(map: GameMap, t: number): boolean {
  const x = t % map.width;
  return isWalkable(map, x, (t - x) / map.width) && familyOf(map.built[t]!) === null;
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
      if (near || (family === 'rail' && !railStation(map, x, y))) continue;
      const platform = platformBeside(map, x, y);
      if (platform >= 0) stops.push({ line: id, family, track: t, platform });
    }
    lines.push({ id, family, tiles, stops });
  }
  return lines;
}

/** Substeps a vehicle halts at a stop (~5 s): long enough to see it wait, and for riders to get on and off. */
export const DWELL = 100;

export interface Transit {
  lines: Line[];
  /** Stop by its track tile. */
  stopAt: Map<number, Stop>;
  /** The line each tile belongs to (-1 off the network). */
  lineOf: Int32Array;
}

interface Cached extends Transit {
  sig: number;
  /** The transit clock when the track was last checked. */
  checkedAt: number;
}
const CACHE = new WeakMap<GameMap, Cached>();
/** Substeps between re-checks of the track for changes — once a second. By the clock, not by calls: every transit
 *  rider asks twice a substep, so a call count made the full-map scans grow with the riders (the scaling pass, Maddy
 *  2026-10-08). */
export const TRANSIT_RECHECK_SUBSTEPS = 20;
let clock = 0;
let scans = 0;

/** Advance the transit clock one substep (step.ts calls it at the top of each). */
export function tickTransitClock(): void {
  clock++;
}

/** How many times the track has been scanned (tests: the re-check is by time, not by callers). */
export function transitScans(): number {
  return scans;
}

function trackSignature(map: GameMap): number {
  let h = 0;
  for (let i = 0; i < map.built.length; i++) {
    const k = map.built[i]!;
    if (familyOf(k) !== null) h = (Math.imul(h, 31) + i * 7 + k) | 0;
  }
  return h;
}

/** The map's lines and stops, rebuilt when its track changes (re-checked every RECHECK calls). */
export function transitFor(map: GameMap): Transit {
  let c = CACHE.get(map);
  if (c && clock - c.checkedAt < TRANSIT_RECHECK_SUBSTEPS) return c;
  scans++;
  const sig = trackSignature(map);
  // the track is unchanged — but a platform built over (Maddy 2026-10-08: an AI node on one) moves its stop too
  if (c && c.sig === sig && c.lines.every((l) => l.stops.every((s) => platformOk(map, s.platform)))) {
    c.checkedAt = clock;
    return c;
  }
  const lines = transitLines(map);
  const stopAt = new Map<number, Stop>();
  const lineOf = new Int32Array(map.width * map.height).fill(-1);
  for (const l of lines) {
    for (const t of l.tiles) lineOf[t] = l.id;
    for (const s of l.stops) stopAt.set(s.track, s);
  }
  c = { lines, stopAt, lineOf, sig, checkedAt: clock };
  CACHE.set(map, c);
  return c;
}
