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
    expect(lines.join(' ')).toMatch(/pinch/);
    expect(lines.join(' ')).toMatch(/Two fingers — move the map/); // Maddy 2026-10-21: one finger builds, two scroll
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

import { soundStartNote } from '../../src/ui/controlsContent';
describe('the sound note names no key on touch', () => {
  it('a click or key press on a keyboard; a tap on touch', () => {
    expect(soundStartNote(false)).toMatch(/click or key press/);
    expect(soundStartNote(true)).toMatch(/tap/);
    expect(soundStartNote(true)).not.toMatch(/key|click/);
  });
});

// Maddy 2026-10-21: "better UI tutorial messages on mobile, to be triggered on first mobile play or for an updating
// mobile client" — a phone guide, shown on a touch screen until its version has been seen.
import { PHONE_TIPS, PHONE_TIPS_VERSION, phoneTipsDue } from '../../src/ui/controlsContent';
describe('the phone guide', () => {
  it('teaches the gestures and where the tools are, naming no key or mouse', () => {
    const text = PHONE_TIPS.join(' ');
    expect(text).toMatch(/Two fingers/);
    expect(text).toMatch(/lift to build/);
    expect(text).toMatch(/swipe/i);
    expect(text).not.toMatch(/click|Esc|key/i);
  });
  it('shows on a touch screen that has not seen this version of it — first play, or a client that updated it', () => {
    expect(phoneTipsDue(true, null)).toBe(true);
    expect(phoneTipsDue(true, String(PHONE_TIPS_VERSION - 1))).toBe(true);
    expect(phoneTipsDue(true, String(PHONE_TIPS_VERSION))).toBe(false);
    expect(phoneTipsDue(true, 'garbage')).toBe(true);
  });
  it('never on a desktop', () => {
    expect(phoneTipsDue(false, null)).toBe(false);
  });
});
