// The building-status infoview (Maddy 2026-10-14: "we need a way to see legends. maybe an infoview for building
// statuses"): the map's badges explained — the blinking bolt (no power), the raincloud and the heart (a home suffering
// or thriving), the sparkle (boosted, engine/boosts.ts) — in a key that draws the badges themselves, over a map dimmed
// to the buildings that wear one. Also the ONE home-badge rule the renderer draws by. PURE — no DOM, no transcendental
// Math (on the architecture guard's pure-ui allowlist).

import type { OverlayLegend } from './overlayLegend';
import { C } from './snesPalette';

/** The one view. */
export const STATUS_VIEWS = ['status'] as const;
export type StatusView = (typeof STATUS_VIEWS)[number];

/** A home's badge flags an EXCEPTION, not every home: a heart for a standout (~1 in 10 on a fresh city), a raincloud
 *  a little earlier since suffering is the actionable case. */
export const HOME_THRIVING = 9;
export const HOME_SUFFERING = -6;

/** The badge a home of this health wears, if any. */
export function homeBadge(health: number | undefined): 'thriving' | 'suffering' | null {
  if (health === undefined) return null;
  if (health >= HOME_THRIVING) return 'thriving';
  if (health <= HOME_SUFFERING) return 'suffering';
  return null;
}

/** The badges, in the order a player meets them (the key's rows). */
export const STATUS_ICONS = ['unpowered', 'suffering', 'thriving', 'boosted'] as const;

const MEANING: Record<(typeof STATUS_ICONS)[number], string> = {
  unpowered: 'no power',
  suffering: 'a home suffering',
  thriving: 'a home thriving',
  boosted: 'boosted — inspect for why',
};

/** Each badge's body colour (snesTileset ICONS) — the swatch if the badge art can't be drawn. */
const SWATCH: Record<(typeof STATUS_ICONS)[number], readonly [number, number, number]> = {
  unpowered: C.gold,
  suffering: C.slate,
  thriving: C.signal,
  boosted: C.cyan,
};

/** A building that wears a badge shows through (no fill); the rest of the map is dimmed. */
export const STATUS_LIT: readonly [number, number, number, number] = [0, 0, 0, 0];

export function statusLegendLine(): string {
  return 'Building status — the badges, and what they mean';
}

/** The key: each badge, drawn, beside what it means. */
export function statusLegend(): OverlayLegend {
  return {
    title: 'Building status',
    stops: STATUS_ICONS.map((icon) => ({ icon, color: SWATCH[icon], label: MEANING[icon] })),
  };
}
