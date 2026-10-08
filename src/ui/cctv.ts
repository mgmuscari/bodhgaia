// The CCTV inset's DOM shell (content: cctvContent.ts). A small camera feed fixed in the lower right of the map
// pane: a canvas the host renders the event into, a REC dot, a caption and the in-game time.

import { CCTV_H, CCTV_W } from './cctvContent';

export interface CctvHandle {
  readonly canvas: HTMLCanvasElement;
  show(caption: string, time: string): void;
  hide(): void;
  /** GPU mode: the feed's ground shows through from the GPU map beneath; only the sprites are on this canvas. */
  setTransparent(on: boolean): void;
}

export function mountCctv(container: HTMLElement): CctvHandle {
  const root = document.createElement('div');
  root.id = 'cctv';
  root.hidden = true;
  const canvas = document.createElement('canvas');
  canvas.style.width = `${CCTV_W}px`;
  canvas.style.height = `${CCTV_H}px`;
  const bar = document.createElement('div');
  bar.className = 'cctv-bar';
  const rec = document.createElement('span');
  rec.className = 'cctv-rec';
  rec.textContent = '● REC';
  const caption = document.createElement('span');
  caption.className = 'cctv-caption';
  const time = document.createElement('span');
  time.className = 'cctv-time';
  bar.append(rec, caption, time);
  root.append(canvas, bar);
  container.appendChild(root);
  return {
    canvas,
    show(text, at) {
      caption.textContent = text;
      time.textContent = at;
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    setTransparent(on) {
      root.classList.toggle('cctv-gpu', on);
    },
  };
}
