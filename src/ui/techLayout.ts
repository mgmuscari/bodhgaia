// Civ-style tech-tree layout: turn the prereq DAG into a positioned graph the
// panel draws with connector lines. Each node sits in a COLUMN equal to its
// dependency DEPTH (longest prereq chain from a root), so roots are on the left and
// each tech sits to the right of everything it needs; each BRANCH has its own lane
// of rows, so a branch reads as one band and no two nodes share a cell. Edges are the
// prereq→node pairs the shell draws as lines. Pure — no DOM, no transcendental
// Math (on the architecture pure-ui allowlist) — so the layout is unit-tested.

import { Branch, type TechNode } from '../tech/tree';
import type { TechState } from '../tech/state';
import { BRANCH_ORDER, branchTitle, nodeViewOf, type NodeView } from './techContent';

/** One positioned node: its display view, branch, and grid cell (col = depth). */
export interface TechLayoutNode {
  view: NodeView;
  branch: Branch;
  col: number;
  row: number;
}

/** A prereq edge: an arrow from `from` (the prereq) to `to` (the dependent node). */
export interface TechEdge {
  from: string;
  to: string;
}

/** One branch's band of rows. */
export interface TechLane {
  branch: Branch;
  title: string;
  row0: number;
  rows: number;
}

export interface TechLayout {
  nodes: TechLayoutNode[];
  edges: TechEdge[];
  lanes: TechLane[];
  /** Grid extent — the shell sizes the scroll canvas from these. */
  cols: number;
  rows: number;
}

/**
 * Dependency depth of every node: 0 for a root (no prereqs), else 1 + the max depth
 * of its prereqs. Memoized; cycle-safe via an in-progress guard (the tree is
 * validated acyclic, but a malformed tree must still terminate). Dangling prereqs
 * (not in `byId`) contribute depth -1 so they don't inflate the chain.
 */
function computeDepths(nodes: readonly TechNode[], byId: ReadonlyMap<string, TechNode>): Map<string, number> {
  const depth = new Map<string, number>();
  const inProgress = new Set<string>();
  const visit = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    const n = byId.get(id);
    if (!n) return -1; // dangling
    if (inProgress.has(id)) return 0; // cycle backstop
    inProgress.add(id);
    let d = 0;
    for (const p of n.prereqs) {
      const pd = visit(p);
      if (pd + 1 > d) d = pd + 1;
    }
    inProgress.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) visit(n.id);
  return depth;
}

/**
 * Lay the tech tree out as a left→right DAG. Returns positioned nodes (col = depth,
 * row = slot within that depth column ordered by branch then cost then id) and the
 * prereq edges, plus the grid extent. Deterministic in (tree, state).
 */
export function techLayout(tree: readonly TechNode[], state: TechState): TechLayout {
  const byId = new Map(tree.map((n) => [n.id, n]));
  const depth = computeDepths(tree, byId);

  let cols = 0;
  for (const n of tree) cols = Math.max(cols, (depth.get(n.id) ?? 0) + 1);

  // Each branch gets its own LANE of rows (a Civ-style era band): within a lane a node's row is its slot
  // among that branch's nodes of the same depth, and the lane is as tall as its busiest column. Lanes stack
  // in BRANCH_ORDER, so no two nodes ever share a cell and every branch reads as one horizontal band.
  const nodes: TechLayoutNode[] = [];
  const lanes: TechLane[] = [];
  let rows = 0;
  for (const branch of BRANCH_ORDER) {
    const own = tree.filter((n) => n.branch === branch);
    const slots = new Map<number, number>(); // col → next free slot in this lane
    const sorted = [...own].sort((a, b) => {
      const da = depth.get(a.id) ?? 0;
      const db = depth.get(b.id) ?? 0;
      if (da !== db) return da - db;
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    let laneRows = 1;
    for (const n of sorted) {
      const c = depth.get(n.id) ?? 0;
      const slot = slots.get(c) ?? 0;
      slots.set(c, slot + 1);
      if (slot + 1 > laneRows) laneRows = slot + 1;
      nodes.push({ view: nodeViewOf(n, byId, state), branch, col: c, row: rows + slot });
    }
    lanes.push({ branch, title: branchTitle(branch), row0: rows, rows: laneRows });
    rows += laneRows;
  }

  const edges: TechEdge[] = [];
  for (const n of tree) {
    for (const p of n.prereqs) {
      if (byId.has(p)) edges.push({ from: p, to: n.id });
    }
  }

  return { nodes, edges, lanes, cols, rows };
}
