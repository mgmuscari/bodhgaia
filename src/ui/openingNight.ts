// The opening's first act — DOM shell (sequence: app/openingNight.ts; words: openingScript.ts). One layer over the
// whole window: the epigraph cards on a dark screen; during the walk a clear pane that only holds the pointer (the
// camera is the opening's) with an "Esc to skip" hint; the mantra and the awakening over the dimmed city.

import { MANTRA, type Epigraph } from './openingScript';
import type { NightUi } from '../app/openingNight';

export function mountNightOverlay(container: HTMLElement): NightUi {
  const root = document.createElement('div');
  root.className = 'night-overlay night-dark';
  const stage = document.createElement('div');
  stage.className = 'night-stage';
  const hint = document.createElement('div');
  hint.className = 'night-hint';
  hint.textContent = 'Esc to skip';
  root.append(stage, hint);
  container.appendChild(root);

  let advance: () => void = () => {};
  let skip: () => void = () => {};
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      skip();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      advance();
    }
  };
  const onClick = (): void => advance();
  window.addEventListener('keydown', onKey);
  root.addEventListener('click', onClick);

  const set = (cls: string, nodes: HTMLElement[]): void => {
    root.className = `night-overlay ${cls}`;
    stage.replaceChildren(...nodes);
  };
  const el = (tag: string, cls: string, text: string): HTMLElement => {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    return e;
  };

  return {
    card(e: Epigraph) {
      const card = el('div', 'night-card', '');
      card.append(...e.lines.map((l) => el('p', 'night-line', l)), el('p', 'night-source', `— ${e.source}`));
      set('night-dark', [card]);
    },
    words(n) {
      set('night-dim', [el('p', 'night-mantra', MANTRA.slice(0, n).join(' '))]);
    },
    title(text) {
      set('night-dim', [el('h1', 'night-title', text)]);
    },
    clear() {
      set('night-clear', []);
    },
    onAdvance: (cb) => (advance = cb),
    onSkip: (cb) => (skip = cb),
    remove() {
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('click', onClick);
      root.remove();
    },
  };
}
