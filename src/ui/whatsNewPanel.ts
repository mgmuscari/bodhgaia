// "What's new" (Maddy 2026-10-13): the release notes a returning player hasn't seen, once, the first time they play a
// new version. DOM shell only — the notes and which to show are the pure changelogContent.ts. It wears the help
// panel's frame (centred, a pinned ✕ and title, the notes scrolling), so it fits a phone the same way.

import type { ChangelogEntry } from './changelogContent';
import { panelVisibility, type PanelHandle } from './panelHandle';

/** Mount the (hidden) What's new window; `onClose` fires when the player dismisses it. */
export function mountWhatsNew(container: HTMLElement, entries: readonly ChangelogEntry[], onClose: () => void): PanelHandle {
  const panel = document.createElement('div');
  panel.className = 'help-panel whats-new';

  const close = document.createElement('div');
  close.className = 'help-panel__close';
  close.textContent = '✕';
  close.title = 'Close';
  panel.appendChild(close);

  const title = document.createElement('div');
  title.className = 'help-panel__title';
  title.textContent = 'What’s new';
  panel.appendChild(title);

  const scroll = document.createElement('div');
  scroll.className = 'help-panel__scroll';
  for (const e of entries) {
    const heading = document.createElement('div');
    heading.className = 'help-panel__credits-heading';
    heading.textContent = `Bodhgaia ${e.version}`;
    scroll.appendChild(heading);
    const list = document.createElement('ul');
    list.className = 'whats-new__notes';
    for (const n of e.notes) {
      const li = document.createElement('li');
      li.textContent = n;
      list.appendChild(li);
    }
    scroll.appendChild(list);
  }
  panel.appendChild(scroll);
  container.appendChild(panel);

  const handle = panelVisibility(panel, { onToggle: (open) => !open && onClose() });
  close.addEventListener('click', () => handle.close());
  return handle;
}
