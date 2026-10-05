// Release: the built page must work under a SUBPATH of the author's site (e.g. /bodhi/), so every asset
// URL Vite emits has to be relative, not rooted at '/'.
import { describe, expect, it } from 'vitest';
import config from '../vite.config';

describe('vite config (release)', () => {
  it("emits relative asset URLs (base './') so the page works under any subpath", () => {
    expect((config as { base?: string }).base).toBe('./');
  });
});
