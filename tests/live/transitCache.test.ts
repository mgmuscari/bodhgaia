// The scaling pass (Maddy 2026-10-08: "anything superlinear in the simulation code"). transitFor re-checked the map for
// track changes every 20th CALL — and every transit rider calls it twice a substep, so the full-map scans grew with the
// riders (300 riders: ~30 scans a substep). It re-checks by the substep clock instead: once a second, however many ask.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind } from '../../src/engine/fabric';
import { transitFor, tickTransitClock, transitScans, TRANSIT_RECHECK_SUBSTEPS } from '../../src/live/transit';

const line = () => {
  const map = new GameMap(40, 10);
  for (let x = 2; x < 30; x++) map.setBuilt(x, 5, BuiltKind.Streetcar);
  return map;
};

describe('the transit cache re-checks by time, not by callers', () => {
  it('a thousand calls in one substep scan the map once', () => {
    const map = line();
    transitFor(map);
    const s0 = transitScans();
    for (let i = 0; i < 1000; i++) transitFor(map);
    expect(transitScans() - s0).toBe(0);
  });

  it('after a second of substeps it looks again — and sees new track', () => {
    const map = line();
    const before = transitFor(map).lines[0]!.tiles.length;
    for (let x = 30; x < 36; x++) map.setBuilt(x, 5, BuiltKind.Streetcar); // the player extends the line
    expect(transitFor(map).lines[0]!.tiles.length).toBe(before); // not yet: same substep
    for (let i = 0; i < TRANSIT_RECHECK_SUBSTEPS; i++) tickTransitClock();
    expect(transitFor(map).lines[0]!.tiles.length).toBe(before + 6);
  });
});
