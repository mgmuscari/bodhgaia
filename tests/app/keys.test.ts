import { describe, it, expect } from 'vitest';
import { installKeys, type KeyTarget } from '../../src/app/keys';
import type { OverlayKind } from '../../src/ui/overlayRegistry';
import type { PanelId } from '../../src/app/panels';

// The key dispatch: ONE keydown listener resolved through the pure key table (src/ui/keyMap.ts) and routed to
// the same closures the dock buttons call — overlay → cycle, life → toggle, panel id → registry toggle.

type Listener = (e: FakeKey) => void;
interface FakeKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target?: unknown;
  prevented: boolean;
  preventDefault(): void;
}

function harness(opts: { opening?: boolean } = {}) {
  const listeners: { type: string; fn: Listener }[] = [];
  const target: KeyTarget = {
    addEventListener: (type, fn) => listeners.push({ type, fn: fn as unknown as Listener }),
  };
  const calls: string[] = [];
  let opening = opts.opening ?? false;
  installKeys({
    target,
    openingUp: () => opening,
    cycleOverlay: (k: OverlayKind) => calls.push(`overlay:${k}`),
    toggleLife: () => calls.push('life'),
    togglePanel: (id: PanelId) => calls.push(`panel:${id}`),
  });
  const press = (key: string, mods: Partial<Pick<FakeKey, 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>> = {}): FakeKey => {
    const e: FakeKey = {
      key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...mods,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    for (const l of listeners) if (l.type === 'keydown') l.fn(e);
    return e;
  };
  return { listeners, calls, press, dismissOpening: () => (opening = false) };
}

describe('installKeys', () => {
  it('installs exactly one keydown listener', () => {
    const h = harness();
    expect(h.listeners.map((l) => l.type)).toEqual(['keydown']);
  });

  it('routes overlays, life and panels to their closures and prevents default on a match', () => {
    const h = harness();
    expect(h.press('e').prevented).toBe(true);
    h.press('U');
    h.press('l');
    h.press('b');
    h.press('?');
    h.press(',');
    h.press('g');
    expect(h.calls).toEqual(['overlay:eco', 'overlay:power', 'life', 'panel:budget', 'panel:help', 'panel:settings', 'panel:restore']);
  });

  it('lets unbound keys and modifier chords through untouched', () => {
    const h = harness();
    expect(h.press('z').prevented).toBe(false);
    expect(h.press('l', { metaKey: true }).prevented).toBe(false);
    expect(h.press('g', { ctrlKey: true }).prevented).toBe(false);
    expect(h.press(',', { altKey: true }).prevented).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('skips keys typed into an editable field', () => {
    const h = harness();
    expect(h.press('s', { target: { tagName: 'INPUT', type: 'number' } }).prevented).toBe(false);
    expect(h.calls).toEqual([]);
    h.press('s', { target: { tagName: 'INPUT', type: 'checkbox' } });
    expect(h.calls).toEqual(['panel:saves']);
  });

  it('swallows nothing under the opening, then works once it is dismissed (read at key time)', () => {
    const h = harness({ opening: true });
    expect(h.press('b').prevented).toBe(false);
    expect(h.calls).toEqual([]);
    h.dismissOpening();
    h.press('b');
    expect(h.calls).toEqual(['panel:budget']);
  });
});
