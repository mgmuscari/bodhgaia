// App shell: the browser never zooms the page (Maddy 2026-10-08, mobile: a double tap zoomed it a little, and a pinch
// over the menu bars zoomed it). The viewport tag forbids scaling and every element allows panning only
// (index.html); this is the backstop for Safari, which honours neither: its own gesture events are cancelled, so is a
// two-finger touch anywhere but the map — whose pinch is the game's zoom (ui/input.ts) — and so is the second tap of a
// double tap (Safari zooms on it whatever touch-action says). A page that got zoomed anyway (a focused field, an old
// release) must be able to pinch back out: while it is zoomed, the pinch guards stand down.

/** A second tap within this of the first is a double tap. */
const DOUBLE_TAP_MS = 350;

const pageScale = (): number => (typeof window !== 'undefined' ? (window.visualViewport?.scale ?? 1) : 1);

export function installNoBrowserZoom(doc: Document, scale: () => number = pageScale): void {
  const zoomed = (): boolean => scale() > 1.01;
  const cancelGesture = (e: Event): void => {
    if (!zoomed()) e.preventDefault();
  };
  doc.addEventListener('gesturestart', cancelGesture, { passive: false });
  doc.addEventListener('gesturechange', cancelGesture, { passive: false });
  doc.addEventListener(
    'touchmove',
    (e: Event) => {
      const t = e as TouchEvent;
      const onMap = (t.target as Element | null)?.closest?.('canvas');
      if (t.touches && t.touches.length > 1 && !onMap && !zoomed()) t.preventDefault();
    },
    { passive: false },
  );
  let lastTap = -Infinity;
  doc.addEventListener(
    'touchend',
    (e: Event) => {
      const t = e as TouchEvent;
      if (t.touches && t.touches.length > 0) return; // a finger still down: not a tap's end
      if (t.timeStamp - lastTap < DOUBLE_TAP_MS) t.preventDefault(); // the second tap: no double-tap zoom
      lastTap = t.timeStamp;
    },
    { passive: false },
  );
}
