/* eslint-disable no-console */
/**
 * Capture marketing / tutorial screenshots of the app from the synthetic demo account.
 *
 *   npx tsx scripts/demo/seed-demo-account.ts        # first (idempotent)
 *   npx tsx scripts/gtm/capture-screens.ts           # all screens, TR then EN
 *   npx tsx scripts/gtm/capture-screens.ts orders profit --locale=en --preview=/tmp/prev
 *
 * Env: BASE_URL (default http://localhost:3100), DEMO_EMAIL, DEMO_PASSWORD, CHROME_PATH.
 * Output: public/marketing/screens/<id>.webp (TR) and public/marketing/screens/en/<id>.webp (EN), 2x DPR.
 *
 * A few screens read live marketplace APIs on load (Etsy editor, inbox). For those the browser-side
 * requests to our own API routes are answered with synthetic fixtures (page.route), so no marketplace is
 * ever contacted with the fake demo tokens. Everything else renders from the seeded local database.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { chromium, type BrowserContext, type Page, type Route } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const EMAIL = process.env.DEMO_EMAIL || 'demo@kolayxport.test';
const PASSWORD = process.env.DEMO_PASSWORD || 'KolayDemo!2026';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'public', 'marketing', 'screens');

const ETSY_SHOP_ID = '48291736';
const LISTING_ID = String(BigInt(1790000000) + BigInt(1234)); // first seeded listing (Iznik bowl)

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const localeArg = args.find((a) => a.startsWith('--locale='))?.split('=')[1];
const previewDir = args.find((a) => a.startsWith('--preview='))?.split('=')[1];
const LOCALES: Array<'tr' | 'en'> = localeArg === 'tr' || localeArg === 'en' ? [localeArg] : ['tr', 'en'];

type Locale = 'tr' | 'en';
interface Screen {
  id: string;
  path: string | ((l: Locale) => string);
  /** Selector that must be visible before capture. */
  ready?: string;
  /** Extra steps after load (open panels, click AI buttons...). */
  act?: (page: Page, l: Locale) => Promise<void>;
  /** 'main' = the <main id="kx-main"> box, 'page' = full viewport. */
  crop?: 'main' | 'page';
  mobile?: boolean;
  settleMs?: number;
}

// ---------------------------------------------------------------------------
// Synthetic fixtures for routes that otherwise call marketplaces live
// ---------------------------------------------------------------------------

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const img = (k: string) => `${BASE}/demo/${k}.jpg`;

function etsyListingFixture() {
  const photos = ['iznik-bowl-blue', 'iznik-bowl-turquoise', 'iznik-plate-tulip', 'iznik-plate-green', 'ceramic-mug-terracotta', 'ceramic-mug-sage', 'copper-cezve'];
  return {
    listing_id: Number(LISTING_ID), shop_id: Number(ETSY_SHOP_ID),
    title: 'Handmade Iznik Ceramic Bowl, Cobalt Blue Tulip Pattern, Turkish Pottery Serving Bowl, 8 Inch',
    description: 'Hand painted in our Istanbul workshop using the 500-year-old Iznik tulip motif. Each bowl is wheel-thrown, painted by hand and fired twice, so no two are exactly alike.\n\nSize: 20 cm (8 in) diameter, 8 cm tall\nFood safe, lead free glaze. Hand wash recommended.\n\nShips from Istanbul in 1-3 business days, gift wrapped on request.',
    tags: ['turkish ceramic', 'iznik pottery', 'handmade bowl', 'housewarming gift', 'ceramic gift', 'hand painted', 'kitchen decor', 'boho kitchen', 'pottery gift', 'serving bowl', 'stoneware', 'gift for mom', 'table decor'],
    materials: ['ceramic', 'glaze', 'clay'],
    price: { amount: 4800, divisor: 100, currency_code: 'USD' },
    views: 2310, num_favorers: 412, quantity: 14, state: 'active',
    url: `https://www.etsy.com/listing/${LISTING_ID}`,
    taxonomy_id: 1052, shop_section_id: 51001, shipping_profile_id: 61001, return_policy_id: 71001,
    readiness_state_id: 81001, processing_min: 1, processing_max: 3,
    who_made: 'i_did', when_made: 'made_to_order', is_supply: false,
    item_weight: 650, item_weight_unit: 'g', item_length: 20, item_width: 20, item_height: 8, item_dimensions_unit: 'cm',
    is_personalizable: false, personalization_is_required: false, personalization_instructions: null, personalization_char_count_max: null,
    has_variations: false,
    updated_timestamp: Math.floor(Date.now() / 1000) - 86400 * 3,
    created_timestamp: Math.floor(Date.now() / 1000) - 86400 * 210,
    images: photos.map((k, i) => ({
      listing_image_id: 6100000000 + i, rank: i + 1,
      url_75x75: img(k), url_170x135: img(k), url_570xN: img(k), url_fullxfull: img(k),
      alt_text: i === 0 ? 'Cobalt blue Iznik ceramic bowl with tulip pattern' : '',
    })),
  };
}

const ETSY_TAXONOMY = [
  { id: 891, name: 'Home & Living', level: 0, full_path_taxonomy_ids: [891], children: [
    { id: 1002, name: 'Kitchen & Dining', level: 1, full_path_taxonomy_ids: [891, 1002], children: [
      { id: 1046, name: 'Dining & Serving', level: 2, full_path_taxonomy_ids: [891, 1002, 1046], children: [
        { id: 1052, name: 'Bowls', level: 3, full_path_taxonomy_ids: [891, 1002, 1046, 1052], children: [] },
        { id: 1053, name: 'Plates', level: 3, full_path_taxonomy_ids: [891, 1002, 1046, 1053], children: [] },
      ] },
    ] },
    { id: 1031, name: 'Bathroom', level: 1, full_path_taxonomy_ids: [891, 1031], children: [] },
  ] },
  { id: 68887482, name: 'Jewelry', level: 0, full_path_taxonomy_ids: [68887482], children: [
    { id: 1222, name: 'Necklaces', level: 1, full_path_taxonomy_ids: [68887482, 1222], children: [] },
  ] },
];

function etsyMarketFixture() {
  const prices = [34, 38, 39, 42, 44, 45, 46, 48, 49, 52, 54, 55, 58, 62, 68];
  return {
    items: prices.map((p, i) => ({ listing_id: 900000 + i, title: `Iznik ceramic bowl ${i}`, price: { amount: p * 100, divisor: 100, currency_code: 'USD' }, num_favorers: 40 + i * 9 })),
    priceStats: { p25: 42, median: 48, p75: 55, min: 34, max: 68, n: prices.length, currency: 'USD' },
    tagFrequency: [{ tag: 'turkish ceramic', count: 31 }, { tag: 'iznik pottery', count: 24 }, { tag: 'housewarming gift', count: 19 }],
    titleKeywords: [{ keyword: 'iznik', count: 28 }, { keyword: 'ceramic bowl', count: 22 }],
    fetchedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  };
}

async function mockEtsyClawd(route: Route) {
  const u = new URL(route.request().url());
  const action = u.searchParams.get('action');
  switch (action) {
    case 'listing': return json(route, etsyListingFixture());
    case 'get_shop_sections': return json(route, { count: 4, results: [
      { shop_section_id: 51001, title: 'Iznik Ceramics', rank: 1, active_listing_count: 9 },
      { shop_section_id: 51002, title: 'Telkari Silver', rank: 2, active_listing_count: 6 },
      { shop_section_id: 51003, title: 'Turkish Towels', rank: 3, active_listing_count: 5 },
      { shop_section_id: 51004, title: 'Leather Goods', rank: 4, active_listing_count: 3 },
    ] });
    case 'get_shipping_profiles': return json(route, { count: 2, results: [
      { shipping_profile_id: 61001, title: 'Worldwide from Istanbul (FedEx/UPS)', min_processing_days: 1, max_processing_days: 3, origin_country_iso: 'TR' },
      { shipping_profile_id: 61002, title: 'Jewelry small parcel', min_processing_days: 1, max_processing_days: 2, origin_country_iso: 'TR' },
    ] });
    case 'get_return_policies': return json(route, { count: 1, results: [{ return_policy_id: 71001, accepts_returns: true, accepts_exchanges: true, return_deadline: 30 }] });
    case 'get_readiness_states': return json(route, { count: 1, results: [{ readiness_state_id: 81001, readiness_state: 'made_to_order', min_processing_time: 1, max_processing_time: 3, processing_time_unit: 'days' }] });
    case 'taxonomy': return json(route, { count: ETSY_TAXONOMY.length, results: ETSY_TAXONOMY });
    case 'get_taxonomy_properties': return json(route, { count: 0, results: [] });
    case 'get_listing_properties': return json(route, { count: 0, results: [] });
    case 'get_listing_videos': return json(route, { count: 0, results: [] });
    case 'get_listing_inventory': return json(route, { products: [{ product_id: 1, sku: 'KX-IZB-01', property_values: [], offerings: [{ offering_id: 1, quantity: 14, is_enabled: true, price: { amount: 4800, divisor: 100, currency_code: 'USD' } }] }], price_on_property: [], quantity_on_property: [], sku_on_property: [] });
    case 'search_market': return json(route, etsyMarketFixture());
    default: return json(route, { count: 0, results: [] });
  }
}

async function mockAiEtsy(route: Route) {
  let body: any = {};
  try { body = route.request().postDataJSON(); } catch { /* ignore */ }
  const a = body?.action;
  if (a === 'optimize_title') {
    return json(route, {
      optimized_title: 'Iznik Ceramic Bowl, Hand Painted Turkish Pottery, Cobalt Blue Tulip Serving Bowl, Housewarming Gift',
      explanation: 'Başa en çok aranan "Iznik Ceramic Bowl" ifadesini aldım, hediye niyetli aramalar için "Housewarming Gift" ekledim.',
    });
  }
  if (a === 'suggest_tags') return json(route, { suggestions: ['iznik bowl', 'turkish pottery', 'cobalt blue bowl', 'tulip pattern', 'housewarming gift', 'ceramic serving', 'hand painted bowl'] });
  if (a === 'generate_description') return json(route, { description: 'Hand painted in Istanbul...' });
  return json(route, {});
}

const INBOX_NOW = Date.now();
const ago = (m: number) => new Date(INBOX_NOW - m * 60_000).toISOString();
function inboxConversations() {
  return [
    {
      id: 'demo-conv-1', platform: 'wix', status: 'unanswered', needsReply: true, unread: true, platformStatus: 'open',
      customerName: 'Rachel Simmons', customerEmail: 'rachel@example.com', subject: 'Gift wrapping for the Iznik bowl',
      lastMessageText: "Hi! Does the cobalt Iznik bowl come gift wrapped? It's for my sister's housewarming next Saturday.",
      lastMessageAt: ago(35), lastMessageDate: ago(35), lastFromCustomer: true, contactId: 'demo-contact-1', unreadCount: 1, messages: [],
    },
    {
      id: '650000101', platform: 'trendyol', status: 'unanswered', needsReply: true, unread: true, platformStatus: 'WAITING_FOR_ANSWER',
      customerName: 'Gizem T.', subject: 'Peştamal boyutu', lastMessageText: 'Merhaba, peştamalın boyutu tam olarak kaç cm? Yıkayınca çeker mi?',
      lastMessageAt: ago(80), lastMessageDate: ago(80), lastFromCustomer: true, unreadCount: 1,
      productInfo: { id: 'KX-PST-01-TY', title: 'İndigo Çizgili Peştamal, %100 Pamuk Hamam Havlusu', imageUrl: img('peshtemal-indigo') },
      messages: [{ id: 'q-650000101', sender: 'customer', text: 'Merhaba, peştamalın boyutu tam olarak kaç cm? Yıkayınca çeker mi?', date: ago(80) }],
    },
    {
      id: 'demo-conv-2', platform: 'wix', status: 'unanswered', needsReply: true, unread: false, platformStatus: 'open',
      customerName: 'Thomas Keller', customerEmail: 'thomas@example.com', subject: 'Engraving',
      lastMessageText: 'Can you engrave three initials on the cognac wallet? Something like T.J.K.',
      lastMessageAt: ago(190), lastMessageDate: ago(190), lastFromCustomer: true, contactId: 'demo-contact-2', unreadCount: 0, messages: [],
    },
    {
      id: '650000102', platform: 'trendyol', status: 'unanswered', needsReply: true, unread: false, platformStatus: 'WAITING_FOR_ANSWER',
      customerName: 'Hakan Y.', subject: 'Zincir', lastMessageText: 'Telkari kolyenin zinciri de gümüş mü, kaç cm?',
      lastMessageAt: ago(260), lastMessageDate: ago(260), lastFromCustomer: true, unreadCount: 0,
      productInfo: { id: 'KX-TLK-N01-TY', title: 'Telkari Gümüş Kolye, 925 Ayar Turkuaz Taşlı Lotus Kolye', imageUrl: img('telkari-necklace-turquoise') },
      messages: [{ id: 'q-650000102', sender: 'customer', text: 'Telkari kolyenin zinciri de gümüş mü, kaç cm?', date: ago(260) }],
    },
    {
      id: 'demo-conv-3', platform: 'wix', status: 'answered', needsReply: false, unread: false, platformStatus: 'open',
      customerName: 'Anna Schmidt', customerEmail: 'anna@example.com', subject: 'Order arrived',
      lastMessageText: 'Thank you, the towels arrived and they are beautiful!', lastMessageAt: ago(1500), lastMessageDate: ago(1500),
      lastFromCustomer: false, contactId: 'demo-contact-3', unreadCount: 0, messages: [],
    },
  ];
}

async function mockMessages(route: Route) {
  const u = new URL(route.request().url());
  const action = u.searchParams.get('action');
  const view = u.searchParams.get('view') || 'needs_reply';
  if (action === 'counts') return json(route, { wix: 2, trendyol: 2, total: 4 });
  if (action === 'list') {
    const all = inboxConversations();
    const list = view === 'all' ? all : all.filter((c) => c.needsReply);
    return json(route, {
      conversations: list, totalCount: list.length, unansweredCount: list.filter((c) => c.needsReply).length, page: 0, pageSize: 30,
      nextCursor: null, enabledPlatforms: ['wix', 'trendyol'], errors: [], platformErrors: [], fetchedAt: new Date().toISOString(), readStateStore: 'db',
    });
  }
  if (action === 'thread') {
    const id = u.searchParams.get('conversationId');
    if (id === 'demo-conv-1') {
      return json(route, { id, platform: 'wix', messages: [
        { id: 'm1', sender: 'customer', text: 'Hello! I ordered the cobalt Iznik bowl last month and loved it.', date: ago(60 * 26) },
        { id: 'm2', sender: 'seller', text: 'So happy to hear that, thank you for the kind words!', date: ago(60 * 25) },
        { id: 'm3', sender: 'customer', text: "Hi! Does the cobalt Iznik bowl come gift wrapped? It's for my sister's housewarming next Saturday.", date: ago(35) },
      ] });
    }
    const c = inboxConversations().find((x) => x.id === id);
    return json(route, c ?? { id, platform: 'wix', messages: [] });
  }
  if (action === 'orderContext') {
    return json(route, { orders: [{
      orderNumber: '10482', status: 'FULFILLED', createdDate: ago(60 * 24 * 31), totalAmount: 48, currency: 'USD', total: '$48.00',
      items: [{ name: 'Handmade Iznik Ceramic Bowl, Cobalt Blue', imageUrl: img('iznik-bowl-blue'), quantity: 1, amount: 48, price: '$48.00' }],
      trackingNumber: '794612345678', shipByDate: null,
    }] });
  }
  if (action === 'markSeen') return route.fulfill({ status: 204, body: '' });
  return route.continue();
}

async function mockDraftReply(route: Route) {
  return json(route, {
    reply: "Hi Rachel! Yes, every order is gift wrapped for free, and we can add a handwritten card with your message. If you order by Tuesday it ships from Istanbul the next business day with FedEx and should arrive before Saturday. Just reply with the note you'd like on the card!",
    missing: [],
  });
}

async function installMocks(ctx: BrowserContext) {
  await ctx.route('**/api/clawd/etsy**', mockEtsyClawd);
  await ctx.route('**/api/ai/etsy**', mockAiEtsy);
  await ctx.route('**/api/messages?**', mockMessages);
  await ctx.route('**/api/messages/draft-reply**', mockDraftReply);
  // Live pulls are click-only, but never let a stray click reach a marketplace.
  await ctx.route('**/api/orders/sync**', (r) => json(r, { ok: true, skipped: true }));
  await ctx.route('**/api/finance/settlements**', (r) => (r.request().method() === 'POST' ? json(r, { ok: true }) : r.continue()));
  await ctx.route('**/api/research/price-gap/refresh**', (r) => json(r, { ok: true }));
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

async function clickFirst(page: Page, selectors: string[], timeout = 4000) {
  for (const s of selectors) {
    const loc = page.locator(s).first();
    try {
      await loc.waitFor({ state: 'visible', timeout });
      await loc.click();
      return true;
    } catch { /* try next */ }
  }
  return false;
}

const SCREENS: Screen[] = [
  { id: 'orders', path: '/app/labels', ready: 'text=/Emily|Michael|Sarah|Jessica|Daniel|Olivia|Lena|Camille|Ayşe|Mehmet/' },
  {
    id: 'labels', path: '/app/labels', ready: 'text=/Emily|Michael|Sarah|Jessica|Olivia|Lena/',
    act: async (page, l) => {
      const ok = await clickFirst(page, [`button:has-text("${l === 'tr' ? 'Etiket oluştur' : 'Create label'}")`, 'button:has-text("Etiket")', 'button:has-text("Create label")']);
      if (!ok) console.warn('  [labels] create-label button not found');
      await page.waitForTimeout(2500);
    },
    crop: 'page',
  },
  { id: 'etsy-listings', path: '/app/etsy-listings', ready: 'text=/Iznik|Telkari|Peshtemal/' },
  {
    id: 'listing-editor', path: `/app/etsy-listings/${LISTING_ID}?shop=${ETSY_SHOP_ID}`, ready: 'text=/Iznik/',
    act: async (page, l) => {
      const ok = await clickFirst(page, [`button:has-text("${l === 'tr' ? 'Başlık öner' : 'Suggest a title'}")`, '[data-testid="le-title"] button:has-text("AI")']);
      if (!ok) console.warn('  [listing-editor] AI title button not found');
      await page.waitForTimeout(2500);
    },
  },
  { id: 'bulk-editor', path: '/app/etsy-listings/bulk', ready: 'text=/Iznik|Telkari|Peshtemal/' },
  { id: 'research', path: '/app/research/keywords?q=turkish%20towel&mkt=etsy&country=US&view=suggested', ready: 'text=/peshtemal/i', settleMs: 4000 },
  { id: 'arbitrage', path: '/app/research/products?source=trendyol&from=category&cat=havlu-x-c839', ready: 'text=/Peştamal|Hamam/', settleMs: 4000 },
  { id: 'profit', path: '/app/reports/profit?mp=etsy', ready: 'text=/\\$/', settleMs: 5000 },
  {
    id: 'inbox', path: '/app/mesajlar?view=needs_reply&store=all&open=wix:demo-conv-1', ready: 'text=/Rachel/',
    act: async (page) => {
      const ok = await clickFirst(page, ['[data-testid="composer-ai"]']);
      if (!ok) console.warn('  [inbox] AI draft button not found');
      await page.waitForTimeout(2500);
    },
  },
  { id: 'stock-sync', path: '/app/stok-senkron', ready: 'text=/KX-|Iznik/' },
  { id: 'orders-mobile', path: '/app/labels', ready: 'text=/Emily|Michael|Sarah|Jessica|Daniel|Olivia|Lena|Camille|Ayşe|Mehmet/', mobile: true, crop: 'page' },
  { id: 'etsy-listings-mobile', path: '/app/etsy-listings', ready: 'text=/Iznik|Telkari|Peshtemal/', mobile: true, crop: 'page' },
];

const HIDE_CSS = `
  nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay], #__next-build-watcher, #__next-prerender-indicator { display: none !important; }
  [role="region"][aria-labelledby="kx-cookie-title"], [aria-labelledby="kx-cookie-title"] { display: none !important; }
  .notistack-SnackbarContainer, .Toastify, [data-sonner-toaster], .MuiSnackbar-root { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; }
`;

async function login(ctx: BrowserContext) {
  const csrf = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
  const res = await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email: EMAIL, password: PASSWORD, json: 'true', callbackUrl: `${BASE}/app/labels` },
    maxRedirects: 0,
  });
  const cookies = await ctx.cookies();
  if (!cookies.some((c) => c.name.includes('next-auth.session-token'))) {
    throw new Error(`Login failed (status ${res.status()}). Did you run scripts/demo/seed-demo-account.ts?`);
  }
}

async function capture(ctx: BrowserContext, screen: Screen, locale: Locale) {
  const page = await ctx.newPage();
  const url = BASE + (typeof screen.path === 'function' ? screen.path(locale) : screen.path);
  console.log(`- [${locale}] ${screen.id}: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.addStyleTag({ content: HIDE_CSS }).catch(() => undefined);
  if (screen.ready) {
    await page.locator(screen.ready).first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => console.warn(`  ready selector not seen: ${screen.ready}`));
  }
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  if (screen.act) await screen.act(page, locale);
  await page.addStyleTag({ content: HIDE_CSS }).catch(() => undefined);
  // Let skeletons / images settle.
  await page.waitForTimeout(screen.settleMs ?? 1500);
  await page.mouse.move(0, 0);

  let buf: Buffer;
  const main = page.locator('#kx-main');
  if ((screen.crop ?? 'main') === 'main' && !screen.mobile && (await main.count()) > 0) {
    const box = await main.boundingBox();
    const vp = page.viewportSize()!;
    if (box) {
      const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, vp.width - box.x), height: Math.min(box.height, vp.height - box.y) };
      buf = await page.screenshot({ clip });
    } else buf = await page.screenshot();
  } else {
    buf = await page.screenshot();
  }
  const dir = locale === 'tr' ? OUT : path.join(OUT, 'en');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${screen.id}.webp`);
  await sharp(buf).webp({ quality: 82 }).toFile(file);
  if (previewDir) {
    fs.mkdirSync(previewDir, { recursive: true });
    await sharp(buf).resize({ width: 1440, withoutEnlargement: true }).jpeg({ quality: 70 }).toFile(path.join(previewDir, `${locale}-${screen.id}.jpg`));
  }
  await page.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    for (const locale of LOCALES) {
      for (const mobile of [false, true]) {
        const screens = SCREENS.filter((s) => !!s.mobile === mobile && (only.length === 0 || only.includes(s.id)));
        if (!screens.length) continue;
        const ctx = await browser.newContext({
          viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
          deviceScaleFactor: mobile ? 3 : 2,
          isMobile: mobile, hasTouch: mobile,
          locale: locale === 'tr' ? 'tr-TR' : 'en-US',
          timezoneId: 'Europe/Istanbul',
        });
        await ctx.addInitScript(([l]) => {
          try {
            localStorage.setItem('kolayxport_locale', l);
            localStorage.setItem('kx-consent', JSON.stringify({ analytics: false, marketing: false, at: new Date().toISOString(), v: 1 }));
          } catch { /* ignore */ }
        }, [locale]);
        await installMocks(ctx);
        await login(ctx);
        for (const s of screens) {
          try { await capture(ctx, s, locale); } catch (e) { console.error(`  FAILED ${s.id}: ${(e as Error).message}`); }
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
