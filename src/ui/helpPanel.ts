// Help / controls panel: an always-visible "⌨ Controls" hint (bottom-left) that opens a centered
// reference listing every keybinding + mouse interaction — so the game's controls are DISCOVERABLE
// instead of secret (Maddy: "UI needs visible instructions"). DOM shell only; the content + formatting
// live in the pure controlsContent.ts. Toggled by the hint click, the ✕, or the '?'/'h' key. Below the controls,
// the Credits (licence notice + GPL §7 terms, from the pure creditsContent.ts) — required on every conveyance.

import { controlsLines } from './controlsContent';
import { creditsBlocks } from './creditsContent';
import { panelVisibility, type PanelHandle } from './panelHandle';

export interface HelpPanelDeps {
  /** Fired on every open/close, so the dock's button can follow. */
  onToggle?(open: boolean): void;
  /** Forget which lessons have been seen, so they play again. Omitted ⇒ no button. */
  onReplayLessons?(): void;
}

/** Mount the persistent hint + the (hidden) controls panel into `container`. */
export function mountHelpPanel(container: HTMLElement, deps: HelpPanelDeps = {}): PanelHandle {
  // The discoverable entry point — always on screen until the panel is open.
  const hint = document.createElement('button');
  hint.className = 'controls-hint';
  hint.textContent = '⌨ Controls  ?';
  hint.title = 'Show controls (?)';
  container.appendChild(hint);

  const panel = document.createElement('div');
  panel.className = 'help-panel';

  const close = document.createElement('div');
  close.className = 'help-panel__close';
  close.textContent = '✕';
  close.title = 'Close (?)';
  panel.appendChild(close);

  const title = document.createElement('div');
  title.className = 'help-panel__title';
  title.textContent = 'Controls';
  panel.appendChild(title);

  // Only the content scrolls: the ✕ and the title stay pinned above it (a scrolled-away ✕ was a trap).
  const scroll = document.createElement('div');
  scroll.className = 'help-panel__scroll';
  panel.appendChild(scroll);

  const body = document.createElement('div');
  body.className = 'help-panel__body';
  body.textContent = controlsLines().join('\n');
  scroll.appendChild(body);

  if (deps.onReplayLessons) {
    const replay = document.createElement('button');
    replay.className = 'help-panel__replay';
    replay.textContent = 'Replay lessons';
    replay.title = 'The lessons play again as each practice takes root';
    replay.addEventListener('click', () => {
      deps.onReplayLessons!();
      replay.textContent = 'Lessons will play again';
      replay.disabled = true;
    });
    scroll.appendChild(replay);
  }

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
  scroll.appendChild(credits);

  container.appendChild(panel);

  const handle = panelVisibility(panel, {
    onToggle: (open) => {
      hint.hidden = open; // the hint and the panel never show together
      deps.onToggle?.(open);
    },
  });
  hint.addEventListener('click', () => handle.open());
  close.addEventListener('click', () => handle.close());
  return handle;
}
