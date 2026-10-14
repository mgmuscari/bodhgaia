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
import { OVERLAY_ALPHA, rangeLabel, stretchRange, stretched, type StretchRange } from './overlayTint';
import { OVERLAY_VIEWS, overlayTint, legendLine, ecoLegend, type OverlayView } from './ecoOverlayContent';
import { CIVIC_VIEWS, civicOverlayTint, civicLegendLine, civicLegend, type CivicOverlayView } from './civicOverlayContent';
import { REDLINE_VIEWS, redlineOverlayTint, redlineLegendLine, redlineLegend } from './redlineOverlayContent';
import { POLICE_VIEWS, POLICE_OVERLAY_ALPHA, policeLegendLine, policeLegend } from './policeViolenceOverlayContent';
import { COVERAGE_VIEWS, coverageTint, coverageLegendLine, coverageLegend } from './coverageOverlayContent';
import { POWER_VIEWS, powerTint, powerLegendLine, powerLegend } from './powerOverlayContent';
import { STATUS_LIT, STATUS_VIEWS, homeBadge, statusLegend, statusLegendLine } from './statusOverlayContent';
import { boostIndex, boostsOf, canBoost } from '../engine/boosts';

/** Every overlay kind, in dock/key order. */
export const OVERLAY_KINDS = ['eco', 'civic', 'redline', 'police', 'coverage', 'power', 'status'] as const;
/** Which overlay dimension is active. */
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

type RGBA = readonly [number, number, number, number];

/** A base-layer tint (structurally the renderer's OverlaySource). */
export interface OverlayTintSource {
  tint(i: number): RGBA | null;
  /** Dim every tile the tint leaves null, so the data reads as a layer view. */
  dimBase?: boolean;
  /** A stretched view: the values its ramp spans (the colour key names it). */
  range?: StretchRange;
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
    /** Each home's health (anchor → value), for its heart / raincloud badge. */
    buildingHealth: ReadonlyMap<number, number>;
  };
  /** Anchor tiles of the powered consumers (the current grid). */
  poweredAnchors: ReadonlySet<number>;
  /** Per-neighbourhood civic values (ids 1..count) and the live tile → neighbourhood partition. */
  civic: { count(): number; getValues(id: number): Record<Exclude<CivicOverlayView, 'health'>, number> };
  /** Each neighbourhood's health, 0..255 (civic/health.ts), by id. */
  health?: (id: number) => number;
  tileToNeighborhood: ArrayLike<number>;
}

/** One overlay kind. A view passed in is always one of `views`. */
export interface OverlayEntry {
  readonly views: readonly string[];
  /** The fill alpha its tints carry. */
  readonly alpha: number;
  /** The one-line caption shown in the dock status line. */
  legendLine(view: string): string;
  /** The visible colour key; a stretched view's `range` joins its title. */
  legend(view: string, range?: StretchRange): OverlayLegend;
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
  legend(view: V, range?: StretchRange): OverlayLegend;
  source?(view: V, ctx: OverlayContext): OverlayTintSource;
  live?: 'police';
  refresh?: { on: 'eco' | 'civic'; rederive(view: V): boolean };
}

/** Type an entry against its own view union; the registry erases it to `string` (views are its domain). */
const entry = <V extends string>(e: TypedEntry<V>): OverlayEntry => e as unknown as OverlayEntry;

const isWater = (map: GameMap, i: number): boolean => map.water[i] !== Water.None;

/** A colour key with the stretched range in its title. */
const withRange =
  <V extends string>(legend: (view: V) => OverlayLegend) =>
  (view: V, range?: StretchRange): OverlayLegend => {
    const key = legend(view);
    return range ? { ...key, title: `${key.title} · ${rangeLabel(range)}` } : key;
  };

/** A field view stretched over the values it shows: `value(i)` on the tiles `shown(i)`, the rest untinted. */
function stretchedField(
  n: number,
  shown: (i: number) => boolean,
  value: (i: number) => number,
  tint: (v: number) => RGBA,
): OverlayTintSource {
  const vals: number[] = [];
  for (let i = 0; i < n; i++) if (shown(i)) vals.push(value(i));
  const range = stretchRange(vals);
  return { dimBase: true, range, tint: (i) => (shown(i) ? tint(stretched(value(i), range)) : null) };
}
const capped = (field: ReadonlyMap<number, number>, i: number): number => Math.min(255, field.get(i) ?? 0);

function ecoSource(view: OverlayView, ctx: OverlayContext): OverlayTintSource {
  const { map } = ctx;
  const n = map.width * map.height;
  const land = (i: number): boolean => !isWater(map, i);
  const tint = (v: number): RGBA => overlayTint(view, v);
  switch (view) {
    case 'biodiversity': {
      const field = biodiversityField(map);
      return stretchedField(n, land, (i) => field[i]!, tint);
    }
    case 'airPollution':
      // the live agent-driven smog field (cars + dirty plants), over land
      return stretchedField(n, land, (i) => capped(ctx.live.pollution, i), tint);
    case 'groundPollution':
      // the live land-contamination field (industry, dirty power, desire-path litter), over land
      return stretchedField(n, land, (i) => capped(ctx.live.groundPollution, i), tint);
    case 'waterPollution':
      // the live runoff field, over WATER — the dingy creeks downstream of redlined industry
      return stretchedField(n, (i) => isWater(map, i), (i) => capped(ctx.live.waterPollution, i), tint);
    default: {
      // soil / flora / fauna read the live map layers; eco lives on land
      const layer = view === 'soil' ? map.soilHealth : view === 'flora' ? map.floraVitality : map.faunaPresence;
      return stretchedField(n, land, (i) => layer[i]!, tint);
    }
  }
}

export const OVERLAYS = {
  eco: entry<OverlayView>({
    views: OVERLAY_VIEWS,
    alpha: OVERLAY_ALPHA,
    legendLine,
    legend: withRange(ecoLegend),
    source: ecoSource,
    // every view is stretched over the values on the map → each eco tick re-derives its range
    refresh: { on: 'eco', rederive: () => true },
  }),
  civic: entry<CivicOverlayView>({
    views: CIVIC_VIEWS,
    alpha: OVERLAY_ALPHA,
    legendLine: civicLegendLine,
    legend: withRange(civicLegend),
    source: (view, ctx) => {
      const count = ctx.civic.count();
      const values = new Uint8Array(count); // per-neighbourhood value, snapshotted per (re)apply
      for (let id = 1; id <= count; id++) values[id - 1] = view === 'health' ? (ctx.health?.(id) ?? 0) : ctx.civic.getValues(id)[view];
      const range = stretchRange(values); // stretched over the neighbourhoods
      const t2n = ctx.tileToNeighborhood;
      return {
        dimBase: true,
        range,
        tint: (i) => {
          const id = t2n[i]!;
          return id === 0 ? null : civicOverlayTint(view, stretched(values[id - 1]!, range));
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
  status: entry({
    views: STATUS_VIEWS,
    alpha: OVERLAY_ALPHA,
    legendLine: statusLegendLine,
    legend: statusLegend,
    // the grid and the homes' health move on the civic cadence (placements re-push via the dirty base)
    refresh: { on: 'civic', rederive: () => true },
    // every building that wears a badge shows through; the rest of the map is dimmed
    source: (_view, { map, parcels, poweredAnchors, live }) => {
      const index = boostIndex(parcels);
      const lit = new Set<number>(); // parcel ids (1-based, as map.parcel)
      for (const i of parcels.aliveIndices()) {
        const p = parcels.get(i);
        const anchor = map.idx(p.x, p.y);
        const badged =
          (isPowerConsumer(p.kind) && !poweredAnchors.has(anchor)) ||
          homeBadge(live.buildingHealth.get(anchor)) !== null ||
          (canBoost(p.kind) && boostsOf(map, parcels, i, index).length > 0);
        if (badged) lit.add(i + 1);
      }
      return { dimBase: true, tint: (i) => (lit.has(map.parcel[i]!) ? STATUS_LIT : null) };
    },
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
