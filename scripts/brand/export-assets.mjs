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
const C = { ink: '#0B1220', paper: '#F7F8FB', accent: '#2F5BFF', cyan: '#00C6FF', inkSoft: '#3A465A' };

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
  return `@font-face{font-family:Jakarta;src:url(${u('PlusJakartaSans.ttf')});font-weight:200 800}
@font-face{font-family:Instrument;src:url(${u('InstrumentSans.ttf')});font-weight:400 700}`;
}

const logoSvg = () => fs.readFileSync(path.join(BRAND, 'kolayxport-logo.svg'), 'utf8');
const logoDarkSvg = () => fs.readFileSync(path.join(BRAND, 'kolayxport-logo-dark.svg'), 'utf8');

/** Card template shared by OG images and banners: ink ground, the blade streak from the logo, white type. */
function cardHtml({ w, h, eyebrow = '', title = '', sub = '', dark = true, logoOnly = false, safe = null, lang = 'tr' }) {
  const bg = dark ? C.ink : '#FFFFFF'; const fg = dark ? '#FFFFFF' : C.ink;
  const tsize = title.length > 60 ? 56 : title.length > 40 ? 66 : 78;
  const area = safe ? `width:${safe.w}px;height:${safe.h}px;` : `width:${w - 160}px;height:${h - 140}px;`;
  // The streak echoes the logo's blade: a long tapering diagonal, bottom-left to top-right.
  const streak = `<svg class="streak" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="sg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${C.accent}" stop-opacity="0"/><stop offset=".55" stop-color="${C.accent}" stop-opacity="${dark ? '.55' : '.35'}"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="${dark ? '.95' : '.7'}"/></linearGradient></defs><path d="M${w * 0.42} ${h + 40} L${w + 60} ${-h * 0.12} L${w + 60} ${-h * 0.02} L${w * 0.42 + 120} ${h + 40} Z" fill="url(#sg)"/></svg>`;
  // lang drives text-transform: uppercase (Turkish İ/I) — must match the copy's language.
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${fontFace()}
*{margin:0;box-sizing:border-box}body{width:${w}px;height:${h}px;background:${bg};color:${fg};font-family:Instrument,sans-serif;position:relative;overflow:hidden}
.glow{position:absolute;right:-20%;top:-40%;width:70%;height:120%;background:radial-gradient(closest-side,${dark ? 'rgba(47,91,255,.28)' : 'rgba(47,91,255,.10)'},transparent)}
.streak{position:absolute;inset:0;width:100%;height:100%}
.wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);${area}display:flex;flex-direction:column;justify-content:${logoOnly ? 'center' : 'space-between'};align-items:${logoOnly ? 'center' : 'flex-start'}}
.logo svg{height:${logoOnly ? Math.round(h * 0.24) : 54}px;width:auto;display:block}
.eyebrow{font-weight:600;letter-spacing:.14em;text-transform:uppercase;font-size:22px;color:${dark ? C.cyan : C.accent}}
h1{font-family:Jakarta;font-weight:800;font-size:${tsize}px;line-height:1.05;letter-spacing:-.025em;max-width:${(safe ? safe.w : w - 160) - 120}px;margin-top:16px}
.sub{font-size:28px;line-height:1.35;color:${dark ? 'rgba(255,255,255,.72)' : C.inkSoft};margin-top:18px;max-width:${(safe ? safe.w : w - 160) - 220}px}
.foot{display:flex;align-items:center;justify-content:space-between;width:100%}
.url{font-weight:600;font-size:22px;letter-spacing:.04em;color:${dark ? 'rgba(255,255,255,.8)' : C.inkSoft}}
</style></head><body><div class="glow"></div>${streak}
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

async function launch() {
  const executablePath = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
  return chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--allow-file-access-from-files'] });
}

async function core() {
  // Icons
  await ico('favicon.svg', [16, 32, 48], path.join(PUB, 'favicon.ico'));
  fs.copyFileSync(path.join(BRAND, 'favicon.svg'), path.join(PUB, 'favicon.svg'));
  // iOS and Android mask the icon themselves: give them the full-bleed square tile.
  await png('kolayxport-symbol-square.svg', 180, path.join(PUB, 'apple-touch-icon.png'));
  await png('kolayxport-symbol.svg', 192, path.join(PUB, 'icon-192x192.png'));
  await png('kolayxport-symbol.svg', 512, path.join(PUB, 'icon-512x512.png'));
  await png('kolayxport-symbol-square.svg', 512, path.join(PUB, 'icon-maskable-512x512.png'));
  await png('kolayxport-symbol.svg', 512, path.join(BRAND, 'kolayxport-symbol-512.png'));

  // PNG copies of the logo for tools that can't take SVG (slides, Canva, marketplaces, email).
  const pngDir = path.join(BRAND, 'png');
  fs.mkdirSync(pngDir, { recursive: true });
  await png('kolayxport-symbol.svg', 1024, path.join(pngDir, 'kolayxport-symbol-1024.png'));
  for (const [svg, out, width] of [
    ['kolayxport-logo.svg', 'kolayxport-logo-1600.png', 1600],
    ['kolayxport-logo-dark.svg', 'kolayxport-logo-dark-1600.png', 1600],
    ['kolayxport-logo-mono.svg', 'kolayxport-logo-mono-1600.png', 1600],
    ['kolayxport-logo-mono-white.svg', 'kolayxport-logo-mono-white-1600.png', 1600],
    ['kolayxport-mark.svg', 'kolayxport-mark-512.png', 512],
    ['kolayxport-mark-dark.svg', 'kolayxport-mark-dark-512.png', 512],
  ]) await sharp(read(svg), { density: 1200 }).resize({ width }).png().toFile(path.join(pngDir, out));

  // Email: hosted PNGs (mail clients don't render SVG). Shown at 160 px wide, exported at 3x.
  const mailDir = path.join(BRAND, 'email');
  fs.mkdirSync(mailDir, { recursive: true });
  await sharp(read('kolayxport-logo.svg'), { density: 1200 }).resize({ width: 480 }).png().toFile(path.join(mailDir, 'kolayxport-logo.png'));
  await sharp(read('kolayxport-logo-dark.svg'), { density: 1200 }).resize({ width: 480 }).png().toFile(path.join(mailDir, 'kolayxport-logo-dark.png'));
  await png('kolayxport-symbol.svg', 144, path.join(mailDir, 'kolayxport-symbol.png'));

  const b = await launch();
  const T = 'Yurt dışına satışın tek paneli';
  const S = 'Etsy, eBay ve Amazon ilanlarınızı yapay zekâyla İngilizce optimize edin, ne satacağınızı veriyle bulun, kargo ve ETGB\'yi aynı yerden halledin.';
  await render(b, cardHtml({ w: 1200, h: 630, eyebrow: 'KolayXport', title: T, sub: S }), 1200, 630, path.join(PUB, 'og/default.png'));
  await render(b, cardHtml({ w: 1200, h: 630, lang: 'en', eyebrow: 'KolayXport', title: 'One dashboard for selling abroad', sub: 'AI-optimised Etsy, eBay and Amazon listings, product research, labels and export paperwork — built for sellers in Türkiye.' }), 1200, 630, path.join(PUB, 'og/default-en.png'));
  const social = path.join(BRAND, 'social');
  for (const [name, w, h, opts] of [
    ['x-header-1500x500.png', 1500, 500, { logoOnly: true }],
    ['facebook-cover-1640x624.png', 1640, 624, { logoOnly: true }],
    ['linkedin-banner-1584x396.png', 1584, 396, { logoOnly: true }],
    ['youtube-banner-2560x1440.png', 2560, 1440, { logoOnly: true, safe: { w: 1546, h: 423 } }],
  ]) await render(b, cardHtml({ w, h, ...opts }), w, h, path.join(social, name));
  // Avatars: full-bleed square tile (platforms crop to a circle; the X sits inside the safe circle).
  await png('kolayxport-symbol-square.svg', 400, path.join(social, 'avatar-400.png'));
  await png('kolayxport-symbol-square.svg', 800, path.join(social, 'avatar-800.png'));
  await png('kolayxport-symbol-light.svg', 400, path.join(social, 'avatar-light-400.png'), { bg: { r: 255, g: 255, b: 255, alpha: 1 } });
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
