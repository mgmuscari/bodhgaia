// Live-layer POSES: where to DRAW a grid-following mover (car, cruiser, pedestrian, train car) and
// which way it faces — the turn arcs, kerb/lane laterals, and the between-substep interpolation the
// renderers read. Cut verbatim from ui/ambientContent.ts; pure, no trig (nlerp + sqrt).

import type { GameMap } from '../engine/map';
import { isRoadKind } from '../engine/fabric';
import { SUBSTEP_MS } from './tuning';
import { DIR_DX, DIR_DY, LANE, PED_CURB } from './geometry';
import type { AmbientState, Car, Mover, Ped, Train } from './types';

/**
 * How much faster a mover's current sim leg should run so its DRAWN path keeps its pace: a leg's pose
 * crosses one tile (moverPose), a unit line when straight but a quarter-arc of radius 0.5 ∓ lateral at
 * a turn — only ~0.53 tiles on a right turn. With every leg taking the same sim time, a turning car
 * visibly crawled round the corner (Maddy 2026-09-30). Returns straight/arc length (1 when straight).
 */
export function legPaceFactor(m: Mover, lateral: number): number {
  const d = m.dir;
  const pd = m.prevDir ?? d;
  const turn = DIR_DX[pd]! * DIR_DY[d]! - DIR_DY[pd]! * DIR_DX[d]!;
  if (turn === 0) return 1;
  return 1 / ((Math.PI / 2) * (0.5 - turn * lateral));
}

/** The kerb offset a pedestrian's current leg is DRAWN with at the tile it crosses (for legPaceFactor). */
export function pedLegLateral(map: GameMap, p: Mover): number {
  const x = p.tx - DIR_DX[p.dir]!;
  const y = p.ty - DIR_DY[p.dir]!;
  return map.inBounds(x, y) && isRoadKind(map.built[map.idx(x, y)]!) ? PED_CURB : 0;
}

/** The leg state a pose is computed from — all {@link moverPose} and {@link pedLateral} read. A mover
 *  is one; so is its pre-substep snapshot (`Mover.snap`), which is posed directly, never copied. */
export type LegState = Pick<Mover, 'x' | 'y' | 'dir' | 'prevDir' | 'tx' | 'ty'>;

/** A sprite's draw pose: world position of its centre (tile units, +0.5 already applied) + a unit
 *  heading vector (screen y-down; the renderer turns it into a rotation). */
export interface Pose {
  x: number;
  y: number;
  hx: number;
  hy: number;
}

/**
 * Where to DRAW a grid-following mover, and which way it faces — smooth through turns (Maddy
 * 2026-09-30: "i like your approach to turning center lines"). Each leg runs centre-to-centre; the pose
 * is drawn half a tile BEHIND the sim position, so over one leg it crosses the leg's start tile from its
 * entry edge (the side it came in on, via `prevDir`) to its exit edge (via `dir`): a straight line, or a
 * quarter-circle round the tile corner between those edges at a 90° turn — the same geometry the SNES
 * lane lines use. `lateral` is the right-of-heading offset (car lane, ped kerb), carried round the arc
 * as the radius (0.5 − lateral on a right turn, 0.5 + lateral on a left), so a turning car never
 * jumps across the road. Leg ends meet exactly, so motion is continuous. Pure, no trig (nlerp + sqrt).
 */
export interface LateralProfile {
  /** Right-of-heading offset at the tile's entry edge, centre, and exit edge. */
  entry: number;
  mid: number;
  exit: number;
}

/** The leg direction (0=N, 1=E, 2=S, 3=W) from tile index `a` to the adjacent tile index `b`. */
export function stepDir(a: number, b: number, W: number): number {
  const dx = (b % W) - (a % W);
  const dy = Math.floor(b / W) - Math.floor(a / W);
  return dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0;
}

/**
 * Re-sync a train's car movers to its trail (call after each substep): car k crosses its tile cells[k]
 * toward cells[k−1] (the locomotive toward its target) at the locomotive's own progress, so the consist
 * moves as one, and each car's previous leg (from the tile behind it) gives it moverPose's quarter-arc bend
 * at a corner — one car after another, a tile apart. The Mover objects persist, keeping their snapshots.
 */
export function syncTrainLegs(t: Train, W: number): Mover[] {
  const p = Math.min(1, Math.max(0, 1 - (Math.abs(t.tx - t.hx) + Math.abs(t.ty - t.hy))));
  const cars = (t.cars ??= []);
  cars.length = t.cells.length;
  for (let k = 0; k < t.cells.length; k++) {
    const a = t.cells[k]!;
    const ax = a % W;
    const ay = Math.floor(a / W);
    const dir = k === 0 ? t.dir : stepDir(a, t.cells[k - 1]!, W);
    const prevDir = k + 1 < t.cells.length ? stepDir(t.cells[k + 1]!, a, W) : dir;
    const m = (cars[k] ??= { x: 0, y: 0, dir: 0, tx: 0, ty: 0 } as Mover);
    m.x = ax + DIR_DX[dir]! * p;
    m.y = ay + DIR_DY[dir]! * p;
    m.tx = ax + DIR_DX[dir]!;
    m.ty = ay + DIR_DY[dir]!;
    m.dir = dir;
    m.prevDir = prevDir;
  }
  return cars;
}

/** Every car of a train posed on the shared mover path ({@link movingPose}), head first; `alpha`
 *  interpolates between substeps exactly as for cars. */
export function trainPoses(t: Train, W: number, alpha = 1): Pose[] {
  const cars = t.cars && t.cars.length === t.cells.length ? t.cars : syncTrainLegs(t, W);
  return cars.map((m) => movingPose(m, 0, alpha));
}

export function moverPose(m: LegState, lateral: number | LateralProfile): Pose {
  const prof = typeof lateral === 'number' ? { entry: lateral, mid: lateral, exit: lateral } : lateral;
  const latAt = (p: number): number => (p < 0.5 ? prof.entry + (prof.mid - prof.entry) * p * 2 : prof.mid + (prof.exit - prof.mid) * (p * 2 - 1));
  const d = m.dir;
  const dx = DIR_DX[d]!;
  const dy = DIR_DY[d]!;
  const onLeg = Math.abs(m.tx - m.x) + Math.abs(m.ty - m.y) <= 1 + 1e-9 && (m.tx !== m.x || m.ty !== m.y);
  if (!onLeg) {
    // idle / off-grid: the plain tile-centre pose
    return { x: m.x + 0.5 - dy * prof.mid, y: m.y + 0.5 + dx * prof.mid, hx: dx, hy: dy };
  }
  const p = Math.min(1, Math.max(0, 1 - (Math.abs(m.tx - m.x) + Math.abs(m.ty - m.y))));
  const pd = m.prevDir ?? d;
  const pdx = DIR_DX[pd]!;
  const pdy = DIR_DY[pd]!;
  const cx = m.tx - dx + 0.5; // centre of the tile being crossed
  const cy = m.ty - dy + 0.5;
  const turn = pdx * dy - pdy * dx; // +1 right (clockwise, y-down), −1 left, 0 straight / U-turn
  const lat = latAt(p);
  if (turn === 0 && pd === d) {
    // straight through
    const bx = cx + dx * (p - 0.5);
    const by = cy + dy * (p - 0.5);
    return { x: bx - dy * lat, y: by + dx * lat, hx: dx, hy: dy };
  }
  if (turn === 0) {
    // U-turn: in along pd to the centre and back out, the heading sweeping round through its right-hand
    // side in two nlerp halves (pd → right(pd) → d) — never a 180° flip
    const rx = -pdy;
    const ry = pdx;
    const t = p < 0.5 ? p * 2 : p * 2 - 1;
    const [ax, ay, bx2, by2] = p < 0.5 ? [pdx, pdy, rx, ry] : [rx, ry, dx, dy];
    let hx = ax + (bx2 - ax) * t;
    let hy = ay + (by2 - ay) * t;
    const hl = Math.sqrt(hx * hx + hy * hy);
    hx /= hl;
    hy /= hl;
    const along = p < 0.5 ? p - 0.5 : 0.5 - p; // toward the centre, then back out
    const bx = cx + pdx * along;
    const by = cy + pdy * along;
    return { x: bx - hy * lat, y: by + hx * lat, hx, hy };
  }
  // quarter-circle round corner K between the entry edge (−pd side) and the exit edge (+d side)
  const kx = cx - pdx * 0.5 + dx * 0.5;
  const ky = cy - pdy * 0.5 + dy * 0.5;
  // unit radials from K to the entry point (= −d) and to the exit point (= +pd); nlerp between them, with
  // p re-timed (a cubic fitted to atan) so the angle sweeps at a near-constant rate — plain nlerp crawls
  // at the start and end of the bend
  const u = p + 0.915 * p * (1 - p) * (0.5 - p);
  const vx0 = -dx * (1 - u) + pdx * u;
  const vy0 = -dy * (1 - u) + pdy * u;
  const len = Math.sqrt(vx0 * vx0 + vy0 * vy0);
  const vx = vx0 / len;
  const vy = vy0 / len;
  const r = 0.5 - turn * lat; // right turn: the right-hand lane is the inside of the curve
  // heading = the radial rotated ±90° (so it starts along pd and ends along d)
  const hx = turn > 0 ? -vy : vy;
  const hy = turn > 0 ? vx : -vx;
  return { x: kx + vx * r, y: ky + vy * r, hx, hy };
}

/** Blend two poses (position lerp, heading nlerp). A jump over 1.5 tiles — a spawn, a park, a
 *  re-route snap — is a teleport: take the newer pose rather than slide across the map. */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx * dx + dy * dy > 2.25) return b;
  let hx = a.hx + (b.hx - a.hx) * t;
  let hy = a.hy + (b.hy - a.hy) * t;
  const l = Math.sqrt(hx * hx + hy * hy);
  if (l < 1e-6) {
    hx = b.hx;
    hy = b.hy;
  } else {
    hx /= l;
    hy /= l;
  }
  return { x: a.x + dx * t, y: a.y + dy * t, hx, hy };
}

/** The pose of a mover as it stood before the latest substep (its snapshot), or null if none. */
export function snapPose(m: Mover, lateral: number | ((leg: LegState) => LateralProfile)): Pose | null {
  const sn = m.snap;
  if (!sn) return null;
  return moverPose(sn, typeof lateral === 'number' ? lateral : lateral(sn));
}

/**
 * Record every mover's leg state before a substep runs, so the renderer can draw it `alpha` of the way
 * from that state to the next (render interpolation — the 50 ms substeps otherwise show as 20 Hz hops
 * on a 60–120 Hz display). Cosmetic state only; the world hash never sees it.
 */
export function snapshotMovers(state: AmbientState): void {
  for (const list of [state.cars, state.cruisers, state.peds, state.trains.flatMap((t) => t.cars ?? [])]) {
    for (const m of list) {
      const sn = (m.snap ??= { x: 0, y: 0, dir: 0, tx: 0, ty: 0 });
      sn.x = m.x;
      sn.y = m.y;
      sn.dir = m.dir;
      sn.prevDir = m.prevDir;
      sn.tx = m.tx;
      sn.ty = m.ty;
    }
  }
}

/** How far (0..1) the display is between the last substep and the next — the interpolation factor. */
export function ambientAlpha(state: AmbientState): number {
  return Math.min(1, Math.max(0, state.accMs / SUBSTEP_MS));
}

/** A car's draw pose. Parked: on its stall/kerb spot, a kerb-parked car lying parallel to the kerb.
 *  Moving: {@link moverPose} in its right-hand lane, interpolated `alpha` of the way from its pose
 *  before the latest substep (1 = no interpolation). */
export function carPose(c: Car, alpha = 1): Pose {
  if (c.parked) {
    // kerb-parked: parallel to the kerb; in a lot bay: east-west, the way the bays are laid out
    const hd = c.curbDir !== undefined ? (c.curbDir % 2 === 0 ? 1 : 0) : c.lotIdx !== undefined ? 1 : c.dir;
    return { x: c.x + 0.5, y: c.y + 0.5, hx: DIR_DX[hd]!, hy: DIR_DY[hd]! };
  }
  return movingPose(c, LANE, alpha);
}

/** A moving mover's draw pose: moverPose now, blended `alpha` of the way from its pose before the latest
 *  substep — the one path cars, cruisers and train cars share. */
export function movingPose(m: Mover, lateral: number, alpha: number): Pose {
  const now = moverPose(m, lateral);
  const before = alpha < 1 ? snapPose(m, lateral) : null;
  return before ? blendPose(before, now, alpha) : now;
}

/**
 * A pedestrian's kerb offset across the tile its leg crosses: PED_CURB on a road tile, 0 on open ground,
 * averaged at each edge with the neighbour across it — so a walker slides onto/off the kerb instead of
 * jumping as it steps between a road and a lot.
 */
export function pedLateral(m: LegState, onRoadAt: (x: number, y: number) => boolean): LateralProfile {
  const lat = (x: number, y: number): number => (onRoadAt(x, y) ? PED_CURB : 0);
  const onLeg = Math.abs(m.tx - m.x) + Math.abs(m.ty - m.y) <= 1 + 1e-9 && (m.tx !== m.x || m.ty !== m.y);
  if (!onLeg) {
    const here = lat(Math.round(m.x), Math.round(m.y));
    return { entry: here, mid: here, exit: here };
  }
  const d = m.dir;
  const pd = m.prevDir ?? d;
  const tx = m.tx - DIR_DX[d]!;
  const ty = m.ty - DIR_DY[d]!;
  const mid = lat(tx, ty);
  return {
    entry: (lat(tx - DIR_DX[pd]!, ty - DIR_DY[pd]!) + mid) / 2,
    mid,
    exit: (mid + lat(m.tx, m.ty)) / 2,
  };
}

/** A pedestrian's draw pose: on the kerb along a road, down the middle elsewhere, easing between the
 *  two across a tile edge — smooth through turns ({@link moverPose}; `walkTo` is only the trip's
 *  destination, walkers still follow grid legs) and interpolated between substeps like {@link carPose}. */
export function pedPose(p: Ped, onRoadAt: (x: number, y: number) => boolean, alpha = 1): Pose {
  const now = moverPose(p, pedLateral(p, onRoadAt));
  const before = alpha < 1 ? snapPose(p, (mv) => pedLateral(mv, onRoadAt)) : null;
  return before ? blendPose(before, now, alpha) : now;
}
