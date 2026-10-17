// Full-page screenshots of marketing pages at phone (375) and desktop (1440) width.
//   node scripts/gtm/preview-pages.mjs [baseUrl] [outDir] /path1 /path2 ...
// Defaults: http://localhost:3100, .cache/preview. Cookie banner is pre-dismissed ("necessary only").
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const [base = 'http://localhost:3100', out = '.cache/preview', ...paths] = process.argv.slice(2);
const executablePath = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(executablePath ? { executablePath } : {});
for (const width of [375, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 }, deviceScaleFactor: width === 375 ? 2 : 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem('kx-consent', JSON.stringify({ analytics: false, marketing: false, at: new Date().toISOString(), v: 1 })); } catch {} });
  const page = await ctx.newPage();
  for (const p of (paths.length ? paths : ['/'])) {
    await page.goto(base + p, { waitUntil: 'networkidle', timeout: 180000 });
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(out, `${p.replace(/^\//, '').replace(/\//g, '_') || 'home'}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(width, p, overflow ? 'HORIZONTAL OVERFLOW' : 'ok', file);
  }
  await ctx.close();
}
await browser.close();
