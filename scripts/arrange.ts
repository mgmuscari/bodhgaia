// Arrange the classical pieces as ensembles (src/audio/music/arrange.ts) — run at authoring time:
//   node scripts/arrange.ts [id ...]        (no ids: every planned piece)
// Reads each piece's original from assets/music-originals/ (kept so a re-arrangement starts from the score) and
// writes the arrangement over public/music/<id>.mid.
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { arrange, type Arrangement } from '../src/audio/music/arrange.ts';

// GM: 4 e.piano, 8 celesta, 11 vibes, 24 nylon guitar, 32 acoustic bass, 48 strings, 59 muted trumpet,
// 60 horn, 65 alto sax, 71 clarinet, 73 flute, 77 shakuhachi, 89 warm pad
export const PLANS: Record<string, Arrangement> = {
  'satie-gymnopedie-1': { style: 'waltz', title: 'Gymnopédie No. 1', lead: 73, counter: 71, comp: 4, pad: 48, colour: 11, bass: 32, bells: 8 },
};

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PLANS);
mkdirSync('assets/music-originals', { recursive: true });
for (const id of ids) {
  const plan = PLANS[id];
  if (!plan) throw new Error(`no plan for ${id}`);
  const original = `assets/music-originals/${id}.mid`;
  if (!existsSync(original)) copyFileSync(`public/music/${id}.mid`, original);
  const out = arrange(new Uint8Array(readFileSync(original)), plan);
  writeFileSync(`public/music/${id}.mid`, out);
  console.log(`${id}: ${out.length} bytes (${plan.style})`);
}
