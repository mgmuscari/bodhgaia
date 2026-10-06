// The one keyboard table (PURE — no DOM). Every game toggle key lives here; main.ts installs ONE keydown
// listener that resolves through it and dispatches. The gate is uniform: nothing matches with Cmd / Ctrl /
// Alt held (so Cmd+L, Cmd+G, Cmd+, … reach the browser), nothing matches while the opening overlay is up, and
// nothing matches while the user is typing in a text field (the Settings number box, …).
// Keys the camera owns (arrows, I/X/Escape) stay in input.ts; the help text lives in controlsContent.ts.

import type { OverlayKind } from './overlayRegistry';

export type KeyAction =
  | `overlay:${OverlayKind}`
  | 'budget'
  | 'saves'
  | 'life'
  | 'restoration'
  | 'settings'
  | 'help'
  | 'tech';

export interface KeyBindingEntry {
  /** Exact `KeyboardEvent.key` values (list both cases for letters). */
  keys: string[];
  action: KeyAction;
}

export const KEY_BINDINGS: readonly KeyBindingEntry[] = [
  { keys: ['e', 'E'], action: 'overlay:eco' },
  { keys: ['c', 'C'], action: 'overlay:civic' },
  { keys: ['r', 'R'], action: 'overlay:redline' },
  { keys: ['p', 'P'], action: 'overlay:police' },
  { keys: ['v', 'V'], action: 'overlay:coverage' },
  { keys: ['u', 'U'], action: 'overlay:power' },
  { keys: ['b', 'B'], action: 'budget' },
  { keys: ['s', 'S'], action: 'saves' },
  { keys: ['l', 'L'], action: 'life' },
  { keys: ['g', 'G'], action: 'restoration' },
  { keys: [','], action: 'settings' },
  { keys: ['?', 'h', 'H'], action: 'help' },
  { keys: ['t', 'T'], action: 'tech' },
];

export interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** The event target (a `KeyboardEvent` passes as-is); typing into an editable one resolves nothing. */
  target?: unknown;
}

// <input> types that take no typed text — keys pressed while one has focus are still game keys.
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** True when `target` takes typed text: a text-like <input>, <textarea>, <select>, or contenteditable. Duck-typed (no DOM). */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const t = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (t.isContentEditable === true) return true;
  const tag = typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = typeof t.type === 'string' ? t.type.toLowerCase() : 'text';
  return !NON_TEXT_INPUT_TYPES.has(type);
}

/** The action a key press triggers, or null (modifier held, opening overlay up, typing in a field, or unbound). */
export function resolveKey(
  ev: KeyPress,
  overlayActive: boolean,
  bindings: readonly KeyBindingEntry[] = KEY_BINDINGS,
): KeyAction | null {
  if (overlayActive || ev.metaKey || ev.ctrlKey || ev.altKey || isEditableTarget(ev.target)) return null;
  for (const b of bindings) if (b.keys.includes(ev.key)) return b.action;
  return null;
}

const OVERLAY_PREFIX = 'overlay:';

/** The overlay dimension an `overlay:*` action cycles, else null. */
export function overlayKindOf(action: KeyAction): OverlayKind | null {
  return action.startsWith(OVERLAY_PREFIX) ? (action.slice(OVERLAY_PREFIX.length) as OverlayKind) : null;
}
