// Live counts the indicators read (economy/indicators.ts): how the people out right now are getting around. Reads the
// live layer only.

import type { AmbientState } from './types';
import { TravelMode } from '../citizens/modes';

/** People out now by how they travel: on foot, by bike, by tram or train, by car (drivers, and passing traffic). */
export function travelModes(state: AmbientState): { walk: number; bike: number; transit: number; car: number } {
  const out = { walk: 0, bike: 0, transit: 0, car: 0 };
  for (const p of state.peds) {
    if (p.phase === 'inside' || p.phase === 'gathering') continue;
    if (p.phase === 'driving') out.car++;
    else if (p.phase === 'riding' || p.phase === 'transit' || p.mode === TravelMode.Streetcar || p.mode === TravelMode.ElevatedRail) out.transit++;
    else if (p.mode === TravelMode.Bike) out.bike++;
    else out.walk++;
  }
  for (const c of state.cars) if (!c.owned && !c.parked && c.atHome === undefined && c.wreck === undefined) out.car++; // passing traffic
  return out;
}
