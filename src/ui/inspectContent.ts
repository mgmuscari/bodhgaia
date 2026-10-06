// Inspect readout (PURE — no DOM, no transcendental Math → pure-ui allowlist). The inspect tool's dock
// status line: the tool's own readout naming the seeded tile, then the LIVE samples the ambient layer
// carries, the tile's power status and its HOLC redline grade. main.ts calls it from applyAt.

import { Water, type GameMap } from '../engine/map';
import { isRoadKind, type ParcelStore } from '../engine/fabric';
import { plantOutput, isPowerConsumer } from '../growth/power';
import { gradeLetter } from '../worldgen/redline';

/** The LIVE sample values the inspector appends to its readout — each undefined when the tile
 *  carries no such field (a road has traffic/smog but no population; a home the reverse). */
export interface LiveSamples {
  occupancy?: number;
  landValue?: number;
  health?: number;
  traffic?: number;
  pollution?: number;
  water?: number;
  road?: number;
  violence?: number;
  /** Fire/health service: true = covered, false = under-served. Omitted when not applicable. */
  served?: boolean;
}

/**
 * Format the live-layer samples for the inspect readout — `pop 12 · land value 64 · traffic 30 ·
 * smog 8`, in a fixed order, omitting any field the tile doesn't carry. Returns '' when nothing is
 * present (so the host appends nothing). Pure: rounds for display, reads only its argument.
 */
export function liveInspectLine(s: LiveSamples): string {
  const parts: string[] = [];
  if (s.occupancy !== undefined) parts.push(`pop ${Math.round(s.occupancy)}`);
  if (s.landValue !== undefined) parts.push(`land value ${Math.round(s.landValue)}`);
  if (s.health !== undefined) parts.push(`health ${Math.round(s.health)}`);
  if (s.traffic !== undefined) parts.push(`traffic ${Math.round(s.traffic)}`);
  if (s.pollution !== undefined) parts.push(`smog ${Math.round(s.pollution)}`);
  if (s.water !== undefined) parts.push(`water ${Math.round(s.water)} contaminated`);
  if (s.road !== undefined) parts.push(`road ${Math.round(s.road)} crumbling`);
  if (s.violence !== undefined) parts.push(`police violence ${Math.round(s.violence)}`);
  if (s.served !== undefined) parts.push(s.served ? 'served' : 'under-served');
  return parts.join(' · ');
}

/** The live fields inspect samples (an `AmbientState` satisfies this). */
export interface InspectFields {
  occupancy: ReadonlyMap<number, number>;
  landValue: ReadonlyMap<number, number>;
  buildingHealth: ReadonlyMap<number, number>;
  traffic: ReadonlyMap<number, number>;
  pollution: ReadonlyMap<number, number>;
  waterPollution: ReadonlyMap<number, number>;
  roadDecay: ReadonlyMap<number, number>;
  policeViolence: ReadonlyMap<number, number>;
  coverage: ReadonlySet<number>;
}

/**
 * The inspect status line for tile (tx, ty). `info` is the inspect tool's own readout (applyTool's
 * `info`). Population/health/land value/service are keyed by the parcel ANCHOR (resolved through the
 * parcel store); traffic/smog/police violence by the clicked tile itself.
 */
export function inspectReadout(
  info: string,
  tx: number,
  ty: number,
  world: { map: GameMap; parcels: ParcelStore },
  live: InspectFields,
  poweredAnchors: ReadonlySet<number>,
): string {
  const { map, parcels } = world;
  let line = info;
  const i = map.idx(tx, ty);
  const pid = map.parcel[i];
  let anchor = i;
  if (pid) {
    const p = parcels.get(pid - 1);
    anchor = map.idx(p.x, p.y);
  }
  const samples = liveInspectLine({
    occupancy: live.occupancy.get(anchor),
    landValue: live.landValue.get(anchor),
    health: live.buildingHealth.get(anchor),
    traffic: live.traffic.get(i),
    pollution: live.pollution.get(i),
    // On a water tile, surface its contamination (the poisoned creek made legible).
    water: map.water[i] !== Water.None ? live.waterPollution.get(i) : undefined,
    // On a road tile, surface its disrepair (redlined roads crumble).
    road: isRoadKind(map.built[i]!) ? live.roadDecay.get(i) : undefined,
    // Where the police have done violence (arrests) — surfaced on any tile that carries it.
    violence: live.policeViolence.get(i),
    // Fire/health service: is this inhabited plot within reach of a station?
    served: pid ? live.coverage.has(anchor) : undefined,
  });
  if (samples) line += ` · ${samples}`;
  // Power status: a plant shows its output; a consumer shows powered/unpowered.
  const builtHere = map.built[i];
  const out = builtHere ? plantOutput(builtHere) : 0;
  if (out > 0) line += ` · output ${out}`;
  else if (pid && isPowerConsumer(parcels.kindAt(pid - 1))) {
    line += poweredAnchors.has(anchor) ? ' · powered' : ' · UNPOWERED';
  }
  // The HOLC redline grade of this ground — the apparatus's classification that sited the burdens here.
  // Land only (water carries a grade but it reads wrong).
  if (map.water[i] === Water.None) line += ` · redline ${gradeLetter(map.redline[i]!)}`;
  return line;
}
