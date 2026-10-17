// One command for the whole pipeline:
//   npm run tutorials -- <slug> [<slug>…]      or      npm run tutorials -- all
//   npm run tutorials -- all --only=narrate,metadata   (skip recording, e.g. when only text changed)
//   npm run tutorials -- all --seed                    (re-seed the local demo account before each recording)
import { execFileSync } from 'node:child_process';
import { allSlugs, loadTutorial } from './lib.mjs';
import { narrate, prefetchVoices } from './narrate.mjs';
import { record } from './record.mjs';
import { compose } from './compose.mjs';
import { metadata } from './metadata.mjs';

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const wanted = args.filter((a) => !a.startsWith('--'));
const slugs = wanted.includes('all') || wanted.length === 0 ? allSlugs() : wanted;
const run = (step) => !only || only.has(step);
const seedAlways = args.includes('--seed');

// Tutorials that stage edits (AI title, bulk AI…) save drafts in the demo account, so a second recording
// would start from a different screen. `reseed: true` in the YAML (or --seed) resets the demo account first.
// The seed refuses to run against anything but a localhost database.
function reseed() {
  console.log('  re-seeding the local demo account…');
  execFileSync('npx', ['tsx', 'scripts/demo/seed-demo-account.ts'], { stdio: ['ignore', 'ignore', 'inherit'] });
}

const failed = [];
// Several tutorials: voice all their missing lines first, in shared batches (the free TTS tier allows ~10
// requests a day). A failure here is not fatal; each tutorial retries its own lines below.
if (run('narrate') && slugs.length > 1) {
  try { await prefetchVoices(slugs); } catch (e) { console.error(`✗ voice prefetch: ${e.message}`); }
}
for (const slug of slugs) {
  console.log(`\n▶ ${slug}`);
  try {
    if (run('narrate')) await narrate(slug);
    if (run('record')) {
      if (seedAlways || loadTutorial(slug).reseed) reseed();
      await record(slug);
    }
    if (run('compose')) await compose(slug);
    if (run('metadata')) metadata(slug);
  } catch (e) {
    console.error(`✗ ${slug}: ${e.message}`);
    failed.push(slug);
  }
}
if (failed.length) { console.error(`\nFailed: ${failed.join(', ')}`); process.exit(1); }
console.log('\nDone.');
