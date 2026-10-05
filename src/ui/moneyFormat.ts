// The one money formatter for the UI: whole dollars, en-US thousands separators, and a true minus
// sign (U+2212) rather than a hyphen. Pure — no DOM, no transcendental Math.

/** The typographic minus sign used for every negative amount. */
export const MINUS = '−';

/** A dollar amount: `$12,346`, `−$2,500`. */
export const money = (v: number): string => `${v < 0 ? MINUS : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;

/** A signed hourly rate: `+$18/h`, `−$18/h`, and an unsigned `$0/h` when it rounds to zero. */
export const perHour = (v: number): string =>
  Math.round(v) === 0 ? '$0/h' : `${v < 0 ? MINUS : '+'}$${Math.abs(Math.round(v)).toLocaleString('en-US')}/h`;
