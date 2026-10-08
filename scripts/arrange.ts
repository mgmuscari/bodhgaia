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
  'satie-gymnopedie-2': { style: 'waltz', title: 'Gymnopédie No. 2', lead: 59, counter: 65, comp: 4, pad: 48, colour: 11, bass: 32, bells: 8 },
  'satie-gymnopedie-3': { style: 'waltz', title: 'Gymnopédie No. 3', lead: 77, counter: 71, comp: 24, pad: 89, colour: 8, bass: 32, bells: 14 },
  'satie-gnossienne-1': { style: 'ballad', title: 'Gnossienne No. 1', lead: 71, counter: 68, comp: 4, pad: 48, colour: 11, bass: 32, bells: 8 },
  'debussy-clair-de-lune': { style: 'ballad', title: 'Clair de lune', lead: 73, counter: 71, comp: 4, pad: 48, colour: 46, bass: 32, bells: 8 },
  'debussy-arabesque-1': { style: 'bossa', title: 'Première Arabesque', lead: 73, counter: 71, comp: 24, pad: 89, colour: 8, bass: 32, bells: 14 },
  'bach-wtc1-prelude-1': { style: 'bossa', title: 'Prelude No. 1 in C major', lead: 11, counter: 73, comp: 24, pad: 89, colour: 8, bass: 32, bells: 14 },
  'bach-prelude-bwv999': { style: 'waltz', title: 'Prelude in D minor, BWV 999', lead: 71, counter: 73, comp: 4, pad: 48, colour: 11, bass: 32, bells: 8 },
  'chopin-nocturne-op9-no3': { style: 'ballad', title: 'Nocturne in B major, Op. 9 No. 3', lead: 65, counter: 59, comp: 4, pad: 48, colour: 11, bass: 32, bells: 8 },
  'chopin-nocturne-op72-no1': { style: 'swing', title: 'Nocturne in E minor, Op. 72 No. 1', lead: 59, counter: 65, comp: 4, pad: 48, colour: 11, bass: 32, bells: 8 },
  'field-nocturne-h37': { style: 'ballad', title: 'Nocturne No. 5 in B-flat major', lead: 60, counter: 71, comp: 4, pad: 48, colour: 46, bass: 32, bells: 8 },
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
