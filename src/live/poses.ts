// Live-layer POSES: where to DRAW a grid-following mover (car, cruiser, pedestrian, train car) and
// which way it faces — the turn arcs, kerb/lane laterals, and the between-substep interpolation the
// renderers read. Cut verbatim from ui/ambientContent.ts; pure, no trig (nlerp + sqrt).

import { SUBSTEP_MS, seconds } from './tuning';
import { DIR_DX, DIR_DY, LANE, PED_CURB } from './geometry';
import type { AmbientState, Car, Mover, Ped, Train } from './types';
import type { GameMap } from '../engine/map';
import { BuiltKind, isRoadKind } from '../engine/fabric';
import { tramStreet } from './network';

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


/** The leg state a pose is computed from — all {@link moverPose} and the walkers' pose read. A mover
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
    const from = k + 1 < t.cells.length ? t.cells[k + 1] : t.behind;
    const prevDir = from !== undefined ? stepDir(from, a, W) : dir;
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
  // a numeric lateral is the flat profile entry = mid = exit, passed as scalars so the per-frame hot
  // path (every car/cruiser/train car) allocates no profile object and no closure
  return typeof lateral === 'number' ? poseAlongLeg(m, lateral, lateral, lateral) : poseAlongLeg(m, lateral.entry, lateral.mid, lateral.exit);
}

/** {@link moverPose} with the lateral profile unpacked (right-of-heading offset at entry / centre / exit). */
function poseAlongLeg(m: LegState, entry: number, mid: number, exit: number): Pose {
  const d = m.dir;
  const dx = DIR_DX[d]!;
  const dy = DIR_DY[d]!;
  const onLeg = Math.abs(m.tx - m.x) + Math.abs(m.ty - m.y) <= 1 + 1e-9 && (m.tx !== m.x || m.ty !== m.y);
  if (!onLeg) {
    // idle / off-grid: the plain tile-centre pose
    return { x: m.x + 0.5 - dy * mid, y: m.y + 0.5 + dx * mid, hx: dx, hy: dy };
  }
  const p = Math.min(1, Math.max(0, 1 - (Math.abs(m.tx - m.x) + Math.abs(m.ty - m.y))));
  const pd = m.prevDir ?? d;
  const pdx = DIR_DX[pd]!;
  const pdy = DIR_DY[pd]!;
  const cx = m.tx - dx + 0.5; // centre of the tile being crossed
  const cy = m.ty - dy + 0.5;
  const turn = pdx * dy - pdy * dx; // +1 right (clockwise, y-down), −1 left, 0 straight / U-turn
  const lat = p < 0.5 ? entry + (mid - entry) * p * 2 : mid + (exit - mid) * (p * 2 - 1);
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
  for (const list of [state.cars, state.cruisers, state.peds, state.trains.flatMap((t) => t.cars ?? []), state.trucks ?? []]) {
    for (const m of list) {
      if (m.ease && --m.ease.n <= 0) m.ease = undefined; // an ease runs down a substep at a time
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
  return Math.min(1, Math.max(0, state.accMs / SUBSTEP_MS)); // (a borrowed step leaves accMs a little below 0)
}

/** Where a walker keeps to the kerb: a road, or a tram street (Maddy 2026-10-08: walkers down the middle of it). */
export function streetAt(map: GameMap): (x: number, y: number) => boolean {
  return (x, y) => {
    if (!map.inBounds(x, y)) return false;
    const k = map.built[map.idx(x, y)]!;
    return isRoadKind(k) || k === BuiltKind.Streetcar;
  };
}

/** Substeps a park, an unpark or a step out of a car eases over (~0.5 s). */
export const EASE_SUBSTEPS = seconds(0.5);

/** Start `m` easing in from `from` — the pose it is drawn at now — so a jump in its position (into a stall, out of
 *  one, out of a car) is drawn as a slide (Maddy 2026-10-08: parking snapped to the side of the road). */
export function easeFrom(m: Mover, from: Pose): void {
  m.ease = { x: from.x, y: from.y, hx: from.hx, hy: from.hy, n: EASE_SUBSTEPS };
}

/** `pose`, eased in from where the mover was (if it is easing): smoothstep over the substeps left, `alpha` between. */
function eased(m: Mover, pose: Pose, alpha: number): Pose {
  const e = m.ease;
  if (!e) return pose;
  const t0 = (EASE_SUBSTEPS - e.n - 1 + alpha) / EASE_SUBSTEPS;
  const t = t0 <= 0 ? 0 : t0 >= 1 ? 1 : t0;
  return blendPose(e, pose, t * t * (3 - 2 * t));
}

/** A car's lane on a tram street: out past the rails, by the kerb (Maddy 2026-10-08: cars drive alongside trams). */
export const TRAM_STREET_LANE = 0.3;

/** The lane a car keeps to on each tile of the map: the outer lane of a tram street, else the usual one. */
export function laneOnTile(map: GameMap): (x: number, y: number) => number {
  return (x, y) => (tramStreet(map, x, y) ? TRAM_STREET_LANE : LANE);
}

/** A leg's lateral profile from the lanes of the tiles it runs through: the tile's own lane at its centre, easing
 *  to the lane beyond at each edge — so a car moves over between street and tram street without a hop. */
function laneProfile(laneAt: (x: number, y: number) => number): (m: LegState) => LateralProfile {
  return (m) => {
    const dx = DIR_DX[m.dir]!;
    const dy = DIR_DY[m.dir]!;
    const pd = m.prevDir ?? m.dir;
    const cx = m.tx - dx;
    const cy = m.ty - dy;
    const mid = laneAt(cx, cy);
    return { entry: (laneAt(cx - DIR_DX[pd]!, cy - DIR_DY[pd]!) + mid) / 2, mid, exit: (mid + laneAt(m.tx, m.ty)) / 2 };
  };
}

/** A car's draw pose. Parked: on its stall/kerb spot, a kerb-parked car lying parallel to the kerb.
 *  Moving: {@link moverPose} in its right-hand lane, interpolated `alpha` of the way from its pose
 *  before the latest substep (1 = no interpolation). */
export function carPose(c: Car, alpha = 1, laneAt?: (x: number, y: number) => number): Pose {
  if (c.parked) {
    // kerb-parked: parallel to the kerb; in a lot bay: east-west, the way the bays are laid out
    const hd = c.curbDir !== undefined ? (c.curbDir % 2 === 0 ? 1 : 0) : c.lotIdx !== undefined ? 1 : c.dir;
    return eased(c, { x: c.x + 0.5, y: c.y + 0.5, hx: DIR_DX[hd]!, hy: DIR_DY[hd]! }, alpha);
  }
  return eased(c, movingPose(c, laneAt ? laneProfile(laneAt) : LANE, alpha), alpha);
}

/** A moving mover's draw pose: moverPose now, blended `alpha` of the way from its pose before the latest
 *  substep — the one path cars, cruisers and train cars share. */
export function movingPose(m: Mover, lateral: number | ((leg: LegState) => LateralProfile), alpha: number): Pose {
  const now = moverPose(m, typeof lateral === 'number' ? lateral : lateral(m));
  const before = alpha < 1 ? snapPose(m, lateral) : null;
  return before ? blendPose(before, now, alpha) : now;
}

/** Which sidewalk a walker keeps to on a road with a kerb on both sides: a stable bit of who they are, so people
 *  use both sides of a street and nobody switches sides mid-walk. */
function sidewalkOf(p: { homeTile?: number; carId?: number }): number {
  return ((Math.imul((p.homeTile ?? p.carId ?? 0) + 1, 0x9e3779b1) >>> 0) >>> 16) & 1;
}

/** Where on a tile a walker stands (offset from its centre): nothing off the road; on a road, its kerb — the side
 *  with no road beyond it (the near kerb of an avenue's lane); where there are kerbs on both sides (a one-lane
 *  street), the walker's own sidewalk; on a junction (no kerb at all), the corner on their side of both streets. Fixed to the map, not to
 *  the walker's heading — so turning round or turning a corner never moves them across the road. */
function kerbOffset(x: number, y: number, side: number, onRoadAt: (x: number, y: number) => boolean): [number, number] {
  if (!onRoadAt(x, y)) return [0, 0];
  const n = !onRoadAt(x, y - 1);
  const s = !onRoadAt(x, y + 1);
  const w = !onRoadAt(x - 1, y);
  const e = !onRoadAt(x + 1, y);
  let ox = (e ? 1 : 0) - (w ? 1 : 0);
  let oy = (s ? 1 : 0) - (n ? 1 : 0);
  if (n && s) oy = side ? 1 : -1;
  if (e && w) ox = side ? 1 : -1;
  // a junction (road all round, no kerb): its corner on the walker's own side of both streets — they turn there, or
  // cross on the junction's edge along the crosswalk, never through its middle (Maddy 2026-10-08)
  if (ox === 0 && oy === 0) return side ? [PED_CURB, PED_CURB] : [-PED_CURB, -PED_CURB];
  const k = PED_CURB / Math.hypot(ox, oy);
  return [ox * k, oy * k];
}

/** A walker's pose from its leg: straight along the leg between tile centres, standing at each tile's kerb and
 *  gliding between them — continuous through turns and reversals (Maddy 2026-10-08: walkers warped across the
 *  avenue when the old heading-relative kerb flipped sides). */
function walkPose(m: LegState, side: number, onRoadAt: (x: number, y: number) => boolean): Pose {
  const moving = m.tx !== m.x || m.ty !== m.y;
  const sx = moving ? m.tx - DIR_DX[m.dir]! : Math.round(m.x);
  const sy = moving ? m.ty - DIR_DY[m.dir]! : Math.round(m.y);
  const t = moving ? Math.min(1, Math.max(0, 1 - (Math.abs(m.tx - m.x) + Math.abs(m.ty - m.y)))) : 0;
  const a = kerbOffset(sx, sy, side, onRoadAt);
  const b = moving ? kerbOffset(m.tx, m.ty, side, onRoadAt) : a;
  return {
    x: m.x + 0.5 + a[0] + (b[0] - a[0]) * t,
    y: m.y + 0.5 + a[1] + (b[1] - a[1]) * t,
    hx: DIR_DX[m.dir]!,
    hy: DIR_DY[m.dir]!,
  };
}

/** A pedestrian's draw pose: on a sidewalk fixed to the map (see kerbOffset), gliding between tiles, interpolated
 *  between substeps like {@link carPose}. */
export function pedPose(p: Ped, onRoadAt: (x: number, y: number) => boolean, alpha = 1): Pose {
  const side = sidewalkOf(p);
  const now = walkPose(p, side, onRoadAt);
  if (alpha >= 1 || !p.snap) return eased(p, now, alpha);
  return eased(p, blendPose(walkPose(p.snap, side, onRoadAt), now, alpha), alpha); // (a teleport isn't blended: it lands)
}

/** Where the opening's night walker is DRAWN: between where it stood before the latest substep and where it stands,
 *  `alpha` of the way — like every other agent. The intro's camera follows this, so the map scrolls evenly under it
 *  (Maddy 2026-10-08: following the raw 20-Hz steps at 30 fps, the map jittered against the moving people). */
export function wandererPose(w: { x: number; y: number; px?: number; py?: number }, alpha: number): { x: number; y: number } {
  const px = w.px ?? w.x;
  const py = w.py ?? w.y;
  return { x: px + (w.x - px) * alpha, y: py + (w.y - py) * alpha };
}
