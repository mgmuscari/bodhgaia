// C1 — the one money formatter (pins the outputs the budget panel, the economy line and the
// tool menu printed before they shared it; byte-identical, incl. the U+2212 minus sign).

import { describe, it, expect } from 'vitest';
import { MINUS, money, perHour } from '../../src/ui/moneyFormat';

describe('money', () => {
  it('formats whole dollars with thousands separators', () => {
    expect(money(0)).toBe('$0');
    expect(money(7)).toBe('$7');
    expect(money(6000)).toBe('$6,000');
    expect(money(12345.6)).toBe('$12,346');
    expect(money(1234567)).toBe('$1,234,567');
  });

  it('puts a true minus sign (U+2212) before the dollar sign for negatives', () => {
    expect(MINUS).toBe('−');
    expect(money(-2500)).toBe('−$2,500');
    expect(money(-0.4)).toBe('−$0'); // sign from the raw value, magnitude rounded
  });
});

describe('perHour', () => {
  it('shows a zero rate as $0/h, unsigned', () => {
    expect(perHour(0)).toBe('$0/h');
    expect(perHour(0.4)).toBe('$0/h');
    expect(perHour(-0.4)).toBe('$0/h');
  });

  it('signs a non-zero rate explicitly, with thousands separators', () => {
    expect(perHour(18)).toBe('+$18/h');
    expect(perHour(-18)).toBe('−$18/h');
    expect(perHour(1234.5)).toBe('+$1,235/h');
    expect(perHour(-98765)).toBe('−$98,765/h');
  });
});
