// Every label / naReason / fix label the scorers emit must exist in EN and TR
// (messages/*.json merged with the not-yet-merged G3 fragment) and format with the params passed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { ebayChecks } from '@/lib/listingScore/ebay';
import { shopifyChecks } from '@/lib/listingScore/shopify';
import { trendyolChecks } from '@/lib/listingScore/trendyol';
import type { Check } from '@/lib/listingScore/types';
import { wixChecks } from '@/lib/listingScore/wix';
import fragment from './newI18nKeys.json';

type Tree = { [k: string]: string | Tree };
const ROOT = path.resolve(__dirname, '../..');

function merge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = typeof v === 'object' && typeof cur === 'object' ? merge(cur, v) : v;
  }
  return out;
}

function load(locale: 'en' | 'tr'): Tree {
  const base = JSON.parse(readFileSync(path.join(ROOT, 'messages', `${locale}.json`), 'utf8')) as Tree;
  return merge(base, (fragment as unknown as Record<string, Tree>)[locale]);
}

function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

const LOCALES = { en: load('en'), tr: load('tr') } as const;

function sourceKeys(): string[] {
  const keys = new Set<string>();
  for (const m of ['etsy', 'ebay', 'trendyol', 'wix', 'shopify']) {
    const src = readFileSync(path.join(ROOT, 'lib', 'listingScore', `${m}.ts`), 'utf8');
    const prefix: Record<string, string> = { K: `listingScore.${m}`, FIX: 'listingScore.fix', NA: 'listingScore.na' };
    for (const match of src.matchAll(/\$\{(K|FIX|NA)\}\.([A-Za-z0-9_.]+)/g)) keys.add(`${prefix[match[1]]}.${match[2]}`);
  }
  return [...keys].sort();
}

/** Inputs that walk each scorer through pass / warn / fail / na branches. */
function emitted(): Check[] {
  const out: Check[] = [];
  const ebayBase = {
    title: 'Apple iPhone 13 Pro 128GB Graphite Unlocked Smartphone Excellent Condition Box',
    description: 'word '.repeat(120),
    imageCount: 8,
    aspects: { Brand: ['Apple'], Type: ['Smartphone'] },
    condition: 'NEW',
    conditionDescription: null,
    category: { id: '9355' },
    policies: { fulfillment: true, payment: true, return: true },
    package: { hasWeight: true, hasDimensions: true },
    price: 10,
    market: { p25: 5, p75: 15 },
    aspectsRequired: { required: 3, filled: 3 },
    aspectsRecommended: { recommended: 5, filled: 5 },
  };
  out.push(...ebayChecks(ebayBase));
  out.push(...ebayChecks({
    ...ebayBase, title: 'x'.repeat(90), description: 'a b', imageCount: 1, condition: 'USED_GOOD', category: { id: '1', isLeaf: false },
    policies: { fulfillment: false, payment: true, return: false }, package: { hasWeight: false, hasDimensions: true }, price: 99,
    aspectsRequired: { required: 3, filled: 1 }, aspectsRecommended: { recommended: 5, filled: 1 },
  }));
  out.push(...ebayChecks({ ...ebayBase, title: 'short', condition: '', category: { id: '' }, package: { hasWeight: true, hasDimensions: false } }));
  out.push(...ebayChecks({ ...ebayBase, aspects: {} }));
  out.push(...ebayChecks({}));

  const tyBase = {
    title: 'Marka Bebek Battaniyesi Pamuklu Yumuşak Organik Örgü Hediye Seti Yenidoğan İçin Özel Tasarım Ürün',
    brandName: 'Marka', categoryName: 'Bebek Battaniyesi', imageCount: 6, description: 'x'.repeat(400), attributeCount: 6,
    listPrice: 200, salePrice: 150, quantity: 3, approved: true, rejected: false, blacklisted: false, dimensionalWeight: 2,
  };
  out.push(...trendyolChecks(tyBase));
  out.push(...trendyolChecks({
    ...tyBase, title: 'x'.repeat(200), brandName: 'Yok', categoryName: 'Zzz Qqq', imageCount: 3, description: 'x'.repeat(150),
    attributeCount: 2, listPrice: 150, salePrice: 150, quantity: 0, approved: false, dimensionalWeight: 0,
  }));
  out.push(...trendyolChecks({ ...tyBase, title: 'kısa', listPrice: 0, salePrice: 0, rejected: true, brandName: '', categoryName: '' }));
  out.push(...trendyolChecks({}));

  const wixBase = { title: 'A good product title here', description: 'x'.repeat(600), imageCount: 10, collectionCount: 1 };
  out.push(...wixChecks(wixBase));
  out.push(...wixChecks({ title: 'x'.repeat(100), description: 'x'.repeat(250), imageCount: 6, collectionCount: 0 }));
  out.push(...wixChecks({ title: 'x', description: '', imageCount: 0 }));
  out.push(...wixChecks({}));

  const shBase = {
    title: 'A good product title here', description: 'x'.repeat(600), imageCount: 6,
    seoTitle: 'SEO title', seoDescription: 'x'.repeat(130), tags: ['a', 'b', 'c'],
  };
  out.push(...shopifyChecks(shBase));
  out.push(...shopifyChecks({ title: 'x'.repeat(200), description: 'x'.repeat(100), imageCount: 1, seoTitle: 'x'.repeat(100), seoDescription: 'x', tags: ['a'] }));
  out.push(...shopifyChecks({ title: 'x', description: '', imageCount: 0, seoTitle: '', seoDescription: '', tags: [] }));
  out.push(...shopifyChecks({}));
  return out;
}

describe('listingScore i18n', () => {
  it('every key referenced by a scorer exists in EN and TR', () => {
    const missing: string[] = [];
    for (const key of sourceKeys()) {
      for (const [loc, tree] of Object.entries(LOCALES)) if (!lookup(tree, key)) missing.push(`${loc}:${key}`);
    }
    expect(missing).toEqual([]);
  });

  it('non-Etsy labels format with the params each check passes', () => {
    const failures: string[] = [];
    for (const c of emitted()) {
      const parts: Array<[string, Record<string, string | number> | undefined]> = [
        [c.label, c.status === 'na' ? undefined : (c.params as Record<string, string | number> | undefined)],
      ];
      if (c.naReason) parts.push([c.naReason, undefined]);
      if (c.fix) parts.push([c.fix.label, undefined]);
      for (const [key, params] of parts) {
        for (const [loc, tree] of Object.entries(LOCALES)) {
          const msg = lookup(tree, key);
          if (!msg) { failures.push(`${loc}:${key} missing`); continue; }
          try {
            const text = new IntlMessageFormat(msg, loc).format(params ?? {});
            if (typeof text !== 'string' || !text.trim()) failures.push(`${loc}:${key} empty`);
          } catch (err) {
            failures.push(`${loc}:${key} ${(err as Error).message}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
