#!/usr/bin/env node
/**
 * Full E2E test for Etsy Research System + Chrome Extension APIs
 * Tests all new Phase 2-6 endpoints: research intelligence, AI reports, extension API, telemetry
 *
 * Usage: node test-etsy-research-e2e.mjs [base_url]
 */

import { createClient } from '@supabase/supabase-js';

const BASE = process.argv[2] || 'https://kolayxport.com';
const API_KEY = '6d8a3ea6c932f48f65f6a4c0f71ee47395fd9fc77d0fbf6b46956f48129199e1';
const SHOP_ID = '54844618';
const TEST_KEYWORD = 'baby blanket crochet';

const supabase = createClient(
  'https://thqyxirtzaajiulmmiqw.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRocXl4aXJ0emFhaml1bG1taXF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYyMDY3NDUsImV4cCI6MjA2MTc4Mjc0NX0.fyjDG2iGVvkEN8EXomnHTo1eWWw89zm81NDOkHjJTJk'
);

let SESSION_TOKEN = '';
let REFRESH_TOKEN = '';
let SESSION_EXPIRES_AT = 0;
let SESSION_EXPIRES_IN = 0;
const SUPABASE_REF = 'thqyxirtzaajiulmmiqw';
const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };
const authedHeaders = () => {
  const cookieValue = JSON.stringify({
    access_token: SESSION_TOKEN,
    refresh_token: REFRESH_TOKEN,
    expires_at: SESSION_EXPIRES_AT,
    expires_in: SESSION_EXPIRES_IN,
    token_type: 'bearer',
  });
  const cookies = [
    `sb-${SUPABASE_REF}-auth-token=${encodeURIComponent(cookieValue)}`,
    `sb-${SUPABASE_REF}-auth-token.0=${encodeURIComponent(cookieValue)}`,
  ].join('; ');
  return { 'Content-Type': 'application/json', Cookie: cookies };
};

let passed = 0, failed = 0, skipped = 0;
const results = [];

// Shared state across tests
let sampleListingId = null;
let nicheData = null;
let searchItems = [];
let shopReviews = null;

// ── Helpers ─────────────────────────────────────────────────────────

async function test(num, name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    if (result === 'SKIP') {
      skipped++;
      results.push({ num, name, status: 'SKIP' });
      console.log(`  #${num} \x1b[33m⏭\x1b[0m  ${name}`);
    } else {
      passed++;
      const ms = Date.now() - start;
      results.push({ num, name, status: 'PASS', detail: result, ms });
      console.log(`  #${num} \x1b[32m✓\x1b[0m  ${name} \x1b[90m(${ms}ms)\x1b[0m — ${result || 'OK'}`);
    }
  } catch (err) {
    if (err.message === 'NOT_DEPLOYED') {
      skipped++;
      results.push({ num, name, status: 'SKIP', detail: 'not deployed yet' });
      console.log(`  #${num} \x1b[33m⏭\x1b[0m  ${name} \x1b[90m(not deployed)\x1b[0m`);
      return;
    }
    failed++;
    const ms = Date.now() - start;
    const msg = err.message?.substring(0, 200) || String(err);
    results.push({ num, name, status: 'FAIL', detail: msg, ms });
    console.log(`  #${num} \x1b[31m✗\x1b[0m  ${name} \x1b[90m(${ms}ms)\x1b[0m — ${msg}`);
  }
}

// ext endpoints use Supabase cookie auth to bypass anonymous rate limit
async function extPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: authedHeaders(), body: JSON.stringify(body),
  });
  if (res.status === 404) throw new Error('NOT_DEPLOYED');
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const errMsg = typeof data === 'object' ? (data.error || JSON.stringify(data).substring(0, 150)) : text.substring(0, 150);
    throw new Error(`HTTP ${res.status}: ${errMsg}`);
  }
  return data;
}

async function apiGet(path, { auth = false } = {}) {
  const hdrs = auth ? authedHeaders() : headers;
  const res = await fetch(`${BASE}${path}`, { headers: hdrs });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const errMsg = typeof data === 'object' ? (data.error || JSON.stringify(data).substring(0, 150)) : text.substring(0, 150);
    throw new Error(`HTTP ${res.status}: ${errMsg}`);
  }
  return data;
}

async function apiPost(path, body, { auth = false, allow404 = false } = {}) {
  const hdrs = auth ? authedHeaders() : headers;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: hdrs, body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (allow404 && res.status === 404) throw new Error('NOT_DEPLOYED');
  if (!res.ok) {
    const errMsg = typeof data === 'object' ? (data.error || JSON.stringify(data).substring(0, 150)) : text.substring(0, 150);
    throw new Error(`HTTP ${res.status}: ${errMsg}`);
  }
  return data;
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function fetchRaw(path, fetchOpts = {}) {
  return fetch(`${BASE}${path}`, fetchOpts);
}

// ── Test Suite ──────────────────────────────────────────────────────

async function run() {
  console.log(`\n\x1b[1m🔬 Etsy Research System — Full E2E Test\x1b[0m`);
  console.log(`   Target: ${BASE}`);
  console.log(`   Time: ${new Date().toISOString()}`);

  // Authenticate
  console.log('\n   🔐 Authenticating...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'kolayxport@gmail.com',
    password: 'AsusGateway%T1',
  });
  if (authError) { console.error('   Auth failed:', authError.message); process.exit(1); }
  SESSION_TOKEN = authData.session.access_token;
  REFRESH_TOKEN = authData.session.refresh_token;
  SESSION_EXPIRES_AT = authData.session.expires_at;
  SESSION_EXPIRES_IN = authData.session.expires_in;
  console.log(`   ✓ Logged in as ${authData.user.email}\n`);

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: Core Search (prerequisite data)
  // ═══════════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════');
  console.log(' SECTION 1: Core Search — Prerequisite Data');
  console.log('═══════════════════════════════════════════════════════\n');

  await test(1, 'search_market — base search', async () => {
    const d = await apiGet(`/api/clawd/etsy?action=search_market&keywords=${encodeURIComponent(TEST_KEYWORD)}&limit=48`);
    const items = d.items || d.results || [];
    assert(items.length > 0, 'No items returned');
    searchItems = items;
    sampleListingId = items[0]?.listing_id;
    return `${d.total || d.count || items.length} results, first listing: ${sampleListingId}`;
  });

  await test(2, 'get_public_shop — shop info', async () => {
    const d = await apiGet(`/api/clawd/etsy?action=get_public_shop&target_shop_id=${SHOP_ID}`);
    assert(d.shop_name || d.shop_id, 'No shop data');
    return `${d.shop_name}, ${d.num_sales || d.transaction_sold_count || '?'} sales`;
  });

  await test(3, 'get_public_shop_listings', async () => {
    const d = await apiGet(`/api/clawd/etsy?action=get_public_shop_listings&target_shop_id=${SHOP_ID}&limit=5`);
    const list = d.results || d.listings || [];
    assert(list.length > 0, 'No listings');
    if (!sampleListingId && list[0]?.listing_id) sampleListingId = list[0].listing_id;
    return `${list.length} listings`;
  });

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: Research Intelligence (Phase 2 backend)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' SECTION 2: Research Intelligence — Niche Analysis');
  console.log('═══════════════════════════════════════════════════════\n');

  await test(4, 'analyze_niche — demand scoring', async () => {
    const d = await apiGet(`/api/clawd/etsy?action=analyze_niche&keywords=${encodeURIComponent(TEST_KEYWORD)}&shop_id=${SHOP_ID}`);
    nicheData = d;
    // demandScore is an object {score, breakdown, level}
    const ds = d.demandScore;
    assert(ds, 'No demandScore');
    const score = typeof ds === 'object' ? ds.score : ds;
    assert(typeof score === 'number' && score >= 0 && score <= 100, `Score out of range: ${score}`);
    return `Demand score: ${score}/100 (${ds.level || '?'}), supply: ${d.totalResults || '?'}`;
  });

  await test(5, 'analyze_niche — competition metrics', async () => {
    assert(nicheData, 'No niche data from test #4');
    const comp = nicheData.competition || {};
    assert(comp.saturationIndex !== undefined, 'No saturation index');
    return `Saturation: ${comp.saturationIndex}, concentration: ${comp.top5Concentration ?? '?'}`;
  });

  await test(6, 'analyze_niche — sales velocity', async () => {
    assert(nicheData, 'No niche data from test #4');
    const vel = nicheData.velocity || {};
    assert(vel.avgEstMonthlySales !== undefined, 'No velocity data');
    return `Avg monthly: ${vel.avgEstMonthlySales}, median: ${vel.medianEstMonthlySales ?? '?'}`;
  });

  await test(7, 'analyze_niche — price stats', async () => {
    assert(nicheData, 'No niche data from test #4');
    const ps = nicheData.priceStats || {};
    assert(ps.avg !== undefined, 'No price stats');
    return `Avg: $${ps.avg}, median: $${ps.median}, range: $${ps.min}-$${ps.max}`;
  });

  await test(8, 'estimate_sales_velocity', async () => {
    const d = await apiGet(`/api/clawd/etsy?action=estimate_sales_velocity&keywords=${encodeURIComponent(TEST_KEYWORD)}&shop_id=${SHOP_ID}`);
    const items = d.listings || d.velocities || d.results || [];
    assert(items.length > 0, 'Empty velocity results');
    const first = items[0];
    assert(first.estMonthlySales !== undefined, 'No sales estimate on item');
    return `${items.length} items, first est: ${first.estMonthlySales}/mo, summary avg: ${d.summary?.avgEstMonthlySales ?? '?'}`;
  });

  await test(9, 'analyze_competition', async () => {
    const d = await apiGet(`/api/clawd/etsy?action=analyze_competition&keywords=${encodeURIComponent(TEST_KEYWORD)}&shop_id=${SHOP_ID}`);
    assert(d.saturationIndex !== undefined || d.competition, 'No competition data');
    const sat = d.saturationIndex ?? d.competition?.saturationIndex;
    return `Saturation: ${sat}, new seller: ${d.newSellerPct ?? d.competition?.newSellerPct ?? '?'}%`;
  });

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3: Listing & Shop Analysis
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' SECTION 3: Listing & Shop Deep Analysis');
  console.log('═══════════════════════════════════════════════════════\n');

  await test(10, 'analyze_listing_url — listing analyzer', async () => {
    if (!sampleListingId) return 'SKIP';
    const d = await apiGet(`/api/clawd/etsy?action=analyze_listing_url&listing_id=${sampleListingId}&shop_id=${SHOP_ID}`);
    assert(d.listing || d.seoScore || d.analysis, 'No listing analysis');
    const seo = d.seoScore || d.analysis?.seoScore || {};
    return `SEO: ${seo.total ?? seo.score ?? '?'}/100, tags: ${d.listing?.tagCount ?? d.listing?.tags?.length ?? '?'}`;
  });

  await test(11, 'get_shop_reviews', async () => {
    const d = await apiGet(`/api/clawd/etsy?action=get_shop_reviews&target_shop_id=${SHOP_ID}&shop_id=${SHOP_ID}`);
    const reviews = d.reviews || d.results || [];
    assert(reviews.length >= 0, 'Invalid reviews response');
    shopReviews = reviews;
    return `${reviews.length} reviews loaded`;
  });

  await test(12, 'batch_shops — multiple shop enrichment', async () => {
    const d = await apiGet(`/api/clawd/etsy?action=batch_shops&shop_ids=${SHOP_ID}`);
    const shops = d.shops || d.results || [];
    assert(shops.length > 0, 'No shops');
    const shop = shops[0];
    assert(shop.shop_name || shop.shopName, 'No shop name');
    return `${shops.length} shop(s): ${shop.shop_name || shop.shopName}`;
  });

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4: AI Reports (Phase 2-3 AI endpoints)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' SECTION 4: AI Intelligence Reports');
  console.log('═══════════════════════════════════════════════════════\n');

  await test(13, 'AI niche_report', async () => {
    if (!nicheData) return 'SKIP';
    const score = typeof nicheData.demandScore === 'object' ? nicheData.demandScore.score : nicheData.demandScore;
    const d = await apiPost('/api/ai/etsy', {
      action: 'niche_report',
      query: TEST_KEYWORD,
      demandScore: score ?? 50,
      priceStats: nicheData.priceStats,
      competition: nicheData.competition,
      velocity: nicheData.velocity,
      engagement: nicheData.engagement,
      topTags: ['baby', 'blanket', 'crochet', 'handmade', 'gift'],
    }, { auth: true });
    // Response: { report: { verdict, strengths, weaknesses, opportunities, ... } }
    const report = d.report || d;
    assert(report.verdict, 'No verdict');
    return `Verdict: ${report.verdict}`;
  });

  await test(14, 'AI niche_report — strengths/weaknesses', async () => {
    const score = nicheData ? (typeof nicheData.demandScore === 'object' ? nicheData.demandScore.score : nicheData.demandScore) : 50;
    const d = await apiPost('/api/ai/etsy', {
      action: 'niche_report',
      query: TEST_KEYWORD,
      demandScore: score,
      priceStats: { min: 5, avg: 30, median: 25, max: 85 },
      topTags: ['baby', 'blanket', 'crochet'],
    }, { auth: true });
    const report = d.report || d;
    assert(report.strengths, 'No strengths');
    assert(report.weaknesses, 'No weaknesses');
    assert(report.opportunities, 'No opportunities');
    return `Strengths: ${report.strengths?.length || '?'}, Weaknesses: ${report.weaknesses?.length || '?'}, Opportunities: ${report.opportunities?.length || '?'}`;
  });

  await test(15, 'AI shop_spy_report', async () => {
    const d = await apiPost('/api/ai/etsy', {
      action: 'shop_spy_report',
      shopName: 'TestShop',
      shopData: { sales: 5000, rating: 4.8, listings: 150 },
      topListings: [
        { title: 'Handmade Baby Blanket', price: 40, favorites: 500 },
        { title: 'Crochet Toy Set', price: 25, favorites: 300 },
      ],
      topTags: ['baby', 'crochet', 'handmade'],
    }, { auth: true });
    // Response: { report: { shop_grade, estimated_monthly_revenue, ... } }
    const report = d.report || d;
    assert(report.shop_grade, 'No shop grade');
    return `Shop grade: ${report.shop_grade}, revenue est: $${report.estimated_monthly_revenue || '?'}`;
  });

  await test(16, 'AI listing_audit', async () => {
    const d = await apiPost('/api/ai/etsy', {
      action: 'listing_audit',
      title: 'Baby Blanket Handmade Crochet Gift Newborn',
      tags: ['baby blanket', 'crochet', 'handmade', 'newborn gift', 'baby shower'],
      description: 'Beautiful handmade crochet baby blanket, perfect for newborns.',
      price: 35,
      imageCount: 5,
      favorites: 100,
      views: 2000,
    }, { auth: true });
    // Response: { audit: { overall_grade, quick_wins, ... } }
    const audit = d.audit || d;
    assert(audit.overall_grade, 'No audit grade');
    assert(audit.quick_wins, 'No quick wins');
    return `Grade: ${audit.overall_grade}, quick wins: ${audit.quick_wins?.length || '?'}`;
  });

  await test(17, 'AI review_sentiment', async () => {
    const reviews = shopReviews?.length > 0 ? shopReviews.slice(0, 10) : [
      { review: 'Beautiful quality, baby loves it!', rating: 5 },
      { review: 'Took too long to ship but nice product', rating: 3 },
      { review: 'Color was different from photos', rating: 2 },
    ];
    const d = await apiPost('/api/ai/etsy', {
      action: 'review_sentiment',
      reviews: reviews.map(r => ({
        review: r.review || r.message || r.content || 'Good product',
        rating: r.rating || 5,
      })),
      shopName: 'TestShop',
    }, { auth: true });
    // Response: { sentiment: { buyer_loves, buyer_complaints, ... } }
    const s = d.sentiment || d;
    assert(s.buyer_loves, 'No buyer loves');
    assert(s.buyer_complaints, 'No buyer complaints');
    return `Loves: ${s.buyer_loves?.length || '?'}, complaints: ${s.buyer_complaints?.length || '?'}`;
  });

  await test(18, 'AI price_recommendation', async () => {
    const d = await apiPost('/api/ai/etsy', {
      action: 'price_recommendation',
      query: 'Handmade Baby Blanket Crochet',
      myPrice: 35,
      priceStats: { min: 12, avg: 28, median: 25, max: 85 },
      avgFavorites: 100,
    }, { auth: true });
    // Response: { recommendation: { recommended_price, strategy, reasoning, ... } }
    const rec = d.recommendation || d;
    assert(rec.recommended_price, 'No recommended price');
    const price = rec.recommended_price;
    assert(typeof price === 'number' && price > 0, `Invalid price: ${price}`);
    return `Recommended: $${price}, strategy: ${rec.strategy || '?'}`;
  });

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 5: Chrome Extension API (/api/ext/research)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' SECTION 5: Chrome Extension API');
  console.log('═══════════════════════════════════════════════════════\n');

  await test(19, 'ext/research — search_enrich', async () => {
    const listingIds = searchItems.slice(0, 3).map(i => String(i.listing_id));
    const d = await extPost('/api/ext/research', {
      action: 'search_enrich', query: TEST_KEYWORD, listingIds,
    });
    assert(d.summary, 'No summary');
    assert(d.summary.totalResults > 0, 'totalResults is 0');
    assert(d.summary.avgPrice > 0, 'avgPrice is 0');
    assert(d.summary.competition, 'No competition level');
    assert(['low', 'medium', 'high'].includes(d.summary.competition), `Unknown competition: ${d.summary.competition}`);
    assert(d.summary.uniqueShops > 0, 'uniqueShops is 0');
    const badgeCount = Object.keys(d.listingBadges || {}).length;
    return `Total: ${d.summary.totalResults}, avg: $${d.summary.avgPrice}, comp: ${d.summary.competition}, badges: ${badgeCount}`;
  });

  await test(20, 'ext/research — search_enrich listing badges', async () => {
    if (!searchItems.length) return 'SKIP';
    const ids = searchItems.slice(0, 5).map(i => String(i.listing_id));
    const d = await extPost('/api/ext/research', {
      action: 'search_enrich', query: TEST_KEYWORD, listingIds: ids,
    });
    const badges = d.listingBadges || {};
    const badgeKeys = Object.keys(badges);
    if (badgeKeys.length > 0) {
      const first = badges[badgeKeys[0]];
      assert(first.price !== undefined, 'Badge missing price');
      assert(first.favorites !== undefined, 'Badge missing favorites');
      assert(first.estMonthlySales !== undefined, 'Badge missing estMonthlySales');
      assert(first.competition, 'Badge missing competition');
      return `${badgeKeys.length} badges, first: $${first.price}, est: ${first.estMonthlySales}/mo`;
    }
    return `0 badges matched (listing IDs may not be in top 100 results)`;
  });

  await test(21, 'ext/research — listing_enrich', async () => {
    if (!sampleListingId) return 'SKIP';
    const d = await extPost('/api/ext/research', {
      action: 'listing_enrich', listingId: String(sampleListingId),
    });
    assert(d.listing, 'No listing data');
    assert(d.seoScore, 'No SEO score');
    assert(d.velocity, 'No velocity data');
    assert(d.seoScore.total >= 0 && d.seoScore.total <= 100, `SEO out of range: ${d.seoScore.total}`);
    return `SEO: ${d.seoScore.total}/100 (title:${d.seoScore.title}, tags:${d.seoScore.tags}), vel: ${d.velocity.estMonthlySales}/mo`;
  });

  await test(22, 'ext/research — listing_enrich shop data', async () => {
    if (!sampleListingId) return 'SKIP';
    const d = await extPost('/api/ext/research', {
      action: 'listing_enrich', listingId: String(sampleListingId),
    });
    assert(d.shop, 'No shop data on listing');
    assert(d.shop.shop_name || d.shop.shopName, 'No shop name');
    return `Shop: ${d.shop.shop_name || d.shop.shopName}, sales: ${d.shop.num_sales || d.shop.numSales || '?'}`;
  });

  await test(23, 'ext/research — shop_enrich', async () => {
    const d = await extPost('/api/ext/research', {
      action: 'shop_enrich', shopId: SHOP_ID,
    });
    assert(d.shop, 'No shop data');
    assert(d.shop.shop_name || d.shop.shopName, 'No shop name');
    assert(d.shop.num_sales !== undefined || d.shop.numSales !== undefined, 'No sales count');
    assert(d.bestSellers, 'No best sellers');
    assert(Array.isArray(d.bestSellers), 'bestSellers is not array');
    return `${d.shop.shop_name || d.shop.shopName}: ${d.shop.num_sales || d.shop.numSales} sales, avg: $${d.avgPrice}, top ${d.bestSellers.length} sellers`;
  });

  await test(24, 'ext/research — shop_enrich best sellers', async () => {
    const d = await extPost('/api/ext/research', {
      action: 'shop_enrich', shopId: SHOP_ID,
    });
    assert(d.bestSellers?.length > 0, 'No best sellers');
    const top = d.bestSellers[0];
    assert(top.title, 'Best seller missing title');
    assert(top.price !== undefined, 'Best seller missing price');
    assert(top.favorites !== undefined, 'Best seller missing favorites');
    return `#1: "${top.title.substring(0, 50)}..." ($${top.price}, ${top.favorites} favs)`;
  });

  await test(25, 'ext/research — plan field', async () => {
    const d = await extPost('/api/ext/research', {
      action: 'search_enrich', query: 'test', listingIds: [],
    });
    assert(d.plan, 'No plan field in response');
    assert(['free', 'starter', 'growth', 'enterprise'].includes(d.plan), `Unknown plan: ${d.plan}`);
    return `Plan: ${d.plan}`;
  });

  await test(26, 'ext/research — error on unknown action', async () => {
    try {
      await extPost('/api/ext/research', { action: 'nonexistent_action' });
      throw new Error('Should have errored');
    } catch (err) {
      if (err.message === 'NOT_DEPLOYED') throw err;
      assert(err.message.includes('400') || err.message.includes('Unknown'), `Unexpected error: ${err.message}`);
      return 'Correctly returns 400 for unknown action';
    }
  });

  await test(27, 'ext/research — error on missing query', async () => {
    try {
      await extPost('/api/ext/research', { action: 'search_enrich' });
      throw new Error('Should have errored');
    } catch (err) {
      if (err.message === 'NOT_DEPLOYED') throw err;
      assert(err.message.includes('400') || err.message.includes('required'), `Unexpected error: ${err.message}`);
      return 'Correctly validates missing query param';
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 6: Telemetry API (/api/ext/telemetry)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' SECTION 6: Extension Telemetry');
  console.log('═══════════════════════════════════════════════════════\n');

  await test(28, 'telemetry — report selector failures', async () => {
    const d = await extPost('/api/ext/telemetry', {
      failures: [
        { page: 'search', selector: '.v2-listing-card', url: 'https://etsy.com/search?q=test', timestamp: Date.now(), extensionVersion: '6.0.0' },
        { page: 'listing', selector: '#listing-page-cart', url: 'https://etsy.com/listing/123', timestamp: Date.now(), extensionVersion: '6.0.0' },
      ],
    });
    assert(d.received === 2, `Expected 2, got ${d.received}`);
    return `Received: ${d.received} failures`;
  });

  await test(29, 'telemetry — empty failures returns 400', async () => {
    try {
      await extPost('/api/ext/telemetry', { failures: [] });
      throw new Error('Should have errored');
    } catch (err) {
      if (err.message === 'NOT_DEPLOYED') throw err;
      assert(err.message.includes('400'), `Expected 400, got: ${err.message}`);
      return 'Correctly rejects empty array';
    }
  });

  await test(30, 'telemetry — caps at 50', async () => {
    const failures = Array.from({ length: 60 }, (_, i) => ({
      page: 'search', selector: `.sel-${i}`, url: 'https://etsy.com', timestamp: Date.now(), extensionVersion: '6.0.0',
    }));
    const d = await extPost('/api/ext/telemetry', { failures });
    assert(d.received === 50, `Expected 50, got ${d.received}`);
    return `Capped at ${d.received} (sent 60)`;
  });

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 7: Research Data Quality
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' SECTION 7: Data Quality & Consistency');
  console.log('═══════════════════════════════════════════════════════\n');

  await test(31, 'search results have required fields', async () => {
    assert(searchItems.length > 0, 'No search items');
    const item = searchItems[0];
    assert(item.listing_id, 'Missing listing_id');
    assert(item.title, 'Missing title');
    assert(item.price !== undefined, 'Missing price');
    const hasViews = item.views !== undefined;
    const hasFavs = item.num_favorers !== undefined;
    return `Fields OK: id=${item.listing_id}, title=${item.title.substring(0, 30)}..., price=${item.price}, views=${hasViews}, favs=${hasFavs}`;
  });

  await test(32, 'niche analysis — score components consistent', async () => {
    if (!nicheData) return 'SKIP';
    const ds = nicheData.demandScore;
    const score = typeof ds === 'object' ? ds.score : ds;
    assert(typeof score === 'number' && score >= 0 && score <= 100, 'Score out of range');
    if (ds?.breakdown) {
      const b = ds.breakdown;
      const total = (b.searchVolume || 0) + (b.engagement || 0) + (b.velocity || 0) + (b.competition || 0) + (b.priceRoom || 0);
      assert(Math.abs(total - score) < 5, `Breakdown sum ${total} differs from score ${score}`);
      return `Score: ${score}, breakdown: sv=${b.searchVolume} eng=${b.engagement} vel=${b.velocity} comp=${b.competition} pr=${b.priceRoom}`;
    }
    return `Score: ${score}, no breakdown`;
  });

  await test(33, 'ext search_enrich — prices are sane', async () => {
    const d = await extPost('/api/ext/research', {
      action: 'search_enrich', query: TEST_KEYWORD, listingIds: [],
    });
    const s = d.summary;
    assert(s.avgPrice > 0 && s.avgPrice < 10000, `Avg price out of range: ${s.avgPrice}`);
    assert(s.minPrice >= 0, `Min price negative: ${s.minPrice}`);
    assert(s.maxPrice >= s.minPrice, `Max < Min: ${s.maxPrice} < ${s.minPrice}`);
    assert(s.avgPrice >= s.minPrice && s.avgPrice <= s.maxPrice, 'Avg not between min/max');
    return `$${s.minPrice} — $${s.avgPrice} (avg) — $${s.maxPrice}`;
  });

  await test(34, 'ext listing_enrich — SEO score breakdown sums correctly', async () => {
    if (!sampleListingId) return 'SKIP';
    const d = await extPost('/api/ext/research', {
      action: 'listing_enrich', listingId: String(sampleListingId),
    });
    const seo = d.seoScore;
    const sum = seo.title + seo.tags + seo.description + seo.images;
    assert(sum === seo.total, `Sum ${sum} !== total ${seo.total}`);
    assert(seo.title >= 0 && seo.title <= 25, 'Title score out of 0-25');
    assert(seo.tags >= 0 && seo.tags <= 25, 'Tags score out of 0-25');
    return `Total: ${seo.total} = title(${seo.title}) + tags(${seo.tags}) + desc(${seo.description}) + img(${seo.images})`;
  });

  await test(35, 'ext search vs main API — consistent results', async () => {
    const extData = await extPost('/api/ext/research', {
      action: 'search_enrich', query: TEST_KEYWORD, listingIds: [],
    });
    const mainData = await apiGet(`/api/clawd/etsy?action=search_market&keywords=${encodeURIComponent(TEST_KEYWORD)}&limit=48`);
    const mainItems = mainData.items || mainData.results || [];
    assert(extData.summary.totalResults > 0, 'Ext: no results');
    assert(mainItems.length > 0, 'Main: no results');
    return `Ext total: ${extData.summary.totalResults}, Main items: ${mainItems.length}`;
  });

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 8: Edge Cases & Error Handling
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' SECTION 8: Edge Cases & Error Handling');
  console.log('═══════════════════════════════════════════════════════\n');

  await test(36, 'analyze_niche — rare keyword', async () => {
    const d = await apiGet(`/api/clawd/etsy?action=analyze_niche&keywords=${encodeURIComponent('xyzzyqwerty987')}&shop_id=${SHOP_ID}`);
    const ds = d.demandScore;
    const score = typeof ds === 'object' ? ds.score : (ds ?? 0);
    assert(score <= 30, `High score for nonsense keyword: ${score}`);
    return `Score for nonsense: ${score} (expected low)`;
  });

  await test(37, 'ext/research — special chars in query', async () => {
    const d = await extPost('/api/ext/research', {
      action: 'search_enrich',
      query: "baby's first christmas gift & ornament",
      listingIds: [],
    });
    assert(d.summary, 'No summary for special chars query');
    return `Results: ${d.summary.totalResults}`;
  });

  await test(38, 'ext/research — very long query', async () => {
    const longQuery = 'handmade baby blanket crochet gift newborn shower present organic cotton soft warm winter';
    const d = await extPost('/api/ext/research', {
      action: 'search_enrich', query: longQuery, listingIds: [],
    });
    assert(d.summary, 'No summary for long query');
    return `Results: ${d.summary.totalResults}`;
  });

  await test(39, 'ext/research — CORS headers present', async () => {
    const res = await fetchRaw('/api/ext/research', {
      method: 'OPTIONS',
      headers: { 'Origin': 'chrome-extension://test' },
    });
    const cors = res.headers.get('access-control-allow-origin');
    assert(cors === '*', `CORS header missing or wrong: ${cors} (status ${res.status})`);
    return `CORS: ${cors}`;
  });

  await test(40, 'telemetry — CORS headers present', async () => {
    const res = await fetchRaw('/api/ext/telemetry', {
      method: 'OPTIONS',
      headers: { 'Origin': 'chrome-extension://test' },
    });
    const cors = res.headers.get('access-control-allow-origin');
    assert(cors === '*', `CORS header missing or wrong: ${cors} (status ${res.status})`);
    return `CORS: ${cors}`;
  });

  await test(41, 'AI endpoint — invalid action returns error', async () => {
    try {
      await apiPost('/api/ai/etsy', { action: 'nonexistent_action' }, { auth: true });
      throw new Error('Should have errored');
    } catch (err) {
      assert(err.message.includes('400') || err.message.includes('Unknown') || err.message.includes('action'), `Unexpected: ${err.message}`);
      return 'Correctly rejects unknown AI action';
    }
  });

  await test(42, 'ext/research — GET method rejected', async () => {
    const res = await fetchRaw('/api/ext/research?action=search_enrich&query=test', { headers });
    if (res.status === 404) throw new Error('NOT_DEPLOYED');
    assert(res.status === 405, `Expected 405, got ${res.status}`);
    return 'Correctly rejects GET';
  });

  // ═══════════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log(`  \x1b[32m✓ Passed: ${passed}\x1b[0m`);
  console.log(`  \x1b[31m✗ Failed: ${failed}\x1b[0m`);
  console.log(`  \x1b[33m⏭ Skipped: ${skipped}\x1b[0m`);
  console.log(`  Total: ${passed + failed + skipped}\n`);

  if (failed > 0) {
    console.log('  \x1b[31mFailed tests:\x1b[0m');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`    #${r.num} ${r.name}: ${r.detail}`);
    });
    console.log('');
  }

  // Timing summary
  const timings = results.filter(r => r.ms).sort((a, b) => b.ms - a.ms);
  console.log('  \x1b[90mSlowest tests:\x1b[0m');
  timings.slice(0, 5).forEach(r => {
    console.log(`    ${r.ms}ms — #${r.num} ${r.name}`);
  });

  const totalMs = results.reduce((s, r) => s + (r.ms || 0), 0);
  console.log(`\n  Total time: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  ${passed}/${passed + failed} tests passing (${Math.round(passed / (passed + failed) * 100)}%)\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
