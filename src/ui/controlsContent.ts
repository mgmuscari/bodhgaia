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
  { key: 'O', label: 'Saves' },
  { key: 'T', label: 'Tech tree' },
  { key: 'L', label: 'Ambient life on/off' },
  { key: 'G', label: 'Restoration readout' },
  { key: 'E', label: 'Ecology overlay' },
  { key: 'C', label: 'Civic overlay' },
  { key: 'R', label: 'Redlining (HOLC) overlay' },
  { key: 'P', label: 'Police-violence overlay' },
  { key: 'V', label: 'Civic-services overlay' },
  { key: 'U', label: 'Power overlay' },
  { key: 'K', label: 'Building status — what the badges mean' },
  { key: '?', label: 'This help' },
];

/** Mouse interactions — not keys, but part of "how do I play this". */
export const POINTER_HINTS: string[] = [
  'Drag, WASD or arrows — pan the map',
  'Scroll — zoom in/out',
  'Click — use the selected tool',
  'Right-click — drop the tool',
];

/** Touch gestures — the whole of "how do I play this" on a touch screen, which has no keys or mouse. */
export const TOUCH_HINTS: string[] = [
  'Two fingers — move the map, pinch to zoom',
  'One finger, no tool — move the map too',
  'With a tool — tap, or drag to aim and lift to build',
  'Roads, rails, bulldozer — drag to draw',
  'Long press — drop the tool',
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

/** The phone guide (Maddy 2026-10-21): how to play by touch, shown on a touch screen the first time — and again when
 *  this version is bumped, for a phone that updated into a changed interface. Bump it when the touch UI changes. */
export const PHONE_TIPS_VERSION = 1;
export const PHONE_TIPS: string[] = [
  ...TOUCH_HINTS,
  'Tools — the bar of buttons; swipe it sideways for more',
  'A menu opens over its button — tap the button again to close it',
  'Controls — these gestures again, any time',
];
/** Whether the phone guide is due: on a touch screen whose `seen` version (stored; null if never) is older. */
export function phoneTipsDue(touch: boolean, seen: string | null): boolean {
  if (!touch) return false;
  const v = Number(seen);
  return seen === null || !Number.isFinite(v) || v < PHONE_TIPS_VERSION;
}
