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
    version: '1.1.0',
    notes: [
      'Neighbourhood health: one score for each neighbourhood — its belonging, voice and trust, its ground, how well its buildings are kept, work within reach, care and food. The Civic overlay opens on it.',
      'Budget now shows how many people have work, how well buildings are kept, and how people get around, with which way each is heading.',
      'Food, from field to table: urban farms (Urban Farms), food banks (Mutual Aid) and pantries (Shared Table). Harvests go to the pantries and banks, the banks send vans out to the pantries, and the pantries feed the homes around them.',
      'Maker spaces and industry work together: makers near the works reach further and mend twice as fast, and the works poisons its ground half as much.',
      'Community AI Nodes are drone hubs. With Drone Deliveries, some of the shopping near a node is flown to people instead of driven.',
      'Some buildings work together — a library and a school, a compost hub and a farm, a food bank and an AI node. Build one near its partner and both get a bonus; placing a building shows what it pairs with.',
      'Schools give their neighbourhood a voice and teach more each day. Children walk to school in the morning and home in the afternoon.',
      'A boosted building wears a sparkle. Inspect it to see why.',
      'Building status (K) dims the map to the buildings wearing a badge — no power, a home suffering or thriving, boosted — with a key to each.',
      'Overlay colours spread across the values on your map, so differences show; the key names the range.',
      'New lessons for food, makers, drones and buildings that work together, one at a time as you unlock them.',
    ],
  },
  {
    version: '1.0.16',
    notes: [
      'Drivers abandon their cars in jams far less often. When one does, the car pulls over to the kerb, out of the way, and is towed soon after.',
    ],
  },
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
