// Exports every raster brand asset from the SVGs in public/brand (GTM Phase 2).
//
//   node scripts/brand/export-assets.mjs            # icons, OG default, social avatars/banners
//   node scripts/brand/export-assets.mjs og         # per-page OG images from content/**/*.md
//
// Icons are rasterised with sharp. Images with type are rendered from an HTML template in
// headless Chrome (fonts from .cache/fonts, fetched by scripts/brand/build-logo.py).
// CHROME_PATH overrides the browser used by Playwright.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from '@playwright/test';
import yaml from 'js-yaml';

const ROOT = process.cwd();
const BRAND = path.join(ROOT, 'public/brand');
const PUB = path.join(ROOT, 'public');
const FONTS = path.join(ROOT, '.cache/fonts');
const C = { ink: '#0E1A2B', paper: '#FAF7F0', accent: '#2B45E0', kraft: '#C9A57B', inkSoft: '#3A4658' };

const read = (f) => fs.readFileSync(path.join(BRAND, f));

async function png(svgFile, size, out, { pad = 0, bg = null } = {}) {
  const inner = Math.round(size * (1 - pad * 2));
  let img = sharp(read(svgFile), { density: 1200 }).resize(inner, inner);
  if (pad || bg) {
    img = sharp({ create: { width: size, height: size, channels: 4, background: bg || { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await img.png().toBuffer(), gravity: 'center' }]);
  }
  await img.png().toFile(out);
}

/** ICO with embedded PNGs (valid in every current browser). */
async function ico(svgFile, sizes, out) {
  const pngs = await Promise.all(sizes.map((s) => sharp(read(svgFile), { density: 1200 }).resize(s, s).png().toBuffer()));
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
    offset += pngs[i].length; return e;
  });
  fs.writeFileSync(out, Buffer.concat([header, ...dir, ...pngs]));
}

function fontFace() {
  const u = (f) => `"file://${encodeURI(path.join(FONTS, f))}"`;
  return `@font-face{font-family:Fraunces;src:url(${u('Fraunces.ttf')});font-weight:100 900}
@font-face{font-family:Instrument;src:url(${u('InstrumentSans.ttf')});font-weight:400 700}`;
}

const logoSvg = () => fs.readFileSync(path.join(BRAND, 'kolayxport-logo.svg'), 'utf8');
const logoDarkSvg = () => fs.readFileSync(path.join(BRAND, 'kolayxport-logo-dark.svg'), 'utf8');
const symbolSvg = () => fs.readFileSync(path.join(BRAND, 'kolayxport-symbol.svg'), 'utf8');

/** Card template shared by OG images and banners: paper ground, manifest rule lines, stamp. */
function cardHtml({ w, h, eyebrow = '', title = '', sub = '', dark = false, logoOnly = false, safe = null, lang = 'tr' }) {
  const bg = dark ? C.ink : C.paper; const fg = dark ? C.paper : C.ink;
  const tsize = title.length > 60 ? 58 : title.length > 40 ? 68 : 80;
  const area = safe ? `width:${safe.w}px;height:${safe.h}px;` : `width:${w - 160}px;height:${h - 140}px;`;
  // lang drives text-transform: uppercase (Turkish İ/I) — must match the copy's language.
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${fontFace()}
*{margin:0;box-sizing:border-box}body{width:${w}px;height:${h}px;background:${bg};color:${fg};font-family:Instrument,sans-serif;position:relative;overflow:hidden}
.rules{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 47px,${dark ? 'rgba(250,247,240,.05)' : 'rgba(14,26,43,.045)'} 47px 48px)}
.edge{position:absolute;right:-120px;top:-120px;width:520px;height:520px;border-radius:50%;border:2px dashed ${dark ? 'rgba(142,160,255,.35)' : 'rgba(43,69,224,.25)'}}
.edge2{position:absolute;right:-40px;top:-40px;width:360px;height:360px;border-radius:50%;border:2px solid ${dark ? 'rgba(142,160,255,.25)' : 'rgba(43,69,224,.18)'}}
.wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);${area}display:flex;flex-direction:column;justify-content:${logoOnly ? 'center' : 'space-between'};align-items:${logoOnly ? 'center' : 'flex-start'}}
.logo svg{height:${logoOnly ? Math.round(h * 0.22) : 56}px;width:auto}
.eyebrow{font-weight:600;letter-spacing:.14em;text-transform:uppercase;font-size:22px;color:${dark ? '#8EA0FF' : C.accent}}
h1{font-family:Fraunces;font-variation-settings:'opsz' 96,'SOFT' 100;font-weight:600;font-size:${tsize}px;line-height:1.04;letter-spacing:-.02em;max-width:${(safe ? safe.w : w - 160) - 40}px;margin-top:14px}
.sub{font-size:28px;line-height:1.35;color:${dark ? 'rgba(250,247,240,.75)' : C.inkSoft};margin-top:18px;max-width:${(safe ? safe.w : w - 160) - 160}px}
.foot{display:flex;align-items:center;justify-content:space-between;width:100%}
.url{font-weight:600;font-size:22px;letter-spacing:.04em;border:2px solid currentColor;border-radius:999px;padding:8px 18px;opacity:.85}
</style></head><body><div class="rules"></div><div class="edge"></div><div class="edge2"></div>
<div class="wrap">${logoOnly ? `<div class="logo">${dark ? logoDarkSvg() : logoSvg()}</div>` : `
<div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
<div class="foot"><div class="logo">${dark ? logoDarkSvg() : logoSvg()}</div><div class="url">kolayxport.com</div></div>`}
</div></body></html>`;
}

async function render(browser, html, w, h, out) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  // A file:// page (not setContent/about:blank) so the file:// @font-face URLs load.
  const tmp = path.join(ROOT, '.cache', `render-${process.pid}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmp, html);
  await page.goto('file://' + encodeURI(tmp), { waitUntil: 'load' });
  fs.unlinkSync(tmp);
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ type: 'png' });
  await page.close();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // JPEG for photos-like banners would blur type; keep PNG but palette-compress.
  await sharp(buf).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out);
}

function avatarHtml(size, dark) {
  const svg = symbolSvg();
  return `<!doctype html><html><head><style>*{margin:0}body{width:${size}px;height:${size}px;display:grid;place-items:center;background:${dark ? C.paper : C.ink}}svg{width:${Math.round(size * 0.62)}px;height:auto}</style></head><body>${svg.replace('fill="#0E1A2B"', `fill="${C.ink}"`)}</body></html>`;
}

async function launch() {
  const executablePath = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
  return chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--allow-file-access-from-files'] });
}

async function core() {
  // Icons
  await ico('favicon.svg', [16, 32, 48], path.join(PUB, 'favicon.ico'));
  fs.copyFileSync(path.join(BRAND, 'favicon.svg'), path.join(PUB, 'favicon.svg'));
  await png('kolayxport-symbol.svg', 180, path.join(PUB, 'apple-touch-icon.png'), { pad: 0.08, bg: C.paper });
  await png('kolayxport-symbol.svg', 192, path.join(PUB, 'icon-192x192.png'));
  await png('kolayxport-symbol.svg', 512, path.join(PUB, 'icon-512x512.png'));
  await png('favicon.svg', 512, path.join(PUB, 'icon-maskable-512x512.png'), { pad: 0.12, bg: C.ink });
  await png('kolayxport-symbol.svg', 512, path.join(BRAND, 'kolayxport-symbol-512.png'));

  const b = await launch();
  const T = 'Yurt dışına satışın tek paneli';
  const S = 'Etsy, eBay ve Amazon ilanlarınızı yapay zekâyla İngilizce optimize edin, ne satacağınızı veriyle bulun, kargo ve ETGB\'yi aynı yerden halledin.';
  await render(b, cardHtml({ w: 1200, h: 630, eyebrow: 'KolayXport', title: T, sub: S }), 1200, 630, path.join(PUB, 'og/default.png'));
  await render(b, cardHtml({ w: 1200, h: 630, lang: 'en', eyebrow: 'KolayXport', title: 'One dashboard for selling abroad', sub: 'AI-optimised Etsy, eBay and Amazon listings, product research, labels and export paperwork — built for sellers in Türkiye.' }), 1200, 630, path.join(PUB, 'og/default-en.png'));
  const social = path.join(BRAND, 'social');
  for (const [name, w, h, opts] of [
    ['x-header-1500x500.png', 1500, 500, { logoOnly: true }],
    ['facebook-cover-1640x624.png', 1640, 624, { logoOnly: true }],
    ['linkedin-banner-1584x396.png', 1584, 396, { logoOnly: true, dark: true }],
    ['youtube-banner-2560x1440.png', 2560, 1440, { logoOnly: true, safe: { w: 1546, h: 423 } }],
  ]) await render(b, cardHtml({ w, h, ...opts }), w, h, path.join(social, name));
  for (const [name, size, dark] of [['avatar-400.png', 400, false], ['avatar-800.png', 800, false], ['avatar-light-400.png', 400, true]]) {
    await render(b, avatarHtml(size, dark), size, size, path.join(social, name));
  }
  await b.close();
}

/** Per-page OG images for every content file: public/og/<locale>/<type>/<slug>.png */
async function og() {
  const b = await launch();
  const base = path.join(ROOT, 'content');
  for (const locale of ['tr', 'en']) {
    for (const type of ['cases', 'integrations', 'compare', 'guides', 'blog']) {
      const dir = path.join(base, locale, type);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        const m = src.match(/^---\n([\s\S]*?)\n---/);
        if (!m) continue;
        const fm = yaml.load(m[1]) || {};
        if (fm.draft) continue;
        const eyebrow = fm.eyebrow || fm.name || ({ cases: 'Çözümler', integrations: 'Entegrasyon', compare: 'Karşılaştırma', guides: 'Nasıl kullanılır', blog: 'Blog' })[type];
        await render(b, cardHtml({ w: 1200, h: 630, eyebrow, title: fm.h1 || fm.title, lang: locale }), 1200, 630,
          path.join(PUB, 'og', locale, type, f.replace(/\.md$/, '.png')));
      }
    }
  }
  await b.close();
}

/** Responsive variants of product screenshots and photos: <id>@800.webp / @1200.webp next to the original. */
async function variants() {
  const roots = [path.join(PUB, 'marketing/screens'), path.join(PUB, 'marketing/screens/en'), path.join(PUB, 'marketing')];
  let n = 0;
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.webp') && !x.includes('@'))) {
      const src = path.join(dir, f);
      const meta = await sharp(src).metadata();
      for (const w of [800, 1200]) {
        if (!meta.width || meta.width <= w) continue;
        const out = path.join(dir, f.replace(/\.webp$/, `@${w}.webp`));
        await sharp(src).resize({ width: w }).webp({ quality: 74 }).toFile(out);
        // Phone captures are the LCP image on mobile: also ship AVIF (~40% smaller).
        if (f.includes('-mobile') && w === 800) await sharp(src).resize({ width: w }).avif({ quality: 50, effort: 6 }).toFile(out.replace(/\.webp$/, '.avif'));
        n += 1;
      }
    }
  }
  console.log(`${n} responsive variants`);
}

const mode = process.argv[2];
(mode === 'og' ? og() : mode === 'variants' ? variants() : core()).then(() => console.log('assets exported')).catch((e) => { console.error(e); process.exit(1); });
