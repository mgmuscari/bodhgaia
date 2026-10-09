// Tile extrusion (PURE — pure-ui allowlist): the copies that give a tile image a 1-px border repeating its own edge
// pixels. Chrome on Windows, scaling a small image by a fractional factor (a 5K display at 175–225%), samples a hair past
// its edge, and what lies there is not the tile: a thin dark line along every tile edge (Maddy 2026-10-08). Drawn from
// inside the border, the hair past the edge is the tile's own colour.

/** Border width, px. */
export const TILE_PAD = 1;

export interface Blit {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
}

/** The copies, in order, from a w×h image into a (w+2)×(h+2) one: the image itself, its four edges, its four corners. */
export function extrudeBlits(w: number, h: number): Blit[] {
  const p = TILE_PAD;
  return [
    { sx: 0, sy: 0, sw: w, sh: h, dx: p, dy: p },
    { sx: 0, sy: 0, sw: w, sh: 1, dx: p, dy: 0 }, // top
    { sx: 0, sy: h - 1, sw: w, sh: 1, dx: p, dy: h + p }, // bottom
    { sx: 0, sy: 0, sw: 1, sh: h, dx: 0, dy: p }, // left
    { sx: w - 1, sy: 0, sw: 1, sh: h, dx: w + p, dy: p }, // right
    { sx: 0, sy: 0, sw: 1, sh: 1, dx: 0, dy: 0 },
    { sx: w - 1, sy: 0, sw: 1, sh: 1, dx: w + p, dy: 0 },
    { sx: 0, sy: h - 1, sw: 1, sh: 1, dx: 0, dy: h + p },
    { sx: w - 1, sy: h - 1, sw: 1, sh: 1, dx: w + p, dy: h + p },
  ];
}
