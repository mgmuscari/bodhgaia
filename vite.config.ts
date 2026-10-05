import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs: the built page is published under a subpath of the author's site, not at '/'.
  base: './',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
