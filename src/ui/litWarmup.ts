// Warm the headlight lit-silhouette cache in idle time. A silhouette (renderer.litSilhouette) is built with
// a getImageData readback the first time a beam strikes that sprite from that direction — which used to
// happen all at once as night fell. These helpers pick the sprites a beam can strike and run the builds
// in idle slices after load; the lazy build stays as the fallback for anything not yet warmed.
//
// Pure: no DOM (the caller supplies the idle scheduler), no transcendental Math.

/** Sprite families a headlight can light, in warm-up order (cars are the commonest lit body). */
const LIT_BODY_PREFIXES = ['@sprite/car/', '@sprite/cop/', '@sprite/firetruck/', '@sprite/train/', '@sprite/ped/', '@sprite/bike/'] as const;

/** The sprite keys among `keys` that can be a lit body, grouped in {@link LIT_BODY_PREFIXES} order. */
export function litBodyKeys(keys: Iterable<string>): string[] {
  const all = [...keys];
  return LIT_BODY_PREFIXES.flatMap((p) => all.filter((k) => k.startsWith(p)));
}

/** The slice of the browser's IdleDeadline these helpers use. */
export interface IdleDeadlineLike {
  timeRemaining(): number;
}

/**
 * Run `jobs` in order across idle periods: each period runs jobs while the deadline has more than a
 * millisecond left (at least one, so a busy page still makes progress), then schedules the next. A job
 * that throws stops the warm-up — whatever it would have built is built lazily on first use instead.
 */
export function drainInIdle(jobs: readonly (() => void)[], schedule: (cb: (deadline: IdleDeadlineLike) => void) => void): void {
  let i = 0;
  const slice = (deadline: IdleDeadlineLike): void => {
    const start = i;
    try {
      while (i < jobs.length && deadline.timeRemaining() > 1) jobs[i++]!();
      if (i === start && i < jobs.length) jobs[i++]!();
    } catch {
      return;
    }
    if (i < jobs.length) schedule(slice);
  };
  if (jobs.length > 0) schedule(slice);
}
