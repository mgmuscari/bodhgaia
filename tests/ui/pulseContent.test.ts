import { describe, it, expect } from 'vitest';
import { pulseLine } from '../../src/ui/pulseContent';

// pulseContent is pure presentation (allowlisted, DOM-free): the always-on dock
// pulse line over the effort-composite wellbeing scalar, with a trend glyph
// comparing the current wellbeing to the previous civic-cadence wellbeing.

describe('pulseLine', () => {
  it('shows the wellbeing scalar with a flat arrow when there is no prior (null)', () => {
    expect(pulseLine(42, null)).toBe('Wellbeing 42 →');
  });

  it('is flat when wellbeing is unchanged', () => {
    expect(pulseLine(42, 42)).toBe('Wellbeing 42 →');
  });

  it('rises (↗) when the current wellbeing exceeds the previous', () => {
    expect(pulseLine(45, 42)).toBe('Wellbeing 45 ↗');
  });

  it('falls (↘) when the current wellbeing is below the previous', () => {
    expect(pulseLine(38, 42)).toBe('Wellbeing 38 ↘');
  });

  it('labels N with the composite wellbeing passed in (not a civic mean)', () => {
    expect(pulseLine(7, null)).toContain('Wellbeing 7');
    expect(pulseLine(123, 100)).toContain('Wellbeing 123');
  });

  it('never shows a spurious arrow on the first cadence (null → flat, not ↗)', () => {
    expect(pulseLine(0, null)).toBe('Wellbeing 0 →');
    expect(pulseLine(99, null)).not.toContain('↗');
    expect(pulseLine(99, null)).not.toContain('↘');
  });
});

// Maddy 2026-10-08: "on mobile, the header with money/etc is too wide for the screen, text is cut off". The line is
// shown as its segments, which wrap onto two rows on a narrow screen.
import { pulseSegments } from '../../src/ui/pulseContent';
import { readFileSync } from 'node:fs';
import { TOPBAR_H } from '../../src/ui/layout';

describe('the top bar on a narrow screen', () => {
  it('splits the line into its segments, each whole', () => {
    expect(pulseSegments('$3,691,431 (+2728/h)  ·  Effort 68716/79821  ·  Wellbeing 157 →  ·  Unhoused 1345 ↓')).toEqual([
      '$3,691,431 (+2728/h)',
      'Effort 68716/79821',
      'Wellbeing 157 →',
      'Unhoused 1345 ↓',
    ]);
  });

  it('on a narrow screen the segments wrap onto two rows that fit inside the bar', () => {
    const css = readFileSync('index.html', 'utf8');
    const narrow = /@media \(max-width: (\d+)px\) \{\s*\.pulse-dock \{([^}]*)\}/.exec(css);
    expect(narrow, 'a narrow-screen rule for the bar').not.toBeNull();
    expect(Number(narrow![1])).toBeGreaterThanOrEqual(700);
    const rule = narrow![2]!;
    expect(rule).toMatch(/flex-wrap:\s*wrap/);
    expect(rule).toMatch(/white-space:\s*normal/);
    const size = Number(/font-size:\s*([\d.]+)px/.exec(rule)![1]);
    const lh = Number(/line-height:\s*([\d.]+);/.exec(rule)![1]);
    expect(2 * size * lh).toBeLessThanOrEqual(TOPBAR_H - 2 * 10); // two rows inside the 10-px frame
  });
});
