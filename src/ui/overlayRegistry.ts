// The overlay registry: ONE table for every map overlay (kind → its views, fill alpha, legend line, colour
// key, tint source and sim-cadence refresh). The shell (src/app/overlays.ts) dispatches through it and never
// branches on a kind, so adding an overlay = one entry here (+ its key in keyMap and its dock button). Each
// *OverlayContent module still owns its ramp/colours/copy; this file only binds them to the world data.
// Also home of the single-active-overlay composite (cycleComposite). PURE — no DOM, no transcendental Math
// (on the architecture guard's pure-ui allowlist); the data a tint reads arrives as a plain OverlayContext.

import { Water, type GameMap } from '../engine/map';
import type { ParcelStore } from '../engine/fabric';
import { biodiversityField } from '../ecology/biodiversity';
import { isPowerConsumer } from '../growth/power';
import type { OverlayLegend } from './overlayLegend';
import { OVERLAY_ALPHA } from './overlayTint';
import { OVERLAY_VIEWS, overlayTint, legendLine, ecoLegend, type OverlayView } from './ecoOverlayContent';
import { CIVIC_VIEWS, civicOverlayTint, civicLegendLine, civicLegend, type CivicOverlayView } from './civicOverlayContent';
import { REDLINE_VIEWS, redlineOverlayTint, redlineLegendLine, redlineLegend } from './redlineOverlayContent';
import { POLICE_VIEWS, POLICE_OVERLAY_ALPHA, policeLegendLine, policeLegend } from './policeViolenceOverlayContent';
import { COVERAGE_VIEWS, coverageTint, coverageLegendLine, coverageLegend } from './coverageOverlayContent';
import { POWER_VIEWS, powerTint, powerLegendLine, powerLegend } from './powerOverlayContent';

/** Every overlay kind, in dock/key order. */
export const OVERLAY_KINDS = ['eco', 'civic', 'redline', 'police', 'coverage', 'power'] as const;
/** Which overlay dimension is active. */
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

type RGBA = readonly [number, number, number, number];

/** A base-layer tint (structurally the renderer's OverlaySource). */
export interface OverlayTintSource {
  tint(i: number): RGBA | null;
  /** Dim every tile the tint leaves null, so the data reads as a layer view. */
  dimBase?: boolean;
}

/** The world data a tint source reads — gathered fresh by the shell each time an overlay is (re)applied. */
export interface OverlayContext {
  map: GameMap;
  parcels: ParcelStore;
  /** The live agent-layer fields. */
  live: {
    pollution: ReadonlyMap<number, number>;
    groundPollution: ReadonlyMap<number, number>;
    waterPollution: ReadonlyMap<number, number>;
    coverage: ReadonlySet<number>;
  };
  /** Anchor tiles of the powered consumers (the current grid). */
  poweredAnchors: ReadonlySet<number>;
  /** Per-neighbourhood civic values (ids 1..count) and the live tile → neighbourhood partition. */
  civic: { count(): number; getValues(id: number): Record<CivicOverlayView, number> };
  tileToNeighborhood: ArrayLike<number>;
}

/** One overlay kind. A view passed in is always one of `views`. */
export interface OverlayEntry {
  readonly views: readonly string[];
  /** The fill alpha its tints carry. */
  readonly alpha: number;
  /** The one-line caption shown in the dock status line. */
  legendLine(view: string): string;
  /** The visible colour key. */
  legend(view: string): OverlayLegend;
  /** The cached-base tint for a view; absent for a live overlay. */
  source?(view: string, ctx: OverlayContext): OverlayTintSource;
  /** A per-frame overlay the renderer draws from a live field instead (no base source). */
  readonly live?: 'police';
  /** Re-pushed on this sim cadence while active; `rederive` → rebuild the source, else just repaint. */
  readonly refresh?: { readonly on: 'eco' | 'civic'; rederive(view: string): boolean };
}

interface TypedEntry<V extends string> {
  views: readonly V[];
  alpha: number;
  legendLine(view: V): string;
  legend(view: V): OverlayLegend;
  source?(view: V, ctx: OverlayContext): OverlayTintSource;
  live?: 'police';
  refresh?: { on: 'eco' | 'civic'; rederive(view: V): boolean };
}

/** Type an entry against its own view union; the registry erases it to `string` (views are its domain). */
const entry = <V extends string>(e: TypedEntry<V>): OverlayEntry => e as unknown as OverlayEntry;

const isWater = (map: GameMap, i: number): boolean => map.water[i] !== Water.None;
const capped = (field: ReadonlyMap<number, number>, i: number): number => Math.min(255, field.get(i) ?? 0);

function ecoSource(view: OverlayView, ctx: OverlayContext): OverlayTintSource {
  const { map } = ctx;
  switch (view) {
    case 'biodiversity': {
      const field = biodiversityField(map);
      return { dimBase: true, tint: (i) => (isWater(map, i) ? null : overlayTint(view, field[i]!)) };
    }
    case 'airPollution': {
      // the live agent-driven smog field (cars + dirty plants), over land
      const poll = ctx.live.pollution;
      return { dimBase: true, tint: (i) => (isWater(map, i) ? null : overlayTint(view, capped(poll, i))) };
    }
    case 'groundPollution': {
      // the live land-contamination field (industry, dirty power, desire-path litter), over land
      const gp = ctx.live.groundPollution;
      return { dimBase: true, tint: (i) => (isWater(map, i) ? null : overlayTint(view, capped(gp, i))) };
    }
    case 'waterPollution': {
      // the live runoff field, over WATER — the dingy creeks downstream of redlined industry
      const wp = ctx.live.waterPollution;
      return { dimBase: true, tint: (i) => (isWater(map, i) ? overlayTint(view, capped(wp, i)) : null) };
    }
    default: {
      // soil / flora / fauna read the live map layers; eco lives on land
      const layer = view === 'soil' ? map.soilHealth : view === 'flora' ? map.floraVitality : map.faunaPresence;
      return { dimBase: true, tint: (i) => (isWater(map, i) ? null : overlayTint(view, layer[i]!)) };
    }
  }
}

export const OVERLAYS = {
  eco: entry<OverlayView>({
    views: OVERLAY_VIEWS,
    alpha: OVERLAY_ALPHA,
    legendLine,
    legend: ecoLegend,
    source: ecoSource,
    // soil/flora/fauna/pollution read live data (a repaint picks it up); biodiversity is derived → rebuild
    refresh: { on: 'eco', rederive: (view) => view === 'biodiversity' },
  }),
  civic: entry<CivicOverlayView>({
    views: CIVIC_VIEWS,
    alpha: OVERLAY_ALPHA,
    legendLine: civicLegendLine,
    legend: civicLegend,
    source: (view, ctx) => {
      const count = ctx.civic.count();
      const values = new Uint8Array(count); // per-neighbourhood value, snapshotted per (re)apply
      for (let id = 1; id <= count; id++) values[id - 1] = ctx.civic.getValues(id)[view];
      const t2n = ctx.tileToNeighborhood;
      return {
        dimBase: true,
        tint: (i) => {
          const id = t2n[i]!;
          return id === 0 ? null : civicOverlayTint(view, values[id - 1]!);
        },
      };
    },
    // the partition was refreshed/remapped and the values moved → rebuild against them
    refresh: { on: 'civic', rederive: () => true },
  }),
  redline: entry({
    views: REDLINE_VIEWS,
    alpha: OVERLAY_ALPHA,
    legendLine: redlineLegendLine,
    legend: redlineLegend,
    // the HOLC grade is a hashed map layer; water carries a grade too, but a red river reads wrong → land only
    source: (_view, { map }) => ({
      dimBase: true,
      tint: (i) => (isWater(map, i) ? null : redlineOverlayTint(map.redline[i]!)),
    }),
  }),
  police: entry({
    views: POLICE_VIEWS,
    alpha: POLICE_OVERLAY_ALPHA,
    legendLine: policeLegendLine,
    legend: policeLegend,
    // a live field (arrests + decay) → drawn per frame by the renderer, not baked into the base
    live: 'police',
  }),
  coverage: entry({
    views: COVERAGE_VIEWS,
    alpha: OVERLAY_ALPHA,
    legendLine: coverageLegendLine,
    legend: coverageLegend,
    // each developed plot tile: is a fire/health station in reach?
    source: (_view, { map, live }) => ({
      dimBase: true,
      tint: (i) => (map.parcel[i] !== 0 ? coverageTint(live.coverage.has(i)) : null),
    }),
  }),
  power: entry({
    views: POWER_VIEWS,
    alpha: OVERLAY_ALPHA,
    legendLine: powerLegendLine,
    legend: powerLegend,
    // the grid is re-solved on the civic cadence (and on placements): follow it, don't freeze at open time
    refresh: { on: 'civic', rederive: () => true },
    // each power-consumer plot, via its parcel anchor: on the grid or dark
    source: (_view, { map, parcels, poweredAnchors }) => ({
      dimBase: true,
      tint: (i) => {
        const pid = map.parcel[i];
        if (!pid || !isPowerConsumer(parcels.kindAt(pid - 1))) return null;
        const p = parcels.get(pid - 1);
        return powerTint(poweredAnchors.has(map.idx(p.x, p.y)));
      },
    }),
  }),
} satisfies Record<OverlayKind, OverlayEntry>;

// --- the single active overlay ----------------------------------------------
//
// At most ONE overlay is active. Pressing a kind's key cycles WITHIN that kind (off → first → … → last →
// off); pressing another kind's key replaces the active overlay at that kind's first view (exclusivity).

/** The single active overlay (kind + one of its views), or null (off). */
export interface CompositeOverlay {
  kind: OverlayKind;
  view: string;
}
export type CompositeState = CompositeOverlay | null;

/** Cycle the composite overlay on a press of `pressed`'s key. Pure. */
export function cycleComposite(current: CompositeState, pressed: OverlayKind): CompositeState {
  const views = OVERLAYS[pressed].views;
  if (current === null || current.kind !== pressed) {
    return { kind: pressed, view: views[0]! };
  }
  const i = views.indexOf(current.view);
  if (i === views.length - 1) return null; // off-wrap
  return { kind: pressed, view: views[i + 1]! };
}
