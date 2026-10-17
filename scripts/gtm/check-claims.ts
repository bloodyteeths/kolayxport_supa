/**
 * Every product claim in content/**\/*.md must point to a feature-inventory row that exists and
 * is not a stub (docs/gtm/feature-inventory.md). Also checks the home page refs.
 *   npm run gtm:check-claims
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { readInventory } from '../../lib/site/inventory';
import { HOME_CLAIM_REFS } from '../../lib/site/homeData';

const rows = new Map(readInventory().map((r) => [r.id, r]));
const problems: string[] = [];

function check(where: string, ref: unknown) {
  if (typeof ref !== 'string' || !ref) return;
  const row = rows.get(ref);
  if (!row) problems.push(`${where}: unknown inventory ref "${ref}"`);
  else if (row.level === 'stub' || row.level === 'none') problems.push(`${where}: "${ref}" is ${row.maturity} — not claimable`);
}

for (const ref of HOME_CLAIM_REFS) check('home page', ref);

const root = path.join(process.cwd(), 'content');
for (const locale of fs.readdirSync(root).filter((d) => ['tr', 'en'].includes(d))) {
  for (const type of fs.readdirSync(path.join(root, locale))) {
    const dir = path.join(root, locale, type);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const where = `content/${locale}/${type}/${f}`;
      const m = fs.readFileSync(path.join(dir, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!m) { problems.push(`${where}: no frontmatter`); continue; }
      let meta: any;
      try { meta = yaml.load(m[1]); } catch (e) { problems.push(`${where}: YAML error ${(e as Error).message}`); continue; }
      if (meta.draft) continue;
      for (const k of ['title', 'description', 'h1']) if (!meta[k]) problems.push(`${where}: missing ${k}`);
      if (meta.title && String(meta.title).length > 70) problems.push(`${where}: title longer than 70 chars`);
      if (meta.description && String(meta.description).length > 165) problems.push(`${where}: description longer than 165 chars`);
      for (const ref of meta.inventoryRefs || []) check(where, ref);
      for (const f2 of meta.features || []) check(`${where} feature "${f2.title}"`, f2.ref);
      for (const c of meta.capabilities || []) if (c.status !== 'no') check(`${where} capability "${c.label}"`, c.ref);
      if (type === "legal") continue; // warranty disclaimers legitimately say "garanti"
      const body = fs.readFileSync(path.join(dir, f), "utf8");
      for (const banned of [/\ben iyi\b/i, /#1\b/, /\bgaranti(li)?\b/i, /\bthe best\b/i, /\bguaranteed\b/i]) {
        const hit = body.replace(/^---[\s\S]*?---/, '').match(banned);
        if (hit && !/garanti etmez|garanti etmiyor|garantisi yok|does not guarantee|no guarantee|not guarantee|garanti etmiyoruz/i.test(body)) problems.push(`${where}: forbidden phrase "${hit[0]}"`);
      }
    }
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} claim problem(s):\n` + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('✓ all content claims map to live inventory rows');
