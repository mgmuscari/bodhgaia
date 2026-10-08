// Tech-panel content: pure presentation that turns (tree, state) into the view
// models the DOM shell will render. No DOM, no transcendental Math — the
// architecture guard's pure-ui allowlist scans this file (tests/architecture.test.ts).
// Keeping the derivation here, not in the shell, lets the panel's status logic and
// the overlay-suppression gate be unit-tested rather than left to manual QA.

import { Branch, type TechNode } from '../tech/tree';
import { BuiltKind, isTransportKind } from '../engine/fabric';
import { builtKindName } from '../engine/builtNames';
import { builtRenderKey, footprintCellKey } from './renderKey';
import type { TechState } from '../tech/state';
import { nodeEffectLines } from './techEffectsContent';

export type NodeStatus = 'locked' | 'affordable' | 'unlocked';

/** One node's display state. `missing` names the unmet prereqs (by name, not id). */
export interface NodeView {
  id: string;
  name: string;
  flavor: string;
  cost: number;
  status: NodeStatus;
  missing: string[];
  /** The card's picture: the tile of the first building it grants, else its branch's icon. */
  art: string;
  /** The buildings unlocking it grants, by name. */
  grants: string[];
  /** Exactly what it changes in the simulation, one sentence each (techEffectsContent). */
  effects: string[];
  /** What its buildings cost to keep (upkeep / tending). */
  costs: string[];
  branchTitle: string;
}

/** One branch column: a philosophy and its nodes in display order. */
export interface BranchColumn {
  branch: Branch;
  title: string;
  nodes: NodeView[];
}

// Columns render in the order the design presents the philosophies.
export const BRANCH_ORDER: readonly Branch[] = [
  Branch.NewUrbanism,
  Branch.GreenDevelopment,
  Branch.RestorativeJustice,
  Branch.IntentionalCommunities,
  Branch.GiftEconomy,
  Branch.Solarpunk,
  Branch.AnarchoCommunism,
];

const BRANCH_TITLES: Record<Branch, string> = {
  [Branch.NewUrbanism]: 'New Urbanism',
  [Branch.GreenDevelopment]: 'Green Development',
  [Branch.RestorativeJustice]: 'Restorative Justice',
  [Branch.IntentionalCommunities]: 'Intentional Communities',
  [Branch.GiftEconomy]: 'Gift Economy',
  [Branch.Solarpunk]: 'Solarpunk',
  [Branch.AnarchoCommunism]: 'Anarcho-Communism',
};

/** Each branch's icon for cards that grant a capability rather than a building. */
const BRANCH_ART: Record<Branch, string> = {
  [Branch.NewUrbanism]: '@ui/life',
  [Branch.GreenDevelopment]: '@ui/eco',
  [Branch.RestorativeJustice]: '@ui/civic',
  [Branch.IntentionalCommunities]: footprintCellKey(BuiltKind.CoopHousing, 1, 1, 0, 0, 0),
  [Branch.GiftEconomy]: '@ui/restore',
  [Branch.Solarpunk]: '@ui/power',
  [Branch.AnarchoCommunism]: '@ui/tech',
};

/** A granted kind's picture: a transport kind as an east-west run of its own tile, a building as its 1×1 drawing. */
const kindArt = (k: BuiltKind): string => (isTransportKind(k) ? builtRenderKey(k, 10, 'c', 0) : footprintCellKey(k, 1, 1, 0, 0, 0));

export function branchTitle(b: Branch): string {
  return BRANCH_TITLES[b];
}

function statusOf(node: TechNode, state: TechState): NodeStatus {
  if (state.unlocked.has(node.id)) return 'unlocked';
  if (state.canUnlock(node.id).ok) return 'affordable';
  return 'locked';
}

/**
 * The display view of one node: its status and the names (not ids) of any prereqs
 * not yet unlocked. Shared by branchColumns and the Civ-style techLayout so both
 * derive node state identically. `byId` maps prereq ids to nodes for name lookup.
 */
export function nodeViewOf(
  n: TechNode,
  byId: ReadonlyMap<string, TechNode>,
  state: TechState,
): NodeView {
  return {
    id: n.id,
    name: n.name,
    flavor: n.flavor,
    cost: n.cost,
    status: statusOf(n, state),
    missing: n.prereqs.filter((p) => !state.unlocked.has(p)).map((p) => byId.get(p)?.name ?? p),
    art: n.grants.kinds?.length ? kindArt(n.grants.kinds[0]!) : BRANCH_ART[n.branch],
    grants: (n.grants.kinds ?? []).map((k) => builtKindName(k)),
    ...nodeEffectLines(n),
    branchTitle: BRANCH_TITLES[n.branch],
  };
}

/**
 * Build the 7 branch columns from (tree, state). Columns follow BRANCH_ORDER;
 * within a column, no-prereq roots come first, then nodes by ascending cost
 * (id-tie-broken for determinism). Each node carries its status and the display
 * names of any prereqs not yet unlocked.
 */
export function branchColumns(tree: readonly TechNode[], state: TechState): BranchColumn[] {
  const byId = new Map(tree.map((n) => [n.id, n]));
  return BRANCH_ORDER.map((branch) => {
    const nodes = tree
      .filter((n) => n.branch === branch)
      .slice()
      .sort((a, b) => {
        const ra = a.prereqs.length === 0 ? 0 : 1;
        const rb = b.prereqs.length === 0 ? 0 : 1;
        if (ra !== rb) return ra - rb; // roots first
        if (a.cost !== b.cost) return a.cost - b.cost; // then ascending cost
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // stable tiebreak
      })
      .map((n): NodeView => nodeViewOf(n, byId, state));
    return { branch, title: BRANCH_TITLES[branch], nodes };
  });
}

/** One-line effort readout for the panel header. */
export function effortLine(state: TechState): string {
  return `Communal effort: ${state.effort}`;
}

/**
 * A compact signature of the panel's STRUCTURAL/visible state — each node's
 * `id:status`, in column-then-node order. Deliberately excludes the effort header
 * (it ticks every 100ms but does not change a node's class) so the host only
 * triggers a FULL panel re-derive when a node actually flips status; the cheap
 * header text is refreshed separately. Order-stable: equal trees in equal states
 * yield equal signatures.
 */
export function panelSignature(columns: readonly BranchColumn[]): string {
  return columns
    .flatMap((c) => c.nodes.map((n) => `${n.id}:${n.status}`))
    .join('|');
}

/**
 * The FULL className for a tech node — the shell sets it wholesale
 * (`el.className = techNodeClass(node)`) so a stale `tech-node-locked`/`-affordable`
 * + `tech-node-clickable` drops by construction when status flips: base
 * `tech-node tech-node-${status}`, plus `tech-node-clickable` iff affordable.
 */
export function techNodeClass(node: NodeView): string {
  let cls = `tech-node tech-node-${node.status}`;
  if (node.status === 'affordable') cls += ' tech-node-clickable';
  return cls;
}

/** What beginning a practice costs, for the card, the detail button, and — when the treasury can't cover the
 *  start — why it can't begin yet. Money is paid once to begin; effort is drawn over the days. */
export interface PracticeCostView {
  card: string;
  detail: string;
  blocked?: string;
}

export function practiceCost(terms: { upfront: number; effort: number; hours: number }, funds: number): PracticeCostView {
  const money = `$${terms.upfront.toLocaleString('en-US')}`;
  const days = Math.round((terms.hours / 24) * 10) / 10;
  return {
    card: `${money} · ${terms.effort} effort`,
    detail: `${money} now, then ${terms.effort} effort over ${days} days`,
    ...(funds < terms.upfront ? { blocked: `Needs ${money} to begin` } : {}),
  };
}
