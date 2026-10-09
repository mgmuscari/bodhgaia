// App shell: the browser never zooms the page (Maddy 2026-10-08, mobile: a double tap zoomed it a little, and a pinch
// over the menu bars zoomed it). The viewport tag forbids scaling and every element allows panning only
// (index.html); this is the backstop for Safari, which honours neither for a pinch: its own gesture events are
// cancelled, and so is a two-finger touch anywhere but the map — whose pinch is the game's zoom (ui/input.ts).

export function installNoBrowserZoom(doc: Document): void {
  const cancel = (e: Event): void => e.preventDefault();
  doc.addEventListener('gesturestart', cancel, { passive: false });
  doc.addEventListener('gesturechange', cancel, { passive: false });
  doc.addEventListener(
    'touchmove',
    (e: Event) => {
      const t = e as TouchEvent;
      const onMap = (t.target as Element | null)?.closest?.('canvas');
      if (t.touches && t.touches.length > 1 && !onMap) t.preventDefault();
    },
    { passive: false },
  );
}
