import { describe, it, expect } from 'vitest';
import { KEY_BINDINGS, resolveKey, overlayKindOf, isEditableTarget, panFor, type KeyAction } from '../../src/ui/keyMap';
import { CONTROLS } from '../../src/ui/controlsContent';

const press = (key: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) => ({
  key,
  metaKey: mods.metaKey ?? false,
  ctrlKey: mods.ctrlKey ?? false,
  altKey: mods.altKey ?? false,
});

// Every game key bound in main.ts / techPanel.ts before the table existed — the table must keep them all.
const EXPECTED: [string, KeyAction][] = [
  ['e', 'overlay:eco'],
  ['c', 'overlay:civic'],
  ['r', 'overlay:redline'],
  ['p', 'overlay:police'],
  ['v', 'overlay:coverage'],
  ['u', 'overlay:power'],
  ['b', 'budget'],
  ['o', 'saves'], // Maddy 2026-10-13: WASD pans, so Saves moved off S
  ['l', 'life'],
  ['g', 'restore'],
  [',', 'settings'],
  ['?', 'help'],
  ['h', 'help'],
  ['t', 'tech'],
];

describe('resolveKey: the one keyboard table', () => {
  it('resolves every currently-bound key (both cases for letters) to its action', () => {
    for (const [key, action] of EXPECTED) {
      expect(resolveKey(press(key), false)).toBe(action);
      if (key.toUpperCase() !== key) expect(resolveKey(press(key.toUpperCase()), false)).toBe(action);
    }
  });

  it('never matches with Cmd / Ctrl / Alt held — browser shortcuts pass through (the Cmd+L bug)', () => {
    for (const key of ['l', 'L', 'g', ',', 'b', 'o', 'r', 't', 'h', '?']) {
      expect(resolveKey(press(key, { metaKey: true }), false)).toBeNull();
      expect(resolveKey(press(key, { ctrlKey: true }), false)).toBeNull();
      expect(resolveKey(press(key, { altKey: true }), false)).toBeNull();
    }
  });

  it('resolves nothing while the opening overlay is up', () => {
    for (const [key] of EXPECTED) expect(resolveKey(press(key), true)).toBeNull();
  });

  it('ignores unbound keys', () => {
    for (const key of ['x', 'i', 'Escape', 'Enter', 'ArrowLeft', '', '1']) {
      expect(resolveKey(press(key), false)).toBeNull();
    }
  });

  it('binds no key twice', () => {
    const all = KEY_BINDINGS.flatMap((b) => b.keys);
    expect(new Set(all).size).toBe(all.length);
  });

  it('binds every key the help panel documents', () => {
    for (const c of CONTROLS) expect(resolveKey(press(c.key), false)).not.toBeNull();
  });

  it('documents every bound action in the help panel (B Budget, S Saves, …)', () => {
    const documented = new Set(CONTROLS.map((c) => c.key.toLowerCase()));
    for (const b of KEY_BINDINGS) {
      expect(b.keys.some((k) => documented.has(k.toLowerCase())), `${b.action} (${b.keys.join('/')})`).toBe(true);
    }
  });

  it('maps overlay actions to their overlay kind, others to null', () => {
    expect(overlayKindOf('overlay:redline')).toBe('redline');
    expect(overlayKindOf('overlay:power')).toBe('power');
    expect(overlayKindOf('budget')).toBeNull();
    expect(overlayKindOf('tech')).toBeNull();
  });

  it('takes a custom table', () => {
    expect(resolveKey(press('q'), false, [{ keys: ['q'], action: 'help' }])).toBe('help');
    expect(resolveKey(press('l'), false, [{ keys: ['q'], action: 'help' }])).toBeNull();
  });

  it('resolves nothing while the user is typing in an editable target (the Settings number-box bug)', () => {
    const targets = [
      { tagName: 'INPUT', type: 'number' },
      { tagName: 'INPUT', type: 'text' },
      { tagName: 'INPUT' }, // no type → text
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
    ];
    for (const target of targets) {
      for (const [key] of EXPECTED) expect(resolveKey({ ...press(key), target }, false)).toBeNull();
    }
  });

  it('still resolves on non-text targets (body, canvas, a focused slider/checkbox/button)', () => {
    const targets = [
      null,
      undefined,
      { tagName: 'BODY' },
      { tagName: 'CANVAS' },
      { tagName: 'BUTTON' },
      { tagName: 'INPUT', type: 'range' },
      { tagName: 'INPUT', type: 'checkbox' },
      { tagName: 'INPUT', type: 'file' },
      { tagName: 'DIV', isContentEditable: false },
    ];
    for (const target of targets) expect(resolveKey({ ...press('b'), target }, false)).toBe('budget');
  });
});

describe('isEditableTarget', () => {
  it('is true for text-entry controls and contenteditable, false otherwise', () => {
    expect(isEditableTarget({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isEditableTarget({ tagName: 'input', type: 'search' })).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SPAN', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'radio' })).toBe(false);
    expect(isEditableTarget({ tagName: 'CANVAS' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget('INPUT')).toBe(false);
  });
});

// Maddy 2026-10-13: "ASDW for scrolling". The arrows and WASD pan the map the same way; W/A/S/D are no toggle key.
describe('panFor: the panning keys', () => {
  it('WASD pan as the arrows do, either case', () => {
    expect(panFor('w')).toEqual(panFor('ArrowUp'));
    expect(panFor('A')).toEqual(panFor('ArrowLeft'));
    expect(panFor('s')).toEqual(panFor('ArrowDown'));
    expect(panFor('D')).toEqual(panFor('ArrowRight'));
    expect(panFor('ArrowUp')![1]).toBeGreaterThan(0); // the map moves down: the view goes up
    expect(panFor('ArrowLeft')![0]).toBeGreaterThan(0);
  });
  it('other keys pan nothing, and no panning key is a toggle key', () => {
    expect(panFor('e')).toBeNull();
    for (const k of ['w', 'a', 's', 'd', 'W', 'A', 'S', 'D']) expect(resolveKey(press(k), false)).toBeNull();
  });
});

// Maddy 2026-10-13: "WASD scrolling should be smooth, not jumpy". Held panning keys give a velocity the camera moves
// by every frame (not a 48 px hop per key repeat); two held at once go diagonally at the same speed.
import { panVelocity, KEY_PAN_SPEED } from '../../src/ui/keyMap';
describe('panVelocity: held panning keys', () => {
  it('nothing held, no motion', () => {
    expect(panVelocity(new Set())).toEqual([0, 0]);
    expect(panVelocity(new Set(['e']))).toEqual([0, 0]);
  });
  it('one key: full speed its way, WASD as the arrows', () => {
    expect(panVelocity(new Set(['w']))).toEqual([0, KEY_PAN_SPEED]);
    expect(panVelocity(new Set(['ArrowLeft']))).toEqual([KEY_PAN_SPEED, 0]);
  });
  it('two at once go diagonally at the same speed; opposite keys cancel', () => {
    const [vx, vy] = panVelocity(new Set(['w', 'd']));
    expect(Math.hypot(vx, vy)).toBeCloseTo(KEY_PAN_SPEED, 5);
    expect(panVelocity(new Set(['a', 'd']))).toEqual([0, 0]);
  });
  it('a key and its arrow twin count once', () => {
    expect(panVelocity(new Set(['w', 'ArrowUp', 'W']))).toEqual([0, KEY_PAN_SPEED]);
  });
});
