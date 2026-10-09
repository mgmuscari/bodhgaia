// Maddy 2026-10-09: "why not just step life at 30/s everywhere? what's the point of 20/s?" — the life layer steps 30
// times a second (one step per 30-fps frame, no beat). Every per-step quantity is re-expressed so the WORLD moves at the
// same real pace: each constant below must give exactly the per-second (or per-second²) value it gave at 20 steps/s.
import { describe, expect, it } from 'vitest';
import * as T from '../../src/live/tuning';
import { DWELL, TRANSIT_RECHECK_SUBSTEPS } from '../../src/live/transit';
import { U_TURN_RETRY } from '../../src/live/motion';
import { EASE_SUBSTEPS } from '../../src/live/poses';
import { RIDE_REST } from '../../src/live/riders';

const HZ = T.SUBSTEPS_PER_SEC;
const OLD = 20;

describe('the life layer steps 30 times a second, at the same real pace', () => {
  it('the clock', () => {
    expect(HZ).toBe(30);
    expect(T.SUBSTEP_MS).toBeCloseTo(1000 / 30, 9);
  });

  it('speeds (distance a second) are unchanged', () => {
    const old: Record<string, number> = { CAR_SPEED: 0.12, PED_SPEED: 0.05, TRAIN_SPEED: 0.16, TRUCK_SPEED: 0.16, CLOUD_SPEED: 0.03, BIRD_MAX_SPEED: 0.08 };
    for (const [k, v] of Object.entries(old)) expect((T as unknown as Record<string, number>)[k]! * HZ, k).toBeCloseTo(v * OLD, 9);
  });

  it('per-step amounts (rates a second) are unchanged', () => {
    const old: Record<string, number> = {
      POLICE_VIOLENCE_DECAY: 0.05, HEALTH_DECAY: 0.02, TRAFFIC_LAY: 10, TRAFFIC_DECAY: 1, POLL_LAY_BASE: 6, POLL_CONGEST: 8,
      POLL_DECAY: 0.4, ROAD_WALK_PENALTY: 0.04, WORN_WALK_PENALTY: 0.04, FUEL_BURN_BASE: 1, FUEL_BURN_LUSH: 0.8,
      FUEL_BURN_BEATEN: 0.7, FUEL_BURN_MIN: 0.3, WEAR_RATE: 1.5, WEAR_DECAY: 0.02, ABANDONED_GROUND_POLL: 0.35,
      CLOUD_SMOG: 3, CLOUD_TOXIC: 24, TOXIC_DECAY: 0.5,
    };
    for (const [k, v] of Object.entries(old)) expect((T as unknown as Record<string, number>)[k]! * HZ, k).toBeCloseTo(v * OLD, 9);
    expect(RIDE_REST * HZ).toBeCloseTo(1 * OLD, 9);
  });

  it('durations (seconds) are unchanged, and stay whole numbers of steps', () => {
    const old: Record<string, number> = {
      CRUISER_LIFE: 400, SCATTER_LEN: 140, CHASE_LEN: 400, ARREST_CADENCE: 40, PARK_MAX_WAIT: 600, RETIRED_CAR_LINGER: 90,
      WIND_CADENCE: 8, RAIN_CADENCE: 560, LV_CADENCE: 20, OCC_CADENCE: 20, WATER_RUNOFF_CADENCE: 20, GROUND_RUNOFF_CADENCE: 20,
      ABANDONED_DEGRADE_TIME: 2400, ROAD_CADENCE: 30, INSIDE_DWELL_MIN: 60, INSIDE_DWELL_SPAN: 200, STUCK_REPATH: 40,
      STUCK_UTURN: 80, STUCK_GIVE_UP: 120, STUCK_ESCAPE: 160, FALL_SUBSTEPS: 60, MEMORIAL_SUBSTEPS: 2400,
      TURNOUT_SUBSTEPS: 100, SPRAY_SUBSTEPS: 60, CLOUD_SUBSTEPS: 600, CRASH_SUBSTEPS: 600,
    };
    const check = (k: string, now: number, then: number) => {
      expect(Number.isInteger(now), `${k} whole`).toBe(true);
      expect(now / HZ, k).toBeCloseTo(then / OLD, 9);
    };
    for (const [k, v] of Object.entries(old)) check(k, (T as unknown as Record<string, number>)[k]!, v);
    check('DWELL', DWELL, 100);
    check('TRANSIT_RECHECK_SUBSTEPS', TRANSIT_RECHECK_SUBSTEPS, 20);
    check('U_TURN_RETRY', U_TURN_RETRY, 10);
    check('EASE_SUBSTEPS', EASE_SUBSTEPS, 10);
  });

  it('the flocks feel the same: attraction per second², alignment as the same relaxation a second', () => {
    expect(T.BIRD_COHESION * HZ * HZ).toBeCloseTo(0.012 * OLD * OLD, 9);
    expect(T.BIRD_SEPARATION * HZ * HZ).toBeCloseTo(0.02 * OLD * OLD, 9);
    // (1 − a)^steps-per-second is the share of misalignment left after a second
    let left = 1;
    for (let i = 0; i < HZ; i++) left *= 1 - T.BIRD_ALIGN;
    let was = 1;
    for (let i = 0; i < OLD; i++) was *= 1 - 0.04;
    expect(left).toBeCloseTo(was, 6);
  });
});

// One step per frame, held: real frame timestamps jitter by a millisecond or two around 33⅓ ms, and a plain accumulator
// then gives a frame no step and the next two — the beat again. Time owed within a quarter step of a whole one is
// taken now (borrowing from the next frame), so jittered frames still carry exactly one step each.
import { stepAmbient } from '../../src/live/step';
import { createAmbientState } from '../../src/live/types';
import { GameMap } from '../../src/engine/map';
import { createRng } from '../../src/engine/rng';

describe('steps lock to frames', () => {
  const run = (dts: number[]) => {
    const state = createAmbientState();
    const map = new GameMap(8, 8);
    const rng = createRng('lock');
    const per: number[] = [];
    let ticks = state.lvTick;
    for (const dt of dts) {
      stepAmbient(state, map, rng, dt);
      per.push(state.lvTick - ticks);
      ticks = state.lvTick;
    }
    return { per, state };
  };
  it('frames jittering around a step’s length each carry exactly one step', () => {
    const jitter = [33.1, 33.6, 32.9, 33.8, 33.2, 33.5, 33.0, 33.7, 33.3, 33.4];
    const { per } = run(Array.from({ length: 60 }, (_, i) => jitter[i % jitter.length]!));
    expect(per.every((n) => n === 1)).toBe(true);
  });
  it('time is never lost or invented: over many frames, steps equal elapsed time over the step', () => {
    const dts = Array.from({ length: 300 }, (_, i) => 10 + ((i * 37) % 50));
    const { per, state } = run(dts);
    const total = dts.reduce((a, b) => a + b, 0);
    const steps = per.reduce((a, b) => a + b, 0);
    expect(Math.abs(steps * T.SUBSTEP_MS + state.accMs - total)).toBeLessThan(1e-6);
  });
  it('the interpolation fraction stays in [0, 1] even when a step was borrowed', async () => {
    const { ambientAlpha } = await import('../../src/live/poses');
    const { state } = run([33.0]);
    expect(state.accMs).toBeLessThan(0); // borrowed a third of a millisecond
    expect(ambientAlpha(state)).toBe(0);
  });
});
