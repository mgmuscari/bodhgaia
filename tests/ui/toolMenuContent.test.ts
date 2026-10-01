// PR D1 — the pure view-model behind the categorized pictorial tool dock.

import { describe, it, expect } from 'vitest';
import {
  categoryOf,
  toolArt,
  buildToolMenu,
  CATEGORY_ORDER,
  type ToolCategory,
} from '../../src/ui/toolMenuContent';
import { availableTools, toolDef } from '../../src/tools/tools';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { footprintCellKey } from '../../src/ui/renderKey';

function freshTech(effort: number) {
  const t = createTechState(TECH_TREE);
  t.effort = effort;
  return t;
}

describe('categoryOf', () => {
  it('puts modes (inspect/bulldoze) in no category', () => {
    expect(categoryOf(toolDef('inspect')!)).toBeNull();
    expect(categoryOf(toolDef('bulldoze')!)).toBeNull();
  });

  it('routes transport builds and converts to transit', () => {
    expect(categoryOf(toolDef('build-1')!)).toBe('transit'); // Street
    expect(categoryOf(toolDef('build-4')!)).toBe('transit'); // Rail
    expect(categoryOf(toolDef('build-5')!)).toBe('transit'); // BikePath
  });

  it('routes building kinds to their category', () => {
    expect(categoryOf(toolDef('build-16')!)).toBe('residential');
    expect(categoryOf(toolDef('build-19')!)).toBe('commercial');
    expect(categoryOf(toolDef('build-21')!)).toBe('industrial');
    expect(categoryOf(toolDef('build-23')!)).toBe('civic');
    expect(categoryOf(toolDef('build-48')!)).toBe('green'); // Parklet
    expect(categoryOf(toolDef('build-53')!)).toBe('energy'); // EnergyNode
  });
});

describe('toolArt — pixel art keys, not emoji (Maddy 2026-09-30: icons instead of text)', () => {
  it('modes use the UI icons; build tools use their own game tile', () => {
    expect(toolArt(toolDef('inspect')!)).toBe('@ui/inspect');
    expect(toolArt(toolDef('bulldoze')!)).toBe('@ui/bulldoze');
    expect(toolArt(toolDef('build-4')!)).toBe('rail-10'); // Rail: an east-west run of track
    expect(toolArt(toolDef('build-1')!)).toBe('road-1-10'); // a street
    expect(toolArt(toolDef('build-16')!)).toBe(footprintCellKey(16, 1, 1, 0, 0, 0)); // a house
    expect(toolArt(toolDef('build-53')!)).toBe(footprintCellKey(53, 1, 1, 0, 0, 0)); // EnergyNode
  });
  it('every category tile carries art', () => {
    const view = buildToolMenu(availableTools(freshTech(0)), null, 999, null);
    expect(view.categories.length).toBeGreaterThan(0);
    for (const c of view.categories) expect(c.art, c.id).toMatch(/^(@ui\/|b-|road-|streetcar-)/);
  });
});

describe('buildToolMenu', () => {
  it('with nothing unlocked: modes + classic categories, nothing open', () => {
    const view = buildToolMenu(availableTools(freshTech(0)), null, 0, null);
    expect(view.modes.map((m) => m.id)).toEqual(['inspect', 'bulldoze']);
    const cats = view.categories.map((c) => c.id);
    expect(cats).toContain('transit');
    expect(cats).toContain('residential');
    expect(cats).toContain('commercial');
    expect(cats).toContain('industrial');
    expect(cats).toContain('civic');
    expect(view.open).toBeNull();
    expect(view.rows).toEqual([]);
  });

  it('lists categories in fixed CATEGORY_ORDER', () => {
    const view = buildToolMenu(availableTools(freshTech(0)), null, 0, null);
    const order = view.categories.map((c) => c.id);
    const expected = CATEGORY_ORDER.filter((c) => order.includes(c));
    expect(order).toEqual(expected);
  });

  it('opening a category yields its tools as rows and flags it active', () => {
    const view = buildToolMenu(availableTools(freshTech(0)), null, 100, 'transit');
    expect(view.open).toBe('transit');
    expect(view.rows.length).toBeGreaterThan(0);
    expect(view.rows.every((r) => r.id.startsWith('build-') || r.id.startsWith('convert-'))).toBe(true);
    const transit = view.categories.find((c) => c.id === 'transit')!;
    expect(transit.active).toBe(true);
    expect(transit.count).toBe(view.rows.length);
  });

  it('marks a category hasSelected when it holds the selected tool', () => {
    const view = buildToolMenu(availableTools(freshTech(100)), 'build-16', 100, null);
    const res = view.categories.find((c) => c.id === 'residential')!;
    expect(res.hasSelected).toBe(true);
    expect(view.categories.find((c) => c.id === 'transit')!.hasSelected).toBe(false);
  });

  it('marks affordability per tool by effort', () => {
    const view = buildToolMenu(availableTools(freshTech(3)), null, 3, 'transit');
    const street = view.rows.find((r) => r.id === 'build-1')!; // cost 2
    const highway = view.rows.find((r) => r.id === 'build-3')!; // cost 5
    expect(street.affordable).toBe(true);
    expect(highway.affordable).toBe(false);
  });

  it('drops an empty/unknown open category back to null', () => {
    const view = buildToolMenu(availableTools(freshTech(0)), null, 0, 'green' as ToolCategory);
    // green has no tools unlocked at tech 0 → no flyout
    expect(view.open).toBeNull();
    expect(view.rows).toEqual([]);
  });

  it('surfaces a tech-unlocked category once its kind is granted', () => {
    const tech = freshTech(1000);
    expect(buildToolMenu(availableTools(tech), null, 1000, null).categories.map((c) => c.id)).not.toContain(
      'green',
    );
    tech.unlock('walkable-streets');
    tech.unlock('road-diets');
    tech.unlock('parklets'); // grants Parklet (green)
    expect(buildToolMenu(availableTools(tech), null, 1000, null).categories.map((c) => c.id)).toContain(
      'green',
    );
  });

  it('shows the Energy category from the start (classic power plants)', () => {
    const cats = buildToolMenu(availableTools(freshTech(0)), null, 0, null).categories.map((c) => c.id);
    expect(cats).toContain('energy'); // Coal/Gas/Hydro/Nuclear are classic
  });
});

describe('buildToolMenu with the economy (funds for the fabric, effort for the commons)', () => {
  it('labels and affords each tool in its own currency', () => {
    const tools = availableTools(freshTech(0));
    const view = buildToolMenu(tools, null, 0, 'residential', 1_000_000);
    const house = view.rows.find((r) => r.id === 'build-16')!;
    expect(house.label).toMatch(/\$\d/);
    expect(house.affordable).toBe(true); // paid in funds, though effort is 0
    const broke = buildToolMenu(tools, null, 1_000_000, 'residential', 0);
    expect(broke.rows.find((r) => r.id === 'build-16')!.affordable).toBe(false);
  });
});
