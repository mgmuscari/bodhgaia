// Riders (docs/design/transit.md): a long trip with stops near both ends rides the line — walk to the platform,
// wait there, board a vehicle halted at the stop, ride it out of sight, get off at the stop nearest the destination,
// walk on. Nobody waits for ever.
import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, placeTransport } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { createAmbientState, offStreet, type Ped } from '../../src/live/types';
import { spawnTransit, stepTrain } from '../../src/live/trains';
import { planRide, startRide, WAIT_MAX, capacityOf } from '../../src/live/riders';
import { TRAM_LEN } from '../../src/live/trains';
import { TRAIN_LEN, FUEL_TANK } from '../../src/live/tuning';
import { chooseMode } from '../../src/live/pathing';
import { TravelMode } from '../../src/citizens/modes';
import { stepPed } from '../../src/live/peds';
import { buildVehicleCtx } from '../../src/live/cars';

/** A long tram line along row 5, a street beside it on row 6, a footpath of open ground on row 7. */
function city() {
  const map = new GameMap(50, 12);
  for (let x = 2; x <= 45; x++) {
    map.setBuilt(x, 5, BuiltKind.Streetcar);
    placeTransport(map, x, 6, BuiltKind.RoadStreet);
  }
  return { map, state: createAmbientState() };
}

const tick = (c: ReturnType<typeof city>, n: number, vehicles: boolean, each?: () => void) => {
  const rng = createRng('r').fork('r');
  for (let i = 0; i < n; i++) {
    if (vehicles) spawnTransit(c.state, c.map, rng);
    c.state.trains = c.state.trains.filter((t) => stepTrain(c.map, t, rng));
    const ctx = buildVehicleCtx(c.state, c.map);
    c.state.peds = c.state.peds.filter((p) => stepPed(c.state, c.map, rng, ctx, p));
    each?.();
  }
};

describe('riding transit', () => {
  it('plans a ride: a stop to board near the start, one to get off near the end, on the same line', () => {
    const { map } = city();
    const r = planRide(map, 3, 7, 44, 7, 'tram')!;
    expect(r).not.toBeNull();
    expect(r.board.line).toBe(r.alight.line);
    const px = (t: number) => t % map.width;
    expect(px(r.board.platform)).toBeLessThan(15);
    expect(px(r.alight.platform)).toBeGreaterThan(30);
    expect(planRide(map, 3, 7, 6, 7, 'tram')).toBeNull(); // too short to be worth a ride
  });

  it('long trips with stops at both ends ride the line; with no line, they walk', () => {
    const c = city();
    expect(chooseMode(c.map, 3, 7, 44, 7)).toBe(TravelMode.Streetcar);
    const bare = new GameMap(50, 12);
    for (let x = 2; x <= 45; x++) placeTransport(bare, x, 6, BuiltKind.RoadStreet);
    expect(chooseMode(bare, 3, 7, 44, 7)).not.toBe(TravelMode.Streetcar);
  });

  it('a ride is the cheap way: taken even for a walk- or bike-length trip when the line runs from end to end (Maddy 2026-10-08)', () => {
    const c = city();
    expect(chooseMode(c.map, 10, 7, 24, 7)).toBe(TravelMode.Streetcar); // bike range, stops at both ends
    expect(chooseMode(c.map, 10, 7, 20, 7)).toBe(TravelMode.Streetcar); // walk range too
    expect(chooseMode(c.map, 10, 7, 12, 7)).toBe(TravelMode.Walk); // next door: just walk
  });

  it('walks to the platform, waits in sight, boards, rides out of sight, gets off at the far stop, walks on', () => {
    const c = city();
    const plan = planRide(c.map, 3, 6, 44, 6, 'tram')!;
    const p: Ped = { x: 3, y: 6, dir: 1, tx: 3, ty: 6, homeTile: c.map.idx(3, 7) };
    startRide(p, plan, { x: 44, y: 7 }, 'to-building');
    c.state.peds.push(p);
    const seen = new Set<string>();
    let waitedAt: number | null = null;
    tick(c, 4000, true, () => {
      if (!c.state.peds.includes(p)) return;
      const stage = p.ride?.stage ?? `walking:${p.phase}`;
      seen.add(stage);
      if (stage === 'waiting') waitedAt = c.map.idx(Math.round(p.x), Math.round(p.y));
      if (stage === 'riding') expect(offStreet(p)).toBe(true);
      if (stage === 'waiting') expect(offStreet(p)).toBe(false);
    });
    expect([...seen]).toEqual(expect.arrayContaining(['to-stop', 'waiting', 'riding', 'walking:to-building']));
    expect(waitedAt).toBe(plan.board.platform);
    expect(p.mode).toBe(TravelMode.Walk); // off the tram, on foot
  });

  it('gives up and walks if nothing comes', () => {
    const c = city();
    const plan = planRide(c.map, 3, 6, 44, 6, 'tram')!;
    const p: Ped = { x: 3, y: 6, dir: 1, tx: 3, ty: 6, homeTile: c.map.idx(3, 7) };
    startRide(p, plan, { x: 44, y: 7 }, 'to-building');
    c.state.peds.push(p);
    let gaveUp: { phase?: string; mode?: TravelMode } | null = null;
    let waited = 0;
    tick(c, WAIT_MAX + 600, false, () => {
      if (p.ride?.stage === 'waiting') waited++;
      if (!gaveUp && !p.ride) gaveUp = { phase: p.phase, mode: p.mode };
    });
    expect(waited).toBeGreaterThanOrEqual(WAIT_MAX);
    expect(gaveUp).toEqual({ phase: 'to-building', mode: TravelMode.Walk }); // on foot, still bound for the plot
  });

  it('carries 32 a car: a two-car tram 64, a train 32 × its consist (Maddy 2026-10-08)', () => {
    expect(capacityOf('tram')).toBe(32 * TRAM_LEN);
    expect(capacityOf('tram')).toBe(64);
    expect(capacityOf('rail')).toBe(32 * TRAIN_LEN);
  });

  it('a ride is a rest: riders get some energy back on the way (Maddy 2026-10-08)', () => {
    const c = city();
    const plan = planRide(c.map, 3, 6, 44, 6, 'tram')!;
    const p: Ped = { x: 3, y: 6, dir: 1, tx: 3, ty: 6, homeTile: c.map.idx(3, 7), fuel: FUEL_TANK / 4 };
    startRide(p, plan, { x: 44, y: 7 }, 'to-building');
    c.state.peds.push(p);
    let boarded: number | null = null;
    let alighted: number | null = null;
    tick(c, 4000, true, () => {
      if (boarded === null && p.ride?.stage === 'riding') boarded = p.fuel!;
      if (boarded !== null && alighted === null && !p.ride) alighted = p.fuel!;
    });
    expect(boarded).not.toBeNull();
    expect(alighted!).toBeGreaterThan(boarded! + 100);
    expect(alighted!).toBeLessThanOrEqual(FUEL_TANK);
  });
});
