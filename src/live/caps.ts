// Live-layer perf ceilings (leaf module — no imports). The settings menu owns the presets/clamp
// (ui/settings.ts re-exports the shape); main wires applyLiveCaps from the persisted store.

/** Live agent/render perf ceilings — the "fast PC vs slow PC" knob. Mutable at runtime; the shape is
 *  the single source of truth for the live layer's caps (re-exported by ui/settings). */
export interface LiveCaps {
  carCap: number;
  pedCap: number;
  flockCap: number;
  /** Citizens kept out on their round = total occupancy ÷ this (bigger → fewer out → lighter). */
  citizenOutDivisor: number;
  spawnPerSubstep: number;
}

// Live agent/render perf ceilings — the "fast PC vs slow PC" knob, mutated at runtime by the settings
// menu (main wires applyLiveCaps from the persisted store; settings.ts owns the shape/presets/clamp).
// Defaults ARE today's shipped magnitudes (== settings' `medium` preset). pedCap is the only HARD
// ceiling (perf safety); the operative citizen target is occupancy/citizenOutDivisor (spawnTargetFor).
export const liveCaps: LiveCaps = {
  carCap: 200,
  pedCap: 1200,
  flockCap: 32,
  citizenOutDivisor: 3,
  spawnPerSubstep: 4,
};

/** Apply a (partial) set of live caps — the single runtime mutation seam the settings menu drives. */
export function applyLiveCaps(caps: Partial<LiveCaps>): void {
  Object.assign(liveCaps, caps);
}
