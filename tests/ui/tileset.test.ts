import { describe, it, expect } from 'vitest';
import { iconKey, edgeKey } from '../../src/ui/tileset';

describe('reserved @ key namespaces (never drawn as tiles)', () => {
  it('iconKey namespaces status icons under @icon/', () => {
    expect(iconKey('unpowered')).toBe('@icon/unpowered');
    expect(iconKey('unpowered').startsWith('@')).toBe(true); // tile keys start with a letter
  });

  it('edgeKey namespaces terrain edge overlays under @edge/', () => {
    expect(edgeKey('shore', 5).startsWith('@edge/')).toBe(true);
  });
});
