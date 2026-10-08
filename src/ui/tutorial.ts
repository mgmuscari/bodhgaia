// The tutorial's DOM shell (sequence: app/tutorial.ts; words: tutorialContent.ts): a dialogue box in the planner's
// voice, a spotlight that dims everything but the part of the interface being explained, and a Skip button.
// Click / Space / Enter moves on; Escape skips.

import type { TutorialUi } from '../app/tutorial';

export function mountTutorial(container: HTMLElement): TutorialUi {
  const root = document.createElement('div');
  root.className = 'tutorial';
  const spot = document.createElement('div');
  spot.className = 'tutorial-spot';
  spot.hidden = true;
  const box = document.createElement('div');
  box.className = 'tutorial-box';
  const text = document.createElement('p');
  text.className = 'tutorial-text';
  const more = document.createElement('span');
  more.className = 'tutorial-more';
  more.textContent = '▶';
  const skipBtn = document.createElement('button');
  skipBtn.className = 'tutorial-skip';
  skipBtn.textContent = 'Skip tutorial';
  box.append(skipBtn, text, more);
  root.append(spot, box);
  container.appendChild(root);

  let advance: () => void = () => {};
  let skip: () => void = () => {};
  const onKey = (e: KeyboardEvent): void => {
    if (root.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      skip();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      advance();
    }
  };
  const onClick = (e: MouseEvent): void => {
    if (e.target === skipBtn) return;
    advance();
  };
  window.addEventListener('keydown', onKey);
  root.addEventListener('click', onClick);
  skipBtn.addEventListener('click', () => skip());

  return {
    say(t) {
      root.hidden = false;
      text.textContent = t;
      box.classList.remove('tutorial-box-in');
      void box.offsetWidth; // restart the entrance
      box.classList.add('tutorial-box-in');
    },
    spotlight(selector) {
      const el = selector ? (document.querySelector(selector) as HTMLElement | null) : null;
      if (!el) {
        spot.hidden = true;
        root.classList.remove('tutorial-spotlit');
        box.classList.remove('tutorial-box-top');
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 6;
      spot.style.left = `${r.left - pad}px`;
      spot.style.top = `${r.top - pad}px`;
      spot.style.width = `${r.width + 2 * pad}px`;
      spot.style.height = `${r.height + 2 * pad}px`;
      spot.hidden = false;
      root.classList.add('tutorial-spotlit');
      // keep the words clear of what they point at
      box.classList.toggle('tutorial-box-top', r.top + r.height / 2 > window.innerHeight * 0.6);
    },
    hide() {
      root.hidden = true;
    },
    onAdvance: (cb) => (advance = cb),
    onSkip: (cb) => (skip = cb),
    remove() {
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
