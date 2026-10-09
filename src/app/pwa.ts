// App shell: register the service worker (scripts/pwa.ts writes it at build) — in a production build only, so the dev
// server is never served stale from a cache. It caches the build for offline play and asks the site for the page
// first, so an installed copy picks up a new release on its next launch (Maddy 2026-10-08). Never reloads a running
// city: a new release applies next time.

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // relative: the game is published under a subpath, and the worker's scope is the folder it lives in.
  // updateViaCache 'none': the browser checks the site's sw.js itself, never an HTTP-cached copy.
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
}
