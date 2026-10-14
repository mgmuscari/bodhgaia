// Release notes (PURE — no DOM, no transcendental Math; on the pure-ui allowlist). Maddy 2026-10-13: "changelogs for
// new releases that display the next time a player launches the game if their browser/pwa sees a new version".
// One list, newest first, in the player's words; a release isn't done until its version has an entry here (the test
// reads package.json). whatsNew picks what a returning player hasn't seen; the shell (whatsNewPanel.ts) shows it.

export interface ChangelogEntry {
  version: string;
  notes: readonly string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '1.0.15',
    notes: [
      'Overlays have menus: Eco and Civic list their views beside their buttons. Closing a menu, or opening another, puts the tool down and the overlay away.',
      'Bulldoze and Inspect put a building tool down; opening a building category puts them down. Esc, a right click or a long press clears everything.',
      'WASD scrolls the map, gliding smoothly. Saves moved to O.',
      'Bulldozing costs money now, and leaves a vacant lot. It grows back to open land as its soil heals — faster with a garden, park or rewilded land nearby.',
      'Rail crossings are only where you lay track across a road. Trains stop at every station on every pass.',
      'Elevated rail over a street runs trains, with stations where a street passes under; cars and people pass beneath it.',
      'Households keep their cars at the kerb near home. Near a transit stop, they give them up over time.',
      'Mutual Aid builds shelters: beds for the people in the camps nearby, safe from the cold.',
      'Community AI Nodes clean up the industry around them.',
      'Big workplaces get a parking lot at the door. Streets grow trees with Walkable Streets, and bike racks with Bike Shares.',
      'A driver stuck in a jam twice may leave the car and walk.',
      'The music’s held notes are softer. A building’s whole footprint shows as you place it.',
      'What’s new shows here, the first time you play a new version.',
    ],
  },
  {
    version: '1.0.14',
    notes: [
      'Clinics send ambulances: someone who collapses has a minute to be saved.',
      'Fire trucks and ambulances share their own siren.',
    ],
  },
];

/** Compare two dotted versions numerically: < 0 if a is older, 0 if the same, > 0 if newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** What a player who last saw `lastSeen` should be shown on `current`: every release after it, up to the running one,
 *  newest first. Nothing for a first-time player (nothing seen) or one already up to date. */
export function whatsNew(lastSeen: string | null, current: string, list: readonly ChangelogEntry[] = CHANGELOG): ChangelogEntry[] {
  if (lastSeen === null || compareVersions(lastSeen, current) >= 0) return [];
  return list.filter((e) => compareVersions(e.version, lastSeen) > 0 && compareVersions(e.version, current) <= 0);
}
