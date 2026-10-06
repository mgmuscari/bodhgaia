// The clamp family: every range clamp in the sim + its readouts lives here, so there is ONE
// definition per behaviour. Engine-level (headless, transcendental-free) so every layer above —
// worldgen, ecology, civic, economy, ui — can import it without a dependency-direction violation.
//
// Hash-sensitive: clampByte feeds the hashed map layers, so each variant's exact expression is
// load-bearing. The byte clamp comes in TWO deliberately distinct variants — do not merge them:
//   - clampByte       — no floor; for callers whose input is already an integer (or that floor first).
//   - floorClampByte  — floors an in-range fraction; for callers that may hand it a fraction.
// They agree on every integer; they differ only on in-range fractions.

/** Pin `v` to [lo, hi] (assumes lo ≤ hi). In-range values — fractions included — pass through. */
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Pin `x` to [0, 1]. */
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Pin `v` to [0, 255] WITHOUT flooring — an in-range fraction passes through unchanged. */
export const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Pin `v` to [0, 255] and FLOOR an in-range fraction to an integer byte. */
export const floorClampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.floor(v));
