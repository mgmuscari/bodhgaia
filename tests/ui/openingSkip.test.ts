// Maddy 2026-10-08 (mobile): no "Esc to skip" on a touch screen — and with no Esc there, the opening needs its own way
// out: a Skip button in the hint's place.
import { describe, expect, it } from 'vitest';
import { skipControl } from '../../src/ui/openingScript';

describe('skipping the opening', () => {
  it('a keyboard gets the hint', () => {
    expect(skipControl(false)).toEqual({ kind: 'hint', text: 'Esc to skip' });
  });
  it('a touch screen gets a button, naming no key', () => {
    const c = skipControl(true);
    expect(c.kind).toBe('button');
    expect(c.text).toBe('Skip');
  });
});
