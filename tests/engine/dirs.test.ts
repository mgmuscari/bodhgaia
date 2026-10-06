import { describe, it, expect } from 'vitest';
import { DIRS4_NESW, DIRS4_EWSN } from '../../src/engine/dirs';

// The 4-neighbour tables are ITERATION-ORDER-sensitive: worldgen, the civic BFS and the decoration
// masks all walk them in order, so a reorder would move the world hash. These pins are the guard.
describe('4-neighbour direction tables (order is load-bearing)', () => {
  it('DIRS4_NESW is clockwise from north: N, E, S, W', () => {
    expect(DIRS4_NESW).toEqual([[0, -1], [1, 0], [0, 1], [-1, 0]]);
  });

  it('DIRS4_NESW index k is the k-th bit of a N=1/E=2/S=4/W=8 edge mask', () => {
    const bit = (dx: number, dy: number): number => DIRS4_NESW.findIndex(([x, y]) => x === dx && y === dy);
    expect(1 << bit(0, -1)).toBe(1);
    expect(1 << bit(1, 0)).toBe(2);
    expect(1 << bit(0, 1)).toBe(4);
    expect(1 << bit(-1, 0)).toBe(8);
  });

  it('DIRS4_EWSN is the axis-pair order: E, W, S, N', () => {
    expect(DIRS4_EWSN).toEqual([[1, 0], [-1, 0], [0, 1], [0, -1]]);
  });
});
