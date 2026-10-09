import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { pwa } from './scripts/pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // the release the credits name (src/ui/creditsContent.ts)
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Relative asset URLs: the built page is published under a subpath of the author's site, not at '/'.
  base: './',
  // installable: manifest, icons and a service worker that caches the build and checks the site for updates
  plugins: [pwa(pkg.version)],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
