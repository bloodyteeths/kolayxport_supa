import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { listContent, slugify } from '@/lib/site/content';
import { localePath } from '@/lib/site/routes';

describe('marketing content', () => {
  it('slugify transliterates Turkish', () => {
    expect(slugify('Çiçeksepeti Ürün Şablonu İğne')).toBe('ciceksepeti-urun-sablonu-igne');
  });

  it('every Turkish page has frontmatter title/description/h1 and renders html', () => {
    for (const type of ['cases', 'integrations', 'compare', 'blog', 'legal'] as const) {
      const docs = listContent('tr', type);
      expect(docs.length, type).toBeGreaterThan(0);
      for (const d of docs) {
        expect(d.meta.title, `${type}/${d.slug}`).toBeTruthy();
        expect(d.meta.description, `${type}/${d.slug}`).toBeTruthy();
        expect(d.html.length, `${type}/${d.slug}`).toBeGreaterThan(50);
      }
    }
  });

  it('english twins use the same slugs', () => {
    for (const type of ['cases', 'integrations', 'legal'] as const) {
      const tr = listContent('tr', type).map((d) => d.slug).sort();
      const en = listContent('en', type).map((d) => d.slug).sort();
      expect(en).toEqual(tr);
    }
  });

  it('localePath', () => {
    expect(localePath('tr', '/')).toBe('/');
    expect(localePath('en', '/')).toBe('/en');
    expect(localePath('en', '/cozumler/etsy-satici')).toBe('/en/cozumler/etsy-satici');
  });

  it('sitemap config keeps the app out of search', () => {
    const cfg = require(path.join(process.cwd(), 'next-sitemap.config.js'));
    for (const p of ['/app/*', '/auth/*', '/login', '/ayarlar']) expect(cfg.exclude).toContain(p);
    expect(fs.existsSync(path.join(process.cwd(), 'public/og/default.png'))).toBe(true);
  });
});
