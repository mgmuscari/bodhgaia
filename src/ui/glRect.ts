// Screen box → WebGL viewport/scissor rect (pure). A GL canvas covering `pane` (CSS px, top-left origin) is
// `pane × dpr` device pixels with its origin at the BOTTOM-left; this maps a box drawn over it (the CCTV inset) to
// the device-pixel rect GL draws into.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function toGlRect(box: Box, pane: Box, dpr: number): { x: number; y: number; w: number; h: number } {
  const x = Math.round((box.left - pane.left) * dpr);
  const w = Math.round(box.width * dpr);
  const h = Math.round(box.height * dpr);
  const top = Math.round((box.top - pane.top) * dpr);
  const y = Math.round(pane.height * dpr) - top - h;
  return { x, y, w, h };
}
