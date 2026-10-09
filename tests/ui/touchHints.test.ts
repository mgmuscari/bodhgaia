// Maddy 2026-10-08 (mobile): "anything that has shortcut keys ('esc' to skip etc) should not be rendered on mobile".
// On a touch screen the dock's labels carry no "(B)", and the help panel explains touch, not keys and a mouse.
import { describe, expect, it } from 'vitest';
import { metaButtons } from '../../src/ui/dockContent';
import { controlsLines, controlsHint, TOUCH_HINTS } from '../../src/ui/controlsContent';

describe('no keyboard hints on a touch screen', () => {
  it('dock labels keep their key on a keyboard, and drop it on touch', () => {
    const withKeys = metaButtons(false, null, true, {}, true);
    const touch = metaButtons(false, null, true, {}, false);
    expect(withKeys.find((b) => b.id === 'budget')!.label).toBe('Budget (B)');
    expect(touch.find((b) => b.id === 'budget')!.label).toBe('Budget');
    for (const b of touch) expect(b.label, b.id).not.toMatch(/\(.{1,3}\)$/);
  });

  it('the help panel lists touch gestures on touch — no keys, no mouse', () => {
    const lines = controlsLines(true);
    expect(lines).toEqual(TOUCH_HINTS);
    expect(lines.join(' ')).toMatch(/Pinch/);
    expect(lines.join(' ')).not.toMatch(/Scroll|Click|Esc/);
  });

  it('…and the keys and the mouse on a keyboard, as before', () => {
    expect(controlsLines(false).join(' ')).toMatch(/Budget/);
    expect(controlsLines()).toEqual(controlsLines(false));
  });

  it('the help entry point names no key on touch', () => {
    expect(controlsHint(false)).toMatch(/\?/);
    expect(controlsHint(true)).not.toMatch(/\?|⌨/);
  });
});
