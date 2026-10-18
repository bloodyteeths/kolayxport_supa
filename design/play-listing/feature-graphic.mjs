// Renders the Google Play feature graphic (1024x500, 24-bit PNG, no alpha) for each listing language from the
// real phone screenshots in screens/<locale>/. Run: node design/play-listing/feature-graphic.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome';
const COPY = {
  tr: { head: 'Siparişler, ilanlar ve kargo<br>tek uygulamada', sub: 'Yurt dışına satan satıcılar için' },
  en: { head: 'Orders, listings and shipping in one app', sub: 'For sellers who sell across borders' },
};
const b64 = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
const logo = fs.readFileSync(path.join(ROOT, 'public', 'favicon.svg'), 'utf8');

const html = (l) => `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box} body{width:1024px;height:500px;overflow:hidden;font-family:-apple-system,'SF Pro Display','Helvetica Neue',Arial,sans-serif;
  background:radial-gradient(120% 140% at 100% 0%,#1E3FD8 0%,#0B1220 55%);color:#fff;position:relative}
  .copy{position:absolute;left:64px;top:0;bottom:0;width:430px;display:flex;flex-direction:column;justify-content:center;gap:22px}
  .brand{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:700;letter-spacing:-.01em}
  .brand svg{width:56px;height:56px}
  h1{font-size:36px;line-height:1.12;font-weight:750;letter-spacing:-.02em}
  p{font-size:20px;color:#8FA8FF}
  .ph{position:absolute;width:236px;border-radius:26px;overflow:hidden;border:6px solid #1B2436;box-shadow:0 30px 60px -20px rgba(0,0,0,.6)}
  .ph img{display:block;width:100%}
  .a{right:262px;top:46px;transform:rotate(-4deg)} .b{right:40px;top:96px;transform:rotate(4deg)}
</style><div class="copy"><div class="brand">${logo}<span>KolayXport</span></div><h1>${COPY[l].head}</h1><p>${COPY[l].sub}</p></div>
<div class="ph a"><img src="${b64(path.join(DIR, 'screens', l, '02-orders.png'))}"></div>
<div class="ph b"><img src="${b64(path.join(DIR, 'screens', l, '03-etsy-listings.png'))}"></div>`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
for (const l of ['tr', 'en']) {
  await page.setContent(html(l), { waitUntil: 'load' });
  const buf = await page.screenshot({ type: 'png' });
  await sharp(buf).flatten({ background: '#0B1220' }).png().toFile(path.join(DIR, `feature-graphic-${l}.png`));
  console.log('wrote', `feature-graphic-${l}.png`);
}
await browser.close();
