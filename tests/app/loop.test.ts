import { describe, it, expect } from 'vitest';
import { createSimTick, createFrame, runFrames, SIM_TICK_MS, type SimTickCtx, type FrameCtx } from '../../src/app/loop';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState } from '../../src/civic/state';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { CIVIC_CADENCE, type SimDeps } from '../../src/civic/compose';
import { createRng } from '../../src/engine/rng';

// The loop: the fixed-tick sim step (simTick + the civic-cadence seams the shell owns) and the rAF frame body
// (power hour → economy hour → sim → base refresh → CPU composite → GPU passes → the sim-gated dock sync).

function simSetup(startTick = 0, withHome = true) {
  const map = new GameMap(16, 16);
  const parcels = new ParcelStore();
  if (withHome) placeParcel(map, parcels, { x: 10, y: 10, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 120 });
  placeTransport(map, 8, 8, BuiltKind.RoadStreet);
  map.soilHealth.fill(100);
  const partition = computeNeighborhoods(map);
  const sim: SimDeps = { world: { map, parcels }, tech: createTechState(TECH_TREE), civic: createCivicState(partition), partition };
  const log: string[] = [];
  let powerChanged = false;
  const ctx: SimTickCtx = {
    sim,
    startTick,
    power: {
      recompute: () => (log.push('power'), powerChanged),
      grid: () => ({ poweredAnchors: new Set<number>() }),
    },
    live: {
      state: { occupancy: new Map<number, number>() },
      revivalRng: createRng('loop-test').fork('revival'),
      refreshParkingLots: () => log.push('lots'),
      refreshHouseholds: () => log.push('households'),
      publishWelcome: (voiceAt) => log.push(`welcome:${voiceAt(0)}`),
    },
    overlays: { onSimTick: (r) => log.push(r.civicTicked ? 'overlay:civic' : 'overlay') },
    pulse: { tick: () => log.push('pulse') },
    restore: () => ({ refresh: () => log.push('restore') }),
    markDirty: () => log.push('dirty'),
  };
  return { ticker: createSimTick(ctx), log, sim, setPowerChanged: (v: boolean) => (powerChanged = v) };
}

describe('createSimTick', () => {
  it('reports tick 0 until a tick fires, then the latest tick; sets the changed flag once per batch', () => {
    const h = simSetup();
    expect(h.ticker.tick()).toBe(0);
    expect(h.ticker.takeChanged()).toBe(false);
    h.ticker.advance(SIM_TICK_MS * 3);
    expect(h.ticker.tick()).toBe(2); // ticks 0, 1, 2
    expect(h.ticker.takeChanged()).toBe(true);
    expect(h.ticker.takeChanged()).toBe(false);
    expect(h.log).toEqual(['overlay', 'overlay', 'overlay']);
  });

  it('a resumed game keeps its clock (but reports 0 until its first tick, as before)', () => {
    const h = simSetup(500);
    expect(h.ticker.tick()).toBe(0);
    h.ticker.advance(SIM_TICK_MS);
    expect(h.ticker.tick()).toBe(500);
  });

  it('runs the civic seams on the civic cadence: pulse, restoration, grid, revival, refreshes', () => {
    const h = simSetup(CIVIC_CADENCE, false);
    h.ticker.advance(SIM_TICK_MS);
    // nothing changed → clean; the fresh voice is published as each home's welcome (none organised yet: 0)
    expect(h.log).toEqual(['overlay:civic', 'pulse', 'restore', 'power', 'lots', 'households', 'welcome:0']);
  });

  it('marks the base dirty on a real change: the grid, or a home that revived / decayed', () => {
    const grid = simSetup(CIVIC_CADENCE, false);
    grid.setPowerChanged(true);
    grid.ticker.advance(SIM_TICK_MS);
    expect(grid.log.at(-1)).toBe('dirty');
    const home = simSetup(CIVIC_CADENCE, true); // an unpowered, unoccupied home decays
    home.ticker.advance(SIM_TICK_MS);
    expect(home.log.at(-1)).toBe('dirty');
  });

  it('clamps a long gap like the fixed-tick loop does (catch-up is bounded)', () => {
    const h = simSetup();
    h.ticker.advance(60_000);
    expect(h.ticker.tick()).toBeLessThanOrEqual(10);
  });
});

function frameSetup(opts: { liveOn?: boolean; gpu?: boolean; hidden?: boolean; changed?: boolean } = {}) {
  const log: string[] = [];
  let dirty = true;
  let changed = opts.changed ?? false;
  const fakeGpu = {
    render: () => log.push('gpu.render'),
    renderAgents: () => log.push('gpu.agents'),
  };
  const ctx: FrameCtx = {
    start: 1000,
    power: { maybeResolveHour: () => (log.push('hour'), false) },
    economy: { advance: () => log.push('econ') },
    sim: {
      advance: (dt) => log.push(`sim:${dt}`),
      takeChanged: () => {
        const c = changed;
        changed = false;
        return c;
      },
    },
    view: {
      renderer: {
        refreshLiveMarks: () => log.push('refreshLiveMarks'),
        renderFrame: () => log.push('renderFrame'),
        render: () => log.push('render'),
        baseCanvas: () => null as never,
        emissionLayers: () => null as never,
        baseVersion: () => 0,
        basePatch: () => ({ version: 0, rects: [] }),
        emissiveBuildingList: () => [],
        headlightBeams: () => [],
      },
      camera: {} as never,
      gpu: () => (opts.gpu ? (fakeGpu as never) : null),
      smog: () => (opts.gpu ? ({ render: () => log.push('smog') } as never) : null),
      width: () => 800,
      height: () => 600,
      markDirty: () => log.push('dirty'),
      isDirty: () => dirty,
      clean: () => {
        dirty = false;
      },
    },
    live: { on: opts.liveOn ?? true, step: () => log.push('live.step'), state: { pollution: null, wind: null } as never },
    world: {} as never,
    hidden: () => opts.hidden ?? false,
    syncDock: () => log.push('syncDock'),
  };
  lastCtx = ctx;
  return { frame: createFrame(ctx), log, isDirty: () => dirty, setChanged: () => (changed = true) };
}
let lastCtx: FrameCtx | null = null;

describe('createFrame', () => {
  it('steps the clocks in order, then composites the live frame (base refresh on the 2 s cadence)', () => {
    const h = frameSetup();
    h.frame(1016);
    expect(h.log).toEqual(['hour', 'econ', 'sim:16', 'live.step', 'renderFrame']); // the cadence clock starts at 0
    expect(h.isDirty()).toBe(false);
    h.log.length = 0;
    h.frame(2032);
    expect(h.log).toEqual(['hour', 'econ', 'sim:1016', 'refreshLiveMarks', 'live.step', 'renderFrame']);
    h.log.length = 0;
    h.frame(3100);
    expect(h.log).not.toContain('refreshLiveMarks'); // inside 2 s of the last refresh
    h.frame(4100);
    expect(h.log).toContain('refreshLiveMarks');
  });

  it('with life off on the CPU path, repaints only when dirty', () => {
    const h = frameSetup({ liveOn: false });
    h.frame(1016);
    expect(h.log).toContain('render');
    h.log.length = 0;
    h.frame(1032);
    expect(h.log).not.toContain('render');
  });

  it('with a hidden tab the live layer does not step', () => {
    const h = frameSetup({ hidden: true });
    h.frame(1016);
    expect(h.log).not.toContain('live.step');
  });

  it('drives the GPU passes every frame when mounted — agent light only with life on; the smog always (Maddy 2026-10-08: with life off it froze and stopped following the map)', () => {
    const on = frameSetup({ gpu: true });
    on.frame(1016);
    expect(on.log.slice(-3)).toEqual(['gpu.render', 'gpu.agents', 'smog']);
    const off = frameSetup({ gpu: true, liveOn: false });
    off.frame(1016);
    off.log.length = 0;
    off.frame(1032);
    expect(off.log.slice(-2)).toEqual(['gpu.render', 'smog']);
  });

  it('syncs the dock once after a sim tick moved state, not every frame', () => {
    const h = frameSetup({ changed: true });
    h.frame(1016);
    expect(h.log.at(-1)).toBe('syncDock');
    h.log.length = 0;
    h.frame(1032);
    expect(h.log).not.toContain('syncDock');
  });
});

describe('runFrames', () => {
  it('runs the frame body, then requests the next frame (a throwing frame stops the loop, as before)', () => {
    const queue: Array<(now: number) => void> = [];
    const seen: number[] = [];
    runFrames((now) => {
      seen.push(now);
      if (now === 3) throw new Error('boom');
    }, (cb) => void queue.push(cb));
    expect(seen).toEqual([]);
    queue.shift()!(1);
    queue.shift()!(2);
    expect(seen).toEqual([1, 2]);
    expect(() => queue.shift()!(3)).toThrow('boom');
    expect(queue).toEqual([]);
  });
});

// Maddy 2026-10-08: "this game heats up phones". Drawing ran on every display refresh — 120 Hz on newer phones —
// though nothing moves faster than the live layer's 20 steps a second. On a touch screen it is capped at 30 fps.
describe('runFrames with a frame cap', () => {
  const drive = (hz: number, seconds: number, minFrameMs: number) => {
    const queue: Array<(now: number) => void> = [];
    let drawn = 0;
    runFrames(() => void drawn++, (cb) => void queue.push(cb), minFrameMs);
    for (let i = 1; i <= hz * seconds; i++) queue.shift()!((i * 1000) / hz);
    return drawn / seconds;
  };
  it('a 120-Hz display draws 30 frames a second under a 30-fps cap; a 60-Hz one too', () => {
    expect(drive(120, 2, 1000 / 30)).toBeCloseTo(30, 0);
    expect(drive(60, 2, 1000 / 30)).toBeCloseTo(30, 0);
  });
  it('a refresh slower than the cap draws every frame', () => {
    expect(drive(24, 2, 1000 / 30)).toBeCloseTo(24, 0);
  });
  it('no cap: every refresh, as before', () => {
    expect(drive(120, 1, 0)).toBe(120);
  });
});

// The performance pass (Maddy 2026-10-08): measure first. A DEV profiler times each phase of the frame — rolling
// averages per phase — so the cost of the economy, the sim, the agents, the 2D draw and each GPU pass can be read.
import { createFrameProfile } from '../../src/app/loop';
describe('the frame profiler', () => {
  it('times each phase of a frame, as a rolling average', () => {
    let t = 0;
    const clock = () => t;
    const prof = createFrameProfile(clock, 4);
    prof.phase('live', () => (t += 1));
    prof.phase('live', () => (t += 3));
    prof.phase('render2d', () => (t += 2));
    prof.endFrame();
    const r = prof.report();
    expect(r.live).toBeCloseTo(4, 6); // 1 + 3 ms in one frame
    expect(r.render2d).toBeCloseTo(2, 6);
    expect(r.frames).toBe(1);
  });

  it('a frame given a profiler times its phases; without one it runs as before', () => {
    let t = 0;
    const prof = createFrameProfile(() => (t += 1), 8);
    const { frame, log } = frameSetup({ gpu: true });
    frame(1016);
    expect(log.length).toBeGreaterThan(0); // unprofiled: unchanged
    const profiled = frameSetupWith(prof);
    profiled(1016);
    const r = prof.report();
    for (const k of ['econ', 'sim', 'live', 'render2d', 'gpuMap', 'gpuGlow', 'smog']) expect(r[k], k).toBeGreaterThan(0);
  });
});

function frameSetupWith(prof: ReturnType<typeof createFrameProfile>) {
  const s = frameSetup({ gpu: true });
  void s;
  const ctx = lastCtx!;
  return createFrame({ ...ctx, prof });
}
