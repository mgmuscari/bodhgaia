// Installs the UI kit (uiKit.ts) into the page (DOM shell): the palette colour roles and each 9-slice frame
// (as a data-URL CSS variable, `--ui-frame-<kind>`) on :root, plus the pixel font. index.html's styles
// read only these variables, so the interface is drawn from the same palette and pixels as the map.

import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import { FRAME_KINDS, framePixels, themeVars } from './uiKit';

export function installUiTheme(): void {
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(themeVars())) root.setProperty(name, value);
  root.setProperty('--ui-font', '"Pixelify Sans", ui-monospace, monospace');
  for (const kind of FRAME_KINDS) {
    const p = framePixels(kind);
    const c = document.createElement('canvas');
    c.width = p.w;
    c.height = p.h;
    const ctx = c.getContext('2d');
    if (!ctx) continue;
    const id = ctx.createImageData(p.w, p.h);
    id.data.set(p.data);
    ctx.putImageData(id, 0, 0);
    root.setProperty(`--ui-frame-${kind}`, `url("${c.toDataURL('image/png')}")`);
  }
}
