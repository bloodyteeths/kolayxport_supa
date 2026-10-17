// One command for the whole pipeline:
//   npm run tutorials -- <slug> [<slug>…]      or      npm run tutorials -- all
//   npm run tutorials -- all --only=narrate,metadata   (skip recording, e.g. when only text changed)
import { allSlugs } from './lib.mjs';
import { narrate } from './narrate.mjs';
import { record } from './record.mjs';
import { compose } from './compose.mjs';
import { metadata } from './metadata.mjs';

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const wanted = args.filter((a) => !a.startsWith('--'));
const slugs = wanted.includes('all') || wanted.length === 0 ? allSlugs() : wanted;
const run = (step) => !only || only.has(step);

const failed = [];
for (const slug of slugs) {
  console.log(`\n▶ ${slug}`);
  try {
    if (run('narrate')) await narrate(slug);
    if (run('record')) await record(slug);
    if (run('compose')) await compose(slug);
    if (run('metadata')) metadata(slug);
  } catch (e) {
    console.error(`✗ ${slug}: ${e.message}`);
    failed.push(slug);
  }
}
if (failed.length) { console.error(`\nFailed: ${failed.join(', ')}`); process.exit(1); }
console.log('\nDone.');
