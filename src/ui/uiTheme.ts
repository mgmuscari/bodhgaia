// Installs the UI kit (uiKit.ts) into the page (DOM shell): the palette colour roles and each 9-slice frame
// (as a data-URL CSS variable, `--ui-frame-<kind>`) on :root, plus the pixel font. index.html's styles
// read only these variables, so the interface is drawn from the same palette and pixels as the map.

import '@fontsource/jersey-10/400.css';
import { FRAME_KINDS, framePixels, themeVars } from './uiKit';
import { pngDataUrl } from './pngEncode';

export function installUiTheme(): void {
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(themeVars())) root.setProperty(name, value);
  // Jersey 10 at 20 px (twice its 10-px grid, so it stays crisp): chunky, unambiguous digits — Pixelify
  // Sans's 3 read as an 8 at 16 px (Maddy 2026-10-01: "numbers are hard to read in the font")
  root.setProperty('--ui-font', '"Jersey 10", ui-monospace, monospace');
  // encoded directly, not read back from a canvas: Safari's fingerprinting protection scrambles canvas readback,
  // which emptied every frame and left the bars dark (pngEncode.ts)
  for (const kind of FRAME_KINDS) root.setProperty(`--ui-frame-${kind}`, `url("${pngDataUrl(framePixels(kind))}")`);
}
