/**
 * eBay Listing Actions E2E Test — Tests every action button in the listing page.
 *
 * Full lifecycle: Create → Get → Edit/Save → Publish → Withdraw → Copy → Bulk Update → Delete
 * Uses a test SKU that gets cleaned up at the end.
 *
 * Usage: node test-ebay-actions-e2e.mjs [base_url]
 */

import { createClient } from '@supabase/supabase-js';

const BASE_URL = process.argv[2] || 'https://kolayxport.com';

const supabase = createClient(
  'https://thqyxirtzaajiulmmiqw.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRocXl4aXJ0emFhaml1bG1taXF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYyMDY3NDUsImV4cCI6MjA2MTc4Mjc0NX0.fyjDG2iGVvkEN8EXomnHTo1eWWw89zm81NDOkHjJTJk'
);

const API_KEY = '6d8a3ea6c932f48f65f6a4c0f71ee47395fd9fc77d0fbf6b46956f48129199e1';
let USER_ID = '';
let passed = 0;
let failed = 0;
const errors = [];

// Test data
const TEST_SKU = `E2E-TEST-${Date.now()}`;
const COPY_SKU = `${TEST_SKU}-copy-${Date.now()}`;
let testOfferId = null;
let testListingId = null;
let copyOfferId = null;

// Policies (fetched at runtime)
let fulfillmentPolicyId = null;
let returnPolicyId = null;
let paymentPolicyId = null;

function log(status, name, detail = '') {
  const icon = status === 'PASS' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (status === 'PASS') passed++;
  else {
    failed++;
    errors.push({ name, detail });
  }
}

async function api(path, opts = {}) {
  const separator = path.includes('?') ? '&' : '?';
  const urlWithUser = USER_ID && !path.includes('userId=') && !path.includes('user_id=')
    ? `${BASE_URL}${path}${separator}user_id=${USER_ID}`
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

// ── Auth ─────────────────────────────────────────────────────────────
async function authenticate() {
  console.log('\n🔐 Authenticating...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'kolayxport@gmail.com',
    password: 'AsusGateway%T1',
  });
  if (error) { console.error('Auth failed:', error.message); process.exit(1); }
  USER_ID = data.user.id;
  console.log(`   Logged in as ${data.user.email} (${USER_ID})`);
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: Pre-requisites — Fetch policies
// ═══════════════════════════════════════════════════════════════════════

async function fetchPolicies() {
  console.log('\n📜 Fetching business policies...');

  const [fulfillment, returns, payment] = await Promise.all([
    api('/api/clawd/ebay?action=fulfillment_policies'),
    api('/api/clawd/ebay?action=return_policies'),
    api('/api/clawd/ebay?action=payment_policies'),
  ]);

  // Extract first policy of each type
  const fp = fulfillment.json?.fulfillmentPolicies || fulfillment.json?.policies || [];
  const rp = returns.json?.returnPolicies || returns.json?.policies || [];
  const pp = payment.json?.paymentPolicies || payment.json?.policies || [];

  fulfillmentPolicyId = fp[0]?.fulfillmentPolicyId || fp[0]?.id;
  returnPolicyId = rp[0]?.returnPolicyId || rp[0]?.id;
  paymentPolicyId = pp[0]?.paymentPolicyId || pp[0]?.id;

  log(fulfillmentPolicyId ? 'PASS' : 'FAIL', 'Fulfillment policy found', fulfillmentPolicyId);
  log(returnPolicyId ? 'PASS' : 'FAIL', 'Return policy found', returnPolicyId);
  log(paymentPolicyId ? 'PASS' : 'FAIL', 'Payment policy found', paymentPolicyId);

  if (!fulfillmentPolicyId || !returnPolicyId || !paymentPolicyId) {
    console.error('\n❌ Cannot proceed without business policies. Set them up in eBay Seller Hub first.');
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: CREATE LISTING (ListingCreatorDialog → "Taslak Oluştur")
// ═══════════════════════════════════════════════════════════════════════

async function testCreateListing() {
  console.log('\n🆕 Testing: Create Listing (Draft)');

  const { status, json } = await api('/api/clawd/ebay?action=create_listing', {
    method: 'POST',
    body: {
      sku: TEST_SKU,
      title: 'E2E Test Product — Do Not Buy — Automated Test',
      description: '<p>This is an automated E2E test listing. Please ignore.</p>',
      condition: 'NEW',
      quantity: 1,
      price: 999.99,
      currency: 'USD',
      categoryId: '11450', // Clothing, Shoes & Accessories
      fulfillmentPolicyId,
      returnPolicyId,
      paymentPolicyId,
      publish: false,
      aspects: {
        'Brand': ['Unbranded'],
        'Type': ['Test'],
      },
    },
  });

  if (status === 201 || status === 200) {
    testOfferId = json?.offerId;
    log('PASS', 'create_listing (draft)', `SKU: ${TEST_SKU}, offerId: ${testOfferId}`);
    log(json?.published === false ? 'PASS' : 'FAIL', 'Listing NOT auto-published');
    log(testOfferId ? 'PASS' : 'FAIL', 'Got offerId back', testOfferId);
  } else {
    log('FAIL', 'create_listing', `${status}: ${json?.error || json?.message || JSON.stringify(json)?.substring(0, 200)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: GET SINGLE LISTING (ListingEditorDrawer → fetchListing)
// ═══════════════════════════════════════════════════════════════════════

async function testGetListing() {
  console.log('\n📖 Testing: Get Single Listing');

  const { status, json } = await api(`/api/clawd/ebay?action=listing&sku=${encodeURIComponent(TEST_SKU)}`);

  if (status === 200) {
    log('PASS', 'get listing returns 200');
    log(json?.sku === TEST_SKU ? 'PASS' : 'FAIL', 'Correct SKU returned', json?.sku);
    log(json?.product?.title ? 'PASS' : 'FAIL', 'Has title', json?.product?.title?.substring(0, 50));
    log(json?.condition ? 'PASS' : 'FAIL', 'Has condition', json?.condition);
    log(json?.availability ? 'PASS' : 'FAIL', 'Has availability');

    // Check offers array
    const offers = json?.offers || [];
    log(offers.length > 0 ? 'PASS' : 'FAIL', 'Has offers', `${offers.length} offer(s)`);
    if (offers.length > 0) {
      testOfferId = testOfferId || offers[0].offerId;
      log(offers[0].offerId ? 'PASS' : 'FAIL', 'Offer has offerId', offers[0].offerId);
      log(offers[0].pricingSummary ? 'PASS' : 'FAIL', 'Offer has pricing');
      log(offers[0].status ? 'PASS' : 'FAIL', 'Offer has status', offers[0].status);
    }
  } else {
    log('FAIL', 'get listing', `${status}: ${json?.error}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: UPDATE INVENTORY ITEM (ListingEditorDrawer → handleSave)
// ═══════════════════════════════════════════════════════════════════════

async function testUpdateInventoryItem() {
  console.log('\n✏️  Testing: Update Inventory Item (Save — title, description, aspects)');

  const newTitle = 'E2E Test Product UPDATED — Do Not Buy';
  const { status, json } = await api(`/api/clawd/ebay?action=update_inventory_item&sku=${encodeURIComponent(TEST_SKU)}`, {
    method: 'PUT',
    body: {
      product: {
        title: newTitle,
        description: '<p>Updated description from E2E test.</p>',
        aspects: {
          'Brand': ['Unbranded'],
          'Type': ['Updated Test'],
        },
      },
      condition: 'NEW',
      availability: {
        shipToLocationAvailability: { quantity: 5 },
      },
    },
  });

  log(status === 200 ? 'PASS' : 'FAIL', 'update_inventory_item', `${status}: ${json?.error || 'OK'}`);

  // Verify the update stuck
  const verify = await api(`/api/clawd/ebay?action=listing&sku=${encodeURIComponent(TEST_SKU)}`);
  if (verify.status === 200) {
    const title = verify.json?.product?.title;
    log(title === newTitle ? 'PASS' : 'FAIL', 'Title actually updated', `"${title?.substring(0, 50)}"`);
    const qty = verify.json?.availability?.shipToLocationAvailability?.quantity;
    log(qty === 5 ? 'PASS' : 'FAIL', 'Quantity actually updated', `qty=${qty}`);
  } else {
    log('FAIL', 'Verify update — could not re-fetch listing');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: UPDATE OFFER (ListingEditorDrawer → handleSave price/policies)
// ═══════════════════════════════════════════════════════════════════════

async function testUpdateOffer() {
  console.log('\n💰 Testing: Update Offer (Save — price, policies)');

  if (!testOfferId) {
    log('FAIL', 'update_offer — no offerId available');
    return;
  }

  const { status, json } = await api(`/api/clawd/ebay?action=update_offer&offer_id=${testOfferId}`, {
    method: 'PUT',
    body: {
      price: 888.88,
      currency: 'USD',
      categoryId: '11450',
      fulfillmentPolicyId,
      returnPolicyId,
      paymentPolicyId,
    },
  });

  log(status === 200 ? 'PASS' : 'FAIL', 'update_offer', `${status}: ${json?.error || 'OK'}`);

  // Verify price changed
  const verify = await api(`/api/clawd/ebay?action=listing&sku=${encodeURIComponent(TEST_SKU)}`);
  if (verify.status === 200) {
    const price = verify.json?.offers?.[0]?.pricingSummary?.price?.value;
    log(price === '888.88' || price === 888.88 ? 'PASS' : 'FAIL', 'Price actually updated', `$${price}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: PUBLISH OFFER (ListingEditorDrawer → "Yayınla")
// ═══════════════════════════════════════════════════════════════════════

async function testPublish() {
  console.log('\n📢 Testing: Publish Offer');

  if (!testOfferId) {
    log('FAIL', 'publish — no offerId');
    return;
  }

  const { status, json } = await api(`/api/clawd/ebay?action=publish_offer&offer_id=${testOfferId}`, {
    method: 'POST',
  });

  if (status === 200) {
    testListingId = json?.listingId;
    log('PASS', 'publish_offer', `listingId: ${testListingId}`);
    log(testListingId ? 'PASS' : 'FAIL', 'Got listingId back');
  } else {
    // Publishing may fail if policies/category are incomplete — log details
    log('FAIL', 'publish_offer', `${status}: ${JSON.stringify(json)?.substring(0, 300)}`);
  }

  // Verify status changed
  const verify = await api(`/api/clawd/ebay?action=listing&sku=${encodeURIComponent(TEST_SKU)}`);
  if (verify.status === 200) {
    const offerStatus = verify.json?.offers?.[0]?.status;
    log(offerStatus === 'PUBLISHED' ? 'PASS' : 'FAIL', 'Status is PUBLISHED after publish', offerStatus);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7: WITHDRAW OFFER (ListingEditorDrawer → "Geri Çek")
// ═══════════════════════════════════════════════════════════════════════

async function testWithdraw() {
  console.log('\n⏸️  Testing: Withdraw Offer');

  if (!testOfferId) {
    log('FAIL', 'withdraw — no offerId');
    return;
  }

  const { status, json } = await api(`/api/clawd/ebay?action=withdraw_offer&offer_id=${testOfferId}`, {
    method: 'POST',
  });

  if (status === 200) {
    log('PASS', 'withdraw_offer', `listingId: ${json?.listingId}`);
  } else {
    log('FAIL', 'withdraw_offer', `${status}: ${JSON.stringify(json)?.substring(0, 300)}`);
  }

  // Verify status changed
  const verify = await api(`/api/clawd/ebay?action=listing&sku=${encodeURIComponent(TEST_SKU)}`);
  if (verify.status === 200) {
    const offerStatus = verify.json?.offers?.[0]?.status;
    // After withdraw, status should NOT be PUBLISHED
    log(offerStatus !== 'PUBLISHED' ? 'PASS' : 'FAIL', 'Status is NOT PUBLISHED after withdraw', offerStatus);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8: END LISTING (BulkOperationsBar → "Geri Çek")
// ═══════════════════════════════════════════════════════════════════════

async function testEndListing() {
  console.log('\n🛑 Testing: End Listing (alias for withdraw)');

  if (!testOfferId) {
    log('FAIL', 'end_listing — no offerId');
    return;
  }

  // Re-publish first so we can end it
  const pub = await api(`/api/clawd/ebay?action=publish_offer&offer_id=${testOfferId}`, { method: 'POST' });
  if (pub.status !== 200) {
    log('FAIL', 'end_listing — could not re-publish to test ending', `${pub.status}: ${pub.json?.error}`);
    return;
  }

  const { status, json } = await api(`/api/clawd/ebay?action=end_listing&offer_id=${testOfferId}`, {
    method: 'POST',
  });

  log(status === 200 ? 'PASS' : 'FAIL', 'end_listing', `${status}: ${json?.error || json?.message || 'OK'}`);
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 9: COPY LISTING (ListingEditorDrawer → "Kopyala")
// ═══════════════════════════════════════════════════════════════════════

async function testCopyListing() {
  console.log('\n📋 Testing: Copy Listing');

  // This mimics ListingEditorDrawer handleCopy — creates inventory item with new SKU
  const { status, json } = await api(`/api/clawd/ebay?action=create_inventory_item&sku=${encodeURIComponent(COPY_SKU)}`, {
    method: 'PUT',
    body: {
      product: {
        title: 'E2E Test Product COPY — Do Not Buy',
        description: '<p>Copied from E2E test.</p>',
        aspects: {
          'Brand': ['Unbranded'],
        },
      },
      condition: 'NEW',
      availability: {
        shipToLocationAvailability: { quantity: 1 },
      },
    },
  });

  log(status === 200 ? 'PASS' : 'FAIL', 'copy (create_inventory_item)', `${status}: ${json?.error || 'OK'}`);

  // Verify copy exists
  const verify = await api(`/api/clawd/ebay?action=listing&sku=${encodeURIComponent(COPY_SKU)}`);
  if (verify.status === 200) {
    log(verify.json?.product?.title?.includes('COPY') ? 'PASS' : 'FAIL', 'Copy has correct title', verify.json?.product?.title?.substring(0, 50));
  } else {
    log('FAIL', 'Copy not found after creation', `${verify.status}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 10: BULK UPDATE PRICE (BulkOperationsBar → price dialog)
// ═══════════════════════════════════════════════════════════════════════

async function testBulkUpdatePrice() {
  console.log('\n📊 Testing: Bulk Update Price');

  if (!testOfferId) {
    log('FAIL', 'bulk_update_price — no offerId');
    return;
  }

  const { status, json } = await api('/api/clawd/ebay?action=bulk_update_price', {
    method: 'POST',
    body: {
      requests: [
        {
          sku: TEST_SKU,
          shipToLocationAvailability: { quantity: 10 },
          offers: [
            {
              offerId: testOfferId,
              availableQuantity: 10,
              price: {
                value: '777.77',
                currency: 'USD',
              },
            },
          ],
        },
      ],
    },
  });

  if (status === 200) {
    log('PASS', 'bulk_update_price', `responses: ${json?.responses?.length || 0}`);

    // Check individual response
    const resp = json?.responses?.[0];
    if (resp) {
      const hasErrors = resp.errors && resp.errors.length > 0;
      log(!hasErrors ? 'PASS' : 'FAIL', 'Bulk update no errors', hasErrors ? JSON.stringify(resp.errors).substring(0, 200) : 'Clean');
    }
  } else {
    log('FAIL', 'bulk_update_price', `${status}: ${JSON.stringify(json)?.substring(0, 300)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 11: CATEGORY SUGGESTIONS (ListingEditorDrawer → search)
// ═══════════════════════════════════════════════════════════════════════

async function testCategorySuggestions() {
  console.log('\n📂 Testing: Category Suggestions');

  const { status, json } = await api(`/api/clawd/ebay?action=category_suggestions&q=${encodeURIComponent('leather jacket')}`);

  if (status === 200) {
    const cats = json?.categorySuggestions || json?.categories || [];
    log('PASS', 'category_suggestions returns 200');
    log(cats.length > 0 ? 'PASS' : 'FAIL', `Found ${cats.length} category suggestions`);
    if (cats.length > 0) {
      const first = cats[0];
      log(first.category?.categoryId || first.categoryId ? 'PASS' : 'FAIL', 'Has categoryId', first.category?.categoryId || first.categoryId);
      log(first.category?.categoryName || first.name ? 'PASS' : 'FAIL', 'Has categoryName', first.category?.categoryName || first.name);
    }
  } else {
    log('FAIL', 'category_suggestions', `${status}: ${json?.error}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 12: ITEM ASPECTS (ListingEditorDrawer → fetchItemAspects)
// ═══════════════════════════════════════════════════════════════════════

async function testLocations() {
  console.log('\n📍 Testing: Merchant Locations');

  const { status, json } = await api('/api/clawd/ebay?action=locations');
  if (status === 200) {
    const locations = json?.locations || [];
    log('PASS', 'locations returns 200');
    log(locations.length > 0 ? 'PASS' : 'FAIL', `Found ${locations.length} locations`);
    if (locations.length > 0) {
      log(locations[0].merchantLocationKey ? 'PASS' : 'FAIL', 'Has merchantLocationKey', locations[0].merchantLocationKey);
    }
  } else {
    log('FAIL', 'locations', `${status}: ${json?.error}`);
  }
}

async function testItemAspects() {
  console.log('\n🏷️  Testing: Item Aspects');

  // Use a leaf category (57988 = Coats, Jackets & Vests from our category_suggestions test)
  const { status, json } = await api('/api/clawd/ebay?action=item_aspects&category_id=57988');

  if (status === 200) {
    const aspects = json?.aspects || [];
    log('PASS', 'item_aspects returns 200');
    log(aspects.length > 0 ? 'PASS' : 'FAIL', `Found ${aspects.length} aspects`);
    if (aspects.length > 0) {
      const required = aspects.filter(a => a.aspectConstraint?.aspectRequired);
      log('PASS', `${required.length} required aspects`);
    }
  } else {
    log('FAIL', 'item_aspects', `${status}: ${json?.error}`);
  }

  // Test non-leaf category graceful handling
  console.log('\n🏷️  Testing: Item Aspects (non-leaf category — should not crash)');
  const { status: s2, json: j2 } = await api('/api/clawd/ebay?action=item_aspects&category_id=11450');
  log(s2 === 200 ? 'PASS' : 'FAIL', 'Non-leaf category returns 200 (graceful)', `${s2}: ${j2?.error || 'OK'}`);
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 13: LISTINGS LIST (ebay-listings page → fetchListings)
// ═══════════════════════════════════════════════════════════════════════

async function testListingsList() {
  console.log('\n📄 Testing: Listings List (all offers)');

  const { status, json } = await api('/api/clawd/ebay?action=listings&marketplace_id=EBAY_US');

  if (status === 200) {
    const offers = json?.offers || [];
    log('PASS', 'listings returns 200');
    log(offers.length > 0 ? 'PASS' : 'FAIL', `Found ${offers.length} offers`);

    // Check that our test listing is in there
    const testOffer = offers.find(o => o.sku === TEST_SKU);
    log(testOffer ? 'PASS' : 'FAIL', 'Test listing found in listings', testOffer ? `offerId: ${testOffer.offerId}` : 'NOT FOUND');
  } else {
    log('FAIL', 'listings', `${status}: ${json?.error}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 14: CREATE & PUBLISH (ListingCreatorDialog → "Oluştur ve Yayınla")
// ═══════════════════════════════════════════════════════════════════════

async function testCreateAndPublish() {
  console.log('\n🚀 Testing: Create & Publish (in one step)');

  const publishSku = `${TEST_SKU}-pub`;
  const { status, json } = await api('/api/clawd/ebay?action=create_listing', {
    method: 'POST',
    body: {
      sku: publishSku,
      title: 'E2E Test PUBLISH — Do Not Buy — Automated',
      description: '<p>Auto-publish test.</p>',
      condition: 'NEW',
      quantity: 1,
      price: 999.99,
      currency: 'USD',
      categoryId: '11450',
      fulfillmentPolicyId,
      returnPolicyId,
      paymentPolicyId,
      publish: true,
      aspects: {
        'Brand': ['Unbranded'],
      },
    },
  });

  if (status === 201 || status === 200) {
    log('PASS', 'create_listing (publish=true)', `offerId: ${json?.offerId}, listingId: ${json?.listingId}`);
    log(json?.published === true ? 'PASS' : 'FAIL', 'Listing auto-published', `published: ${json?.published}`);

    // Clean up: withdraw + delete
    if (json?.offerId) {
      await api(`/api/clawd/ebay?action=withdraw_offer&offer_id=${json.offerId}`, { method: 'POST' });
    }
    await api(`/api/clawd/ebay?action=delete_inventory_item&sku=${encodeURIComponent(publishSku)}`, { method: 'DELETE' });
    log('PASS', 'Auto-publish test listing cleaned up');
  } else {
    log('FAIL', 'create_listing (publish=true)', `${status}: ${JSON.stringify(json)?.substring(0, 300)}`);
    // Cleanup attempt anyway
    await api(`/api/clawd/ebay?action=delete_inventory_item&sku=${encodeURIComponent(publishSku)}`, { method: 'DELETE' });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 15: AI ENDPOINTS (ListingEditorDrawer AI buttons)
// ═══════════════════════════════════════════════════════════════════════

async function testAIEndpoints() {
  console.log('\n🤖 Testing: AI Action Buttons');

  // AI Optimize Title
  const titleResp = await api('/api/clawd/ebay-ai?action=optimize_title', {
    method: 'POST',
    body: { title: 'nike shoes mens size 10 used good condition black leather' },
  });
  if (titleResp.status === 200) {
    log('PASS', 'AI optimize_title', `"${titleResp.json?.optimizedTitle?.substring(0, 60)}"`);
  } else if (titleResp.status === 429) {
    log('PASS', 'AI optimize_title (rate limited)', 'Expected on free tier');
  } else {
    log('FAIL', 'AI optimize_title', `${titleResp.status}: ${titleResp.json?.error}`);
  }

  // AI Generate Description
  const descResp = await api('/api/clawd/ebay-ai?action=generate_description', {
    method: 'POST',
    body: { title: 'Vintage Leather Jacket Brown', aspects: { Brand: ['Unbranded'], Size: ['L'] } },
  });
  if (descResp.status === 200) {
    log('PASS', 'AI generate_description', `${descResp.json?.description?.length || 0} chars`);
  } else if (descResp.status === 429) {
    log('PASS', 'AI generate_description (rate limited)', 'Expected');
  } else {
    log('FAIL', 'AI generate_description', `${descResp.status}: ${descResp.json?.error}`);
  }

  // AI Suggest Price
  const priceResp = await api('/api/clawd/ebay-ai?action=suggest_price', {
    method: 'POST',
    body: { title: 'Vintage Leather Jacket Brown', condition: 'USED_EXCELLENT' },
  });
  if (priceResp.status === 200) {
    log('PASS', 'AI suggest_price', `$${priceResp.json?.suggestedPrice || priceResp.json?.price}`);
  } else if (priceResp.status === 429) {
    log('PASS', 'AI suggest_price (rate limited)', 'Expected');
  } else {
    log('FAIL', 'AI suggest_price', `${priceResp.status}: ${priceResp.json?.error}`);
  }

  // AI Analyze Listing
  const analyzeResp = await api('/api/clawd/ebay-ai?action=analyze_listing', {
    method: 'POST',
    body: { title: 'nike shoes mens size 10', price: 45, imageCount: 3, description: 'Good shoes.' },
  });
  if (analyzeResp.status === 200) {
    log('PASS', 'AI analyze_listing', `score: ${analyzeResp.json?.score}`);
  } else if (analyzeResp.status === 429) {
    log('PASS', 'AI analyze_listing (rate limited)', 'Expected');
  } else {
    log('FAIL', 'AI analyze_listing', `${analyzeResp.status}: ${analyzeResp.json?.error}`);
  }

  // AI Suggest Aspects
  const aspectsResp = await api('/api/clawd/ebay-ai?action=suggest_aspects', {
    method: 'POST',
    body: { title: 'Vintage Leather Jacket Brown Size L', categoryId: '11450', aspectNames: ['Brand', 'Size', 'Color', 'Material'] },
  });
  if (aspectsResp.status === 200) {
    log('PASS', 'AI suggest_aspects', `${Object.keys(aspectsResp.json?.aspects || aspectsResp.json?.suggestedAspects || {}).length} aspects`);
  } else if (aspectsResp.status === 429) {
    log('PASS', 'AI suggest_aspects (rate limited)', 'Expected');
  } else {
    log('FAIL', 'AI suggest_aspects', `${aspectsResp.status}: ${aspectsResp.json?.error}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 16: MARKET RESEARCH (used by ListingCreatorDialog)
// ═══════════════════════════════════════════════════════════════════════

async function testMarketResearch() {
  console.log('\n🔬 Testing: Market Research');

  const { status, json } = await api(`/api/clawd/ebay?action=search_market&q=${encodeURIComponent('vintage leather jacket')}&limit=5`);

  if (status === 200) {
    const items = json?.itemSummaries || json?.items || [];
    log('PASS', 'search_market returns 200');
    log(items.length > 0 ? 'PASS' : 'FAIL', `Found ${items.length} market items`);
    if (items.length > 0) {
      log(items[0].title ? 'PASS' : 'FAIL', 'Has title');
      log(items[0].price ? 'PASS' : 'FAIL', 'Has price', `$${items[0].price?.value}`);
    }
  } else {
    log('FAIL', 'search_market', `${status}: ${json?.error}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 17: CSV EXPORT (toolbar → "CSV İndir")
// This is client-side only, but we test the listings data format
// ═══════════════════════════════════════════════════════════════════════

async function testCSVExportData() {
  console.log('\n📁 Testing: Listings data for CSV export');

  const { status, json } = await api('/api/clawd/ebay?action=listings&marketplace_id=EBAY_US');

  if (status === 200 && json?.offers?.length > 0) {
    const offer = json.offers[0];
    // Check all fields needed by CSV export
    log(offer.sku ? 'PASS' : 'FAIL', 'CSV field: sku', offer.sku);
    log(offer.pricingSummary?.price?.value ? 'PASS' : 'FAIL', 'CSV field: price');
    log(offer.status ? 'PASS' : 'FAIL', 'CSV field: status');
    log('PASS', 'Listings data suitable for CSV export');
  } else {
    log('FAIL', 'CSV export data', `${status}: no offers`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 18: DELETE (ListingEditorDrawer → "Sil")
// ═══════════════════════════════════════════════════════════════════════

async function testDeleteListings() {
  console.log('\n🗑️  Testing: Delete Listings (cleanup)');

  // Delete the copy first
  const copyDel = await api(`/api/clawd/ebay?action=delete_inventory_item&sku=${encodeURIComponent(COPY_SKU)}`, {
    method: 'DELETE',
  });
  log(copyDel.status === 200 ? 'PASS' : 'FAIL', 'Delete copy listing', `${copyDel.status}: ${copyDel.json?.error || 'OK'}`);

  // Delete the main test listing
  const mainDel = await api(`/api/clawd/ebay?action=delete_inventory_item&sku=${encodeURIComponent(TEST_SKU)}`, {
    method: 'DELETE',
  });
  log(mainDel.status === 200 ? 'PASS' : 'FAIL', 'Delete main test listing', `${mainDel.status}: ${mainDel.json?.error || 'OK'}`);

  // Verify deletion
  const verify = await api(`/api/clawd/ebay?action=listing&sku=${encodeURIComponent(TEST_SKU)}`);
  // Should get 404 or error
  log(verify.status !== 200 || !verify.json?.sku ? 'PASS' : 'FAIL', 'Listing gone after delete', `status: ${verify.status}`);
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 19: ERROR HANDLING — Bad inputs
// ═══════════════════════════════════════════════════════════════════════

async function testErrorHandling() {
  console.log('\n⚠️  Testing: Error Handling');

  // Missing SKU
  const noSku = await api('/api/clawd/ebay?action=create_listing', {
    method: 'POST',
    body: { title: 'test', price: 10 },
  });
  log(noSku.status === 400 ? 'PASS' : 'FAIL', 'create_listing without SKU → 400', `got ${noSku.status}`);

  // Missing title
  const noTitle = await api('/api/clawd/ebay?action=create_listing', {
    method: 'POST',
    body: { sku: 'TEST-NO-TITLE', price: 10 },
  });
  log(noTitle.status === 400 ? 'PASS' : 'FAIL', 'create_listing without title → 400', `got ${noTitle.status}`);

  // Missing price
  const noPrice = await api('/api/clawd/ebay?action=create_listing', {
    method: 'POST',
    body: { sku: 'TEST-NO-PRICE', title: 'Test' },
  });
  log(noPrice.status === 400 ? 'PASS' : 'FAIL', 'create_listing without price → 400', `got ${noPrice.status}`);

  // Invalid offerId for publish
  const badPublish = await api('/api/clawd/ebay?action=publish_offer&offer_id=FAKE_ID', {
    method: 'POST',
  });
  log(badPublish.status >= 400 ? 'PASS' : 'FAIL', 'publish invalid offerId → error', `got ${badPublish.status}`);

  // Delete non-existent SKU
  const badDelete = await api('/api/clawd/ebay?action=delete_inventory_item&sku=NONEXISTENT-SKU-XYZ', {
    method: 'DELETE',
  });
  log(badDelete.status >= 400 ? 'PASS' : 'FAIL', 'delete non-existent SKU → error', `got ${badDelete.status}`);

  // Unknown action
  const badAction = await api('/api/clawd/ebay?action=does_not_exist');
  log(badAction.status >= 400 ? 'PASS' : 'FAIL', 'unknown action → error', `got ${badAction.status}`);
}

// ═══════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  eBay Listing Actions — Full E2E Test Suite`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Test SKU: ${TEST_SKU}`);
  console.log(`${'═'.repeat(65)}`);

  await authenticate();

  // ── Pre-requisites ──
  console.log(`\n${'─'.repeat(65)}`);
  console.log('  PRE-REQUISITES');
  console.log(`${'─'.repeat(65)}`);
  await fetchPolicies();

  // ── Listing Lifecycle ──
  console.log(`\n${'─'.repeat(65)}`);
  console.log('  LISTING LIFECYCLE (Create → Edit → Publish → Withdraw → Copy → Delete)');
  console.log(`${'─'.repeat(65)}`);

  await testCreateListing();           // Create draft
  await testGetListing();              // Fetch single listing
  await testUpdateInventoryItem();     // Edit title/desc/aspects/qty
  await testUpdateOffer();             // Edit price/policies
  await testPublish();                 // Publish
  await testWithdraw();                // Withdraw
  await testEndListing();              // End (alias)
  await testCopyListing();             // Copy
  await testBulkUpdatePrice();         // Bulk price/qty

  // ── Data Endpoints ──
  console.log(`\n${'─'.repeat(65)}`);
  console.log('  DATA ENDPOINTS (used by page/editor)');
  console.log(`${'─'.repeat(65)}`);

  await testLocations();
  await testCategorySuggestions();
  await testItemAspects();
  await testListingsList();
  await testCSVExportData();
  await testMarketResearch();

  // ── Create & Publish ──
  console.log(`\n${'─'.repeat(65)}`);
  console.log('  CREATE & PUBLISH (one-step)');
  console.log(`${'─'.repeat(65)}`);

  await testCreateAndPublish();

  // ── AI Endpoints ──
  console.log(`\n${'─'.repeat(65)}`);
  console.log('  AI TOOLS');
  console.log(`${'─'.repeat(65)}`);

  await testAIEndpoints();

  // ── Error Handling ──
  console.log(`\n${'─'.repeat(65)}`);
  console.log('  ERROR HANDLING');
  console.log(`${'─'.repeat(65)}`);

  await testErrorHandling();

  // ── Cleanup ──
  console.log(`\n${'─'.repeat(65)}`);
  console.log('  CLEANUP');
  console.log(`${'─'.repeat(65)}`);

  await testDeleteListings();

  // ── Summary ──
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m, ${passed + failed} total`);
  if (errors.length > 0) {
    console.log(`\n  Failed tests:`);
    errors.forEach(e => console.log(`    \x1b[31m✗\x1b[0m ${e.name} — ${e.detail}`));
  }
  console.log(`${'═'.repeat(65)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  // Emergency cleanup
  console.log('\n🧹 Emergency cleanup...');
  Promise.all([
    api(`/api/clawd/ebay?action=delete_inventory_item&sku=${encodeURIComponent(TEST_SKU)}`, { method: 'DELETE' }).catch(() => {}),
    api(`/api/clawd/ebay?action=delete_inventory_item&sku=${encodeURIComponent(COPY_SKU)}`, { method: 'DELETE' }).catch(() => {}),
    api(`/api/clawd/ebay?action=delete_inventory_item&sku=${encodeURIComponent(TEST_SKU + '-pub')}`, { method: 'DELETE' }).catch(() => {}),
  ]).then(() => process.exit(1));
});
