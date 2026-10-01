// PR E — the pure Civ-style tech-tree layout (depth columns + prereq edges).

import { describe, it, expect } from 'vitest';
import { techLayout } from '../../src/ui/techLayout';
import { TECH_TREE } from '../../src/tech/tree';
import { createTechState } from '../../src/tech/state';
import { BRANCH_ORDER, nodeViewOf } from '../../src/ui/techContent';
import { footprintCellKey } from '../../src/ui/renderKey';

function freshState() {
  return createTechState(TECH_TREE);
}

describe('techLayout', () => {
  it('places every tree node exactly once', () => {
    const layout = techLayout(TECH_TREE, freshState());
    expect(layout.nodes.length).toBe(TECH_TREE.length);
    const ids = new Set(layout.nodes.map((n) => n.view.id));
    expect(ids.size).toBe(TECH_TREE.length);
  });

  it('puts roots (no prereqs) in column 0', () => {
    const layout = techLayout(TECH_TREE, freshState());
    const byId = new Map(TECH_TREE.map((n) => [n.id, n]));
    for (const n of layout.nodes) {
      if (byId.get(n.view.id)!.prereqs.length === 0) expect(n.col).toBe(0);
    }
  });

  it('places every node strictly right of all its prereqs (col > prereq col)', () => {
    const layout = techLayout(TECH_TREE, freshState());
    const colOf = new Map(layout.nodes.map((n) => [n.view.id, n.col]));
    const byId = new Map(TECH_TREE.map((n) => [n.id, n]));
    for (const n of TECH_TREE) {
      for (const p of n.prereqs) {
        if (byId.has(p)) expect(colOf.get(n.id)!).toBeGreaterThan(colOf.get(p)!);
      }
    }
  });

  it('emits one edge per resolvable prereq', () => {
    const layout = techLayout(TECH_TREE, freshState());
    const byId = new Map(TECH_TREE.map((n) => [n.id, n]));
    let expected = 0;
    for (const n of TECH_TREE) for (const p of n.prereqs) if (byId.has(p)) expected++;
    expect(layout.edges.length).toBe(expected);
    // every edge endpoint is a real node
    const ids = new Set(layout.nodes.map((n) => n.view.id));
    for (const e of layout.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it('assigns unique (col,row) cells with no overlap', () => {
    const layout = techLayout(TECH_TREE, freshState());
    const cells = new Set(layout.nodes.map((n) => `${n.col},${n.row}`));
    expect(cells.size).toBe(layout.nodes.length);
  });

  it('reports a grid extent that bounds every node', () => {
    const layout = techLayout(TECH_TREE, freshState());
    for (const n of layout.nodes) {
      expect(n.col).toBeLessThan(layout.cols);
      expect(n.row).toBeLessThan(layout.rows);
    }
  });

  it('reflects unlock status in node views', () => {
    const state = freshState();
    state.effort = 1000;
    state.unlock('walkable-streets');
    const layout = techLayout(TECH_TREE, state);
    const ws = layout.nodes.find((n) => n.view.id === 'walkable-streets')!;
    expect(ws.view.status).toBe('unlocked');
    // road-diets now affordable (its only prereq is unlocked + effort covers it)
    const rd = layout.nodes.find((n) => n.view.id === 'road-diets')!;
    expect(rd.view.status).toBe('affordable');
  });

  it('is deterministic for equal state', () => {
    expect(techLayout(TECH_TREE, freshState())).toEqual(techLayout(TECH_TREE, freshState()));
  });

  it('gives each branch its own lane of rows, in branch order (Maddy 2026-09-30: fix how the tree renders)', () => {
    const layout = techLayout(TECH_TREE, freshState());
    expect(layout.lanes.map((l) => l.branch)).toEqual([...BRANCH_ORDER]);
    let next = 0;
    for (const lane of layout.lanes) {
      expect(lane.row0).toBe(next); // lanes stack with no gaps or overlaps
      expect(lane.rows).toBeGreaterThan(0);
      next = lane.row0 + lane.rows;
      for (const n of layout.nodes.filter((m) => m.branch === lane.branch)) {
        expect(n.row).toBeGreaterThanOrEqual(lane.row0);
        expect(n.row).toBeLessThan(lane.row0 + lane.rows);
      }
    }
    expect(next).toBe(layout.rows);
  });
});


describe('tech card content', () => {
  const byId = new Map(TECH_TREE.map((n) => [n.id, n]));
  it('a card that grants a building shows that building; a capability card shows its branch icon', () => {
    const parklets = nodeViewOf(byId.get('parklets')!, byId, freshState());
    expect(parklets.art).toBe(footprintCellKey(48, 1, 1, 0, 0, 0)); // the parklet's own tile
    const walk = nodeViewOf(byId.get('walkable-streets')!, byId, freshState());
    expect(walk.art).toMatch(/^@ui\//);
    // a transit practice shows its track/road tile, not a (nonexistent) building cell
    expect(nodeViewOf(byId.get('streetcar-revival')!, byId, freshState()).art).toMatch(/^streetcar-/);
  });
  it('lists what a node grants in words', () => {
    const parklets = nodeViewOf(byId.get('parklets')!, byId, freshState());
    expect(parklets.grants.join(' ')).toMatch(/Parklet/i);
    const walk = nodeViewOf(byId.get('walkable-streets')!, byId, freshState());
    expect(walk.grants.length).toBeGreaterThan(0);
  });
  it('names its branch', () => {
    expect(nodeViewOf(byId.get('parklets')!, byId, freshState()).branchTitle).toBe('New Urbanism');
  });
});
