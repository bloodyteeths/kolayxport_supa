/**
 * End-to-end test for eBay API endpoints.
 * Makes real eBay API calls through the local/production API routes.
 *
 * Usage:
 *   node test-ebay-e2e.mjs [base_url]
 *
 * If no base_url provided, defaults to http://localhost:3000
 */

import { createClient } from '@supabase/supabase-js';

const BASE_URL = process.argv[2] || 'http://localhost:3000';

const supabase = createClient(
  'https://thqyxirtzaajiulmmiqw.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRocXl4aXJ0emFhaml1bG1taXF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYyMDY3NDUsImV4cCI6MjA2MTc4Mjc0NX0.fyjDG2iGVvkEN8EXomnHTo1eWWw89zm81NDOkHjJTJk'
);

let passed = 0;
let failed = 0;
const results = [];

function log(status, name, detail = '') {
  const icon = status === 'PASS' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (status === 'PASS') passed++;
  else failed++;
  results.push({ status, name, detail });
}

const API_KEY = '6d8a3ea6c932f48f65f6a4c0f71ee47395fd9fc77d0fbf6b46956f48129199e1';
let USER_ID = '';

async function api(path, opts = {}) {
  // Append userId to path if not already there
  const separator = path.includes('?') ? '&' : '?';
  const urlWithUser = USER_ID && !path.includes('userId=')
    ? `${BASE_URL}${path}${separator}userId=${USER_ID}`
    : `${BASE_URL}${path}`;
  const resp = await fetch(urlWithUser, {
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: resp.status, json, text };
}

// ── Auth ──────────────────────────────────────────────────────────────────
async function authenticate() {
  console.log('\n🔐 Authenticating...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'kolayxport@gmail.com',
    password: 'AsusGateway%T1',
  });
  if (error) {
    console.error('Auth failed:', error.message);
    process.exit(1);
  }
  USER_ID = data.user.id;
  console.log(`   Logged in as ${data.user.email} (${USER_ID})`);
  return data.session.access_token;
}

// ── Tests ─────────────────────────────────────────────────────────────────

async function testMyLegacyListings(token) {
  console.log('\n📦 Testing: My Legacy Listings');
  const { status, json } = await api('/api/clawd/ebay?action=my_legacy_listings', { token });

  if (status !== 200) {
    log('FAIL', 'my_legacy_listings returns 200', `got ${status}: ${json?.error || 'unknown'}`);
    return;
  }
  log('PASS', 'my_legacy_listings returns 200');

  const listings = json?.listings || [];
  if (listings.length > 0) {
    log('PASS', `Found ${listings.length} legacy listings`);
  } else {
    log('FAIL', 'Should find at least 1 legacy listing', 'got 0');
  }

  // Check listing structure
  if (listings.length > 0) {
    const first = listings[0];
    const hasTitle = !!first.title;
    const hasItemId = !!first.itemId || !!first.legacyItemId;
    const hasPrice = first.price !== undefined;
    log(hasTitle ? 'PASS' : 'FAIL', 'Listing has title', first.title?.substring(0, 50));
    log(hasItemId ? 'PASS' : 'FAIL', 'Listing has itemId');
    log(hasPrice ? 'PASS' : 'FAIL', 'Listing has price');
  }

  return listings;
}

async function testSearchSeller(token) {
  console.log('\n🔍 Testing: Search Seller');
  // First get a seller name from our own listings
  const listingsResp = await api('/api/clawd/ebay?action=my_legacy_listings', { token });
  const firstListing = listingsResp.json?.listings?.[0];
  const sellerName = firstListing?.seller?.username || 'nike';
  console.log(`   Using seller: ${sellerName}`);
  const { status, json } = await api(`/api/clawd/ebay?action=search_seller&seller=${encodeURIComponent(sellerName)}`, { token });

  if (status !== 200) {
    log('FAIL', 'search_seller returns 200', `got ${status}: ${json?.error || 'unknown'} | ${json?.details?.substring?.(0, 200) || ''}`);
    return;
  }
  log('PASS', 'search_seller returns 200');

  const items = json?.items || json?.itemSummaries || [];
  log('PASS', `Seller search returned ${items.length} items (0 is valid if no match for default query)`);
}

async function testCategoryBestsellers(token) {
  console.log('\n🏆 Testing: Category Bestsellers');
  // Category 11450 = Clothing, Shoes & Accessories
  const { status, json } = await api('/api/clawd/ebay?action=category_bestsellers&category_id=11450', { token });

  if (status !== 200) {
    log('FAIL', 'category_bestsellers returns 200', `got ${status}: ${json?.error || 'unknown'}`);
    return;
  }
  log('PASS', 'category_bestsellers returns 200');

  const items = json?.items || json?.itemSummaries || [];
  if (items.length > 0) {
    log('PASS', `Found ${items.length} category bestsellers`);
    // Check for estimatedSoldQuantity enrichment
    const withSold = items.filter(i => i.estimatedSoldQuantity !== undefined);
    log(withSold.length > 0 ? 'PASS' : 'FAIL', 'Items have estimatedSoldQuantity', `${withSold.length}/${items.length} enriched`);
  } else {
    log('FAIL', 'Should find category items', 'got 0');
  }
}

async function testTopCategories(token) {
  console.log('\n📂 Testing: Top Categories');
  const { status, json } = await api('/api/clawd/ebay?action=top_categories', { token });

  if (status !== 200) {
    log('FAIL', 'top_categories returns 200', `got ${status}: ${json?.error || 'unknown'}`);
    return;
  }
  log('PASS', 'top_categories returns 200');

  const categories = json?.categories || [];
  if (categories.length > 0) {
    log('PASS', `Found ${categories.length} top categories`);
  } else {
    log('FAIL', 'Should find categories', 'got 0');
  }
}

async function testResearchTrackedProducts(token) {
  console.log('\n📊 Testing: Research — Tracked Products');
  const { status, json } = await api('/api/clawd/ebay-research?action=tracked_products', { token });

  if (status !== 200) {
    log('FAIL', 'tracked_products returns 200', `got ${status}: ${json?.error || 'unknown'}`);
    return;
  }
  log('PASS', 'tracked_products returns 200');
  log('PASS', `${json?.products?.length || 0} tracked products found`);
}

async function testResearchProductDatabase(token) {
  console.log('\n🗄️  Testing: Research — Product Database Search');
  const { status, json } = await api('/api/clawd/ebay-research?action=product_database&q=vintage+leather+jacket&limit=5', { token });

  if (status !== 200) {
    log('FAIL', 'product_database returns 200', `got ${status}: ${json?.error || 'unknown'}`);
    return;
  }
  log('PASS', 'product_database returns 200');

  const items = json?.items || json?.itemSummaries || [];
  if (items.length > 0) {
    log('PASS', `Found ${items.length} products for "vintage leather jacket"`);
  } else {
    log('FAIL', 'Should find products', 'got 0');
  }
}

async function testResearchNicheAnalyze(token) {
  console.log('\n🎯 Testing: Research — Niche Analyze');
  const { status, json } = await api('/api/clawd/ebay-research?action=niche_analyze&q=vintage+denim+jacket', { token });

  if (status !== 200) {
    log('FAIL', 'niche_analyze returns 200', `got ${status}: ${json?.error || 'unknown'}`);
    return;
  }
  log('PASS', 'niche_analyze returns 200');

  if (json?.demandScore !== undefined) {
    log('PASS', `Demand score: ${json.demandScore}, Competition: ${json.competitionScore}`);
  } else {
    log('FAIL', 'Should return demand/competition scores');
  }
}

async function testResearchTrackProduct(token) {
  console.log('\n📌 Testing: Research — Track & Untrack Product');

  // First search for a product to get an itemId
  const searchResp = await api('/api/clawd/ebay-research?action=product_database&q=nike+air+max&limit=1', { token });
  if (searchResp.status !== 200 || !searchResp.json?.items?.length) {
    log('FAIL', 'Could not find product to track');
    return;
  }

  const item = searchResp.json.items[0];
  const legacyItemId = item.legacyItemId || item.itemId;
  if (!legacyItemId) {
    log('FAIL', 'Product has no legacyItemId to track');
    return;
  }

  // Track the product
  const trackResp = await api('/api/clawd/ebay-research?action=track_product', {
    token,
    method: 'POST',
    body: {
      legacyItemId,
      title: item.title?.substring(0, 100) || 'Test Item',
    },
  });

  if (trackResp.status === 200 || trackResp.status === 201) {
    log('PASS', 'track_product succeeded', `legacyItemId: ${legacyItemId}`);

    // Get the product_id from response to untrack
    const productId = trackResp.json?.product?.id;
    if (productId) {
      const untrackResp = await api(`/api/clawd/ebay-research?action=untrack_product&product_id=${productId}`, {
        token,
        method: 'DELETE',
      });

      if (untrackResp.status === 200) {
        log('PASS', 'untrack_product succeeded');
      } else {
        log('FAIL', 'untrack_product failed', `status: ${untrackResp.status}: ${untrackResp.json?.error || ''}`);
      }
    } else {
      log('FAIL', 'track_product response missing product.id for untrack');
    }
  } else {
    log('FAIL', 'track_product failed', `status: ${trackResp.status}: ${trackResp.json?.error || 'unknown'}`);
  }
}

async function testResearchTrackedSellers(token) {
  console.log('\n👥 Testing: Research — Tracked Sellers');
  const { status, json } = await api('/api/clawd/ebay-research?action=tracked_sellers', { token });

  if (status !== 200) {
    log('FAIL', 'tracked_sellers returns 200', `got ${status}: ${json?.error || 'unknown'}`);
    return;
  }
  log('PASS', 'tracked_sellers returns 200');
  log('PASS', `${json?.sellers?.length || 0} tracked sellers found`);
}

async function testResearchSavedNiches(token) {
  console.log('\n💎 Testing: Research — Saved Niches');
  const { status, json } = await api('/api/clawd/ebay-research?action=saved_niches', { token });

  if (status !== 200) {
    log('FAIL', 'saved_niches returns 200', `got ${status}: ${json?.error || 'unknown'}`);
    return;
  }
  log('PASS', 'saved_niches returns 200');
  log('PASS', `${json?.niches?.length || 0} saved niches found`);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  eBay API End-to-End Tests`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`${'='.repeat(60)}`);

  const token = await authenticate();

  // Run all tests
  await testMyLegacyListings(token);
  await testSearchSeller(token);
  await testCategoryBestsellers(token);
  await testTopCategories(token);
  await testResearchTrackedProducts(token);
  await testResearchProductDatabase(token);
  await testResearchNicheAnalyze(token);
  await testResearchTrackProduct(token);
  await testResearchTrackedSellers(token);
  await testResearchSavedNiches(token);

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
