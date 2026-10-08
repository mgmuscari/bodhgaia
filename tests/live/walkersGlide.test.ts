import { describe, it, expect } from 'vitest';
import { pedPose } from '../../src/live/poses';
import { PED_SPEED } from '../../src/live/tuning';
import { DIR_DX, DIR_DY } from '../../src/live/geometry';
import { isRoadKind } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';
import { residentialCensus } from '../../src/citizens/census';
import { parkingLots, parkingStalls } from '../../src/ui/parkingContent';
import { plantPollution } from '../../src/growth/power';
import {
  createAmbientState,
  setParkingLots,
  setHouseholds,
  setPlantEmitters,
} from '../../src/live/types';
import { stepAmbient } from '../../src/live/step';
import { seedDecay } from '../../src/live/fields/pollution';


/** A leap: the drawing moves sideways more than this in one step beyond the walker's own move. Gliding from one
 *  kerb to the other across a whole tile (where a sidewalk ends at a side road) is about 0.2 a step at a walk. */
const LEAP = 0.25;
const SEED = 'r';
const SIZE = 48;
function probe(): { jumps: number; worstSide: number; worstAlong: number; fastest: number; report: string } {
  const world = runPipeline({ seed: SEED, width: SIZE, height: SIZE }, [
    terrainStage(),
    mosesCenturyStage(),
    ecoSeedStage(),
  ]);
  // The Moses century demolishes every rail, so lay a rail line by hand (two rows, wherever the
  // tile accepts it) — otherwise the train code would go unexercised.
  for (const y of [3, SIZE - 4]) {
    for (let x = 0; x < SIZE; x++) placeTransport(world.map, x, y, BuiltKind.Rail);
  }
  const ambientRng = createRng(SEED).fork('ambient');
  const state = createAmbientState(createRng(SEED).fork('ambient-wind'));
  setParkingLots(
    state,
    parkingLots(world.map).map((lot) => ({
      cx: (lot.x0 + lot.x1) / 2,
      cy: (lot.y0 + lot.y1) / 2,
      x0: lot.x0,
      y0: lot.y0,
      x1: lot.x1,
      y1: lot.y1,
      stalls: parkingStalls(lot),
    })),
  );
  setHouseholds(state, residentialCensus(world.parcels));
  const PLUME_RADIUS = 2;
  const emitters: { tile: number; amount: number }[] = [];
  for (const idx of world.parcels.aliveIndices()) {
    const p = world.parcels.get(idx);
    const amt = plantPollution(p.kind);
    if (amt <= 0) continue;
    for (let yy = -PLUME_RADIUS; yy < p.height + PLUME_RADIUS; yy++) {
      for (let xx = -PLUME_RADIUS; xx < p.width + PLUME_RADIUS; xx++) {
        const tx = p.x + xx;
        const ty = p.y + yy;
        if (world.map.inBounds(tx, ty)) emitters.push({ tile: world.map.idx(tx, ty), amount: amt });
      }
    }
  }
  setPlantEmitters(state, emitters);
  seedDecay(state, world.map);

  for (let f = 0; f < 10; f++) stepAmbient(state, world.map, ambientRng, 1000); // settle
  const onRoad = (x: number, y: number) => world.map.inBounds(x, y) && isRoadKind(world.map.built[world.map.idx(x, y)]!);
  const last = new Map<object, { x: number; y: number; px: number; py: number; mode: number; st: string; path?: readonly number[] }>();
  const details: string[] = [];
  let fastCase = '';
  const hits = new Map<string, number>();
  let jumps = 0, samples = 0, worst = 0, worstSide = 0, worstAlong = 0, fastest = 0;
  for (let s = 0; s < 1200; s++) {
    stepAmbient(state, world.map, ambientRng, 50);
    for (const p of state.peds) {
      if (p.phase === 'inside' || p.phase === 'driving') { last.delete(p); continue; }
      // stepping out of a car eases the drawing from the car to the kerb while the walker's place has already moved —
      // the drawing doesn't follow the walk then, by design (tests/live/parkEase.test.ts holds the ease to a slide)
      if (p.ease) { last.delete(p); continue; }
      const pose = pedPose(p, onRoad, 1);
      const prev = last.get(p);
      if (prev) {
        samples++;
        // a warp is the drawing leaping where the walker didn't: the drawn move less the walker's own move, split
        // into sideways (across the way they're going — the warp across a tile) and along (a hitch in speed)
        const ex = pose.x - prev.x - (p.x - prev.px);
        const ey = pose.y - prev.y - (p.y - prev.py);
        const side = Math.abs(ex * -pose.hy + ey * pose.hx);
        const along = Math.abs(ex * pose.hx + ey * pose.hy);
        worstSide = Math.max(worstSide, side);
        worstAlong = Math.max(worstAlong, along);
        const d = side;
        // how far a walker on foot actually moved this substep (their pace, not the drawing)
        // walking along a leg: they were on the line of the leg they're on now (a corner turn starts at the tile
        // centre — on it). A re-planned leg, or stepping back onto the grid from a parked car, starts off it: a
        // one-off hop, left as it is (backlog, Maddy: no more walker changes)
        const horizontal = p.dir === 1 || p.dir === 3;
        const mx = p.x - prev.px;
        const my = p.y - prev.py;
        const forward = mx * DIR_DX[p.dir]! + my * DIR_DY[p.dir]!; // moving the leg's own way, not hopping back
        const replanned = p.path !== prev.path; // a fresh route this substep: the re-plan hop (backlog), not a pace
        const onLeg = !replanned && (horizontal ? Math.abs(prev.py - p.ty) < 1e-9 : Math.abs(prev.px - p.tx) < 1e-9) && forward >= 0;
        if (p.mode === 0 && prev.mode === 0 && onLeg) {
          const v = Math.abs(p.x - prev.px) + Math.abs(p.y - prev.py);
          if (v > fastest) fastCase = `v=${v.toFixed(3)} was ${prev.st} | now x${p.x.toFixed(2)} y${p.y.toFixed(2)} t(${p.tx},${p.ty}) dir${p.dir} prev${p.prevDir} ph:${p.phase ?? '-'} walkTo:${p.walkTo ? p.walkTo.x + ',' + p.walkTo.y : '-'} path:${p.path ? p.path.length : '-'} leg:${p.leg}`;
          fastest = Math.max(fastest, v);
        }
        worst = Math.max(worst, d);
        if (d > LEAP && details.length < 12) details.push(`d=${d.toFixed(2)} from(${prev.x.toFixed(2)},${prev.y.toFixed(2)}) to(${pose.x.toFixed(2)},${pose.y.toFixed(2)}) | was ${prev.st} | now x${p.x.toFixed(2)} y${p.y.toFixed(2)} t(${p.tx},${p.ty}) dir${p.dir} prev${p.prevDir} ph:${p.phase ?? '-'} mode:${p.mode} walkTo:${p.walkTo ? p.walkTo.x + ',' + p.walkTo.y : '-'} snapDir:${p.snap?.dir} snap(${p.snap?.x.toFixed(2)},${p.snap?.y.toFixed(2)})`);
        if (d > LEAP) { jumps++; const k = `${Math.floor(pose.x)},${Math.floor(pose.y)} ${world.map.built[world.map.idx(Math.floor(pose.x), Math.floor(pose.y))]}`; hits.set(k, (hits.get(k) ?? 0) + 1); }
      }
      last.set(p, { x: pose.x, y: pose.y, px: p.x, py: p.y, mode: p.mode ?? 0, path: p.path, st: `x${p.x.toFixed(2)} y${p.y.toFixed(2)} t(${p.tx},${p.ty}) dir${p.dir} prev${p.prevDir} ph:${p.phase ?? '-'}` });
    }
  }
  const top = [...hits].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}×${n}`).join('  ');
  return { jumps, worstSide, worstAlong, fastest, report: fastCase + '\n' + details.join('\n') + '\n' + `leaps>${LEAP}: ${jumps} of ${samples} steps, worst ${worst.toFixed(2)} tiles; tiles (x,y kind): ${top}` };
}
describe('walkers glide (Maddy 2026-10-08: residents warped across the avenue at her (106, 37))', () => {
  it('over a minute of the live city, no walker’s drawing leaps sideways beyond where they walked (gliding across a tile is fine)', () => {
    const r = probe();
    expect(r.jumps, r.report).toBeLessThanOrEqual(5); // sideways leaps (a respawn at home is a real one)
    expect(r.worstAlong, r.report).toBeLessThan(0.35); // a fast rider rounding a kerb corner may hitch a little
  });

  it('nobody on foot ever moves faster than a walk — not even round a corner (Maddy: they shot round kerbs)', () => {
    const r = probe();
    expect(r.fastest, `fastest walker ${r.fastest.toFixed(3)} tiles a substep: ${r.report.split('\n')[0]}`).toBeLessThanOrEqual(PED_SPEED * 1.001);
  });
});
