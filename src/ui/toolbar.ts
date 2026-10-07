// Tool palette: the thin DOM shell for the left-docked sidebar (Maddy 2026-09-30: "icons instead of text
// for buttons, and keeping the menu bar docked on the left side, with the game window to its right, not
// overlapped"). It holds NO logic worth unit-testing — categorization and art keys are pure and tested in
// ui/toolMenuContent.ts, the map/panel buttons in ui/dockContent.ts. This shell only APPLIES those.
//
// Layout (top→bottom, a 2-column grid of icon buttons, SNES SimCity style): the modes (inspect,
// bulldoze), the build categories, then the map toggles and panels. A category opens a FLYOUT beside the
// sidebar with its tools, each shown as the very tile it builds. Labels, costs and hotkeys live in a
// pixel tooltip. The status line (inspect readouts, legend captions) is a bar along the bottom of the map.
//
// Render discipline: render() runs only on discrete events (select / category toggle / unlock) and the
// sim-gated dirty check — NOT per frame. Click listeners are delegated to the STABLE containers (bound
// once at mount), so rebuilding their children never loses a click. ZERO game imports.

import type { ToolMenuView, ToolCategory } from './toolMenuContent';
import type { MetaButton } from './dockContent';

/** The sidebar's width (CSS px) — the map pane starts right of it. */
export { SIDEBAR_W } from './layout';

export interface ToolbarDeps {
  /** Re-derive the current dock view (assembled in main.ts from pure modules). */
  getMenu(): ToolMenuView;
  /** A tool/mode tile was clicked; the host updates selection then refreshes. */
  onSelect(id: string): void;
  /** A category tile was clicked; the host toggles which flyout is open then refreshes. */
  onToggleCategory(id: ToolCategory): void;
  /** Re-derive the map/panel buttons (+ active flags). Optional. */
  getMetaButtons?(): MetaButton[];
  /** A map/panel button was clicked. Optional. */
  onMeta?(id: MetaButton['id']): void;
  /** The image for an art key (a game tile or `@ui/` icon), or undefined if none. */
  art(key: string): CanvasImageSource | undefined;
}

export interface ToolbarHandle {
  /** Re-derive and re-render the palette from getMenu(). */
  refresh(): void;
  /** Show (or clear with null) the status line — e.g. the inspect readout. */
  setStatus(text: string | null): void;
  /** Re-derive and re-apply the map/panel buttons. */
  refreshMeta(): void;
  /** Pulse the palette to announce a freshly-unlocked tool. */
  flash(): void;
}

const FLASH_CLASS = 'toolbar-tool-flash';
const FLASH_MS = 1000;
const ICON_PX = 16; // art is drawn at its native 16 px and scaled ×2 by CSS (pixelated)

export function mountToolbar(container: HTMLElement, deps: ToolbarDeps): ToolbarHandle {
  const bar = document.createElement('nav');
  bar.className = 'toolbar';

  const modesEl = document.createElement('div');
  modesEl.className = 'toolbar-grid';
  const catsEl = document.createElement('div');
  catsEl.className = 'toolbar-grid';
  const meta = document.createElement('div');
  meta.className = 'toolbar-grid';
  const rule = (): HTMLElement => {
    const hr = document.createElement('div');
    hr.className = 'toolbar-rule';
    return hr;
  };
  bar.append(modesEl, rule(), catsEl, rule(), meta);

  const flyout = document.createElement('div');
  flyout.className = 'toolbar-flyout';
  flyout.hidden = true;

  const status = document.createElement('div');
  status.className = 'toolbar-status'; // always shown: the map pane is sized around it

  const tip = document.createElement('div');
  tip.className = 'ui-tip';
  tip.hidden = true;

  container.append(bar, flyout, status, tip);

  /** An icon button showing `art`, with `label` as its tooltip. */
  function iconButton(art: string, label: string, cls: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `icon-btn ${cls}`;
    btn.dataset.tip = label;
    btn.setAttribute('aria-label', label);
    const c = document.createElement('canvas');
    c.width = ICON_PX;
    c.height = ICON_PX;
    const img = deps.art(art);
    const ctx = c.getContext('2d');
    if (img && ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, ICON_PX, ICON_PX);
    }
    btn.appendChild(c);
    return btn;
  }

  const metaButtonEls = new Map<string, HTMLButtonElement>();

  function render(): void {
    const view = deps.getMenu();
    modesEl.replaceChildren(
      ...view.modes.map((m) => {
        const btn = iconButton(m.art, m.label, m.selected ? 'is-selected' : '');
        btn.dataset.toolId = m.id;
        return btn;
      }),
    );
    catsEl.replaceChildren(
      ...view.categories.map((c) => {
        const cls = [c.active ? 'is-open' : '', c.hasSelected ? 'is-selected' : ''].join(' ');
        const btn = iconButton(c.art, `${c.label} (${c.count})`, cls);
        btn.dataset.catId = c.id;
        return btn;
      }),
    );
    if (view.open === null || view.rows.length === 0) {
      flyout.replaceChildren();
      flyout.hidden = true;
    } else {
      flyout.replaceChildren(
        ...view.rows.map((r) => {
          const cls = [r.selected ? 'is-selected' : '', r.affordable ? '' : 'is-unaffordable'].join(' ');
          const btn = iconButton(r.art, r.label, cls);
          btn.dataset.toolId = r.id;
          return btn;
        }),
      );
      flyout.style.gridTemplateColumns = `repeat(${Math.min(4, view.rows.length)}, 44px)`; // sized to its tools
      // open beside its category button
      const anchor = catsEl.querySelector(`[data-cat-id="${view.open}"]`) as HTMLElement | null;
      flyout.style.top = `${anchor ? anchor.getBoundingClientRect().top : 0}px`;
      flyout.hidden = false;
    }
  }

  function refreshMeta(): void {
    for (const m of deps.getMetaButtons?.() ?? []) {
      let btn = metaButtonEls.get(m.id);
      if (!btn) {
        btn = iconButton(m.art, m.label, '');
        btn.dataset.metaId = m.id;
        metaButtonEls.set(m.id, btn);
        meta.appendChild(btn);
      }
      btn.classList.toggle('is-selected', m.active);
    }
  }

  function setStatus(text: string | null): void {
    // the status line is permanent chrome (the map pane is sized around it): an empty message just blanks it
    status.textContent = text ?? '';
  }

  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  function flash(): void {
    bar.classList.add(FLASH_CLASS);
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      bar.classList.remove(FLASH_CLASS);
      flashTimer = null;
    }, FLASH_MS);
  }

  // Delegated listeners on the STABLE containers (bound once).
  const onToolClick = (e: Event): void => {
    const el = (e.target as HTMLElement).closest('[data-tool-id]') as HTMLElement | null;
    const id = el?.dataset.toolId;
    if (id !== undefined) deps.onSelect(id);
  };
  modesEl.addEventListener('click', onToolClick);
  flyout.addEventListener('click', onToolClick);
  catsEl.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-cat-id]') as HTMLElement | null;
    const id = el?.dataset.catId;
    if (id !== undefined) deps.onToggleCategory(id as ToolCategory);
  });
  meta.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-meta-id]') as HTMLElement | null;
    const id = el?.dataset.metaId;
    if (id !== undefined) deps.onMeta?.(id as MetaButton['id']);
  });

  // The pixel tooltip: label (+ cost / hotkey) beside whichever icon is under the pointer.
  const onOver = (e: Event): void => {
    const el = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    tip.textContent = el.dataset.tip ?? '';
    tip.style.left = `${r.right + 6}px`;
    tip.style.top = `${r.top + 4}px`;
    tip.hidden = false;
  };
  const onOut = (): void => {
    tip.hidden = true;
  };
  for (const host of [bar, flyout]) {
    host.addEventListener('pointerover', onOver);
    host.addEventListener('pointerout', onOut);
  }

  render();
  refreshMeta();
  return { refresh: render, setStatus, refreshMeta, flash };
}
