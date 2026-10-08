// The unhoused indicator: `Unhoused N` with a down-is-good trend arrow. The count itself is the live layer's
// unhoused stock (AmbientState.unhoused — docs/design/rehoming.md), not a vacancy figure. Pure: no DOM, no
// transcendental Math (pure-ui allowlist).

/** The always-on indicator suffix: `Unhoused N` with a DOWN-is-good arrow vs the previous sample
 *  (↓ = fewer displaced, your housing is working; ↑ = more, displacement worsening; none = flat/no
 *  prior). Down-is-good because for a COUNT of harm, falling is the improvement. */
export function unhousedSuffix(count: number, prev: number | null): string {
  let arrow = '';
  if (prev !== null && count !== prev) arrow = count < prev ? ' ↓' : ' ↑';
  return `Unhoused ${count}${arrow}`;
}
