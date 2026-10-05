// Controls reference (PURE — the canonical keybinding + pointer list and its formatter). The single
// source of truth the on-screen help panel and the persistent hint both read, so the game's controls
// are DISCOVERABLE instead of secret. No DOM / no transcendental Math → on the pure-ui allowlist.
// The keys are bound in keyMap.ts (the one key table; its test checks every key listed here is bound).

export interface KeyBinding {
  /** The display key (single char / symbol). Letter keys are bound case-insensitively. */
  key: string;
  label: string;
}

/** Toggle keys, in the order they read in the help panel. Mirrors keyMap.ts. */
export const CONTROLS: KeyBinding[] = [
  { key: ',', label: 'Settings menu' },
  { key: 'T', label: 'Tech tree' },
  { key: 'L', label: 'Ambient life on/off' },
  { key: 'G', label: 'Restoration readout' },
  { key: 'E', label: 'Ecology overlay' },
  { key: 'C', label: 'Civic overlay' },
  { key: 'R', label: 'Redlining (HOLC) overlay' },
  { key: 'P', label: 'Police-violence overlay' },
  { key: 'V', label: 'Civic-services overlay' },
  { key: 'U', label: 'Power overlay' },
  { key: '?', label: 'This help' },
];

/** Mouse interactions — not keys, but part of "how do I play this". */
export const POINTER_HINTS: string[] = [
  'Drag — pan the map',
  'Scroll — zoom in/out',
  'Click — use the selected tool',
];

/** One aligned `key  label` line per binding, then the pointer hints — the help-panel body. */
export function controlsLines(): string[] {
  const keyWidth = CONTROLS.reduce((w, b) => Math.max(w, b.key.length), 0);
  const keyed = CONTROLS.map((b) => `${b.key.padStart(keyWidth)}  ${b.label}`);
  return [...keyed, ...POINTER_HINTS];
}
