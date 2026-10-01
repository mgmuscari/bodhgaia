import { describe, it, expect } from 'vitest';
import { economyLine } from '../../src/ui/economyContent';

describe('economyLine — the top bar readout', () => {
  const base = { funds: 12345.6, fundsPerHour: -18.4, effort: 640.2, capacity: 1801, approval: 52.4, goodwill: 54.1, burnout: 0 };
  it('shows funds with their hourly trend, effort against capacity, approval and trust', () => {
    expect(economyLine(base)).toBe('$12,346 (−18/h)  ·  Effort 640/1801  ·  Approval 52%  ·  Trust 54');
  });
  it('a surplus reads with a plus sign; burnout shows only when people are tired', () => {
    expect(economyLine({ ...base, fundsPerHour: 7 })).toContain('(+7/h)');
    expect(economyLine(base)).not.toContain('Tired');
    expect(economyLine({ ...base, burnout: 0.35 })).toContain('Tired 35%');
  });
  it('debt reads as debt', () => {
    expect(economyLine({ ...base, funds: -2500 })).toContain('−$2,500');
  });
});
