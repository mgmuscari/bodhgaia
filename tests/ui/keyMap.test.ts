import { describe, it, expect } from 'vitest';
import { KEY_BINDINGS, resolveKey, overlayKindOf, isEditableTarget, type KeyAction } from '../../src/ui/keyMap';
import { compositeKeyFor } from '../../src/ui/civicOverlayContent';
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
  ['s', 'saves'],
  ['l', 'life'],
  ['g', 'restoration'],
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
    for (const key of ['l', 'L', 'g', ',', 'b', 's', 'r', 't', 'h', '?']) {
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

  it('agrees with compositeKeyFor on the overlay keys', () => {
    for (const b of KEY_BINDINGS) {
      for (const k of b.keys) {
        const kind = compositeKeyFor(k, false);
        if (b.action.startsWith('overlay:')) expect(`overlay:${kind}`).toBe(b.action);
        else expect(kind).toBeNull();
      }
    }
  });

  it('binds every key the help panel documents', () => {
    for (const c of CONTROLS) expect(resolveKey(press(c.key), false)).not.toBeNull();
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
