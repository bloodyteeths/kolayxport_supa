/* eslint-disable no-console */
/**
 * Seed a SYNTHETIC demo account for marketing screenshots and tutorials.
 *
 *   npx tsx scripts/demo/seed-demo-account.ts            # images + DB seed
 *   npx tsx scripts/demo/seed-demo-account.ts --images   # only (re)generate public/demo/*.jpg
 *
 * Every name, address, order, tracking number and tax id below is fictional.
 * The script refuses to touch any database that is not on localhost.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { PRODUCTS, TAGS, MATERIALS, SECTION, TAXONOMY } from './demoCatalog';

// ---------------------------------------------------------------------------
// Product photography (flat, studio-style SVG renders -> JPG under public/demo)
// ---------------------------------------------------------------------------

const S = 800;
const bg = (a: string, b: string) => `
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/>
    </radialGradient>
    <radialGradient id="sh" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#000" stop-opacity=".28"/><stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="silver" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f4f5f7"/><stop offset="45%" stop-color="#b9bec6"/><stop offset="70%" stop-color="#eef0f3"/><stop offset="100%" stop-color="#8d939c"/>
    </linearGradient>
    <linearGradient id="copper" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7a3b1c"/><stop offset="35%" stop-color="#d98a4e"/><stop offset="55%" stop-color="#f3c08e"/><stop offset="100%" stop-color="#8a4421"/>
    </linearGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  <rect y="560" width="${S}" height="240" fill="#000" opacity=".035"/>`;
const shadow = (cx: number, cy: number, rx: number, ry: number) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#sh)"/>`;
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${body}</svg>`;

function iznikBowl(main: string, accent: string, bgA: string, bgB: string) {
  return svg(`${bg(bgA, bgB)}${shadow(400, 600, 300, 40)}
    <path d="M110 380 Q400 380 690 380 Q680 560 400 600 Q120 560 110 380 Z" fill="#fbfaf6"/>
    <path d="M140 420 Q400 425 660 420 Q630 540 400 572 Q170 540 140 420 Z" fill="${main}" opacity=".92"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<g transform="translate(${190 + i * 70} ${470 + Math.sin(i) * 8})">
      <path d="M0 -26 C14 -10 14 10 0 26 C-14 10 -14 -10 0 -26Z" fill="#fbfaf6"/>
      <circle r="7" fill="${accent}"/></g>`).join('')}
    <ellipse cx="400" cy="380" rx="290" ry="58" fill="#f3efe6"/>
    <ellipse cx="400" cy="384" rx="262" ry="46" fill="${main}"/>
    <ellipse cx="400" cy="390" rx="240" ry="38" fill="#fbfaf6"/>
    <g transform="translate(400 390) scale(1 .16)">${[0, 45, 90, 135, 180, 225, 270, 315].map((r) => `<path transform="rotate(${r})" d="M0 -40 C30 -90 30 -150 0 -200 C-30 -150 -30 -90 0 -40Z" fill="${main}" opacity=".85"/>`).join('')}<circle r="34" fill="${accent}"/></g>
    <path d="M150 400 Q200 520 330 560" stroke="#fff" stroke-width="10" opacity=".25" fill="none" stroke-linecap="round"/>`);
}

function mug(main: string, bgA: string, bgB: string) {
  return svg(`${bg(bgA, bgB)}${shadow(390, 618, 210, 30)}
    <path d="M520 330 C640 330 650 520 520 520" stroke="${main}" stroke-width="34" fill="none"/>
    <path d="M220 260 L560 260 L545 600 Q390 640 235 600 Z" fill="${main}"/>
    <path d="M222 300 L558 300 L556 345 L224 345 Z" fill="#f6f1e7" opacity=".9"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${255 + i * 58}" cy="322" r="9" fill="${main}"/>`).join('')}
    <ellipse cx="390" cy="260" rx="170" ry="26" fill="#3b2a20"/>
    <ellipse cx="390" cy="257" rx="160" ry="20" fill="#5a3b28"/>
    <path d="M250 370 Q260 500 290 590" stroke="#fff" stroke-width="14" opacity=".18" fill="none" stroke-linecap="round"/>`);
}

function plate(main: string, accent: string, bgA: string, bgB: string) {
  const petals = Array.from({ length: 12 }, (_, i) => `<path transform="rotate(${i * 30})" d="M0 -95 C26 -140 26 -190 0 -225 C-26 -190 -26 -140 0 -95Z" fill="${i % 2 ? main : accent}"/>`).join('');
  return svg(`${bg(bgA, bgB)}${shadow(410, 430, 320, 320)}
    <circle cx="400" cy="400" r="320" fill="#fbfaf5"/>
    <circle cx="400" cy="400" r="300" fill="none" stroke="${main}" stroke-width="18"/>
    <circle cx="400" cy="400" r="268" fill="none" stroke="${accent}" stroke-width="5" stroke-dasharray="14 12"/>
    <g transform="translate(400 400)">${petals}<circle r="80" fill="${main}"/><circle r="44" fill="#fbfaf5"/><circle r="20" fill="${accent}"/></g>`);
}

function necklace(stone: string, bgA: string, bgB: string) {
  return svg(`${bg(bgA, bgB)}
    <path d="M150 90 Q400 560 650 90" stroke="url(#silver)" stroke-width="6" fill="none"/>
    <path d="M150 90 Q400 560 650 90" stroke="#9aa0a8" stroke-width="2" stroke-dasharray="3 6" fill="none"/>
    <g transform="translate(400 470)">
      ${Array.from({ length: 10 }, (_, i) => `<path transform="rotate(${i * 36})" d="M0 -20 C30 -40 40 -80 0 -110 C-40 -80 -30 -40 0 -20Z" fill="none" stroke="url(#silver)" stroke-width="7"/>`).join('')}
      ${Array.from({ length: 10 }, (_, i) => `<path transform="rotate(${i * 36 + 18})" d="M0 -30 C14 -46 14 -64 0 -78 C-14 -64 -14 -46 0 -30Z" fill="none" stroke="#c9ced5" stroke-width="3"/>`).join('')}
      <circle r="34" fill="url(#silver)"/><circle r="22" fill="${stone}"/><circle cx="-7" cy="-8" r="6" fill="#fff" opacity=".6"/>
    </g>
    ${shadow(408, 640, 140, 18)}`);
}

function earrings(stone: string, bgA: string, bgB: string) {
  const one = (x: number) => `<g transform="translate(${x} 250)">
    <path d="M0 -120 Q30 -150 18 -170" stroke="url(#silver)" stroke-width="6" fill="none"/>
    <circle cy="-110" r="10" fill="url(#silver)"/>
    <path d="M0 -100 L0 -60" stroke="url(#silver)" stroke-width="4"/>
    <path d="M0 -60 C70 -10 80 120 0 190 C-80 120 -70 -10 0 -60Z" fill="none" stroke="url(#silver)" stroke-width="8"/>
    ${[0, 1, 2, 3].map((i) => `<path d="M0 ${-30 + i * 50} C40 ${-10 + i * 50} 40 ${30 + i * 50} 0 ${50 + i * 50} C-40 ${30 + i * 50} -40 ${-10 + i * 50} 0 ${-30 + i * 50}Z" fill="none" stroke="#c4c9d0" stroke-width="3"/>`).join('')}
    <circle cy="70" r="20" fill="${stone}"/><circle cx="-6" cy="63" r="5" fill="#fff" opacity=".6"/></g>`;
  return svg(`${bg(bgA, bgB)}${one(290)}${one(510)}${shadow(400, 640, 220, 18)}`);
}

function ring(stone: string, bgA: string, bgB: string) {
  return svg(`${bg(bgA, bgB)}${shadow(400, 600, 200, 30)}
    <ellipse cx="400" cy="460" rx="170" ry="140" fill="none" stroke="url(#silver)" stroke-width="40"/>
    <ellipse cx="400" cy="460" rx="170" ry="140" fill="none" stroke="#fff" stroke-width="4" opacity=".5" stroke-dasharray="20 30"/>
    <path d="M330 330 L470 330 L440 280 L360 280 Z" fill="url(#silver)"/>
    <path d="M345 280 L455 280 L430 210 L370 210 Z" fill="${stone}"/>
    <path d="M370 210 L400 280 L430 210 Z" fill="#fff" opacity=".25"/>`);
}

function towel(c1: string, c2: string, bgA: string, bgB: string) {
  const stripes = (y0: number, h: number) =>
    Array.from({ length: 9 }, (_, i) => `<rect x="150" y="${y0 + i * (h / 9)}" width="500" height="${h / 18}" fill="${i % 3 === 0 ? c2 : '#fbf8f1'}" opacity=".9"/>`).join('');
  return svg(`${bg(bgA, bgB)}${shadow(400, 640, 300, 36)}
    <rect x="150" y="470" width="500" height="150" rx="10" fill="${c1}"/>${stripes(470, 150)}
    <rect x="160" y="330" width="480" height="150" rx="10" fill="${c1}"/>
    ${Array.from({ length: 9 }, (_, i) => `<rect x="160" y="${330 + i * 16.6}" width="480" height="8" fill="${i % 3 === 0 ? c2 : '#fbf8f1'}" opacity=".85"/>`).join('')}
    <rect x="170" y="190" width="460" height="150" rx="10" fill="${c1}"/>
    ${Array.from({ length: 9 }, (_, i) => `<rect x="170" y="${190 + i * 16.6}" width="460" height="8" fill="${i % 3 === 0 ? c2 : '#fbf8f1'}" opacity=".85"/>`).join('')}
    ${Array.from({ length: 24 }, (_, i) => `<line x1="${180 + i * 19}" y1="340" x2="${178 + i * 19}" y2="372" stroke="${c1}" stroke-width="5" stroke-linecap="round"/>`).join('')}
    <rect x="150" y="470" width="500" height="10" fill="#000" opacity=".08"/>`);
}

function wallet(c: string, stitch: string, bgA: string, bgB: string) {
  return svg(`${bg(bgA, bgB)}${shadow(400, 600, 260, 30)}
    <rect x="160" y="250" width="480" height="340" rx="34" fill="${c}"/>
    <rect x="182" y="272" width="436" height="296" rx="24" fill="none" stroke="${stitch}" stroke-width="4" stroke-dasharray="12 9"/>
    <path d="M160 300 Q400 360 640 300 L640 250 Q640 250 606 250 L194 250 Q160 250 160 284Z" fill="#000" opacity=".12"/>
    <rect x="270" y="410" width="260" height="70" rx="10" fill="#000" opacity=".1"/>
    <text x="400" y="456" font-family="Georgia, serif" font-size="30" text-anchor="middle" fill="${stitch}" opacity=".8">A · K</text>
    <path d="M200 300 Q260 280 300 290" stroke="#fff" stroke-width="8" opacity=".15" fill="none" stroke-linecap="round"/>`);
}

function tote(c: string, strap: string, bgA: string, bgB: string) {
  return svg(`${bg(bgA, bgB)}${shadow(400, 650, 250, 30)}
    <path d="M300 330 Q300 160 400 160 Q500 160 500 330" stroke="${strap}" stroke-width="26" fill="none"/>
    <path d="M200 320 L600 320 L630 640 L170 640 Z" fill="${c}"/>
    <path d="M200 320 L600 320 L604 360 L196 360 Z" fill="#000" opacity=".12"/>
    <path d="M220 345 L580 345" stroke="#f3dcc0" stroke-width="3" stroke-dasharray="10 8"/>
    <circle cx="300" cy="330" r="14" fill="#c8a165"/><circle cx="500" cy="330" r="14" fill="#c8a165"/>
    <path d="M230 400 Q260 520 240 620" stroke="#fff" stroke-width="12" opacity=".12" fill="none" stroke-linecap="round"/>`);
}

function evilEye(bgA: string, bgB: string) {
  const eye = (x: number, y: number, r: number) => `<g transform="translate(${x} ${y})">
    <circle r="${r}" fill="#1d4ed8"/><circle r="${r * 0.72}" fill="#fff"/><circle r="${r * 0.5}" fill="#60a5fa"/><circle r="${r * 0.28}" fill="#0b1020"/><circle cx="${-r * 0.3}" cy="${-r * 0.35}" r="${r * 0.12}" fill="#fff" opacity=".8"/></g>`;
  return svg(`${bg(bgA, bgB)}
    <path d="M400 60 L400 150" stroke="#8b6b4a" stroke-width="4"/>
    <circle cx="400" cy="60" r="10" fill="#8b6b4a"/>
    ${eye(400, 260, 110)}
    <path d="M400 370 L400 420" stroke="#8b6b4a" stroke-width="4"/>
    ${eye(400, 470, 55)}<path d="M400 525 L400 560" stroke="#8b6b4a" stroke-width="4"/>${eye(400, 600, 42)}
    ${[0, 1, 2, 3, 4].map((i) => `<circle cx="${400}" cy="${660 + i * 22}" r="8" fill="${i % 2 ? '#e0b354' : '#1d4ed8'}"/>`).join('')}`);
}

function cezve(bgA: string, bgB: string) {
  return svg(`${bg(bgA, bgB)}${shadow(380, 630, 200, 28)}
    <path d="M480 360 L700 300" stroke="#3a2516" stroke-width="26" stroke-linecap="round"/>
    <path d="M480 360 L560 338" stroke="url(#copper)" stroke-width="30"/>
    <path d="M250 300 Q240 330 270 360 Q210 470 240 620 Q380 660 520 620 Q550 470 490 360 Q520 330 510 300 Z" fill="url(#copper)"/>
    <ellipse cx="380" cy="300" rx="130" ry="22" fill="#5a2d14"/>
    <path d="M240 300 Q232 280 220 285" stroke="url(#copper)" stroke-width="14" fill="none" stroke-linecap="round"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<circle cx="${280 + i * 33}" cy="${470 + (i % 2) * 30}" r="5" fill="#5a2d14" opacity=".45"/>`).join('')}
    <path d="M290 400 Q275 500 290 600" stroke="#fff" stroke-width="12" opacity=".2" fill="none" stroke-linecap="round"/>`);
}

function lamp(bgA: string, bgB: string) {
  const tiles = ['#c0392b', '#e67e22', '#f1c40f', '#16a085', '#2980b9', '#8e44ad'];
  let mosaic = '';
  for (let r = 0; r < 7; r++) for (let c = 0; c < 12; c++) {
    const x = 240 + c * 27 + (r % 2) * 13; const y = 250 + r * 30;
    const w = Math.sin((r / 6) * Math.PI) * 160 + 20;
    if (Math.abs(x + 12 - 400) > w) continue;
    mosaic += `<rect x="${x}" y="${y}" width="22" height="24" rx="4" fill="${tiles[(r * 3 + c) % tiles.length]}" opacity=".95"/>`;
  }
  return svg(`${bg(bgA, bgB)}<rect width="${S}" height="${S}" fill="#000" opacity=".25"/>
    <circle cx="400" cy="360" r="260" fill="#f5c46b" opacity=".18"/>
    <path d="M400 60 L400 200" stroke="#c8a165" stroke-width="5"/>
    <path d="M370 200 L430 200 L420 240 L380 240Z" fill="#c8a165"/>
    <ellipse cx="400" cy="350" rx="190" ry="125" fill="#2b1a10"/>${mosaic}
    <path d="M360 470 L440 470 L420 520 L380 520Z" fill="#c8a165"/>
    <circle cx="400" cy="540" r="16" fill="#c8a165"/>`);
}

export const PRODUCT_IMAGES: Record<string, () => string> = {
  'iznik-bowl-blue': () => iznikBowl('#1e4f9c', '#c0392b', '#f6efe3', '#e2d6c2'),
  'iznik-bowl-turquoise': () => iznikBowl('#138a8a', '#e0a526', '#f3f0ea', '#d9d2c4'),
  'ceramic-mug-terracotta': () => mug('#b45a3c', '#f4ede2', '#ddd0bb'),
  'ceramic-mug-sage': () => mug('#7d9a7a', '#f2efe7', '#d7d2c3'),
  'iznik-plate-tulip': () => plate('#1e4f9c', '#c0392b', '#efe9dd', '#d6cbb6'),
  'iznik-plate-green': () => plate('#2f7d5b', '#e0a526', '#f2eee6', '#d3cbbb'),
  'telkari-necklace-turquoise': () => necklace('#1fb5a8', '#2f3a48', '#141a22'),
  'telkari-necklace-garnet': () => necklace('#9b1c31', '#2c4a42', '#10201c'),
  'telkari-earrings': () => earrings('#2aa198', '#efeae2', '#d2c8b8'),
  'telkari-earrings-pearl': () => earrings('#f5f0e6', '#33404f', '#151b24'),
  'silver-ring-amethyst': () => ring('#7b3fa0', '#f1ece4', '#d6ccbd'),
  'peshtemal-indigo': () => towel('#2c3e66', '#9fb4d8', '#f4f0e8', '#dcd3c3'),
  'peshtemal-terracotta': () => towel('#b4583a', '#f0c9a8', '#f3eee6', '#dbcfbd'),
  'peshtemal-sage': () => towel('#6f8f6c', '#d9e6cf', '#f2efe8', '#d6d0c2'),
  'leather-wallet-cognac': () => wallet('#9a5428', '#f2d1a8', '#efe8dc', '#d4c6b1'),
  'leather-wallet-black': () => wallet('#26221f', '#c8a165', '#ece8e1', '#cfc8bd'),
  'leather-tote-tan': () => tote('#b77a45', '#7a4a26', '#f1ebe1', '#d8cbb7'),
  'evil-eye-hanging': () => evilEye('#f3efe8', '#d9d0c1'),
  'copper-cezve': () => cezve('#efe7da', '#d2c3ab'),
  'mosaic-lamp': () => lamp('#3a2a3e', '#120c16'),
};

export async function generateProductImages(publicDir: string) {
  const out = path.join(publicDir, 'demo');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, render] of Object.entries(PRODUCT_IMAGES)) {
    await sharp(Buffer.from(render())).jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(out, `${name}.jpg`));
  }
  console.log(`[demo] wrote ${Object.keys(PRODUCT_IMAGES).length} product images to ${out}`);
}


// ---------------------------------------------------------------------------
// Database seed
// ---------------------------------------------------------------------------

const DEFAULT_DB = 'postgresql://postgres@localhost:5544/kx_gtm_preview';
const DB_URL = process.env.DATABASE_URL || DEFAULT_DB;

function assertLocalDb(url: string) {
  let host = '';
  try { host = new URL(url).hostname; } catch { /* fallthrough */ }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    console.error(`[demo] REFUSING to run: DATABASE_URL host is "${host || 'unparseable'}". This seed only runs against a local database.`);
    process.exit(2);
  }
}

export const DEMO_USER_ID = 'demo-user-kolayxport';
export const DEMO_EMAIL = 'demo@kolayxport.test';
export const DEMO_PASSWORD_DEFAULT = 'KolayDemo!2026';
const ETSY_SHOP_ID = '48291736';
const ETSY_SHOP_NAME = 'DemoAtolyeStudio';
const TRENDYOL_SUPPLIER_ID = '990417';
const WIX_SITE_ID = 'demo-wix-site-7f3c';
export const DEMO_HTTPS_IMG_HOST = 'https://demo-cdn.kolayxport.test';

// Deterministic PRNG so every run produces the same demo.
let seedState = 20261017;
const rnd = () => { seedState = (seedState * 1664525 + 1013904223) % 4294967296; return seedState / 4294967296; };
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
const NOW = Date.now();
const daysAgo = (d: number, h = 10) => new Date(NOW - d * DAY - (h % 24) * 3_600_000);
const img = (key: string) => `/demo/${key}.jpg`;


const PEOPLE = [
  { name: 'Emily Carter', street1: '418 Maple Grove Ave', city: 'Portland', state: 'OR', postal: '97205', country: 'US' },
  { name: 'Michael Brooks', street1: '72 Willow Creek Rd', city: 'Austin', state: 'TX', postal: '78704', country: 'US' },
  { name: 'Sarah Whitman', street1: '1550 Harbor View Dr', city: 'San Diego', state: 'CA', postal: '92101', country: 'US' },
  { name: 'Jessica Nguyen', street1: '90 Orchard Lane', city: 'Brooklyn', state: 'NY', postal: '11215', country: 'US' },
  { name: 'Daniel Foster', street1: '3301 Lakeshore Blvd', city: 'Chicago', state: 'IL', postal: '60657', country: 'US' },
  { name: 'Olivia Bennett', street1: '27 Kingsley Gardens', city: 'London', state: '', postal: 'N1 7RB', country: 'GB' },
  { name: 'Harry Collins', street1: '8 Thornbury Close', city: 'Manchester', state: '', postal: 'M20 4QP', country: 'GB' },
  { name: 'Lena Hoffmann', street1: 'Lindenstraße 41', city: 'Berlin', state: '', postal: '10969', country: 'DE' },
  { name: 'Jonas Becker', street1: 'Am Rosenhang 12', city: 'München', state: '', postal: '81477', country: 'DE' },
  { name: 'Camille Laurent', street1: '14 Rue des Tilleuls', city: 'Lyon', state: '', postal: '69003', country: 'FR' },
  { name: 'Sophie van Dijk', street1: 'Prinsengracht 288', city: 'Amsterdam', state: '', postal: '1016 HJ', country: 'NL' },
  { name: 'Liam O\'Connor', street1: '61 Cedar Bay Crescent', city: 'Toronto', state: 'ON', postal: 'M4L 2T7', country: 'CA' },
  { name: 'Chloe Mitchell', street1: '9 Banksia Street', city: 'Melbourne', state: 'VIC', postal: '3121', country: 'AU' },
  { name: 'Hannah Reed', street1: '205 Pinecrest Way', city: 'Denver', state: 'CO', postal: '80206', country: 'US' },
  { name: 'Grace Turner', street1: '44 Elmstead Court', city: 'Seattle', state: 'WA', postal: '98109', country: 'US' },
  { name: 'Marco Rossi', street1: 'Via dei Glicini 7', city: 'Milano', state: '', postal: '20144', country: 'IT' },
  { name: 'Ella Johansson', street1: 'Björkvägen 19', city: 'Stockholm', state: '', postal: '11346', country: 'SE' },
  { name: 'Noah Williams', street1: '1187 Riverbend Pkwy', city: 'Nashville', state: 'TN', postal: '37206', country: 'US' },
  { name: 'Ava Thompson', street1: '36 Juniper Hill', city: 'Boston', state: 'MA', postal: '02130', country: 'US' },
  { name: 'Isla Murray', street1: '3 Rowan Terrace', city: 'Edinburgh', state: '', postal: 'EH3 9LN', country: 'GB' },
];
const TR_PEOPLE = [
  { name: 'Ayşe Yıldırım', street1: 'Bağdat Cad. No:214 D:6', city: 'İstanbul', state: 'Kadıköy', postal: '34728', country: 'TR' },
  { name: 'Mehmet Kaya', street1: 'Atatürk Bulvarı No:88 D:12', city: 'Ankara', state: 'Çankaya', postal: '06680', country: 'TR' },
  { name: 'Zeynep Demir', street1: 'Kordon Boyu Sok. No:15', city: 'İzmir', state: 'Karşıyaka', postal: '35540', country: 'TR' },
  { name: 'Elif Şahin', street1: 'Nilüfer Cad. No:42 D:3', city: 'Bursa', state: 'Nilüfer', postal: '16110', country: 'TR' },
  { name: 'Burak Aydın', street1: 'Lara Yolu No:120', city: 'Antalya', state: 'Muratpaşa', postal: '07230', country: 'TR' },
  { name: 'Selin Arslan', street1: 'Moda Cad. No:31 D:2', city: 'İstanbul', state: 'Kadıköy', postal: '34710', country: 'TR' },
  { name: 'Can Öztürk', street1: 'Tunalı Hilmi Cad. No:57', city: 'Ankara', state: 'Çankaya', postal: '06700', country: 'TR' },
];

function fedexTracking() { return `7${String(between(10_000_000_000, 99_999_999_999))}`; }
function upsTracking() {
  const a = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  let s = '1Z'; for (let i = 0; i < 6; i++) s += a[between(0, a.length - 1)];
  return `${s}03${String(between(10_000_000, 99_999_999))}`;
}
function dhlEcomTracking() { return `${between(100000, 999999)}${between(100000, 999999)}`; }

const ETSY_LISTING_BASE = BigInt(1790000000);

async function main() {
  const root = path.resolve(__dirname, '..', '..');
  await generateProductImages(path.join(root, 'public'));
  if (process.argv.includes('--images')) return;

  assertLocalDb(DB_URL);
  const { PrismaClient, Prisma } = await import('@prisma/client');
  const bcrypt = (await import('bcryptjs')).default;
  const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  const uid = DEMO_USER_ID;
  const D = (n: number) => new Prisma.Decimal(n.toFixed(2));

  try {
    // ---- 0. wipe previous demo data (idempotent) -------------------------
    const prevOrders = await prisma.order.findMany({ where: { userId: uid }, select: { id: true } });
    const orderIds = prevOrders.map((o) => o.id);
    const prevItems = await prisma.orderItem.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await prisma.labelJob.deleteMany({ where: { orderItemId: { in: prevItems.map((i) => i.id) } } });
    await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.trackingSubmission.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderShipping.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEffect.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.senkronOrderData.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => undefined);
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { userId: uid } });
    await prisma.etsyListingOffering.deleteMany({ where: { etsyShopId: ETSY_SHOP_ID } });
    await prisma.etsyListingDailyStat.deleteMany({ where: { etsyShopId: ETSY_SHOP_ID } });
    await prisma.etsyListingVersion.deleteMany({ where: { etsyShopId: ETSY_SHOP_ID } });
    const prevDrafts = await prisma.etsyListingDraft.findMany({ where: { userId: uid }, select: { id: true } });
    await prisma.etsyDraftMedia.deleteMany({ where: { draftId: { in: prevDrafts.map((d) => d.id) } } });
    await prisma.etsyDraftSyncAttempt.deleteMany({ where: { draftId: { in: prevDrafts.map((d) => d.id) } } });
    await prisma.etsyListingDraft.deleteMany({ where: { userId: uid } });
    await prisma.etsyListing.deleteMany({ where: { etsyShopId: ETSY_SHOP_ID } });
    await prisma.etsyShop.deleteMany({ where: { OR: [{ userId: uid }, { shopId: ETSY_SHOP_ID }] } });
    const prevStock = await prisma.stockItem.findMany({ where: { userId: uid }, select: { id: true } });
    const sIds = prevStock.map((s) => s.id);
    await prisma.stockPush.deleteMany({ where: { userId: uid } });
    await prisma.stockLedger.deleteMany({ where: { stockItemId: { in: sIds } } });
    await prisma.stockLink.deleteMany({ where: { stockItemId: { in: sIds } } });
    await prisma.stockObservation.deleteMany({ where: { userId: uid } });
    await prisma.stockSnapshot.deleteMany({ where: { userId: uid } });
    await prisma.stockItem.deleteMany({ where: { userId: uid } });
    await prisma.stockSettings.deleteMany({ where: { userId: uid } });
    for (const m of ['financialTransaction', 'financialSyncCursor', 'productCost', 'trendyolProduct', 'ebayListing', 'inboxThread', 'savedReply',
      'notification', 'connectionAuthState', 'syncOperation', 'syncLog', 'arbitrageResultRecord', 'shipperProfile', 'credential'] as const) {
      await (prisma as any)[m].deleteMany({ where: { userId: uid } });
    }
    await prisma.wixSite.deleteMany({ where: { OR: [{ userId: uid }, { siteId: WIX_SITE_ID }] } });
    await prisma.researchCache.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { OR: [{ id: uid }, { email: DEMO_EMAIL }] } });

    // ---- 1. user, sender profile, credentials -----------------------------
    const password = await bcrypt.hash(process.env.DEMO_PASSWORD || DEMO_PASSWORD_DEFAULT, 10);
    await prisma.user.create({
      data: {
        id: uid,
        name: 'Deniz Aksoy',
        email: DEMO_EMAIL,
        emailVerified: daysAgo(120),
        password,
        subscriptionPlan: 'pro',
        subscriptionStatus: 'active',
        billingProvider: 'stripe',
        billingInterval: 'month',
        usageResetAt: new Date(NOW + 18 * DAY),
        onboardingStep: 99,
        labelCount: 214,
        orderSyncCount: 1386,
        lastSyncedAt: new Date(NOW - 6 * 60_000),
        createdAt: daysAgo(200),
        shippingSettings: {
          packagePresets: [
            { id: 'small-box', name: 'Small box', length: 20, width: 15, height: 10, weightKg: 0.6 },
            { id: 'towel-mailer', name: 'Towel mailer', length: 30, width: 25, height: 6, weightKg: 0.45 },
            { id: 'jewelry', name: 'Jewelry box', length: 12, width: 10, height: 5, weightKg: 0.15 },
          ],
        },
      },
    });
    await prisma.shipperProfile.create({
      data: {
        userId: uid,
        shipperName: 'Demo Atölye Ltd.',
        shipperPersonName: 'Deniz Aksoy',
        shipperPhoneNumber: '+905550000000',
        shipperStreet1: 'Örnek Mah. Atölye Sok. No:12',
        shipperStreet2: 'Kat 2',
        shipperCity: 'İstanbul',
        shipperStateCode: 'Beyoğlu',
        shipperPostalCode: '34430',
        shipperCountryCode: 'TR',
        shipperTinNumber: '0000000000',
        shipperTinType: 'BUSINESS_NATIONAL',
        defaultCurrencyCode: 'USD',
        defaultCountryOfMfg: 'TR',
        defaultHarmonizedCode: '691200',
        defaultPackagingType: 'YOUR_PACKAGING',
        defaultServiceType: 'INTERNATIONAL_ECONOMY',
        defaultWeightKg: 0.5,
      },
    });
    const farFuture = new Date(NOW + 365 * DAY);
    // Fake, non-functional tokens: only their presence is checked by connection status.
    await prisma.credential.create({
      data: {
        userId: uid,
        etsyAccessToken: 'demo-etsy-access', etsyRefreshToken: 'demo-etsy-refresh', etsyShopId: ETSY_SHOP_ID, etsyTokenExpiresAt: farFuture,
        ebayAccessToken: 'demo-ebay-access', ebayRefreshToken: 'demo-ebay-refresh', ebayTokenExpiresAt: farFuture,
        amazonAccessToken: 'demo-amazon-access', amazonRefreshToken: 'demo-amazon-refresh', amazonTokenExpiresAt: farFuture,
        amazonSellerId: 'A1DEMOSELLER00', amazonMarketplaceId: 'ATVPDKIKX0DER', amazonMarketplaceIds: ['ATVPDKIKX0DER'], amazonRegion: 'na',
        trendyolApiKey: 'demo-trendyol-key', trendyolApiSecret: 'demo-trendyol-secret', trendyolSupplierId: TRENDYOL_SUPPLIER_ID,
        fedexApiKey: 'demo-fedex-key', fedexApiSecret: 'demo-fedex-secret', fedexAccountNumber: '000000001234',
        upsApiKey: 'demo-ups-key', upsApiSecret: 'demo-ups-secret', upsAccountNumber: '00000A5678',
        mngCustomerNumber: '000000', mngPassword: 'demo-mng-password',
        wixInstanceId: 'demo-wix-instance', wixSiteId: WIX_SITE_ID,
      },
    });
    await prisma.etsyShop.create({
      data: {
        userId: uid, shopId: ETSY_SHOP_ID, shopName: ETSY_SHOP_NAME, accessToken: 'demo-etsy-access', refreshToken: 'demo-etsy-refresh',
        tokenExpiresAt: farFuture, isDefault: true, isActive: true, lastListingSyncAt: new Date(NOW - 4 * 60_000), lastWebhookAt: new Date(NOW - 9 * 60_000), lastListingReconcileAt: new Date(NOW - 4 * 60_000), lastOrderPollAt: new Date(NOW - 3 * 60_000),
      },
    });
    await prisma.wixSite.create({
      data: { userId: uid, siteId: WIX_SITE_ID, instanceId: 'demo-wix-instance', siteName: 'Demo Atölye Shop', siteUrl: 'https://demo-atolye.example', accessToken: 'demo-wix-access', isActive: true, lastOrderSyncAt: new Date(NOW - 20 * 60_000), catalogVersion: 'V3' },
    });
    await prisma.syncOperation.create({ data: { userId: uid, type: 'orders', status: 'completed', metrics: { fetched: 40, created: 0, updated: 3 } } });

    // ---- 2. Etsy listings -------------------------------------------------
    const nowSec = Math.floor(NOW / 1000);
    const etsyHealth = [96, 92, 88, 85, 94, 79, 91, 87, 83, 76, 68, 98, 93, 81, 89, 90, 72, 64, 58, 86, 84, 95, 77, 88, 47];
    const failsFor = (score: number): string[] => (score >= 90 ? [] : score >= 80 ? ['photos_alt'] : score >= 70 ? ['photos_alt', 'video'] : score >= 60 ? ['tags_count', 'video', 'photos_alt'] : ['tags_count', 'photos_count', 'title_length', 'video']);
    for (let i = 0; i < PRODUCTS.length; i++) {
      const p = PRODUCTS[i];
      const score = etsyHealth[i];
      const listingId = ETSY_LISTING_BASE + BigInt(i * 7919 + 1234);
      const tags = TAGS[p.cat].slice(0, score < 60 ? 8 : 13);
      const state = i === 17 ? 'sold_out' : i === 24 ? 'inactive' : 'active';
      const title = score < 50 ? p.title.split(',')[0] : p.title;
      await prisma.etsyListing.create({
        data: {
          etsyShopId: ETSY_SHOP_ID,
          etsyListingId: listingId,
          title,
          description: `${p.title}.\n\nHandmade in our small workshop in Istanbul and shipped worldwide with tracking. Every piece is made to order, so small variations make each one unique.\n\nDetails\n- Materials: ${MATERIALS[p.cat].join(', ')}\n- Ships from Istanbul, Turkey in 1-3 business days\n- Gift wrapping available\n\nQuestions? Send us a message, we reply within a few hours.`,
          tags,
          materials: MATERIALS[p.cat],
          priceAmount: Math.round(p.price * 100), priceDivisor: 100, priceCurrencyCode: 'USD',
          views: between(180, 4200), numFavorers: between(12, 640), quantity: state === 'sold_out' ? 0 : between(3, 40),
          state, url: `https://www.etsy.com/listing/${listingId}`,
          shopSectionId: BigInt(SECTION[p.cat]), lastWebhookAt: new Date(NOW - between(9, 600) * 60_000),
          taxonomyId: TAXONOMY[p.cat], whoMade: 'i_did', whenMade: 'made_to_order', isSupply: false,
          processingMin: 1, processingMax: 3,
          isPersonalizable: !!p.personalizable, personalizationInstructions: p.personalizable ? 'Enter up to 3 initials' : null, personalizationCharCountMax: p.personalizable ? 3 : null,
          thumbnailUrl75x75: img(p.image), thumbnailUrl170x135: img(p.image), thumbnailUrl570xN: img(p.image),
          imageCount: score < 50 ? 3 : between(6, 10), hasVideo: score >= 80,
          etsyCreatedTimestamp: nowSec - between(30, 400) * 86400, etsyUpdatedTimestamp: nowSec - between(0, 20) * 86400,
          syncedAt: new Date(NOW - 4 * 60_000),
          healthScore: score, healthChecksUsed: 12, healthChecksTotal: 12, healthFails: failsFor(score),
        },
      });
      await prisma.etsyListingOffering.create({
        data: { etsyShopId: ETSY_SHOP_ID, etsyListingId: listingId, variantKey: '', variantValueKey: '', sku: p.sku, skuNormalized: p.sku.toLowerCase(), quantity: 10, priceAmount: Math.round(p.price * 100), priceDivisor: 100 },
      });
      for (let d = 0; d < 30; d++) {
        await prisma.etsyListingDailyStat.create({
          data: { etsyShopId: ETSY_SHOP_ID, etsyListingId: listingId, date: new Date(new Date(NOW - d * DAY).toISOString().slice(0, 10)), views: between(4, 60), favorites: between(0, 6), unitsSold: rnd() < 0.15 ? 1 : 0, orders: 0, currency: 'USD', state: 'active', taxonomyId: TAXONOMY[p.cat] },
        });
      }
    }
    // One staged draft so the "unsent changes" UI has something to show.
    await prisma.etsyListingDraft.create({
      data: { userId: uid, etsyShopId: ETSY_SHOP_ID, etsyListingId: ETSY_LISTING_BASE + BigInt(1234), status: 'draft', fieldPatch: { title: 'Handmade Iznik Ceramic Bowl, Cobalt Blue Tulip Bowl, Turkish Pottery Serving Bowl, Housewarming Gift' } as any },
    }).catch((e) => console.warn('[demo] draft skipped:', (e as Error).message));

    // Two listings still in Turkish (a new seller's Trendyol copies), so the TR→EN "Çevir / AI açıklama" job has
    // something to translate in the demo.
    const TR_LISTINGS = [
      { p: PRODUCTS[0], tags: ['iznik kase', 'el yapımı çini', 'kobalt mavi', 'türk seramik', 'servis kasesi', 'lale desenli', 'hediyelik kase', 'çini kase', 'mutfak dekoru', 'ev hediyesi'],
        description: 'El yapımı İznik çini kase, kobalt mavisi lale deseniyle tek tek elde boyanır.\n\nÖzellikler\n- Çap: 20 cm\n- Malzeme: seramik, sır\n- İstanbul atölyemizde 1-3 iş gününde kargoya verilir\n\nHer parça el yapımı olduğu için küçük farklılıklar olabilir.' },
      { p: PRODUCTS[11], tags: ['peştamal', 'plaj havlusu', 'pamuk havlu', 'hamam havlusu', 'indigo çizgili', 'türk havlusu', 'hafif havlu', 'banyo havlusu'],
        description: 'Yüzde yüz pamuk indigo çizgili peştamal. Hafif, çabuk kurur, plajda ve banyoda kullanılır.\n\nÖlçü: 90 x 180 cm\nYıkama: 30 derecede makinede yıkanabilir\n\nİstanbul\'dan takipli kargo ile gönderilir.' },
    ];
    for (let k = 0; k < TR_LISTINGS.length; k++) {
      const { p, tags, description } = TR_LISTINGS[k];
      const listingId = ETSY_LISTING_BASE + BigInt(900001 + k);
      await prisma.etsyListing.create({
        data: {
          etsyShopId: ETSY_SHOP_ID, etsyListingId: listingId, title: p.trTitle, description, tags, materials: MATERIALS[p.cat],
          priceAmount: Math.round(p.price * 100), priceDivisor: 100, priceCurrencyCode: 'USD',
          views: between(20, 120), numFavorers: between(0, 8), quantity: between(5, 20), state: 'active', url: `https://www.etsy.com/listing/${listingId}`,
          shopSectionId: BigInt(SECTION[p.cat]), lastWebhookAt: new Date(NOW - between(9, 600) * 60_000),
          taxonomyId: TAXONOMY[p.cat], whoMade: 'i_did', whenMade: 'made_to_order', isSupply: false, processingMin: 1, processingMax: 3,
          isPersonalizable: false,
          thumbnailUrl75x75: img(p.image), thumbnailUrl170x135: img(p.image), thumbnailUrl570xN: img(p.image),
          imageCount: 5, hasVideo: false,
          etsyCreatedTimestamp: nowSec - between(2, 10) * 86400, etsyUpdatedTimestamp: nowSec - between(0, 2) * 86400,
          syncedAt: new Date(NOW - 4 * 60_000),
          healthScore: 62, healthChecksUsed: 12, healthChecksTotal: 12, healthFails: ['tags_count', 'video', 'photos_alt'],
        },
      });
      await prisma.etsyListingOffering.create({
        data: { etsyShopId: ETSY_SHOP_ID, etsyListingId: listingId, variantKey: '', variantValueKey: '', sku: `${p.sku}-TR`, skuNormalized: `${p.sku}-tr`.toLowerCase(), quantity: 10, priceAmount: Math.round(p.price * 100), priceDivisor: 100 },
      });
    }

    // ---- 3. eBay listings + Trendyol products -----------------------------
    const ebayIdx = [0, 4, 6, 7, 8, 11, 12, 15, 16, 19, 20, 17];
    for (const [n, i] of ebayIdx.entries()) {
      const p = PRODUCTS[i];
      const score = [91, 84, 95, 88, 73, 90, 86, 69, 82, 93, 78, 61][n];
      await prisma.ebayListing.create({
        data: {
          userId: uid, sku: p.sku, offerId: `90${1000000 + n * 37}`, listingId: `3${String(65000000000 + n * 104729)}`,
          title: p.title.slice(0, 80), description: `<p>${p.title}</p><p>Handmade in Istanbul. Ships worldwide with tracking.</p>`,
          priceValue: (p.price * 1.08).toFixed(2), priceCurrency: 'USD', quantity: between(2, 25), condition: 'NEW',
          categoryName: { ceramics: 'Pottery & Glass', silver: 'Fine Necklaces & Pendants', towel: 'Beach Towels', leather: "Men's Wallets", decor: 'Home Décor' }[p.cat],
          categoryId: String(between(10000, 99999)), status: 'PUBLISHED', marketplaceId: 'EBAY_US',
          imageUrl: img(p.image), imageUrls: [img(p.image)], imageCount: between(5, 12),
          aspects: { Brand: ['Demo Atölye'], 'Country/Region of Manufacture': ['Turkey'], Material: [MATERIALS[p.cat][0]] },
          ebayCreatedAt: daysAgo(between(40, 300)).toISOString(), ebayUpdatedAt: daysAgo(between(0, 15)).toISOString(), syncedAt: new Date(NOW - 5 * 60_000),
          healthScore: score, healthChecksUsed: 10, healthChecksTotal: 10, healthFails: score >= 85 ? [] : ['item_specifics'],
        },
      });
    }
    const tyIdx = [0, 1, 2, 3, 4, 6, 8, 11, 12, 13, 15, 18, 19];
    for (const [n, i] of tyIdx.entries()) {
      const p = PRODUCTS[i];
      const tryPrice = Math.round(p.price * 24) + 0.9;
      await prisma.trendyolProduct.create({
        data: {
          userId: uid, supplierId: TRENDYOL_SUPPLIER_ID, barcode: `8690000${String(100 + n).padStart(6, '0')}`, stockCode: p.sku, productMainId: `${p.sku}-TY`, trendyolId: String(70000000 + n * 311),
          title: p.trTitle, description: `${p.trTitle}. Atölyemizde el yapımı olarak üretilmiştir.`, brandName: 'Demo Atölye',
          categoryName: { ceramics: 'Kase & Tabak', silver: 'Gümüş Takı', towel: 'Havlu', leather: 'Cüzdan', decor: 'Dekoratif Obje' }[p.cat],
          categoryId: { ceramics: 1203, silver: 1247, towel: 839, leather: 1108, decor: 1877 }[p.cat],
          listPrice: D(Math.round(tryPrice * 1.25)), salePrice: D(tryPrice), currencyType: 'TRY', quantity: n === 5 ? 0 : between(4, 60), vatRate: 10,
          images: [{ url: img(p.image) }], thumbnailUrl: img(p.image), imageCount: between(3, 8),
          approved: true, onSale: true, trendyolCreatedDate: daysAgo(between(30, 300)), trendyolLastUpdate: daysAgo(between(0, 10)), syncedAt: new Date(NOW - 8 * 60_000),
          healthScore: [88, 92, 79, 84, 90, 95, 73, 86, 91, 67, 82, 94, 77][n], healthChecksUsed: 9, healthChecksTotal: 9,
        },
      });
    }

    // ---- 4. Orders --------------------------------------------------------
    type Mp = 'Etsy' | 'eBay' | 'Amazon' | 'Trendyol';
    const plan: Mp[] = [
      ...Array(16).fill('Etsy'), ...Array(9).fill('eBay'), ...Array(8).fill('Amazon'), ...Array(7).fill('Trendyol'),
    ];
    // Interleave so the newest orders show a mix of stores.
    plan.sort(() => rnd() - 0.5);
    // Newest order: an Etsy order to the US (the hero row for the create-label screenshot).
    const firstEtsy = plan.indexOf('Etsy');
    [plan[0], plan[firstEtsy]] = [plan[firstEtsy], plan[0]];
    let etsyNo = 3412870150, ebayNo = 0, amzNo = 0, tyNo = 10284551;
    const orderMeta: Array<{ id: string; mp: Mp; number: string; sku: string; name: string; price: number; date: Date; currency: string }> = [];
    for (let k = 0; k < plan.length; k++) {
      const mp = plan[k];
      const ageDays = Math.min(29, Math.floor(k * 0.72) + (k < 6 ? 0 : 1));
      const date = daysAgo(ageDays, between(7, 22));
      const isOpen = ageDays <= 3;
      const person = mp === 'Trendyol' ? TR_PEOPLE[k % TR_PEOPLE.length] : PEOPLE[(k * 7) % PEOPLE.length];
      const pool = mp === 'Trendyol' ? tyIdx : mp === 'eBay' ? ebayIdx : PRODUCTS.map((_, i) => i);
      const nItems = rnd() < 0.22 ? 2 : 1;
      const items = Array.from({ length: nItems }, (_, j) => PRODUCTS[j === 0 ? pool[(k * 7 + 3) % pool.length] : pick(pool)]);
      const currency = mp === 'Trendyol' ? 'TRY' : mp === 'Amazon' && person.country === 'GB' ? 'GBP' : mp === 'Amazon' && ['DE', 'FR', 'IT', 'NL', 'SE'].includes(person.country) ? 'EUR' : 'USD';
      const fx = currency === 'TRY' ? 24 : currency === 'GBP' ? 0.79 : currency === 'EUR' ? 0.92 : 1;
      const qtys = items.map(() => (rnd() < 0.15 ? 2 : 1));
      const unit = items.map((p) => round2(mp === 'Trendyol' ? Math.round(p.price * fx) + 0.9 : p.price * fx * (mp === 'eBay' ? 1.08 : mp === 'Amazon' ? 1.12 : 1)));
      const shipping = mp === 'Trendyol' ? 0 : mp === 'Etsy' ? (person.country === 'US' ? 0 : 12) : 9.5;
      const total = round2(unit.reduce((s, u, i) => s + u * qtys[i], 0) + shipping);
      const number = mp === 'Etsy' ? String(etsyNo += between(900, 40000))
        : mp === 'eBay' ? `${between(10, 27)}-${String(between(10000, 99999))}-${String(between(10000, 99999))}`
          : mp === 'Amazon' ? `11${between(1, 4)}-${String(between(1000000, 9999999))}-${String(between(1000000, 9999999))}`
            : String(tyNo += between(1500, 90000));
      if (mp === 'eBay') ebayNo++; if (mp === 'Amazon') amzNo++;
      const shipBy = new Date(date.getTime() + (mp === 'Trendyol' ? 2 : 3) * DAY);
      const shippedStatus = mp === 'Trendyol' ? (ageDays > 6 ? 'Delivered' : 'Shipped') : mp === 'Amazon' ? 'Shipped' : mp === 'Etsy' ? (ageDays > 12 ? 'completed' : 'shipped') : 'shipped';
      const openStatus = mp === 'Trendyol' ? 'Created' : mp === 'Amazon' ? 'Unshipped' : 'paid';
      const status = isOpen ? openStatus : shippedStatus;
      const [first, ...rest] = person.name.split(' ');
      const giftNote = mp === 'Etsy' && k % 5 === 1 ? 'Happy birthday Mom! Love, J.' : null;
      const order = await prisma.order.create({
        data: {
          userId: uid, marketplace: mp, marketplaceKey: `${mp.toLowerCase()}-${number}`, orderNumber: number,
          customerName: person.name, status, externalStatus: status, currency, totalPrice: total,
          source: mp === 'Etsy' ? 'etsy-api' : mp === 'eBay' ? 'ebay-api' : mp === 'Amazon' ? 'amazon' : 'trendyol',
          createdAt: date, uiOrderDate: date, shipByAt: shipBy, lastEventAt: date,
          shippingAddress: {
            name: person.name, firstName: first, lastName: rest.join(' '), street1: person.street1, city: person.city, state: person.state,
            postalCode: person.postal, country: person.country, phone: person.country === 'TR' ? '+905550000000' : '+15550100000', email: `${first.toLowerCase()}@example.com`,
          },
          weightKg: round2(items.reduce((s, p) => s + (p.cat === 'silver' ? 0.2 : p.cat === 'towel' ? 0.4 : p.cat === 'leather' ? (p.price > 100 ? 1.1 : 0.3) : p.sku.startsWith('KX-MUG') ? 0.5 : 0.8), 0)),
          weightEditedAt: date,
          packageLength: 25, packageWidth: 20, packageHeight: 10, dimensionUnits: 'CM',
          commodityDesc: items[0].cat === 'silver' ? 'Sterling silver jewelry' : items[0].cat === 'towel' ? 'Cotton towels' : items[0].cat === 'leather' ? 'Leather goods' : 'Handmade ceramic tableware',
          countryOfMfg: 'TR', harmonizedCode: items[0].cat === 'silver' ? '711311' : items[0].cat === 'towel' ? '630260' : items[0].cat === 'leather' ? '420231' : '691200',
          giftMessage: giftNote, customerNote: mp === 'Etsy' && items[0].personalizable ? 'Initials: E.M.C' : null,
          manualShippingCost: isOpen || mp === 'Trendyol' ? null : D(round2(11.2 + rnd() * 3.4)), manualShippingCostCurrency: isOpen || mp === 'Trendyol' ? null : 'USD',
          shippedAt: isOpen ? null : new Date(date.getTime() + between(1, 2) * DAY),
          deliveredAt: status === 'Delivered' || status === 'completed' ? new Date(date.getTime() + 5 * DAY) : null,
          labelStatus: isOpen ? null : 'created',
          rawData: mp === 'Etsy' ? { receipt_id: Number(number), is_shipped: !isOpen, shipments: isOpen ? [] : [{ tracking_code: 'demo', shipment_notification_timestamp: Math.floor(date.getTime() / 1000) + 86400 }] } : undefined,
        },
      });
      for (let i = 0; i < items.length; i++) {
        const p = items[i];
        const listingIdx = PRODUCTS.indexOf(p);
        await prisma.orderItem.create({
          data: {
            orderId: order.id, sku: p.sku, productName: mp === 'Trendyol' ? p.trTitle : p.title, quantity: qtys[i], unitPrice: D(unit[i]), totalPrice: D(unit[i] * qtys[i]),
            image: img(p.image), marketplaceKey: order.marketplaceKey, orderNumber: number, shipBy, uniqueLineKey: `${number}-${i}`, remoteLineId: `${number}-L${i}`,
            countryOfMfg: 'TR', weightKg: p.cat === 'silver' ? 0.15 : 0.5,
            listingRef: mp === 'Etsy' ? String(ETSY_LISTING_BASE + BigInt(listingIdx * 7919 + 1234)) : null,
            variantInfo: p.personalizable && mp === 'Etsy' ? 'Personalization: E.M.C' : p.cat === 'towel' ? 'Size: 100 x 180 cm' : null,
          },
        });
      }
      if (!isOpen) {
        const carrier = person.country === 'TR' ? 'dhl' : ['US', 'CA', 'AU'].includes(person.country) ? 'fedex' : 'ups';
        const trackingNumber = carrier === 'fedex' ? fedexTracking() : carrier === 'ups' ? upsTracking() : dhlEcomTracking();
        await prisma.shipment.create({
          data: {
            orderId: order.id, carrier, status: 'created', trackingNumber,
            serviceType: carrier === 'fedex' ? 'INTERNATIONAL_ECONOMY' : carrier === 'ups' ? 'UPS_WORLDWIDE_SAVER' : 'STANDARD',
            createdAt: new Date(date.getTime() + DAY),
          },
        });
        await prisma.order.update({
          where: { id: order.id },
          data: {
            trackingNumber,
            ...(mp === 'Etsy' ? { rawData: { receipt_id: Number(number), is_shipped: true, shipments: [{ tracking_code: trackingNumber, carrier_name: carrier, shipment_notification_timestamp: Math.floor(date.getTime() / 1000) + 86400 }] } } : {}),
          },
        });
        if (mp === 'Etsy') {
          await prisma.trackingSubmission.create({
            data: {
              orderId: order.id, trackingNumber, carrierId: carrier === 'fedex' ? 2 : 3, carrierName: carrier === 'fedex' ? 'FedEx' : carrier === 'ups' ? 'UPS' : 'DHL eCommerce',
              submittedBy: uid, status: 'submitted', etsySubmitStatus: 'submitted', etsySubmittedAt: new Date(date.getTime() + DAY + 3_600_000),
            },
          });
        }
      }
      orderMeta.push({ id: order.id, mp, number, sku: items[0].sku, name: items[0].title, price: total, date, currency });
    }

    // ---- 5. Finance (profit report) ----------------------------------------
    const tx: any[] = [];
    let txn = 0;
    const etsyCandidates = PRODUCTS.filter((_, i) => i !== 24);
    for (let d = 0; d < 62; d++) {
      const day = daysAgo(d, 12);
      const salesToday = between(2, d % 7 === 5 || d % 7 === 6 ? 6 : 4) + (d < 30 ? 1 : 0);
      for (let s = 0; s < salesToday; s++) {
        const p = pick(etsyCandidates);
        const qty = rnd() < 0.12 ? 2 : 1;
        const gross = round2(p.price * qty);
        const orderNumber = String(3400000000 + d * 100 + s);
        const at = new Date(day.getTime() + s * 1_700_000);
        tx.push({ marketplace: 'etsy', externalId: `demo-etsy-sale-${++txn}`, transactionType: 'Sale', orderNumber, barcode: p.sku, productName: p.title, quantity: qty, amount: D(gross), currency: 'USD', transactionDate: at });
        tx.push({ marketplace: 'etsy', externalId: `demo-etsy-fee-${txn}`, transactionType: 'EtsyFee', orderNumber, barcode: p.sku, productName: 'Transaction fee + processing fee', amount: D(-round2(gross * 0.095 + 0.45)), currency: 'USD', transactionDate: at });
        tx.push({ marketplace: 'etsy', externalId: `demo-etsy-ship-${txn}`, transactionType: 'shipping_label', orderNumber, productName: 'Shipping label', amount: D(-round2(p.cat === 'silver' ? 6.4 : 8.9)), currency: 'USD', transactionDate: at });
      }
      tx.push({ marketplace: 'etsy', externalId: `demo-etsy-ads-${d}`, transactionType: 'Etsy Ads', productName: 'Etsy Ads daily budget', amount: D(-round2(4 + rnd() * 3)), currency: 'USD', transactionDate: day });
      if (d % 9 === 3) tx.push({ marketplace: 'etsy', externalId: `demo-etsy-offsite-${d}`, transactionType: 'offsite ads fee', productName: 'Offsite Ads fee', amount: D(-round2(6 + rnd() * 8)), currency: 'USD', transactionDate: day });
      if (d % 7 === 1) tx.push({ marketplace: 'etsy', externalId: `demo-etsy-disb-${d}`, transactionType: 'Disbursement', productName: 'Deposit to bank', amount: D(-round2(600 + rnd() * 300)), currency: 'USD', transactionDate: day });
      if (d === 11 || d === 40) tx.push({ marketplace: 'etsy', externalId: `demo-etsy-refund-${d}`, transactionType: 'Refund', productName: PRODUCTS[2].title, barcode: PRODUCTS[2].sku, amount: D(-32), currency: 'USD', transactionDate: day });
      if (d % 30 === 2) tx.push({ marketplace: 'etsy', externalId: `demo-etsy-listing-${d}`, transactionType: 'EtsyFee', productName: 'Listing fees (renewals)', amount: D(-round2(8.4)), currency: 'USD', transactionDate: day });
      // eBay + Trendyol (lighter)
      if (d % 2 === 0) {
        const p = PRODUCTS[pick(ebayIdx)];
        const gross = round2(p.price * 1.08);
        tx.push({ marketplace: 'ebay', externalId: `demo-ebay-sale-${d}`, transactionType: 'SALE', orderNumber: `27-${10000 + d}-${20000 + d}`, barcode: p.sku, productName: p.title, amount: D(gross), commission: D(round2(gross * 0.1325)), currency: 'USD', transactionDate: day });
      }
      const pt = PRODUCTS[pick(tyIdx)];
      const tryGross = Math.round(pt.price * 24) + 0.9;
      tx.push({ marketplace: 'trendyol', externalId: `demo-ty-sale-${d}`, transactionType: 'Satış', orderNumber: String(10280000 + d), barcode: pt.sku, productName: pt.trTitle, amount: D(tryGross), commission: D(round2(tryGross * 0.17)), currency: 'TRY', transactionDate: day });
    }
    for (const row of tx) await prisma.financialTransaction.create({ data: { userId: uid, ...row } });
    await prisma.financialSyncCursor.createMany({
      data: [
        { userId: uid, marketplace: 'etsy', lastSyncedTo: new Date(), totalSynced: tx.filter((t) => t.marketplace === 'etsy').length, currentBalance: D(1284.6), balanceCurrency: 'USD' },
        { userId: uid, marketplace: 'ebay', lastSyncedTo: new Date(), totalSynced: 31, currentBalance: D(412.2), balanceCurrency: 'USD', heldFunds: D(96.4) },
        { userId: uid, marketplace: 'trendyol', lastSyncedTo: new Date(), totalSynced: 62, balanceCurrency: 'TRY' },
        { userId: uid, marketplace: 'amazon', lastSyncedTo: new Date(), totalSynced: 0, balanceCurrency: 'USD' },
      ],
    });
    for (const p of PRODUCTS) {
      for (const mp of ['etsy', 'ebay'] as const) {
        await prisma.productCost.create({ data: { userId: uid, marketplace: mp, sku: p.sku, barcode: p.sku, productName: p.title, costAmount: D(p.cost), costCurrency: 'USD', shippingCost: D(p.cat === 'silver' ? 1.2 : 2.5) } });
      }
      await prisma.productCost.create({ data: { userId: uid, marketplace: 'trendyol', sku: p.sku, barcode: p.sku, productName: p.trTitle, costAmount: D(p.cost * 24), costCurrency: 'TRY', shippingCost: D(45) } });
    }

    // ---- 6. Stock sync ------------------------------------------------------
    await prisma.stockSettings.create({ data: { userId: uid, enabled: true, dryRun: false, enabledAt: daysAgo(40), goLiveAt: daysAgo(33), autoFixDrift: true, channels: [] } });
    const stockIdx = [0, 1, 2, 4, 6, 8, 11, 12, 15, 16, 18, 19, 20, 17];
    for (const [n, i] of stockIdx.entries()) {
      const p = PRODUCTS[i];
      const onHand = i === 17 ? 0 : [14, 9, 22, 6, 4, 11, 38, 27, 12, 17, 31, 8, 3, 0][n];
      const item = await prisma.stockItem.create({
        data: { userId: uid, sku: p.sku.toLowerCase(), displaySku: p.sku, title: p.title, imageUrl: img(p.image), onHand, safetyBuffer: p.cat === 'silver' ? 1 : 0, status: n === 12 ? 'needs_review' : 'active', seededAt: daysAgo(33) },
      });
      const listingId = String(ETSY_LISTING_BASE + BigInt(i * 7919 + 1234));
      const links: Array<{ channel: string; accountRef: string; externalId: string }> = [{ channel: 'etsy', accountRef: ETSY_SHOP_ID, externalId: listingId }];
      if (ebayIdx.includes(i)) links.push({ channel: 'ebay', accountRef: 'default', externalId: p.sku });
      const tyPos = tyIdx.indexOf(i);
      if (tyPos >= 0) links.push({ channel: 'trendyol', accountRef: TRENDYOL_SUPPLIER_ID, externalId: `8690000${String(100 + tyPos).padStart(6, '0')}` });
      for (const l of links) {
        const link = await prisma.stockLink.create({
          data: {
            userId: uid, stockItemId: item.id, ...l, remoteSku: p.sku, title: p.title, matchType: 'auto_exact', status: 'active',
            lastSeenRemoteQty: onHand, lastSeenAt: new Date(NOW - between(5, 90) * 60_000), lastPushedQty: onHand, lastPushedAt: daysAgo(between(0, 3)), confirmedAt: daysAgo(33),
          },
        });
        if (l.channel === 'etsy' && n < 6) {
          await prisma.stockPush.create({ data: { userId: uid, stockItemId: item.id, linkId: link.id, reason: 'sale', targetQty: onHand, sentQty: onHand, status: 'applied', attempts: 1, appliedAt: daysAgo(n % 3, 3), remoteQtyAfter: onHand } });
        }
      }
      await prisma.stockLedger.create({ data: { userId: uid, stockItemId: item.id, kind: 'seed', delta: onHand + 3, qtyAfter: onHand + 3, idempotencyKey: `demo-seed-${p.sku}`, actor: 'system', createdAt: daysAgo(33) } });
      await prisma.stockLedger.create({ data: { userId: uid, stockItemId: item.id, kind: 'sale', delta: -3, qtyAfter: onHand, channel: 'etsy', idempotencyKey: `demo-sale-${p.sku}`, actor: 'system', createdAt: daysAgo(n % 5, 4) } });
    }

    // ---- 7. Keyword research cache (shared `__public__` rows) -------------
    const { createHash } = await import('crypto');
    const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
    const norm = (q: string) => q.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
    const SHARED = '__public__';
    const cacheTtl = new Date(NOW + 30 * DAY); // long so screenshots can be retaken for a month
    const putCache = async (cacheKey: string, data: unknown) => {
      const env = { v: 1, fetchedAt: new Date(NOW - 25 * 60_000).toISOString(), data };
      await prisma.researchCache.upsert({
        where: { userId_cacheKey: { userId: SHARED, cacheKey } },
        create: { userId: SHARED, cacheKey, data: env as any, expiresAt: cacheTtl },
        update: { data: env as any, expiresAt: cacheTtl },
      });
    };
    const KW_SEEDS: Record<string, Array<[string, number, number, 1 | 2 | 3 | 4 | 5, number, number, string[]]>> = {
      // keyword, supply total, top48 exact-tag count, demand tier, p25, p75, origins
      'turkish towel': [
        ['turkish towel', 61840, 41, 5, 22, 38, ['seed', 'tags', 'autocomplete']],
        ['peshtemal', 9120, 33, 4, 24, 36, ['tags', 'autocomplete']],
        ['turkish beach towel', 28400, 37, 5, 24, 39, ['tags', 'autocomplete']],
        ['personalized beach towel', 18750, 22, 5, 28, 46, ['autocomplete']],
        ['turkish bath towel', 14320, 26, 4, 26, 42, ['tags', 'autocomplete']],
        ['hammam towel', 7480, 29, 3, 22, 34, ['tags']],
        ['cotton beach towel', 22100, 18, 4, 20, 35, ['tags']],
        ['bridesmaid gift towel', 3260, 12, 3, 27, 41, ['autocomplete']],
        ['turkish hand towel', 6980, 21, 3, 14, 24, ['autocomplete']],
        ['monogram towel', 11400, 16, 4, 26, 44, ['autocomplete']],
        ['boho beach towel', 5610, 14, 3, 21, 33, ['tags']],
        ['turkish towel set', 4870, 19, 3, 48, 92, ['autocomplete']],
        ['quick dry towel', 15200, 9, 4, 18, 32, ['tags']],
        ['spa gift for her', 26900, 6, 4, 30, 58, ['tags']],
        ['turkish cotton throw', 3920, 17, 2, 55, 96, ['tags']],
        ['travel towel', 12750, 8, 3, 16, 29, ['tags']],
      ],
    };
    const trend = (peak: number) => Array.from({ length: 12 }, (_, m) => Math.round(35 + 55 * Math.exp(-((m - peak) ** 2) / 4) + (m % 3) * 2));
    for (const [seed, rows] of Object.entries(KW_SEEDS)) {
      await putCache(`public:etsy:kwpool:${sha1([norm(seed), 'US'].join('|'))}`, rows.map(([keyword, , , , , , origin]) => ({ keyword, origin })));
      for (const [keyword, total, top48, tier, p25, p75] of rows) {
        const metrics = {
          keyword, mkt: 'etsy', country: 'US', total, n: 48, top48,
          priceBand: { p25, p75, currency: 'USD', n: 48 },
          demand: {
            tier,
            inputs: [
              { key: 'googleTrends', value: 30 + tier * 12, normalized: Math.min(1, 0.2 + tier * 0.16), ok: true },
              { key: 'autocomplete', value: Math.min(3, Math.max(1, tier - 1)), normalized: Math.min(1, tier / 5), ok: true },
              { key: 'engagement', value: 4 + tier * 3, normalized: Math.min(1, 0.15 + tier * 0.17), ok: true },
            ],
          },
          monthly: trend(keyword.includes('beach') || keyword.includes('towel') ? 6 : 10),
          fetchedAt: new Date(NOW - 25 * 60_000).toISOString(),
        };
        await putCache(`public:etsy:kwmetrics:${sha1([norm(keyword), 'US'].join('|'))}`, metrics);
      }
    }

    // ---- 8. Price gap (Trendyol -> eBay) indexes --------------------------
    const GAP_CAT = 'havlu-x-c839';
    const gapRows: Array<[string, string, number, number, string, number, number]> = [
      // trendyol name, brand, priceTry, ebayPriceUsd, image, soldQty, confidence
      ['Peştamal %100 Pamuk Plaj Havlusu 90x180 İndigo', 'Ege Dokuma', 349.9, 32.99, 'peshtemal-indigo', 412, 0.93],
      ['Hamam Peştamalı Kiremit Çizgili 100x180', 'Bursa Tekstil', 289.9, 29.5, 'peshtemal-terracotta', 268, 0.91],
      ['Peştamal El Havlusu 2li Set Adaçayı', 'Denizli Home', 219.9, 24.99, 'peshtemal-sage', 187, 0.88],
      ['Pamuklu Koltuk Şalı Peştamal 160x200', 'Ege Dokuma', 589.9, 64.0, 'peshtemal-terracotta', 96, 0.86],
      ['Nakışlı Kişiye Özel Peştamal Gelin Hediyesi', 'Atölye Nakış', 449.9, 41.95, 'peshtemal-indigo', 143, 0.79],
      ['Plaj Havlusu Organik Pamuk Saçaklı', 'Bodrum Loom', 399.9, 36.5, 'peshtemal-sage', 121, 0.84],
      ['Hamam Havlusu Klasik Kareli Lacivert', 'Bursa Tekstil', 259.9, 22.99, 'peshtemal-indigo', 205, 0.9],
      ['Peştamal Bebek Battaniyesi Yumuşak Pamuk', 'Denizli Home', 329.9, 34.0, 'peshtemal-sage', 77, 0.74],
      ['Spa Havlu Seti 3lü Peştamal', 'Ege Dokuma', 699.9, 74.99, 'peshtemal-terracotta', 58, 0.82],
      ['Saçaklı Peştamal Pareo Plaj Örtüsü', 'Bodrum Loom', 229.9, 27.95, 'peshtemal-terracotta', 164, 0.87],
    ];
    const idxExpires = new Date(NOW + 30 * DAY);
    // The price-gap view only renders https images, so these rows point at a fake https host that
    // scripts/gtm/capture-screens.ts serves from public/demo (page.route). In a normal browser they show the
    // app's placeholder thumbnail.
    const httpsImg = (k: string) => `${DEMO_HTTPS_IMG_HOST}/demo/${k}.jpg`;
    const englishFor = (name: string) => (name.includes('Bebek') ? 'turkish cotton baby blanket' : name.includes('Şal') ? 'turkish cotton throw blanket' : name.includes('Spa') ? 'turkish towel set' : name.includes('Nakışlı') ? 'personalized turkish towel' : 'turkish peshtemal towel');
    const etsyQueries = new Set<string>();
    for (const [n, [name, brand, priceTry, ebayPrice, image, sold, conf]] of gapRows.entries()) {
      const productId = 880000100 + n;
      await prisma.trendyolProductIndex.upsert({
        where: { productId },
        create: { productId, name, brand, priceTry, originalPriceTry: round2(priceTry * 1.3), imageUrl: httpsImg(image), url: `https://www.trendyol.com/demo/p-${productId}`, categorySlug: GAP_CAT, categoryName: 'Havlu', ratingScore: 4.3 + (n % 5) * 0.1, ratingCount: 900 - n * 70, merchantName: brand, favoriteCount: String(1200 - n * 90), orderCount: String(500 - n * 30), expiresAt: idxExpires },
        update: { name, brand, priceTry, imageUrl: httpsImg(image), categorySlug: GAP_CAT, ratingCount: 900 - n * 70, expiresAt: idxExpires, fetchedAt: new Date() },
      });
      // 8 matched US eBay listings per product so the median has a real sample (MIN_SAMPLE = 5).
      for (let j = 0; j < 8; j++) {
        const ebayItemId = `v1|3${String(66000000000 + n * 7717 + j * 13)}|0`;
        const price = round2(ebayPrice * (0.82 + j * 0.05));
        const title = `Turkish ${name.includes('Bebek') ? 'Baby Blanket' : name.includes('Şal') ? 'Cotton Throw Blanket' : 'Peshtemal Towel'} 100% Cotton Handwoven ${j % 2 ? 'Beach' : 'Bath'} Towel ${['Navy', 'Rust', 'Sage', 'Sand', 'Grey', 'Blue', 'Olive', 'Cream'][j]}`;
        await prisma.ebayProductIndex.upsert({
          where: { itemId: ebayItemId },
          create: { itemId: ebayItemId, title, price, currency: 'USD', condition: 'New', imageUrl: httpsImg(image), categoryId: '175986', categoryName: 'Beach Towels', soldQuantity: Math.max(3, Math.round(sold / (j + 1))), sellerName: `demo_seller_${n}_${j}`, itemUrl: `https://www.ebay.com/itm/demo-${n}-${j}`, expiresAt: idxExpires, searchQuery: 'Turkish towel cotton' },
          update: { title, price, imageUrl: httpsImg(image), soldQuantity: Math.max(3, Math.round(sold / (j + 1))), expiresAt: idxExpires, fetchedAt: new Date() },
        });
        const c = round2(Math.max(0.55, conf - j * 0.015));
        await prisma.arbitrageMatch.upsert({
          where: { trendyolId_ebayItemId: { trendyolId: productId, ebayItemId } },
          create: { trendyolId: productId, ebayItemId, confidence: c, matchType: c >= 0.85 ? 'exact' : 'equivalent', matchReason: 'Same material, size and weave', categorySlug: GAP_CAT, expiresAt: idxExpires },
          update: { confidence: c, matchType: c >= 0.85 ? 'exact' : 'equivalent', expiresAt: idxExpires },
        });
      }
      const english = englishFor(name);
      etsyQueries.add(english);
      const fin = { landedUsd: round2(priceTry / 40 + 6.5), ebayFeesUsd: round2(ebayPrice * 0.13) };
      await prisma.arbitrageResultRecord.create({
        data: {
          userId: uid, trendyolProductId: productId, trendyolName: name, trendyolBrand: brand, trendyolPriceTry: priceTry, trendyolImageUrl: httpsImg(image), trendyolCategory: GAP_CAT,
          ebayMedianPrice: ebayPrice, ebayAvgPrice: ebayPrice, ebayListingCount: 8, ebayAvgSold: Math.round(sold / 3), ebayTopItems: [], translatedQuery: english, matchTier: 'gemini',
          profitUsd: round2(ebayPrice - fin.landedUsd - fin.ebayFeesUsd), roiPercent: 120, marginPercent: 45, totalCostUsd: fin.landedUsd, score: 80, verdict: 'good', financials: fin, exchangeRate: 40,
        },
      });
    }
    for (const q of Array.from(etsyQueries)) {
      const base = q.includes('blanket') || q.includes('throw') ? 58 : q.includes('set') ? 52 : q.includes('personalized') ? 34 : 27;
      const items = Array.from({ length: 14 }, (_, j) => ({
        id: String(1700000000 + j), title: `${q} ${j}`, url: null, thumbUrl: null, price: round2(base * (0.78 + j * 0.035)), currency: 'USD', favorites: 20 + j * 11, ageDays: 40 + j * 9, shop: { id: null, name: null, url: null }, tags: [],
      }));
      const key = `public:etsy:search:${sha1([norm(q), 'US', '', ''].join('|'))}`;
      await putCache(key, { query: q, country: 'US', taxonomyId: null, total: 8000 + q.length * 311, items, fetchedAt: new Date(NOW - 25 * 60_000).toISOString() });
    }

    // ---- 9. Inbox cache + saved replies -----------------------------------
    const threads = [
      { platform: 'wix', externalId: 'demo-conv-1', contactId: 'demo-contact-1', customerName: 'Rachel Simmons', text: 'Hi! Does the cobalt Iznik bowl come gift wrapped? It\'s for my sister\'s housewarming next Saturday.', needsReply: true, ago: 35 },
      { platform: 'trendyol', externalId: '650000101', customerName: 'Gizem T.', text: 'Merhaba, peştamalın boyutu tam olarak kaç cm? Yıkayınca çeker mi?', needsReply: true, ago: 80 },
      { platform: 'wix', externalId: 'demo-conv-2', contactId: 'demo-contact-2', customerName: 'Thomas Keller', text: 'Can you engrave three initials on the cognac wallet? Something like T.J.K.', needsReply: true, ago: 190 },
      { platform: 'trendyol', externalId: '650000102', customerName: 'Hakan Y.', text: 'Telkari kolyenin zinciri de gümüş mü, kaç cm?', needsReply: true, ago: 260 },
      { platform: 'wix', externalId: 'demo-conv-3', contactId: 'demo-contact-3', customerName: 'Anna Schmidt', text: 'Thank you, the towels arrived and they are beautiful!', needsReply: false, ago: 1500 },
    ];
    for (const t of threads) {
      await prisma.inboxThread.create({
        data: { userId: uid, platform: t.platform, externalId: t.externalId, contactId: t.contactId ?? null, customerName: t.customerName, lastMessageAt: new Date(NOW - t.ago * 60_000), lastMessageText: t.text, lastFromCustomer: t.needsReply, needsReply: t.needsReply, messageCount: 3, contactActivityAt: new Date(NOW - t.ago * 60_000) },
      });
    }
    await prisma.savedReply.createMany({
      data: [
        { userId: uid, title: 'Shipping time (international)', body: 'Hi {name}! Your order ships from Istanbul within 1-3 business days and usually arrives in 4-7 business days with FedEx or UPS. You will get the tracking number by email as soon as it ships.', usageCount: 42 },
        { userId: uid, title: 'Gift wrapping', body: 'Of course! We gift wrap every order for free and can add a handwritten note. Just tell us what you would like the card to say.', usageCount: 18 },
        { userId: uid, title: 'Kargo süresi (Türkiye)', body: 'Merhaba, siparişiniz 1-2 iş günü içinde DHL eCommerce ile kargoya verilir. Takip numarası Trendyol üzerinden iletilecektir.', platform: 'trendyol', usageCount: 27 },
      ],
    });

    console.log(`[demo] seeded user ${DEMO_EMAIL}: ${PRODUCTS.length + 2} Etsy listings, ${ebayIdx.length} eBay listings, ${tyIdx.length} Trendyol products, ${plan.length} orders, ${tx.length} finance rows, ${stockIdx.length} stock items, ${threads.length} inbox threads`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
