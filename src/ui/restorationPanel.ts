// Restoration readout panel: the thin, toggleable DOM shell that shows the "is my repair helping?"
// readout. No logic beyond the shared handle (the lines are derived by the pure restorationContent and
// tested there); it owns a panel element, a title, and visibility. It touches the DOM only inside
// mountRestorationPanel, which main() calls only when `document` exists. Hidden by default; the G key and
// the dock's button open it the same way: a FRESH reading at once (flat — no stale trend arrows), then the
// civic cadence's refresh trends each reading against the previous one.

import { panelVisibility, type PanelHandle } from './panelHandle';

export interface RestorationPanelDeps {
  /** The readout lines: `fresh` on open (no prior), else trended against the previous reading. */
  read(fresh: boolean): string[];
  /** Fired on every open/close, so the dock's button can follow. */
  onToggle?(open: boolean): void;
}

/** Build and mount the (hidden) restoration readout panel into `container`. */
export function mountRestorationPanel(container: HTMLElement, deps: RestorationPanelDeps): PanelHandle {
  const panel = document.createElement('div');
  panel.className = 'restoration-panel';

  const title = document.createElement('div');
  title.className = 'restoration-panel__title';
  title.textContent = 'Restoration';
  panel.appendChild(title);

  const body = document.createElement('div');
  body.className = 'restoration-panel__body';
  panel.appendChild(body);

  container.appendChild(panel);

  const show = (fresh: boolean): void => {
    body.textContent = deps.read(fresh).join('\n');
  };
  return panelVisibility(panel, { render: () => show(true), refresh: () => show(false), onToggle: deps.onToggle });
}
