/**
 * Merge i18n fragments into messages/en.json and messages/tr.json (owner W5).
 *
 *   npx tsx scripts/i18n/merge-fragments.ts --check        # validate only, writes nothing
 *   npx tsx scripts/i18n/merge-fragments.ts                # write messages/{en,tr}.json
 *   npx tsx scripts/i18n/merge-fragments.ts --out /tmp/x   # write merged files to a scratch dir
 *
 * Exit 1 (listing paths) on a differing existing value or when an en fragment
 * and its tr pair have different key sets. See mergeFragmentsCore.ts.
 */
import fs from 'fs';
import path from 'path';
import { mergeFragments, type FragmentPair, type Json } from './mergeFragmentsCore';

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Json;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : null;
  if (outIdx >= 0 && !outDir) {
    console.error('--out needs a directory');
    process.exit(2);
  }

  const root = process.cwd();
  const messagesDir = path.join(root, 'messages');
  const fragDir = path.join(messagesDir, 'fragments');
  const base = { en: readJson(path.join(messagesDir, 'en.json')), tr: readJson(path.join(messagesDir, 'tr.json')) };

  const pairs = new Map<string, FragmentPair>();
  const files = fs.existsSync(fragDir) ? fs.readdirSync(fragDir) : [];
  for (const f of files) {
    const m = /^(.+)\.(en|tr)\.json$/.exec(f);
    if (!m) continue;
    const [, name, locale] = m;
    const pair = pairs.get(name) || { name, en: null, tr: null };
    pair[locale as 'en' | 'tr'] = readJson(path.join(fragDir, f));
    pairs.set(name, pair);
  }

  const result = mergeFragments(base, Array.from(pairs.values()));
  const problems = [...result.mismatches, ...result.conflicts];
  if (problems.length) {
    console.error(`merge-fragments: ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(`merge-fragments: ${pairs.size} fragment pair(s), +${result.added.en} en / +${result.added.tr} tr leaves`);
  if (check) return;

  const target = outDir ? path.resolve(outDir) : messagesDir;
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'en.json'), `${JSON.stringify(result.en, null, 2)}\n`);
  fs.writeFileSync(path.join(target, 'tr.json'), `${JSON.stringify(result.tr, null, 2)}\n`);
  console.log(`merge-fragments: wrote ${path.join(target, 'en.json')} and tr.json`);
}

main();
