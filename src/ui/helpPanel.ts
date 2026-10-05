// Help / controls panel: an always-visible "⌨ Controls" hint (bottom-left) that opens a centered
// reference listing every keybinding + mouse interaction — so the game's controls are DISCOVERABLE
// instead of secret (Maddy: "UI needs visible instructions"). DOM shell only; the content + formatting
// live in the pure controlsContent.ts. Toggled by the hint click, the ✕, or the '?'/'h' key. Below the controls,
// the Credits (licence notice + GPL §7 terms, from the pure creditsContent.ts) — required on every conveyance.

import { controlsLines } from './controlsContent';
import { creditsBlocks } from './creditsContent';

export interface HelpPanelHandle {
  /** Show/hide the reference; returns the new visibility. */
  toggle(): boolean;
  visible(): boolean;
}

/** Mount the persistent hint + the (hidden) controls panel into `container`. */
export function mountHelpPanel(container: HTMLElement): HelpPanelHandle {
  // The discoverable entry point — always on screen until the panel is open.
  const hint = document.createElement('button');
  hint.className = 'controls-hint';
  hint.textContent = '⌨ Controls  ?';
  hint.title = 'Show controls (?)';
  container.appendChild(hint);

  const panel = document.createElement('div');
  panel.className = 'help-panel';
  panel.style.display = 'none';

  const close = document.createElement('div');
  close.className = 'help-panel__close';
  close.textContent = '✕';
  close.title = 'Close (?)';
  panel.appendChild(close);

  const title = document.createElement('div');
  title.className = 'help-panel__title';
  title.textContent = 'Controls';
  panel.appendChild(title);

  const body = document.createElement('div');
  body.className = 'help-panel__body';
  body.textContent = controlsLines().join('\n');
  panel.appendChild(body);

  const credits = document.createElement('div');
  credits.className = 'help-panel__credits';
  const creditsTitle = document.createElement('div');
  creditsTitle.className = 'help-panel__title';
  creditsTitle.textContent = 'Credits';
  credits.appendChild(creditsTitle);
  for (const block of creditsBlocks()) {
    const heading = document.createElement('div');
    heading.className = 'help-panel__credits-heading';
    heading.textContent = block.heading;
    credits.appendChild(heading);
    for (const text of block.paragraphs) {
      const p = document.createElement('p');
      p.textContent = text;
      credits.appendChild(p);
    }
    for (const link of block.links ?? []) {
      const a = document.createElement('a');
      a.href = link.href;
      a.textContent = link.label;
      a.target = '_blank';
      a.rel = 'noopener';
      credits.appendChild(a);
    }
  }
  panel.appendChild(credits);

  container.appendChild(panel);

  let shown = false;
  const setShown = (v: boolean): void => {
    shown = v;
    panel.style.display = v ? 'block' : 'none';
    hint.style.display = v ? 'none' : 'block'; // the hint and the panel never show together
  };
  hint.addEventListener('click', () => setShown(true));
  close.addEventListener('click', () => setShown(false));

  return {
    toggle(): boolean {
      setShown(!shown);
      return shown;
    },
    visible(): boolean {
      return shown;
    },
  };
}
