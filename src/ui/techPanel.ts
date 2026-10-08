// Tech panel ("the Commons"): the thin DOM shell for the Civ-style tech tree, toggled by `T` or the
// palette's Tech button. Structure is pure and tested — node status and card content in ui/techContent.ts,
// the depth-column × branch-lane layout and prereq edges in ui/techLayout.ts; this shell only draws them.
//
// Each branch is a horizontal LANE (a labelled band); each node a FIXED-SIZE card — its picture (the
// building it grants, or its branch's icon), name and cost — so nothing can overflow into a neighbour.
// Prereq connectors run at right angles through the gaps between columns. Clicking a card SELECTS it into
// the detail pane (description, needs, grants, Unlock); clicking a selected, affordable card — or Unlock —
// unlocks it. Nodes and edges are built ONCE (the tree's shape is static) and re-applied on refresh.

import { techNodeClass, type PracticeCostView } from './techContent';
import type { TechLayout, TechLayoutNode } from './techLayout';
import { panelVisibility, type PanelHandle } from './panelHandle';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Grid metrics (CSS px).
const LABEL_W = 120; // the branch-label column
const COL_W = 212;
const CARD_W = 188;
const CARD_H = 48;
const ROW_H = 58;
const PAD = 10;
const ICON_PX = 16;

/** Plain-data content for the panel (assembled in main.ts from pure modules). */
export interface TechPanelContent {
  effort: string;
  layout: TechLayout;
}

export interface TechPanelDeps {
  getContent(): TechPanelContent;
  /** Cheap header source: just the effort line, for refreshHeader each tick. Optional. */
  getEffort?(): string;
  /** Attempt to unlock a node; returns true if it succeeded (state changed). */
  onUnlock(id: string): boolean;
  /** Fired for every toggle so the host keeps the palette's Tech button in sync. Optional. */
  onToggle?(open: boolean): void;
  /** The image for an art key (a game tile or `@ui/` icon). */
  art(key: string): CanvasImageSource | undefined;
  /** A practice underway as a project: its progress 0..1 (undefined when not started). Optional. */
  progress?(id: string): number | undefined;
  /** What beginning a practice costs (money to begin, effort over days), and why it can't begin yet. Optional. */
  cost?(id: string): PracticeCostView | undefined;
}

export interface TechPanelHandle extends PanelHandle {
  /** The cheap per-tick header (just the effort line) — no-op while closed. */
  refreshHeader(): void;
}

/** A 16-px art canvas, scaled ×`scale` by CSS (pixelated). */
function artCanvas(img: CanvasImageSource | undefined, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ICON_PX;
  c.height = ICON_PX;
  c.style.width = `${ICON_PX * scale}px`;
  c.style.height = `${ICON_PX * scale}px`;
  const ctx = c.getContext('2d');
  if (img && ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, ICON_PX, ICON_PX);
  }
  return c;
}

export function mountTechPanel(container: HTMLElement, deps: TechPanelDeps): TechPanelHandle {
  const panel = document.createElement('div');
  panel.className = 'tech-panel';

  const header = document.createElement('div');
  header.className = 'tech-panel-header';
  const title = document.createElement('span');
  title.className = 'tech-panel-title';
  title.textContent = 'The Commons';
  const effortText = document.createElement('span');
  effortText.className = 'tech-panel-effort';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tech-panel-close';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close the tech tree');
  closeBtn.addEventListener('click', () => handle.close());
  header.append(title, effortText, closeBtn);

  const body = document.createElement('div');
  body.className = 'tech-body';
  const wrap = document.createElement('div');
  wrap.className = 'tech-tree-wrap';
  const tree = document.createElement('div');
  tree.className = 'tech-tree';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'tech-edges');
  svg.setAttribute('shape-rendering', 'crispEdges');
  tree.appendChild(svg);
  wrap.appendChild(tree);

  const detail = document.createElement('aside');
  detail.className = 'tech-detail';
  body.append(wrap, detail);
  panel.append(header, body);
  container.appendChild(panel);

  let built = false;
  let selected: string | null = null;
  const cardMap = new Map<string, HTMLElement>();
  const edgeMap = new Map<string, SVGPolylineElement>();

  const leftOf = (col: number): number => PAD + LABEL_W + col * COL_W;
  const topOf = (row: number): number => PAD + row * ROW_H;

  function buildTree(layout: TechLayout): void {
    const width = leftOf(layout.cols) + PAD;
    const height = topOf(layout.rows) + PAD;
    tree.style.width = `${width}px`;
    tree.style.height = `${height}px`;
    svg.setAttribute('width', `${width}`);
    svg.setAttribute('height', `${height}`);

    // Branch lanes: a band with its title, alternating shade.
    layout.lanes.forEach((lane, i) => {
      const band = document.createElement('div');
      band.className = i % 2 === 0 ? 'tech-lane' : 'tech-lane tech-lane-alt';
      band.style.top = `${topOf(lane.row0) - 4}px`;
      band.style.height = `${lane.rows * ROW_H}px`;
      band.style.width = `${width}px`;
      const label = document.createElement('div');
      label.className = 'tech-lane-label';
      label.textContent = lane.title;
      band.appendChild(label);
      tree.insertBefore(band, svg);
    });

    // Connectors at right angles: out of the prereq's right edge, down/up in the gap before the dependent's
    // column, then in to its left edge.
    const cell = new Map(layout.nodes.map((n) => [n.view.id, n]));
    for (const e of layout.edges) {
      const a = cell.get(e.from);
      const b = cell.get(e.to);
      if (!a || !b) continue;
      const x1 = leftOf(a.col) + CARD_W;
      const y1 = topOf(a.row) + CARD_H / 2;
      const x2 = leftOf(b.col);
      const y2 = topOf(b.row) + CARD_H / 2;
      const xm = x2 - (COL_W - CARD_W) / 2;
      const line = document.createElementNS(SVG_NS, 'polyline');
      line.setAttribute('points', `${x1},${y1} ${xm},${y1} ${xm},${y2} ${x2},${y2}`);
      line.setAttribute('class', 'tech-edge');
      svg.appendChild(line);
      edgeMap.set(`${e.from}->${e.to}`, line);
    }

    for (const n of layout.nodes) {
      const card = document.createElement('div');
      card.dataset.nodeId = n.view.id;
      card.style.left = `${leftOf(n.col)}px`;
      card.style.top = `${topOf(n.row)}px`;
      card.style.width = `${CARD_W}px`;
      card.style.height = `${CARD_H}px`;
      const text = document.createElement('div');
      text.className = 'tech-card-text';
      const name = document.createElement('div');
      name.className = 'tech-card-name';
      name.textContent = n.view.name;
      const cost = document.createElement('div');
      cost.className = 'tech-card-cost';
      text.append(name, cost);
      card.append(artCanvas(deps.art(n.view.art), 2), text);
      tree.appendChild(card);
      cardMap.set(n.view.id, card);
    }
    built = true;
  }

  function renderDetail(n: TechLayoutNode | undefined): void {
    detail.replaceChildren();
    if (!n) {
      const hint = document.createElement('p');
      hint.className = 'tech-detail-hint';
      hint.textContent = 'Choose a practice to read about it. Each is unlocked with communal effort once the practices it grows from are in place.';
      detail.appendChild(hint);
      return;
    }
    const v = n.view;
    const head = document.createElement('div');
    head.className = 'tech-detail-head';
    const name = document.createElement('div');
    name.className = 'tech-detail-name';
    name.textContent = v.name;
    const branch = document.createElement('div');
    branch.className = 'tech-detail-branch';
    branch.textContent = v.branchTitle;
    const names = document.createElement('div');
    names.append(name, branch);
    head.append(artCanvas(deps.art(v.art), 4), names);
    const flavor = document.createElement('p');
    flavor.className = 'tech-detail-flavor';
    flavor.textContent = v.flavor;
    detail.append(head, flavor);
    const line = (label: string, text: string, cls: string): void => {
      const p = document.createElement('p');
      p.className = cls;
      p.textContent = `${label}: ${text}`;
      detail.appendChild(p);
    };
    if (v.grants.length > 0) line('Builds', v.grants.join(', '), 'tech-detail-grants');
    const list = (items: string[], cls: string): void => {
      const ul = document.createElement('ul');
      ul.className = cls;
      for (const t of items) {
        const li = document.createElement('li');
        li.textContent = t;
        ul.appendChild(li);
      }
      detail.appendChild(ul);
    };
    list(v.effects.length > 0 ? v.effects : ['Not yet in the simulation'], 'tech-detail-effects');
    if (v.costs.length > 0) list(v.costs, 'tech-detail-costs');
    if (v.missing.length > 0) line('Needs', v.missing.join(', '), 'tech-detail-needs');
    const act = document.createElement('button');
    act.className = 'tech-detail-unlock';
    act.dataset.unlockId = v.id;
    const prog = deps.progress?.(v.id);
    if (v.status === 'unlocked') {
      act.textContent = 'In practice';
      act.disabled = true;
    } else if (prog !== undefined) {
      act.textContent = `Underway · ${Math.round(prog * 100)}%`;
      act.disabled = true;
    } else {
      const c = deps.cost?.(v.id);
      act.textContent = !c ? `Unlock · ${v.cost}` : v.missing.length === 0 && c.blocked ? c.blocked : `Begin · ${c.detail}`;
      act.disabled = v.missing.length > 0 || !!c?.blocked;
    }
    detail.appendChild(act);
  }

  function applyTree(layout: TechLayout): void {
    if (!built) buildTree(layout);
    const unlocked = new Set(layout.nodes.filter((n) => n.view.status === 'unlocked').map((n) => n.view.id));
    for (const n of layout.nodes) {
      const card = cardMap.get(n.view.id);
      if (!card) continue;
      const prog = deps.progress?.(n.view.id);
      card.className = `tech-card ${techNodeClass(n.view)}${prog !== undefined ? ' tech-node-underway' : ''}${n.view.id === selected ? ' tech-card-selected' : ''}`;
      (card.querySelector('.tech-card-cost') as HTMLElement).textContent =
        n.view.status === 'unlocked'
          ? 'in practice'
          : prog !== undefined
            ? `underway ${Math.round(prog * 100)}%`
            : (deps.cost?.(n.view.id)?.card ?? `${n.view.cost} effort`);
    }
    for (const [key, line] of edgeMap) {
      const from = key.slice(0, key.indexOf('->'));
      line.setAttribute('class', unlocked.has(from) ? 'tech-edge tech-edge-active' : 'tech-edge');
    }
    renderDetail(layout.nodes.find((n) => n.view.id === selected));
  }

  function render(): void {
    const content = deps.getContent();
    effortText.textContent = content.effort;
    applyTree(content.layout);
  }

  const handle = panelVisibility(panel, { render, onToggle: deps.onToggle });

  function onKey(event: KeyboardEvent): void {
    // T is bound in the one key table (keyMap.ts → main.ts calls toggle()); the panel keeps only Escape.
    if (event.key === 'Escape' && handle.isOpen()) {
      event.preventDefault();
      handle.close();
    }
  }

  tree.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null;
    const id = el?.dataset.nodeId;
    if (id === undefined) return;
    if (id === selected) deps.onUnlock(id); // a second click on the chosen card begins it (if it can)
    selected = id;
    render();
  });
  detail.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-unlock-id]') as HTMLElement | null;
    const id = el?.dataset.unlockId;
    if (id !== undefined && deps.onUnlock(id)) render();
  });

  window.addEventListener('keydown', onKey);

  return {
    ...handle,
    refreshHeader: () => {
      if (handle.isOpen()) effortText.textContent = deps.getEffort ? deps.getEffort() : deps.getContent().effort;
    },
  };
}
