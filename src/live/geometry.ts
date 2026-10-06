// Live-layer GEOMETRY (leaf module, no imports): the 4-neighbour direction tables and the draw-time
// lane / kerb offsets cars and pedestrians ride. Cut verbatim from ui/ambientContent.ts; pure, so
// every live module can read it at import time without a cycle.

// 4-neighbour directions, indexed 0=N, 1=E, 2=S, 3=W.
export const DIR_DX = [0, 1, 0, -1] as const;
export const DIR_DY = [-1, 0, 1, 0] as const;
export const opposite = (d: number): number => (d + 2) % 4;

/** Lane half-width in tile units: how far a car is drawn off its tile centre, to the
 *  RIGHT of its heading, so opposing flows ride opposite sides of a road. Cosmetic —
 *  read only by the renderer's sprite draw; live-pass tuned. */
export const LANE = 0.16;

/** A car's body footprint (tile units) — the bounding box parking and lanes are laid out to clear. */
export const CAR_LENGTH = 0.44;
export const CAR_WIDTH = 0.24;
/** The car lane offset (exported for tests / pace maths). */
export const LANE_OFFSET = LANE;

/** The lane seam (pure, `dir`-only): a car's draw-time offset from its tile centre,
 *  perpendicular to and on the RIGHT of its heading (right-hand traffic). Screen
 *  coords are y-down, so "right" is the heading rotated 90° clockwise: (dx,dy) →
 *  (-dy, dx). On any vertical/horizontal road the two travel directions are therefore
 *  drawn on opposite sides — bidirectional flow, visibly separated (Maddy playtest).
 *  0=N→east side, 1=E→south side, 2=S→west side, 3=W→north side. */
export function laneOffset(dir: number): { dx: number; dy: number } {
  return { dx: -DIR_DY[dir]! * LANE, dy: DIR_DX[dir]! * LANE };
}

/** How far a street-parked car is drawn toward its curb (the adjacent non-road tile). Larger
 *  than LANE so the car clears the lane centre and hugs the kerb instead of sitting in the
 *  middle of the road — but < 0.5 so it stays within its own tile. */
export const CURB = 0.32;

/** A street-parked car's draw-time offset from its tile centre, straight toward its recorded
 *  curb side (curbDir, 0=N/1=E/2=S/3=W) so it parks against the building/grass edge rather
 *  than on the lane. Cosmetic — read only by the renderer. */
export function curbParkOffset(curbDir: number): { dx: number; dy: number } {
  return { dx: DIR_DX[curbDir]! * CURB, dy: DIR_DY[curbDir]! * CURB };
}

/** How far a pedestrian is drawn toward the kerb (perpendicular to its heading) when walking
 *  ALONG a street — bigger than the car LANE so it clears the traffic onto the sidewalk edge.
 *  Opposite-direction walkers ride opposite kerbs (right-hand), so both sides of the street
 *  are used. Through-the-middle is reserved for demand-path cut-throughs across open ground. */
export const PED_CURB = 0.38;

export const KERB_PULL = 0.4; // a curb stall sits this far toward its kerb edge — a car width clear of the lane (LANE)
export const STALL_ALONG = 0.25; // the two stalls on a kerb side sit this far either way ALONG it — a car length apart
