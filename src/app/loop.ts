// App shell: the two clocks. The SIM is a fixed-tick loop (simTick: effort every tick, ecology / civic on their
// cadences) plus the civic-cadence seams the shell owns; the FRAME is the requestAnimationFrame body that steps
// the in-game hour, the economy and the sim, then paints (CPU composite → GPU map → GPU glow → GPU smog) and
// runs the sim-gated dock sync. The live layer keeps its OWN clock (live.step) — never folded into the sim's.

import { FixedTickLoop } from '../engine/loop';
import type { Rng } from '../engine/rng';
import { simTick, type SimDeps, type SimTickResult } from '../civic/compose';
import { neighborhoodVoice } from '../civic/voice';
import { stepRepairShops, stepRevival } from '../growth/revival';
import type { Camera } from '../ui/camera';
import { gameSec } from '../ui/gameTime';
import type { Renderer } from '../ui/renderer';
import type { GpuRenderer } from '../ui/gpuRenderer';
import type { SmogOverlay } from '../ui/smogOverlay';
import type { AmbientState } from '../live/types';
import type { WorldState } from '../worldgen/pipeline';

export const SIM_TICK_MS = 100;
/** Wear/junk/tents/murk are baked into the cached base: their changed tiles are re-drawn on this slow cadence (ms). */
export const BASE_REFRESH_MS = 2000;

export interface SimTickCtx {
  sim: SimDeps;
  /** A resumed game keeps its clock (repair rings are stamped in ticks). */
  startTick: number;
  power: { recompute(): boolean; grid(): { poweredAnchors: ReadonlySet<number> } };
  live: {
    state: Pick<AmbientState, 'occupancy'>;
    revivalRng: Rng;
    refreshParkingLots(): void;
    refreshHouseholds(): void;
    publishWelcome(voiceAt: (tile: number) => number): void;
  };
  overlays: { onSimTick(r: SimTickResult): void };
  pulse: { tick(): void };
  /** The Restoration window — mounted after the loop's creation is fine; read at tick time. */
  restore: () => { refresh(): void };
  markDirty: () => void;
}

export interface SimTicker {
  /** Feed wall-clock ms to the fixed-tick loop (its clamp owns catch-up). */
  advance(dtMs: number): void;
  /** The latest sim tick (0 until the first tick fires) — saves and repair forwarding read it. */
  tick(): number;
  /** True once after any tick ran (the frame's sim-gated dock sync), then false until the next. */
  takeChanged(): boolean;
}

export function createSimTick(ctx: SimTickCtx): SimTicker {
  const { sim, power, live } = ctx;
  let currentTick = 0;
  let changed = false;
  // Each tick sets `changed` so the next frame re-derives the dock/panel signatures ONCE (~10Hz), not per rAF
  // frame (Y5). Overlays re-push on their source's tick; the pulse refreshes on the civic cadence only.
  // (The agent layer IS the traffic: the sim runs no abstract O-D trips.)
  const loop = new FixedTickLoop(
    SIM_TICK_MS,
    (tick) => {
      currentTick = tick;
      const r = simTick(sim, tick);
      changed = true; // effort accrued / grants may have moved → re-sync next frame
      ctx.overlays.onSimTick(r); // the active overlay's source ticked → re-push it
      if (!r.civicTicked) return;
      ctx.pulse.tick();
      // Restoration readout: sample the live metrics and trend vs the prior sample (no-op while closed).
      ctx.restore().refresh();
      // Revival/decay seam: sample the LIVE occupancy into the hashed stock — thriving homes heal + densify
      // (R1→R2→R3), struggling ones crumble toward a derelict ruin (reversibly). Runs HERE on the slow civic
      // cadence (sim side), never in stepAmbient (which must leave the world hash untouched) and never in
      // simTick (the N=120 gate pins its stock byte-stable). Re-derive the grid FIRST so revival reads the
      // current power state: an unpowered home is hard-gated (no growth, slow decay) until power returns.
      const powerChanged = power.recompute();
      const revived = stepRevival(
        sim.world,
        (tile) => live.state.occupancy.get(tile),
        live.revivalRng,
        (tile) => power.grid().poweredAnchors.has(tile),
      );
      const mended = stepRepairShops(sim.world); // maker spaces mend what's near (hashed stock, deterministic)
      live.refreshParkingLots(); // the player may have rezoned a lot → refresh the storage set
      live.refreshHouseholds(); // homes may have grown/decayed → refresh who's out living their day
      // organised neighbourhoods welcome the unhoused back (rehoming.md): publish the fresh voice per home
      live.publishWelcome((t) => neighborhoodVoice(sim.civic, sim.partition, t));
      if (revived > 0 || mended > 0 || powerChanged) ctx.markDirty(); // stock/grid changed → rebuild base
    },
    { startTick: ctx.startTick },
  );
  return {
    advance: (dtMs) => loop.advance(dtMs),
    tick: () => currentTick,
    takeChanged: () => {
      const c = changed;
      changed = false;
      return c;
    },
  };
}

/** The slice of the view (src/app/view.ts) the frame paints through. */
export interface FrameView {
  renderer: Pick<
    Renderer,
    'refreshLiveMarks' | 'renderFrame' | 'render' | 'baseCanvas' | 'baseVersion' | 'basePatch' | 'emissionLayers' | 'emissiveBuildingList' | 'headlightBeams'
  >;
  camera: Camera;
  gpu(): Pick<GpuRenderer, 'render' | 'renderAgents'> | null;
  smog(): Pick<SmogOverlay, 'render'> | null;
  width(): number;
  height(): number;
  isDirty(): boolean;
  clean(): void;
}

export interface FrameCtx {
  /** performance.now() when the loop starts — the sim's first dt is measured from it. */
  start: number;
  power: { maybeResolveHour(now: number): boolean };
  economy: { advance(now: number): void };
  sim: Pick<SimTicker, 'advance' | 'takeChanged'>;
  view: FrameView & { markDirty(): void };
  live: { readonly on: boolean; step(now: number): void; state: AmbientState };
  world: WorldState;
  hidden: () => boolean;
  /** The sim-gated sync (tools.syncDock). */
  syncDock: () => void;
  /** After the map is drawn: the live event feed's CCTV inset. Optional. */
  afterRender?: (now: number) => void;
  /** After the GPU map, glow and smog: the CCTV inset's own GPU viewport. Optional. */
  afterGpu?: (now: number) => void;
}

/** The rAF frame body (the caller re-requests the next frame after it). */
export function createFrame(ctx: FrameCtx): (now: number) => void {
  const { view, live, world } = ctx;
  const { renderer, camera } = view;
  let last = ctx.start;
  let lastBaseRefresh = 0;
  return (now) => {
    // a new in-game hour: demand re-draws and the blackout may roll to another block
    if (ctx.power.maybeResolveHour(now)) view.markDirty();
    // the economy steps once per in-game hour (catching up a few if the tab was in the background)
    ctx.economy.advance(now);
    // Two independent clocks (YP3): `last` drives the sim (its FixedTickLoop clamp owns catch-up); never fold
    // the ambient dt into it.
    ctx.sim.advance(now - last);
    last = now;
    // Wear/junk/tents/murk are baked into the cached base (under the agents); refresh them on a slow cadence so
    // newly-worn ground + encampments appear even with a static camera (they evolve over many seconds). Only the
    // tiles whose mark changed are re-drawn (and re-uploaded to the GPU).
    if (now - lastBaseRefresh > BASE_REFRESH_MS) {
      lastBaseRefresh = now;
      renderer.refreshLiveMarks();
    }
    const gpu = view.gpu();
    if (live.on && !ctx.hidden()) {
      // Continuous ambient path: step the ambient sim on its OWN clock (its clamp owns catch-up), then
      // composite + sprites. The base rebuilds inside renderFrame iff invalidated, so this stays cheap.
      live.step(now);
      renderer.renderFrame(world, camera, live.state);
      view.clean();
      ctx.afterRender?.(now);
    } else if (view.isDirty() || gpu) {
      // Ambient-OFF path: repaint only when something changed. With GPU on we still run the composite (it
      // produces/clears the base the GPU samples) each frame the base is dirty.
      if (view.isDirty()) renderer.render(world, camera);
      view.clean();
    }
    const w = view.width();
    const h = view.height();
    // GPU hybrid: render the WebGL map EVERY frame (animates via u_time), AFTER the CPU base pass so it samples
    // the freshest baked tiles. The base re-uploads only when its version changed.
    gpu?.render(camera, w, h, gameSec(now), renderer.baseCanvas(), renderer.baseVersion(), renderer.basePatch(), renderer.emissionLayers());
    // GPU glow: headlights, cruiser bars and lit windows cast onto the ground (the agents are pixel art above).
    if (gpu && live.on) gpu.renderAgents(live.state, camera, w, h, gameSec(now), renderer.emissiveBuildingList(), renderer.headlightBeams());
    // GPU smog overlay (z2, above sprites): the atmospheric haze.
    const smog = view.smog();
    // the haze is part of the map: drawn every frame so it follows the camera — with life off the pollution field
    // simply holds still (Maddy 2026-10-08: it froze in place on screen and the map slid under it)
    if (smog) smog.render(camera, w, h, now / 1000, live.state.pollution, live.state.wind, live.state.toxic);
    ctx.afterGpu?.(now);
    // Sim-gated (Y5): re-derive the dock/panel signatures ONLY when a sim tick has run since the last sync.
    if (ctx.sim.takeChanged()) ctx.syncDock();
  };
}

/** Drive `frame` from requestAnimationFrame: the body runs, THEN the next frame is requested. */
/** A display refresh this close to the cap's interval still counts as due (refresh timestamps jitter). */
const FRAME_SLACK_MS = 2;

/** Run `frame` on display refreshes — at most one per `minFrameMs` (0: every refresh). A skipped refresh does no work;
 *  the next frame's longer step catches the clocks up (Maddy 2026-10-08: a 120-Hz phone heated up drawing 120 frames
 *  a second of a city that moves 20 steps a second). */
export function runFrames(frame: (now: number) => void, raf: (cb: (now: number) => void) => void, minFrameMs = 0): void {
  let last = -Infinity;
  const loop = (now: number): void => {
    if (now - last >= minFrameMs - FRAME_SLACK_MS) {
      last = now;
      frame(now);
    }
    raf(loop);
  };
  raf(loop);
}
