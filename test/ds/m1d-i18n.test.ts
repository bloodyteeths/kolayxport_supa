import { describe, expect, it } from 'vitest';
import { m1dEn, m1dTr } from './m1d-messages';
import { etsyChecks } from '@/lib/listingScore/etsy';

type Tree = { [k: string]: string | Tree };

function flatten(t: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const en = flatten(m1dEn as unknown as Tree);
const tr = flatten(m1dTr as unknown as Tree);

describe('M1-d i18n keys', () => {
  it('EN and TR have the same keys', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  it('no ASCII-Turkish, no uppercase-only labels, no empty strings', () => {
    for (const [k, v] of Object.entries(tr)) {
      expect(v, k).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme|Saglig|Gelistir|Mukemmel/);
      expect(v.trim(), k).not.toBe('');
    }
    for (const [k, v] of Object.entries(en)) {
      expect(v.trim(), k).not.toBe('');
      if (/[a-z]{4,}/i.test(v)) expect(v, k).not.toMatch(/^[^a-z]*[A-Z]{4,}[^a-z]*$/);
    }
  });

  it('every label, fix and n/a key the Etsy scorer can emit exists', () => {
    const inputs = [
      {},
      { title: '', tags: [], images: [], description: '', materials: [], attributes: { required: 1, filled: 0 }, shipping: { hasProfile: false, hasProcessing: false, hasWeight: false }, price: 1, market: { p25: 2, p75: 3 } },
      { title: 'x'.repeat(150), tags: ['a'], images: [{ alt: '' }], hasVideo: false, description: 'x', materials: ['m'], shipping: { hasProfile: true, hasProcessing: false, hasWeight: true } },
      { title: 'x'.repeat(120), tags: Array(13).fill('soft blanket'), images: Array(10).fill({ alt: 'a' }), hasVideo: true, shipping: { hasProfile: true, hasProcessing: true, hasWeight: false } },
    ];
    const keys = new Set<string>();
    for (const i of inputs) {
      for (const c of etsyChecks(i)) {
        keys.add(c.label);
        if (c.fix) keys.add(c.fix.label);
        if (c.naReason) keys.add(c.naReason);
      }
    }
    for (const k of keys) {
      expect(en[k], k).toBeDefined();
      expect(tr[k], k).toBeDefined();
    }
  });
});
