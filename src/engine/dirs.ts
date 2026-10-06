// The 4-neighbour direction tables. Engine-level (headless) so every layer above can share them.
//
// ITERATION ORDER IS LOAD-BEARING: BFS frontiers, steepest-descent tie-breaks, rng-indexed picks and
// first-match scans all walk these in order, so the order decides the generated world (hashWorld).
// There are TWO orders in use and they must NOT be merged — each caller keeps the order it was
// written against:
//   - DIRS4_NESW — clockwise from north. Index k is also the k-th bit of a N=1/E=2/S=4/W=8 edge mask
//     (the same order as live/geometry's DIR_DX/DIR_DY).
//   - DIRS4_EWSN — the axis pairs: east/west, then south/north.

export type Dir4 = readonly [number, number];

/** N, E, S, W (clockwise from north; index k ↔ mask bit 1 << k). */
export const DIRS4_NESW: ReadonlyArray<Dir4> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** E, W, S, N (the horizontal pair, then the vertical pair). */
export const DIRS4_EWSN: ReadonlyArray<Dir4> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
