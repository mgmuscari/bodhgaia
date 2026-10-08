import { describe, it, expect } from 'vitest';
import { unhousedSuffix } from '../../src/ui/unhousedContent';

describe('unhousedSuffix — down-is-good indicator', () => {
  it('no prior sample → bare count, no arrow', () => {
    expect(unhousedSuffix(12, null)).toBe('Unhoused 12');
  });
  it('fewer unhoused reads ↓ (housing is working)', () => {
    expect(unhousedSuffix(8, 12)).toBe('Unhoused 8 ↓');
  });
  it('more unhoused reads ↑ (displacement worsening)', () => {
    expect(unhousedSuffix(15, 12)).toBe('Unhoused 15 ↑');
  });
  it('unchanged → no arrow', () => {
    expect(unhousedSuffix(12, 12)).toBe('Unhoused 12');
  });
});
