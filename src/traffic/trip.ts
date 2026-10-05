// The origin→destination trip record. The 1989-style O-D generator that produced these
// (Micropolis TrafficGen: makeTrip/generateTraffic/layTraffic) is retired — traffic is
// agent-driven in the live layer now — so only the type survives, for the composite's
// legacy `trips` dep. Headless + deterministic (a plain record).

/** A committed origin→destination trip. `path` is road tile indices, origin-first;
 *  `origin` is -1 when the footprint has no frontage road (Micropolis "no road"). */
export interface Trip {
  origin: number;
  destination: number;
  path: number[];
  found: boolean;
}
