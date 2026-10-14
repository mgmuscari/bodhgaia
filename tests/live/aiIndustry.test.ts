// Maddy 2026-10-08 (backlog, in 1.0.15): "an AI node turns nearby industry into high-tech jobs — the industrial
// pollution there goes away". Industry within AI_CLEAN_RADIUS of a Community AI Node no longer poisons the ground it
// stands on, seeps into its neighbours, sheds runoff into the water, or spills.
import { describe, expect, it } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState } from '../../src/live/types';
import { accumulateGroundPollution, accumulateWaterRunoff, aiCleaned, AI_CLEAN_RADIUS } from '../../src/live/fields/pollution';
import { drawSpills } from '../../src/live/spills';

function works(withNode: boolean, nodeAt = 6) {
  const map = new GameMap(30, 12);
  const parcels = new ParcelStore();
  for (let x = 0; x < 30; x++) map.water[map.idx(x, 0)] = 1; // a river along the top
  const w = placeParcel(map, parcels, { x: 2, y: 1, width: 2, height: 2, kind: BuiltKind.Industrial });
  parcels.setCondition(w, 0); // run down: spills likely
  for (let k = 0; k < 2 * 2; k++) map.redline[map.idx(2 + (k % 2), 1 + (k >> 1))] = 255;
  if (withNode) placeParcel(map, parcels, { x: nodeAt, y: 4, width: 1, height: 1, kind: BuiltKind.AINode });
  return { map, parcels, state: createAmbientState(createRng('ai').fork('a')) };
}

describe('AI nodes clean up nearby industry', () => {
  it('industry within reach of an AI node is marked clean; beyond it, not', () => {
    expect(aiCleaned(works(true).map).has(works(true).map.idx(2, 1))).toBe(true);
    const far = works(true, 2 + AI_CLEAN_RADIUS + 3);
    expect(aiCleaned(far.map).has(far.map.idx(2, 1))).toBe(false);
  });

  it('it no longer poisons its ground or seeps into its neighbours', () => {
    const dirty = works(false);
    const clean = works(true);
    for (const s of [dirty, clean]) accumulateGroundPollution(s.state, s.map);
    expect(dirty.state.groundPollution.get(dirty.map.idx(2, 1)) ?? 0).toBeGreaterThan(0);
    expect(dirty.state.groundPollution.get(dirty.map.idx(4, 1)) ?? 0).toBeGreaterThan(0); // seep
    expect(clean.state.groundPollution.get(clean.map.idx(2, 1)) ?? 0).toBe(0);
    expect(clean.state.groundPollution.get(clean.map.idx(4, 1)) ?? 0).toBe(0);
  });

  it('it sheds no toxic runoff into the river (only what any built ground does)', () => {
    const dirty = works(false);
    const clean = works(true);
    for (const s of [dirty, clean]) accumulateWaterRunoff(s.state, s.map);
    const at = (s: ReturnType<typeof works>) => s.state.waterPollution.get(s.map.idx(2, 0)) ?? 0;
    expect(at(clean)).toBeLessThan(at(dirty));
  });

  it('it never spills', () => {
    const dirty = works(false);
    const clean = works(true);
    let d = 0;
    let c = 0;
    const rd = createRng('sp').fork('d');
    const rc = createRng('sp').fork('d');
    for (let h = 0; h < 24 * 400; h++) {
      d += drawSpills(dirty.state, dirty, rd, h % 24).length;
      c += drawSpills(clean.state, clean, rc, h % 24).length;
    }
    expect(d).toBeGreaterThan(0);
    expect(c).toBe(0);
  });
});
