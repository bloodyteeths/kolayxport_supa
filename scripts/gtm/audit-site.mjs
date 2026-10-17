// Quality gate for the public site (GTM plan "verification"): Lighthouse mobile (performance, accessibility,
// best practices, SEO) + structural checks on every public page.
//   node scripts/gtm/audit-site.mjs [baseUrl] [--write]
// Run against a production build (`next build && next start`), not `next dev` (dev bundles are not representative).
// --write saves docs/gtm/audit/latest.md. Exit code 1 when a page misses the budget.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const base = (process.argv.find((a) => /^https?:/.test(a)) || 'http://localhost:3200').replace(/\/$/, '');
const write = process.argv.includes('--write');
const BUDGET = { performance: 95, accessibility: 95, 'best-practices': 95, seo: 95, lcpMs: 2000, cls: 0.05 };
const chrome = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));

function pages() {
  const list = ['/', '/en', '/fiyatlandirma', '/cozumler', '/entegrasyonlar', '/karsilastirma', '/nasil-kullanirim', '/blog', '/kurumsal', '/iletisim', '/ozellikler'];
  for (const [type, baseUrl] of [['cases', '/cozumler'], ['integrations', '/entegrasyonlar'], ['compare', '/karsilastirma'], ['blog', '/blog'], ['guides', '/nasil-kullanirim'], ['legal', '']]) {
    const dir = path.join(process.cwd(), 'content/tr', type);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) list.push(`${baseUrl}/${f.replace(/\.md$/, '')}`);
  }
  return list;
}

function lighthouse(url) {
  const out = path.join(process.cwd(), '.cache', `lh-${Buffer.from(url).toString('hex').slice(-24)}.json`);
  execFileSync('npx', ['-y', 'lighthouse@12', url, '--quiet', '--output=json', `--output-path=${out}`, '--form-factor=mobile', '--throttling-method=simulate', '--only-categories=performance,accessibility,best-practices,seo', `--chrome-flags=--headless=new --no-sandbox`],
    { stdio: 'ignore', env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) }, timeout: 240000 });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.unlinkSync(out);
  const score = (k) => Math.round((r.categories[k]?.score ?? 0) * 100);
  const failedA11y = Object.values(r.audits).filter((a) => a.score === 0 && r.categories.accessibility.auditRefs.some((ref) => ref.id === a.id)).map((a) => a.id);
  return {
    performance: score('performance'), accessibility: score('accessibility'), 'best-practices': score('best-practices'), seo: score('seo'),
    lcpMs: Math.round(r.audits['largest-contentful-paint']?.numericValue ?? 0),
    cls: Number((r.audits['cumulative-layout-shift']?.numericValue ?? 0).toFixed(3)),
    a11y: failedA11y,
  };
}

const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
await ctx.addInitScript(() => { try { localStorage.setItem('kx-consent', JSON.stringify({ analytics: false, marketing: false, at: new Date().toISOString(), v: 1 })); } catch {} });
const page = await ctx.newPage();
const rows = [];
let failures = 0;
for (const p of pages()) {
  const url = base + p;
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
  const s = await page.evaluate(() => ({
    h1: document.querySelectorAll('h1').length,
    title: document.title,
    desc: document.querySelector('meta[name=description]')?.getAttribute('content') || '',
    canonical: document.querySelector('link[rel=canonical]')?.getAttribute('href') || '',
    hreflang: document.querySelectorAll('link[rel=alternate][hreflang]').length,
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent || '{}')['@type']; } catch { return 'INVALID'; } }),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    lang: document.documentElement.lang,
  }));
  const lh = lighthouse(url);
  const problems = [];
  if (res?.status() !== 200) problems.push(`HTTP ${res?.status()}`);
  if (s.h1 !== 1) problems.push(`${s.h1} h1`);
  if (!s.desc) problems.push('no meta description');
  if (!s.canonical) problems.push('no canonical');
  if (s.ld.includes('INVALID')) problems.push('invalid JSON-LD');
  if (s.overflow) problems.push('horizontal overflow @375');
  for (const k of ['performance', 'accessibility', 'best-practices', 'seo']) if (lh[k] < BUDGET[k]) problems.push(`${k} ${lh[k]}`);
  if (lh.lcpMs > BUDGET.lcpMs) problems.push(`LCP ${lh.lcpMs}ms`);
  if (lh.cls > BUDGET.cls) problems.push(`CLS ${lh.cls}`);
  if (problems.length) failures++;
  rows.push({ p, ...lh, ld: s.ld.join(' '), hreflang: s.hreflang, lang: s.lang, problems });
  console.log(`${problems.length ? '✗' : '✓'} ${p}  P${lh.performance} A${lh.accessibility} BP${lh['best-practices']} S${lh.seo} LCP ${lh.lcpMs}ms CLS ${lh.cls}${problems.length ? '  → ' + problems.join(', ') : ''}`);
}
await browser.close();

if (write) {
  const md = [
    `# Site audit (automated) — ${new Date().toISOString().slice(0, 10)}`,
    '',
    `Base: ${base} · Lighthouse 12, mobile, simulated 4G · budget: every category ≥ 95, LCP < 2.0 s, CLS < 0.05, one H1, no overflow at 375 px.`,
    '',
    '| Page | Perf | A11y | BP | SEO | LCP | CLS | JSON-LD | hreflang | Problems |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.p} | ${r.performance} | ${r.accessibility} | ${r['best-practices']} | ${r.seo} | ${(r.lcpMs / 1000).toFixed(2)}s | ${r.cls} | ${r.ld} | ${r.hreflang} | ${r.problems.join('; ') || '—'}${r.a11y.length ? ` (a11y: ${r.a11y.join(', ')})` : ''} |`),
  ].join('\n');
  fs.mkdirSync('docs/gtm/audit', { recursive: true });
  fs.writeFileSync('docs/gtm/audit/latest.md', md + '\n');
}
console.log(`\n${rows.length - failures}/${rows.length} pages within budget`);
process.exit(failures ? 1 : 0);
