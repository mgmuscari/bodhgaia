// Maddy 2026-10-08: "cars park horizontally in parking lots but the stalls are vertical". The cars stand east–west in a
// 2 × 3 grid of stalls (parkingContent); the lot's paint drew north–south bays too narrow for a car. The stall lines
// now run east–west, between the rows of cars, so every car sits in a painted bay.
import { describe, expect, it } from 'vitest';
import { paintBuilding } from '../../src/ui/snesBuildings';
import { BuiltKind } from '../../src/engine/fabric';
import { STALL_COLS, STALL_ROWS } from '../../src/ui/parkingContent';
import { C } from '../../src/ui/snesPalette';
import { BASE_TILE } from '../../src/ui/camera';

const T = BASE_TILE;
const lot = paintBuilding(BuiltKind.ParkingLot, T, T, 0, 0);
const isLine = (x: number, y: number) => {
  const i = (y * T + x) * 4;
  return lot.data[i] === C.line[0] && lot.data[i + 1] === C.line[1] && lot.data[i + 2] === C.line[2];
};

describe('the lot’s stall lines run the way the cars park', () => {
  it('no vertical stall lines: no line pixel has a line pixel directly above it', () => {
    for (let y = 1; y < T; y++) for (let x = 0; x < T; x++) expect(isLine(x, y) && isLine(x, y - 1), `(${x},${y})`).toBe(false);
  });

  it('a line runs east–west between every two rows of cars, in each column of stalls', () => {
    for (let r = 1; r < STALL_ROWS; r++) {
      const y = Math.round((r * T) / STALL_ROWS) - 1;
      for (let c = 0; c < STALL_COLS; c++) {
        const cx = Math.floor(((c + 0.5) * T) / STALL_COLS);
        expect(isLine(cx, y), `row edge ${r}, col ${c} at (${cx},${y})`).toBe(true);
      }
    }
  });

  it('no line crosses a car: the stall centres are clear asphalt', () => {
    for (let r = 0; r < STALL_ROWS; r++)
      for (let c = 0; c < STALL_COLS; c++) {
        const cx = Math.floor(((c + 0.5) * T) / STALL_COLS);
        const cy = Math.floor(((r + 0.5) * T) / STALL_ROWS);
        expect(isLine(cx, cy)).toBe(false);
      }
  });
});
