// The SNES skin's one shared palette (PURE — pure-ui allowlist). Channel values sit on the SNES 5-bit
// grid (multiples of 8): part of the look, and it keeps the palette honest. Every pixel the SNES
// painters write must come from here (test-enforced) — one limited palette is what makes terrain,
// buildings and roads read as one world instead of a collage.

import type { RGB } from './pixelArt';

export const C = {
  ink: [24, 24, 40],
  // grass
  grassHi: [152, 208, 88],
  grass: [112, 176, 64],
  grassMid: [88, 152, 56],
  grassLo: [64, 120, 48],
  // meadow
  meadowHi: [200, 208, 104],
  meadow: [160, 184, 72],
  flower: [248, 216, 88],
  petal: [248, 248, 232],
  // bare ground
  dirtHi: [216, 184, 128],
  dirt: [184, 152, 104],
  dirtLo: [144, 112, 80],
  // forest canopy
  leafHi: [120, 184, 72],
  leaf: [64, 136, 56],
  leafLo: [40, 104, 48],
  leafDk: [24, 72, 40],
  // water
  waterDeep: [32, 64, 152],
  water: [40, 80, 184],
  waterShallow: [56, 104, 208],
  wave: [104, 152, 232],
  foam: [200, 224, 248],
  // polluted water (a palette swap of the water tiles, never marks on them)
  murkHi: [80, 128, 144],
  murk: [48, 88, 136],
  murkLo: [40, 72, 112],
  // paving
  paveHi: [200, 200, 192],
  pave: [168, 168, 160],
  paveLo: [128, 128, 128],
  asphalt: [88, 88, 104],
  asphaltLo: [64, 64, 80],
  line: [232, 232, 216],
  lineYellow: [240, 200, 64],
  // roofs
  roofRedHi: [232, 104, 72],
  roofRed: [192, 64, 48],
  roofRedLo: [144, 40, 40],
  roofBlueHi: [104, 152, 216],
  roofBlue: [64, 104, 176],
  roofBlueLo: [40, 72, 136],
  roofBrownHi: [184, 128, 80],
  roofBrown: [144, 96, 56],
  roofBrownLo: [104, 64, 40],
  slateHi: [152, 160, 176],
  slate: [112, 120, 136],
  slateLo: [80, 88, 104],
  // walls
  cream: [240, 224, 184],
  creamLo: [200, 184, 144],
  brick: [176, 88, 64],
  brickLo: [128, 56, 48],
  // glass + fittings
  glassHi: [184, 224, 248],
  glass: [96, 160, 216],
  glassLo: [56, 104, 168],
  door: [88, 56, 40],
  gold: [232, 184, 56],
  signal: [224, 56, 56],
  cyan: [88, 216, 216],
} as const satisfies Record<string, RGB>;

export const SNES_PALETTE: readonly RGB[] = Object.values(C);
