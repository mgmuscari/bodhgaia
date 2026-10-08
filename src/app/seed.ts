// A new city's seed (Maddy 2026-10-08): a new player — or New city — gets a random world, not always the same one.
// A cheap guard (worldgen is ~30 ms) keeps a first city from being a hamlet: up to a few draws, the first with at
// least MIN_HOMES homes. `?seed=` still pins a world. Randomness lives here in the shell; the engine stays seeded.

/** A city needs at least this many homes to be a first city worth healing (the smallest of 30 random draws had 392). */
export const MIN_HOMES = 300;

/** A random seed — short, URL-safe, lowercase. */
export function randomSeed(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(rand() * 36).toString(36);
  return `city-${s}`;
}

/** Draw seeds until one's city has at least MIN_HOMES homes (`homesOf` builds it), or `tries` run out — then the
 *  last draw (a small city beats no city). */
export function chooseSeed(draw: () => string, homesOf: (seed: string) => number, tries = 5): string {
  let seed = draw();
  for (let k = 1; k < tries && homesOf(seed) < MIN_HOMES; k++) seed = draw();
  return seed;
}
