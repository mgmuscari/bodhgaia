// Tool-menu content: the pure view-model behind the categorized, pictorial tool
// dock. The flat tool row (toolbarContent) didn't scale — classics + every tech
// unlock made a 20-wide strip. This groups tools behind category tiles (Transit /
// Residential / … / Energy), each a pictorial icon, with the picked category's
// tools shown in a flyout. inspect/bulldoze stay top-level modes (always one click
// away). No DOM, no transcendental Math — on the architecture pure-ui allowlist.
// Keeping the categorization + icon mapping here, not in the shell, lets it be
// unit-tested rather than left to manual QA.

import { toolPrice, type ToolDef, type ToolId } from '../tools/tools';
import { BuiltKind, isTransportKind } from '../engine/fabric';
import { builtRenderKey, footprintCellKey } from './renderKey';
import { money } from './moneyFormat';

/** The tool categories, in fixed dock layout order. */
export type ToolCategory =
  | 'transit'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'civic'
  | 'green'
  | 'energy';

export const CATEGORY_ORDER: readonly ToolCategory[] = [
  'transit',
  'residential',
  'commercial',
  'industrial',
  'civic',
  'green',
  'energy',
];

/** One tool entry in a menu (mode button or category flyout tile). */
export interface MenuToolRow {
  id: ToolId;
  /** Display label — `Name · cost` for buildables, bare name for the free-ish modes. */
  label: string;
  /** Art key (a game tile or `@ui/` icon) the shell draws as the button face. */
  art: string;
  selected: boolean;
  affordable: boolean;
}

/** One always-visible category tile. */
export interface CategoryTile {
  id: ToolCategory;
  label: string;
  /** Art key the shell draws as the tile face. */
  art: string;
  /** How many tools the category holds (a count badge). */
  count: number;
  /** Whether this category's flyout is open. */
  active: boolean;
  /** Whether the currently-selected tool lives in this category (highlight even when closed). */
  hasSelected: boolean;
}

/** The full dock view: top-level modes, the category tiles, and the open flyout's tools. */
export interface ToolMenuView {
  modes: MenuToolRow[];
  categories: CategoryTile[];
  open: ToolCategory | null;
  rows: MenuToolRow[];
}

const CATEGORY_LABEL: Record<ToolCategory, string> = {
  transit: 'Transit',
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  civic: 'Civic',
  green: 'Green',
  energy: 'Energy',
};

/** Category art: a representative building's own tile, or a UI icon (transit). */
const CATEGORY_ART: Record<ToolCategory, string> = {
  transit: '@ui/transit',
  residential: footprintCellKey(BuiltKind.HouseSingle, 1, 1, 0, 0, 0),
  commercial: footprintCellKey(BuiltKind.CommercialStrip, 1, 1, 0, 0, 0),
  industrial: footprintCellKey(BuiltKind.Industrial, 1, 1, 0, 0, 0),
  civic: footprintCellKey(BuiltKind.Civic, 1, 1, 0, 0, 0),
  green: footprintCellKey(BuiltKind.Park, 1, 1, 0, 0, 0),
  energy: footprintCellKey(BuiltKind.WindTurbine, 1, 1, 0, 0, 0),
};

// Per-kind category. Anything not listed is uncategorized (won't appear as a build
// tool). Transit is computed via isTransportKind — plus the parking lot, a building kind that belongs with it.
const CATEGORY_OF_BUILDING: ReadonlyMap<number, ToolCategory> = new Map<number, ToolCategory>([
  [BuiltKind.ParkingLot, 'transit'],
  [BuiltKind.HouseSingle, 'residential'],
  [BuiltKind.Apartments, 'residential'],
  [BuiltKind.Projects, 'residential'],
  [BuiltKind.ADU, 'residential'],
  [BuiltKind.CoopHousing, 'residential'],
  [BuiltKind.Commune, 'residential'],
  [BuiltKind.TinyHomes, 'residential'],
  [BuiltKind.CommercialStrip, 'commercial'],
  [BuiltKind.Offices, 'commercial'],
  [BuiltKind.Bazaar, 'commercial'],
  [BuiltKind.MakerSpace, 'commercial'],
  [BuiltKind.Industrial, 'industrial'],
  [BuiltKind.Civic, 'civic'],
  [BuiltKind.FireStation, 'civic'],
  [BuiltKind.Clinic, 'civic'],
  [BuiltKind.Library, 'civic'],
  [BuiltKind.School, 'civic'],
  [BuiltKind.HealingCommons, 'civic'],
  [BuiltKind.Park, 'green'],
  [BuiltKind.RewildedLand, 'green'],
  [BuiltKind.Parklet, 'green'],
  [BuiltKind.CommunityGarden, 'green'],
  [BuiltKind.CompostHub, 'green'],
  [BuiltKind.VerticalFarm, 'green'],
  [BuiltKind.WastewaterWorks, 'green'],
  [BuiltKind.RetentionPond, 'green'],
  [BuiltKind.EnergyNode, 'energy'],
  [BuiltKind.AINode, 'energy'],
  [BuiltKind.CoalPlant, 'energy'],
  [BuiltKind.GasPlant, 'energy'],
  [BuiltKind.HydroPlant, 'energy'],
  [BuiltKind.NuclearPlant, 'energy'],
  [BuiltKind.WindTurbine, 'energy'],
  [BuiltKind.SolarPlant, 'energy'],
  [BuiltKind.FusionPlant, 'energy'],
]);


/** The category a tool belongs to, or null for the top-level modes (inspect/bulldoze). */
export function categoryOf(def: ToolDef): ToolCategory | null {
  if (def.kind === undefined) return null; // inspect / bulldoze
  if (isTransportKind(def.kind)) return 'transit';
  return CATEGORY_OF_BUILDING.get(def.kind) ?? null;
}

/** A tool's art key: the UI icon for the modes, else the tile it builds — a transport kind as an east-west
 *  run (connection mask E|W), a building as its own 1×1 drawing. */
export function toolArt(def: ToolDef): string {
  if (def.id === 'inspect') return '@ui/inspect';
  if (def.id === 'bulldoze') return '@ui/bulldoze';
  if (def.kind === undefined) return '@ui/help';
  if (isTransportKind(def.kind)) return builtRenderKey(def.kind, 10, 'c', 0);
  return footprintCellKey(def.kind, 1, 1, 0, 0, 0);
}

/** A tool's price as shown: `$160` from the treasury, `8 effort` from the commons (or the bare cost
 *  without an economy). */
function priceLabel(t: ToolDef, funds: number | undefined): string {
  if (funds === undefined) return `${t.cost}`;
  const p = toolPrice(t);
  return p.funds > 0 ? money(p.funds) : `${p.effort} effort`;
}

function affordable(t: ToolDef, effort: number, funds: number | undefined): boolean {
  if (funds === undefined) return effort >= t.cost;
  const p = toolPrice(t);
  return effort >= p.effort && funds >= p.funds;
}

/**
 * Assemble the dock view from the available tools, current selection, effort, and
 * which category is open. Modes (inspect/bulldoze) come first; the remaining tools
 * are bucketed by category (only non-empty categories surface, in CATEGORY_ORDER),
 * each tile flagged active/hasSelected; `rows` holds the open category's tools (or
 * [] when nothing is open). Pure — deterministic in its inputs.
 */
export function buildToolMenu(
  tools: readonly ToolDef[],
  selectedId: ToolId | null,
  effort: number,
  open: ToolCategory | null,
  /** The treasury, when the economy is running: the fabric is then priced in funds, the commons in effort. */
  funds?: number,
): ToolMenuView {
  const modes: MenuToolRow[] = [];
  const byCat = new Map<ToolCategory, MenuToolRow[]>();

  for (const t of tools) {
    const cat = categoryOf(t);
    const row: MenuToolRow = {
      id: t.id,
      label: cat === null ? t.name : `${t.name} · ${priceLabel(t, funds)}`,
      art: toolArt(t),
      selected: t.id === selectedId,
      affordable: affordable(t, effort, funds),
    };
    if (cat === null) {
      modes.push(row);
      continue;
    }
    const bucket = byCat.get(cat);
    if (bucket) bucket.push(row);
    else byCat.set(cat, [row]);
  }

  const categories: CategoryTile[] = [];
  for (const cat of CATEGORY_ORDER) {
    const rows = byCat.get(cat);
    if (!rows || rows.length === 0) continue;
    categories.push({
      id: cat,
      label: CATEGORY_LABEL[cat],
      art: CATEGORY_ART[cat],
      count: rows.length,
      active: open === cat,
      hasSelected: rows.some((r) => r.selected),
    });
  }

  const openValid = open !== null && byCat.has(open) ? open : null;
  return { modes, categories, open: openValid, rows: openValid ? byCat.get(openValid)! : [] };
}
