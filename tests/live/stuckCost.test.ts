// The scaling pass (Maddy 2026-10-08): a stuck car's escape copied the whole traffic map (new Map(traffic)) to price
// out its jammed tile, and a failed U-turn re-planned every substep — the cost peaking exactly when the city jams.
import { describe, expect, it } from 'vitest';
import { avoidingTile, uTurnDue, U_TURN_RETRY } from '../../src/live/motion';
import { STUCK_UTURN } from '../../src/live/tuning';

describe('a stuck car prices out its tile without copying the traffic', () => {
  it('the jammed tile costs a fortune; every other reads the live traffic as it is', () => {
    let reads = 0;
    const traffic = { get: (i: number) => (reads++, i === 5 ? 7 : undefined) };
    const t = avoidingTile(traffic, 9);
    expect(t.get(9)).toBe(1e6);
    expect(t.get(5)).toBe(7);
    expect(t.get(6)).toBeUndefined();
    expect(reads).toBe(2); // read through on demand — nothing copied up front
  });

  it('a failed U-turn is retried every few substeps, not every one', () => {
    const due = Array.from({ length: 40 }, (_, k) => STUCK_UTURN + k).filter(uTurnDue);
    expect(due[0]).toBe(STUCK_UTURN);
    expect(due.length).toBe(Math.ceil(40 / U_TURN_RETRY));
    expect(uTurnDue(STUCK_UTURN - 1)).toBe(false);
  });
});
