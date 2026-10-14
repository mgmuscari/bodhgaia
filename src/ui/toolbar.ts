// Tool palette: the thin DOM shell for the left-docked sidebar (Maddy 2026-09-30: "icons instead of text
// for buttons, and keeping the menu bar docked on the left side, with the game window to its right, not
// overlapped"). It holds NO logic worth unit-testing — categorization and art keys are pure and tested in
// ui/toolMenuContent.ts, the map/panel buttons in ui/dockContent.ts. This shell only APPLIES those.
//
// Layout (top→bottom, a 2-column grid of icon buttons, in the 16-bit console city-builders' manner): the modes (inspect,
// bulldoze), the build categories, then the map toggles and panels. A category opens a FLYOUT beside the
// sidebar with its tools, each shown as the very tile it builds; an overlay with several views opens the same
// flyout as a list of its views by name (ui/dockMenu.ts holds the rules). Labels, costs and hotkeys live in a
// pixel tooltip. The status line (inspect readouts, legend captions) is a bar along the bottom of the map.
//
// Render discipline: render() runs only on discrete events (select / category toggle / unlock) and the
// sim-gated dirty check — NOT per frame. Click listeners are delegated to the STABLE containers (bound
// once at mount), so rebuilding their children never loses a click. ZERO game imports.

import type { ToolMenuView, ToolCategory } from './toolMenuContent';
import type { MetaButton } from './dockContent';
import type { ViewRow } from './dockMenu';

/** The sidebar's width (CSS px) — the map pane starts right of it. */
export { SIDEBAR_W } from './layout';
import { dockAtBottom, dockMenuAt } from './layout';

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
  /** The open overlay menu — its views, beside its button — or null. Optional. */
  getViewMenu?(): { kind: string; rows: ViewRow[] } | null;
  /** A view was picked from an overlay's menu. Optional. */
  onPickView?(kind: string, view: string): void;
  /** The image for an art key (a game tile or `@ui/` icon), or undefined if none. */
  art(key: string): CanvasImageSource | undefined;
}

export interface ToolbarHandle {
  /** Re-derive and re-render the palette from getMenu(). */
  refresh(): void;
  /** Show (or clear with null) the status line — e.g. the inspect readout. A message takes the bar over the news. */
  setStatus(text: string | null): void;
  /** The news ticker's headlines (newest last), scrolled along the bar whenever no message is showing. */
  setNews(items: readonly string[]): void;
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
  // two rows: the tools, then the panels and overlays — one column down the side on a desktop (the rows are
  // display: contents there), two rows along the bottom on a phone, each scrolling sideways (ui/layout.ts)
  const toolsRow = document.createElement('div');
  toolsRow.className = 'toolbar-row';
  toolsRow.append(modesEl, rule(), catsEl);
  const metaRow = document.createElement('div');
  metaRow.className = 'toolbar-row';
  metaRow.append(meta);
  bar.append(toolsRow, rule(), metaRow);

  const flyout = document.createElement('div');
  flyout.className = 'toolbar-flyout';
  flyout.hidden = true;

  const status = document.createElement('div');
  status.className = 'toolbar-status'; // always shown: the map pane is sized around it
  const message = document.createElement('span');
  message.className = 'toolbar-status__message';
  const news = document.createElement('div');
  news.className = 'toolbar-status__news';
  const newsTrack = document.createElement('span');
  newsTrack.className = 'toolbar-status__news-track';
  news.appendChild(newsTrack);
  status.append(message, news);

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

  /** On a phone (the palette docked along the bottom) a menu opens upward from its button, above the status line;
   *  false on a desktop, where it opens beside the side palette (and keeps the stylesheet's left). */
  function placeOnPhone(anchor: HTMLElement | null | undefined): boolean {
    if (!dockAtBottom(window.innerWidth)) {
      flyout.style.left = '';
      return false;
    }
    const at = dockMenuAt(anchor ? anchor.getBoundingClientRect().left : 0, flyout.offsetWidth, flyout.offsetHeight, window.innerWidth, window.innerHeight);
    flyout.style.left = `${at.left}px`;
    flyout.style.top = `${at.top}px`;
    tip.hidden = true; // the tap's tooltip would sit on the menu it just opened
    return true;
  }

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
    const views = deps.getViewMenu?.() ?? null;
    flyout.classList.toggle('is-views', views !== null);
    if (views !== null) {
      // an overlay's menu: its views by name, beside its dock button (Maddy 2026-10-13)
      flyout.replaceChildren(
        ...views.rows.map((r) => {
          const btn = document.createElement('button');
          btn.className = `flyout-view${r.selected ? ' is-selected' : ''}`;
          btn.textContent = r.label;
          btn.dataset.viewKind = views.kind;
          btn.dataset.view = r.view;
          return btn;
        }),
      );
      flyout.style.gridTemplateColumns = '';
      // it opens UPWARD, ending level with its button: the overlay's colour key sits below, at the foot of the map
      flyout.hidden = false;
      const anchor = metaButtonEls.get(views.kind);
      if (!placeOnPhone(anchor)) {
        const bottom = anchor ? anchor.getBoundingClientRect().bottom : flyout.offsetHeight;
        flyout.style.top = `${Math.max(0, bottom - flyout.offsetHeight)}px`;
      }
    } else if (view.open === null || view.rows.length === 0) {
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
      flyout.hidden = false;
      if (!placeOnPhone(anchor)) flyout.style.top = `${anchor ? anchor.getBoundingClientRect().top : 0}px`;
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
    markMore();
  }

  /** A dock row with buttons past its right edge fades out there, so a phone player knows it scrolls. */
  function markMore(): void {
    for (const row of [toolsRow, metaRow]) row.classList.toggle('has-more', row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
  }
  for (const row of [toolsRow, metaRow]) row.addEventListener('scroll', markMore, { passive: true });
  window.addEventListener('resize', markMore);

  function setStatus(text: string | null): void {
    // the status line is permanent chrome (the map pane is sized around it): an empty message lets the news show
    message.textContent = text ?? '';
    status.classList.toggle('has-message', !!text);
  }

  // An update never interrupts a pass (Maddy 2026-10-07: "an updated ticker should wait for the next opportunity
  // to scroll"): the new feed waits as PENDING and is swapped in when the current pass ends — at an animation
  // iteration, where the track is back at its start — or at once if nothing is showing yet.
  let shown = '';
  let pending: { text: string; latest: string } | null = null;
  const show = (text: string, latest: string): void => {
    shown = text;
    newsTrack.textContent = text;
    newsTrack.dataset['latest'] = latest;
    newsTrack.style.animationDuration = `${Math.max(14, text.length / 9)}s`; // ~9 characters a second
  };
  newsTrack.addEventListener('animationiteration', () => {
    if (pending === null) return;
    show(pending.text, pending.latest);
    pending = null;
  });
  function setNews(items: readonly string[]): void {
    const text = items.join('     ·     ');
    const latest = items[items.length - 1] ?? '';
    if (shown === '') show(text, latest);
    else if (text !== shown) pending = { text, latest };
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

  // a click opens a menu beside the button: its tooltip would sit on the menu's first row
  for (const host of [bar, flyout]) host.addEventListener('click', () => (tip.hidden = true));

  // Delegated listeners on the STABLE containers (bound once).
  const onToolClick = (e: Event): void => {
    const el = (e.target as HTMLElement).closest('[data-tool-id]') as HTMLElement | null;
    const id = el?.dataset.toolId;
    if (id !== undefined) deps.onSelect(id);
  };
  modesEl.addEventListener('click', onToolClick);
  flyout.addEventListener('click', onToolClick);
  flyout.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null;
    if (el?.dataset.viewKind !== undefined && el.dataset.view !== undefined) deps.onPickView?.(el.dataset.viewKind, el.dataset.view);
  });
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
    // a phone: the dock's tooltip opens where its menus do — none while one is open (re-rendered buttons under a
    // finger fire a fresh pointerover after the menu opened)
    if (dockAtBottom(window.innerWidth) && bar.contains(el) && !flyout.hidden) return;
    const r = el.getBoundingClientRect();
    tip.textContent = el.dataset.tip ?? '';
    tip.hidden = false;
    if (dockAtBottom(window.innerWidth) && bar.contains(el)) {
      // a phone: above the dock, from the button's left edge
      const at = dockMenuAt(r.left, tip.offsetWidth, tip.offsetHeight, window.innerWidth, window.innerHeight);
      tip.style.left = `${at.left}px`;
      tip.style.top = `${at.top}px`;
    } else {
      tip.style.left = `${r.right + 6}px`;
      tip.style.top = `${r.top + 4}px`;
    }
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
  return {
    refresh: () => {
      render();
      markMore();
    },
    setStatus,
    setNews,
    refreshMeta,
    flash,
  };
}
