// Controls reference (PURE — the canonical keybinding + pointer list and its formatter). The single
// source of truth the on-screen help panel and the persistent hint both read, so the game's controls
// are DISCOVERABLE instead of secret. No DOM / no transcendental Math → on the pure-ui allowlist.
// The keys are bound in keyMap.ts (the one key table; its test checks both directions: every key listed here
// is bound, and every bound action is listed here).

export interface KeyBinding {
  /** The display key (single char / symbol). Letter keys are bound case-insensitively. */
  key: string;
  label: string;
}

/** Toggle keys, in the order they read in the help panel. Mirrors keyMap.ts. */
export const CONTROLS: KeyBinding[] = [
  { key: ',', label: 'Settings menu' },
  { key: 'B', label: 'Budget' },
  { key: 'S', label: 'Saves' },
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

/** Touch gestures — the whole of "how do I play this" on a touch screen, which has no keys or mouse. */
export const TOUCH_HINTS: string[] = [
  'Drag — pan the map',
  'Pinch — zoom in/out',
  'Tap — use the selected tool',
];

/** The help panel's entry point: names its key, except on a touch screen. */
export function controlsHint(touch = false): string {
  return touch ? 'Controls' : '⌨ Controls  ?';
}

/** One aligned `key  label` line per binding, then the pointer hints — the help-panel body. On a touch screen, the
 *  touch gestures alone (Maddy 2026-10-08: no shortcut keys rendered on mobile). */
export function controlsLines(touch = false): string[] {
  if (touch) return TOUCH_HINTS;
  const keyWidth = CONTROLS.reduce((w, b) => Math.max(w, b.key.length), 0);
  const keyed = CONTROLS.map((b) => `${b.key.padStart(keyWidth)}  ${b.label}`);
  return [...keyed, ...POINTER_HINTS];
}

/** Settings' note on when the sound starts: a click or key press, or on a touch screen a tap. */
export function soundStartNote(touch = false): string {
  return touch
    ? 'Sound starts after your first tap (the browser asks for that).'
    : 'Sound starts after your first click or key press (the browser asks for that).';
}
