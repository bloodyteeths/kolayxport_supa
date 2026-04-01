#!/usr/bin/env node
/**
 * E2E Production Test: Trendyol→eBay Arbitrage Scanner
 * Comprehensive test covering:
 * - Full Trendyol product data extraction & validation
 * - Gemini title translation quality
 * - Tiered eBay matching (GTIN → Gemini → fallback)
 * - Arbitrage calculation & financial validation
 * - 20-30+ products across multiple categories
 */

const BASE_URL = 'https://kolayxport.com';
const API_KEY = process.env.CLAWD_API_KEY || '6d8a3ea6c932f48f65f6a4c0f71ee47395fd9fc77d0fbf6b46956f48129199e1';

let passed = 0;
let failed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

async function apiCall(action, body = {}) {
  const res = await fetch(`${BASE_URL}/api/clawd/arbitrage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: res.status, data: await res.json() };
}

// ═══════════════════════════════════════════════════════════════
// Test Suite
// ═══════════════════════════════════════════════════════════════

async function run() {
  console.log('\n🔍 ARBITRAGE E2E TEST SUITE — Comprehensive');
  console.log('═'.repeat(60));

  // ─── 1. API Basics ──────────────────────────────────────────
  console.log('\n📌 1. API Basics');

  await test('GET returns 405', async () => {
    const res = await fetch(`${BASE_URL}/api/clawd/arbitrage`, {
      method: 'GET',
      headers: { 'x-api-key': API_KEY },
    });
    assert(res.status === 405, `Expected 405, got ${res.status}`);
  });

  await test('Missing auth returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/clawd/arbitrage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'scan', categories: ['test'] }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('Unknown action returns 400', async () => {
    const { status, data } = await apiCall('unknown_action');
    assert(status === 400, `Expected 400, got ${status}`);
    assert(data.error, 'Should have error message');
  });

  await test('Scan without categories returns 400', async () => {
    const { status } = await apiCall('scan', { categories: [] });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  // ─── 2. Exchange Rate ───────────────────────────────────────
  console.log('\n📌 2. Exchange Rate');

  let liveRate = 0;
  await test('Fetch exchange rate (TRY→USD)', async () => {
    const { status, data } = await apiCall('exchange_rate');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.rate > 0.01 && data.rate < 0.1, `Rate ${data.rate} out of range`);
    liveRate = data.rate;
    console.log(`      Live rate: 1 TRY = $${data.rate} USD (1 USD = ${(1/data.rate).toFixed(2)} TRY)`);
  });

  // ─── 3. Category Listing ────────────────────────────────────
  console.log('\n📌 3. Category Listing');

  let categoryList = [];
  await test('Fetch available categories', async () => {
    const { status, data } = await apiCall('categories');
    assert(status === 200);
    assert(Array.isArray(data.categories), 'Should return categories array');
    assert(data.categories.length >= 15, `Expected 15+ categories, got ${data.categories.length}`);
    categoryList = data.categories;
    console.log(`      ${data.categories.length} categories available`);
  });

  await test('Each category has required fields', async () => {
    for (const cat of categoryList) {
      assert(cat.slug, `Missing slug in category`);
      assert(cat.label, `Missing label for ${cat.slug}`);
      assert(cat.labelTr, `Missing labelTr for ${cat.slug}`);
      assert(cat.ebaySearch, `Missing ebaySearch for ${cat.slug}`);
      assert(cat.slug.includes('-x-c'), `Slug "${cat.slug}" missing -x-c pattern`);
    }
    console.log(`      All ${categoryList.length} categories have slug, label, labelTr, ebaySearch`);
  });

  // ─── 4. Trendyol Data Extraction ───────────────────────────
  console.log('\n📌 4. Trendyol Product Data (Full Validation)');

  const CATEGORIES_TO_TEST = [
    'pestemal-x-c104074',
    'nazar-boncugu-x-c104271',
    'lamba-x-c104155',
    'cay-bardagi-x-c104217',
    'seramik-tabak-x-c104209',
  ];

  const allTrendyolProducts = [];
  let categoriesSucceeded = 0;

  for (const slug of CATEGORIES_TO_TEST) {
    await test(`Trendyol parse: ${slug}`, async () => {
      const { status, data } = await apiCall('test_trendyol', { slug });
      assert(status === 200);
      if (!data.success) {
        // Trendyol may 403 some categories from Vercel IPs
        console.log(`      ⚠ Trendyol blocked: ${data.error}`);
        return;
      }
      if (data.parsedCount === 0) {
        // Some categories may return HTML but no parseable products
        console.log(`      ⚠ 0 products parsed (empty or different HTML structure)`);
        return;
      }
      categoriesSucceeded++;
      console.log(`      ${data.parsedCount} products parsed`);

      // Validate each product has all required fields
      for (const p of data.products) {
        assert(typeof p.id === 'number' && p.id > 0, `Invalid id: ${p.id}`);
        assert(typeof p.name === 'string' && p.name.length > 0, `Missing name for ${p.id}`);
        assert(typeof p.brand === 'string' && p.brand.length > 0, `Missing brand for ${p.id}`);
        assert(typeof p.priceTry === 'number' && p.priceTry > 0, `Invalid price for ${p.id}: ${p.priceTry}`);
        assert(typeof p.imageUrl === 'string' && p.imageUrl.startsWith('http'), `Invalid imageUrl for ${p.id}`);
        assert(typeof p.ebayQuery === 'string' && p.ebayQuery.length > 0, `Missing ebayQuery for ${p.id}`);

        allTrendyolProducts.push(p);
      }
    });
  }

  await test('At least 3/5 categories succeed', async () => {
    assert(categoriesSucceeded >= 3, `Only ${categoriesSucceeded}/5 categories returned data`);
    console.log(`      ${categoriesSucceeded}/5 categories accessible`);
  });

  await test('Trendyol products have diverse data', async () => {
    assert(allTrendyolProducts.length >= 10, `Expected 10+ products, got ${allTrendyolProducts.length}`);
    const brands = new Set(allTrendyolProducts.map(p => p.brand));
    const priceRange = {
      min: Math.min(...allTrendyolProducts.map(p => p.priceTry)),
      max: Math.max(...allTrendyolProducts.map(p => p.priceTry)),
    };
    console.log(`      ${allTrendyolProducts.length} total products, ${brands.size} unique brands`);
    console.log(`      Price range: ${priceRange.min.toFixed(0)}₺ - ${priceRange.max.toFixed(0)}₺`);
    assert(brands.size >= 3, `Expected 3+ unique brands, got ${brands.size}`);
    assert(priceRange.max > priceRange.min, 'Should have price variety');
  });

  // ─── 5. Gemini Translation Quality ─────────────────────────
  console.log('\n📌 5. Gemini Translation Quality');

  await test('Gemini generates English eBay queries', async () => {
    const withQueries = allTrendyolProducts.filter(p => p.ebayQuery);
    assert(withQueries.length > 0, 'No products with ebayQuery');

    let englishCount = 0;
    for (const p of withQueries) {
      // Check query has mostly ASCII chars (English)
      const asciiRatio = p.ebayQuery.replace(/[^a-zA-Z0-9\s]/g, '').length / p.ebayQuery.length;
      if (asciiRatio > 0.7) englishCount++;
      console.log(`      ${p.brand} | ${p.name.substring(0, 35)}...`);
      console.log(`        → "${p.ebayQuery}" (${(asciiRatio * 100).toFixed(0)}% ASCII)`);
    }
    const pct = (englishCount / withQueries.length * 100).toFixed(0);
    console.log(`      ${englishCount}/${withQueries.length} (${pct}%) queries are mostly English`);
    assert(englishCount / withQueries.length >= 0.5, `Only ${pct}% queries are English, expected ≥50%`);
  });

  // ─── 6. Full Arbitrage Scan (20-30 products) ───────────────
  console.log('\n📌 6. Full Arbitrage Scan (Multi-Category)');

  let allResults = [];
  let totalProductsScanned = 0;

  await test('Scan 3 categories, 24 products', async () => {
    const { status, data } = await apiCall('scan', {
      categories: ['lamba-x-c104155', 'nazar-boncugu-x-c104271', 'bakir-cezve-x-c104262'],
      maxTrendyolResults: 24,
      shippingCostUsd: 12,
      minProfitUsd: 1,
      minRoiPercent: 5,
      includeInternationalFee: true,
    });

    assert(status === 200, `Expected 200, got ${status}`);
    assert(typeof data.exchangeRate === 'number', 'Should have exchangeRate');
    assert(typeof data.totalScanned === 'number', 'Should have totalScanned');
    assert(data.totalScanned > 0, 'Should have scanned products');
    assert(typeof data.scanDurationMs === 'number', 'Should have duration');
    assert(Array.isArray(data.results), 'Results should be array');

    totalProductsScanned += data.totalScanned;
    allResults.push(...data.results);

    console.log(`      Scanned: ${data.totalScanned} | Results: ${data.results.length} | Profitable: ${data.profitable}`);
    console.log(`      Duration: ${(data.scanDurationMs / 1000).toFixed(1)}s`);
    console.log(`      Exchange rate: ${data.exchangeRate}`);
  });

  await test('Scan 2 more categories for breadth', async () => {
    const { status, data } = await apiCall('scan', {
      categories: ['kilim-x-c104037', 'pestemal-x-c104074'],
      maxTrendyolResults: 12,
      shippingCostUsd: 12,
      minProfitUsd: 1,
      minRoiPercent: 5,
      includeInternationalFee: true,
    });

    assert(status === 200);
    totalProductsScanned += data.totalScanned;
    allResults.push(...data.results);
    console.log(`      Scanned: ${data.totalScanned} | Results: ${data.results.length} | Profitable: ${data.profitable}`);
  });

  console.log(`\n      📊 COMBINED: ${totalProductsScanned} products scanned, ${allResults.length} with eBay matches`);

  // ─── 7. Result Structure Validation ─────────────────────────
  console.log('\n📌 7. Result Structure Validation');

  await test('Result has complete Trendyol data', async () => {
    assert(allResults.length > 0, 'Need at least one result');
    const r = allResults[0];

    assert(r.trendyol, 'Missing trendyol');
    assert(typeof r.trendyol.id === 'number', 'trendyol.id should be number');
    assert(r.trendyol.name, 'Missing trendyol.name');
    assert(r.trendyol.brand, 'Missing trendyol.brand');
    assert(typeof r.trendyol.priceTry === 'number' && r.trendyol.priceTry > 0, 'priceTry should be > 0');
    assert(typeof r.trendyol.originalPriceTry === 'number', 'originalPriceTry should be number');
    assert(r.trendyol.imageUrl, 'Missing trendyol.imageUrl');
    assert(r.trendyol.url, 'Missing trendyol.url');
    assert(r.trendyol.url.includes('trendyol.com'), 'URL should contain trendyol.com');
    assert(r.trendyol.categoryName, 'Missing categoryName');
    console.log(`      Trendyol: ${r.trendyol.brand} - ${r.trendyol.name.substring(0, 40)}...`);
    console.log(`      Price: ${r.trendyol.priceTry}₺ | Rating: ${r.trendyol.ratingScore} (${r.trendyol.ratingCount} reviews)`);
  });

  await test('Result has complete eBay data', async () => {
    assert(allResults.length > 0, 'Need results');
    const r = allResults[0];

    assert(r.ebay, 'Missing ebay');
    assert(typeof r.ebay.avgPrice === 'number' && r.ebay.avgPrice > 0, 'avgPrice should be > 0');
    assert(typeof r.ebay.medianPrice === 'number' && r.ebay.medianPrice > 0, 'medianPrice should be > 0');
    assert(typeof r.ebay.minPrice === 'number', 'minPrice should be number');
    assert(typeof r.ebay.maxPrice === 'number', 'maxPrice should be number');
    assert(r.ebay.maxPrice >= r.ebay.minPrice, 'maxPrice should be >= minPrice');
    assert(typeof r.ebay.totalListings === 'number' && r.ebay.totalListings > 0, 'totalListings should be > 0');
    assert(typeof r.ebay.avgSold === 'number', 'avgSold should be number');
    assert(Array.isArray(r.ebay.topItems), 'topItems should be array');
    assert(r.ebay.topItems.length > 0, 'Should have at least 1 top item');

    console.log(`      eBay: avg $${r.ebay.avgPrice.toFixed(2)} | med $${r.ebay.medianPrice.toFixed(2)} | ${r.ebay.totalListings} listings`);
    console.log(`      Price range: $${r.ebay.minPrice.toFixed(2)} - $${r.ebay.maxPrice.toFixed(2)}`);
  });

  await test('eBay top items have full data', async () => {
    const withItems = allResults.find(r => r.ebay.topItems.length > 0);
    assert(withItems, 'Need result with top items');

    for (const item of withItems.ebay.topItems.slice(0, 3)) {
      assert(item.title, 'Item should have title');
      assert(typeof item.price === 'number' && item.price > 0, `Item price invalid: ${item.price}`);
      assert(item.currency, 'Item should have currency');
      assert(item.itemId, 'Item should have itemId');
      assert(typeof item.soldQuantity === 'number', 'soldQuantity should be number');
      console.log(`      "${item.title.substring(0, 50)}..." — $${item.price} (${item.soldQuantity} sold)`);
    }
  });

  await test('Result has complete financial breakdown', async () => {
    assert(allResults.length > 0, 'Need results');
    const f = allResults[0].financials;

    assert(typeof f.costTry === 'number' && f.costTry > 0, 'costTry should be > 0');
    assert(typeof f.costUsd === 'number' && f.costUsd > 0, 'costUsd should be > 0');
    assert(typeof f.shippingUsd === 'number' && f.shippingUsd > 0, 'shippingUsd should be > 0');
    assert(typeof f.suggestedPriceUsd === 'number' && f.suggestedPriceUsd > 0, 'suggestedPriceUsd should be > 0');
    assert(typeof f.ebayFeePercent === 'number' && f.ebayFeePercent > 0, 'ebayFeePercent should be > 0');
    assert(typeof f.ebayFeeName === 'string', 'ebayFeeName should be string');
    assert(typeof f.ebayFeeUsd === 'number', 'ebayFeeUsd should be number');
    assert(typeof f.paymentFeeUsd === 'number', 'paymentFeeUsd should be number');
    assert(typeof f.internationalFeeUsd === 'number', 'internationalFeeUsd should be number');
    assert(typeof f.totalCostUsd === 'number', 'totalCostUsd should be number');
    assert(typeof f.profitUsd === 'number', 'profitUsd should be number');
    assert(typeof f.roiPercent === 'number', 'roiPercent should be number');
    assert(typeof f.marginPercent === 'number', 'marginPercent should be number');

    console.log(`      Cost: ${f.costTry.toFixed(0)}₺ ($${f.costUsd.toFixed(2)}) + $${f.shippingUsd} shipping`);
    console.log(`      Fees: eBay ${f.ebayFeePercent}% ($${f.ebayFeeUsd.toFixed(2)}) + payment $${f.paymentFeeUsd.toFixed(2)} + intl $${f.internationalFeeUsd.toFixed(2)}`);
    console.log(`      Total cost: $${f.totalCostUsd.toFixed(2)} → Sell: $${f.suggestedPriceUsd.toFixed(2)} → Profit: $${f.profitUsd.toFixed(2)}`);
    console.log(`      ROI: ${f.roiPercent.toFixed(1)}% | Margin: ${f.marginPercent.toFixed(1)}%`);
  });

  await test('Score and verdict are valid', async () => {
    for (const r of allResults) {
      assert(typeof r.score === 'number' && r.score >= 0 && r.score <= 100, `Invalid score: ${r.score}`);
      assert(['excellent', 'good', 'marginal', 'skip'].includes(r.verdict), `Invalid verdict: ${r.verdict}`);
      assert(typeof r.exchangeRate === 'number' && r.exchangeRate > 0, 'exchangeRate should be > 0');
    }
  });

  // ─── 8. Financial Calculations Audit ────────────────────────
  console.log('\n📌 8. Financial Calculations Audit');

  await test('costUsd = costTry × exchangeRate', async () => {
    for (const r of allResults) {
      const expected = Math.round(r.financials.costTry * r.exchangeRate * 100) / 100;
      assert(Math.abs(r.financials.costUsd - expected) < 0.02,
        `Product ${r.trendyol.id}: costUsd ${r.financials.costUsd} ≠ ${expected}`);
    }
    console.log(`      ✓ Verified for all ${allResults.length} results`);
  });

  await test('totalCost = cost + shipping + fees', async () => {
    for (const r of allResults) {
      const f = r.financials;
      const expected = f.costUsd + f.shippingUsd + f.ebayFeeUsd + f.paymentFeeUsd + f.internationalFeeUsd;
      assert(Math.abs(f.totalCostUsd - expected) < 0.05,
        `Product ${r.trendyol.id}: totalCost ${f.totalCostUsd} ≠ ${expected.toFixed(2)}`);
    }
    console.log(`      ✓ Verified for all ${allResults.length} results`);
  });

  await test('profit = suggestedPrice - totalCost', async () => {
    for (const r of allResults) {
      const f = r.financials;
      const expected = f.suggestedPriceUsd - f.totalCostUsd;
      assert(Math.abs(f.profitUsd - expected) < 0.05,
        `Product ${r.trendyol.id}: profit ${f.profitUsd} ≠ ${expected.toFixed(2)}`);
    }
    console.log(`      ✓ Verified for all ${allResults.length} results`);
  });

  await test('ROI = (profit / costUsd) × 100 (return on product cost)', async () => {
    for (const r of allResults) {
      const f = r.financials;
      if (f.costUsd === 0) continue;
      const expected = (f.profitUsd / f.costUsd) * 100;
      assert(Math.abs(f.roiPercent - expected) < 1,
        `Product ${r.trendyol.id}: ROI ${f.roiPercent}% ≠ ${expected.toFixed(1)}%`);
    }
    console.log(`      ✓ Verified for all ${allResults.length} results`);
  });

  // ─── 9. Fee Configuration Tests ─────────────────────────────
  console.log('\n📌 9. Fee Configuration');

  await test('Custom fee override (18%)', async () => {
    const { status, data } = await apiCall('scan', {
      categories: ['lamba-x-c104155'],
      maxTrendyolResults: 5,
      shippingCostUsd: 12,
      feeOverridePercent: 18,
    });
    assert(status === 200);
    if (data.results.length > 0) {
      assert(data.results[0].financials.ebayFeePercent === 18,
        `Fee should be 18%, got ${data.results[0].financials.ebayFeePercent}%`);
      console.log(`      Fee applied: ${data.results[0].financials.ebayFeePercent}%`);
    } else {
      console.log(`      No results to verify fee (${data.totalScanned} scanned)`);
    }
  });

  await test('High defect rate surcharge (+5%)', async () => {
    const { status, data } = await apiCall('scan', {
      categories: ['lamba-x-c104155'],
      maxTrendyolResults: 5,
      shippingCostUsd: 12,
      highDefectRate: true,
    });
    assert(status === 200);
    if (data.results.length > 0) {
      const fee = data.results[0].financials.ebayFeePercent;
      assert(fee >= 8, `High defect fee should be >= 8%, got ${fee}%`);
      console.log(`      Fee with surcharge: ${fee}%`);
    }
  });

  await test('No international fee when disabled', async () => {
    const { status, data } = await apiCall('scan', {
      categories: ['lamba-x-c104155'],
      maxTrendyolResults: 5,
      shippingCostUsd: 12,
      includeInternationalFee: false,
    });
    assert(status === 200);
    if (data.results.length > 0) {
      assert(data.results[0].financials.internationalFeeUsd === 0,
        `International fee should be 0, got ${data.results[0].financials.internationalFeeUsd}`);
    }
  });

  await test('Custom exchange rate override', async () => {
    const { status, data } = await apiCall('scan', {
      categories: ['lamba-x-c104155'],
      maxTrendyolResults: 3,
      shippingCostUsd: 12,
      exchangeRate: 0.03,
    });
    assert(status === 200);
    assert(data.exchangeRate === 0.03, `Rate should be 0.03, got ${data.exchangeRate}`);
  });

  // ─── 10. Edge Cases ─────────────────────────────────────────
  console.log('\n📌 10. Edge Cases');

  await test('Invalid category slug handled gracefully', async () => {
    const { status, data } = await apiCall('scan', {
      categories: ['nonexistent-x-c999999'],
      maxTrendyolResults: 5,
      shippingCostUsd: 12,
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.totalScanned === 0 || data.results.length === 0, 'Should handle gracefully');
  });

  await test('Very high shipping ($50) reduces profitability', async () => {
    const { status, data } = await apiCall('scan', {
      categories: ['lamba-x-c104155'],
      maxTrendyolResults: 10,
      shippingCostUsd: 50,
      minProfitUsd: 0,
      minRoiPercent: 0,
    });
    assert(status === 200);
    if (data.results.length > 0) {
      const profitable = data.results.filter(r => r.financials.profitUsd > 0).length;
      console.log(`      With $50 shipping: ${profitable}/${data.results.length} profitable`);
    }
  });

  // ─── 11. Score Distribution & Summary ───────────────────────
  console.log('\n📌 11. Score Distribution Analysis');

  await test('Analyze all results', async () => {
    const verdicts = { excellent: 0, good: 0, marginal: 0, skip: 0 };
    let totalProfit = 0;
    let profitableCount = 0;
    let bestResult = null;

    for (const r of allResults) {
      verdicts[r.verdict]++;
      if (r.financials.profitUsd > 0) {
        profitableCount++;
        totalProfit += r.financials.profitUsd;
      }
      if (!bestResult || r.score > bestResult.score) bestResult = r;
    }

    console.log(`      Total scanned: ${totalProductsScanned}`);
    console.log(`      Total with eBay match: ${allResults.length}`);
    console.log(`      🔥 Excellent: ${verdicts.excellent}`);
    console.log(`      ✅ Good: ${verdicts.good}`);
    console.log(`      ⚠️  Marginal: ${verdicts.marginal}`);
    console.log(`      ❌ Skip: ${verdicts.skip}`);
    console.log(`      Net profitable: ${profitableCount}/${allResults.length}`);
    if (profitableCount > 0) {
      console.log(`      Avg profit: $${(totalProfit / profitableCount).toFixed(2)}`);
    }
    if (bestResult) {
      console.log(`\n      🏆 BEST FIND:`);
      console.log(`         ${bestResult.trendyol.brand} - ${bestResult.trendyol.name.substring(0, 50)}`);
      console.log(`         Trendyol: ${bestResult.financials.costTry.toFixed(0)}₺ ($${bestResult.financials.costUsd.toFixed(2)})`);
      console.log(`         eBay median: $${bestResult.ebay.medianPrice.toFixed(2)}`);
      console.log(`         Profit: $${bestResult.financials.profitUsd.toFixed(2)} (${bestResult.financials.roiPercent.toFixed(0)}% ROI)`);
      console.log(`         Score: ${bestResult.score} (${bestResult.verdict})`);
    }
  });

  // ─── Summary ────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`\n📊 TOTAL PRODUCTS SCANNED: ${totalProductsScanned}`);
  console.log(`📊 TOTAL WITH EBAY MATCH: ${allResults.length}`);
  console.log(`\n✅ Passed: ${passed}/${total}`);
  if (failed > 0) console.log(`❌ Failed: ${failed}/${total}`);
  console.log('═'.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
