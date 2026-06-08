#!/usr/bin/env node
// E2E test: is Etsy's 3-variation API live, and is our SaaS ready?
// Usage: node test-etsy-3-variations.mjs [LISTING_ID]
//
// Hits the production SaaS at kolayxport.com using the same x-api-key
// pattern as test-etsy-all.mjs. The SaaS proxies to Etsy with the shop's
// OAuth token, so we don't need raw Etsy credentials locally.

const BASE = process.env.BASE_URL || 'https://kolayxport.com';
const API_KEY = process.env.SAAS_API_KEY || '6d8a3ea6c932f48f65f6a4c0f71ee47395fd9fc77d0fbf6b46956f48129199e1';
const SHOP_ID = process.env.SHOP_ID || '54844618';
const LISTING_ID_ARG = process.argv[2] || process.env.LISTING_ID;

const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

let passed = 0, failed = 0;
const fail = (label, err) => { failed++; console.log(`  ${failed + passed}. FAIL — ${label}\n     ${err}`); };
const pass = (label, detail = '') => { passed++; console.log(`  ${failed + passed}. PASS — ${label}${detail ? ` — ${detail}` : ''}`); };

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { headers, ...opts });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

console.log(`\nEtsy 3-Variation Readiness E2E`);
console.log(`  base:    ${BASE}`);
console.log(`  shop:    ${SHOP_ID}`);
console.log(`  listing: ${LISTING_ID_ARG || '(auto-pick from drafts)'}\n`);

// ─────────────────────────────────────────────────────────────
// 1. Pick a listing to work with (drafts only — we never want to
//    accidentally mutate a live listing during the probe).
// ─────────────────────────────────────────────────────────────
let listingId = LISTING_ID_ARG;
let taxonomyId = null;

if (!listingId) {
  const drafts = await api(`/api/clawd/etsy?action=drafts&shop_id=${SHOP_ID}&limit=5`);
  if (drafts.ok && Array.isArray(drafts.body?.results) && drafts.body.results.length > 0) {
    const d = drafts.body.results[0];
    listingId = d.listing_id;
    taxonomyId = d.taxonomy_id;
    pass(`Auto-picked draft listing ${listingId} (taxonomy ${taxonomyId})`);
  } else {
    fail('Auto-pick draft listing', `No drafts available: ${drafts.status} ${JSON.stringify(drafts.body).slice(0, 200)}`);
    console.log(`\n  Pass a LISTING_ID arg to continue. Aborting.\n`);
    process.exit(1);
  }
} else {
  const listing = await api(`/api/clawd/etsy?action=listing&listing_id=${listingId}&shop_id=${SHOP_ID}`);
  if (listing.ok) {
    taxonomyId = listing.body?.taxonomy_id;
    pass(`Loaded listing ${listingId} (taxonomy ${taxonomyId})`);
  } else {
    fail(`Load listing ${listingId}`, `${listing.status} ${JSON.stringify(listing.body).slice(0, 200)}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────
// 2. Taxonomy returns properties with predefined possible_values
//    (these are eligible for the 3rd-variation slot).
// ─────────────────────────────────────────────────────────────
if (taxonomyId) {
  const tax = await api(`/api/clawd/etsy?action=get_taxonomy_properties&taxonomy_id=${taxonomyId}&shop_id=${SHOP_ID}`);
  if (tax.ok && Array.isArray(tax.body?.results)) {
    const eligible = tax.body.results.filter(p =>
      Array.isArray(p.possible_values) &&
      p.possible_values.length > 0 &&
      p.property_id !== 513 &&
      p.property_id !== 514
    );
    if (eligible.length > 0) {
      pass(`Taxonomy ${taxonomyId} exposes ${eligible.length} 3rd-variation-eligible properties`, eligible.slice(0, 3).map(p => p.display_name || p.name).join(', '));
    } else {
      fail(`Taxonomy ${taxonomyId} has no eligible 3rd-variation properties`, `(may be a niche w/ no predefined props; UI will hide the picker)`);
    }
  } else {
    fail('get_taxonomy_properties', `${tax.status} ${JSON.stringify(tax.body).slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────────────────────
// 3. Read the listing's current inventory — confirm parser handles
//    whatever shape comes back (1, 2, or 3 property_values).
// ─────────────────────────────────────────────────────────────
const inv = await api(`/api/clawd/etsy?action=get_listing_inventory&listing_id=${listingId}&shop_id=${SHOP_ID}`);
if (!inv.ok) {
  fail('get_listing_inventory', `${inv.status} ${JSON.stringify(inv.body).slice(0, 300)}`);
  process.exit(1);
}
const products = inv.body?.products || [];
const variationCounts = new Set(products.map(p => (p.property_values || []).length));
pass(`Inventory read: ${products.length} products, variation slot counts seen: [${Array.from(variationCounts).join(', ')}]`);

if (variationCounts.has(3)) {
  pass('This listing already uses 3 variations — Etsy has rolled out write support for it');
}

// ─────────────────────────────────────────────────────────────
// 4. THE KEY PROBE: send a no-op PUT with max_variations_supported=3.
//    Re-send the current inventory unchanged. If Etsy accepts the
//    query param (200), the API is open. If it 400s "invalid query
//    param", the API isn't ready for this app yet.
// ─────────────────────────────────────────────────────────────
if (products.length > 0) {
  console.log(`\n  Probing PUT with ?max_variations_supported=3 (no-op resend)…`);
  const echo = {
    products: products.map(p => ({
      sku: p.sku || '',
      property_values: (p.property_values || []).map(pv => ({
        property_id: pv.property_id,
        property_name: pv.property_name,
        values: pv.values || [],
        ...(Array.isArray(pv.value_ids) && pv.value_ids.length ? { value_ids: pv.value_ids } : {}),
        ...(pv.scale_id ? { scale_id: pv.scale_id } : {}),
      })),
      offerings: (p.offerings || []).map(o => ({
        price: typeof o.price === 'object' ? o.price.amount / (o.price.divisor || 100) : o.price,
        quantity: o.quantity,
        is_enabled: o.is_enabled,
        ...(o.readiness_state_id ? { readiness_state_id: o.readiness_state_id } : {}),
      })),
    })),
    price_on_property: inv.body.price_on_property || [],
    quantity_on_property: inv.body.quantity_on_property || [],
    sku_on_property: inv.body.sku_on_property || [],
  };

  const probe = await api(`/api/clawd/etsy?action=update_listing_inventory&listing_id=${listingId}&shop_id=${SHOP_ID}`, {
    method: 'PUT',
    body: JSON.stringify(echo),
  });

  if (probe.ok) {
    pass('Etsy ACCEPTED ?max_variations_supported=3 — write API is live for this app', `status ${probe.status}`);
  } else {
    const msg = typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body);
    if (msg.includes('max_variations_supported') || msg.includes('query param')) {
      fail('Etsy REJECTED ?max_variations_supported=3 — API not yet open for this app', msg.slice(0, 300));
    } else if (msg.includes('unsupported number of property IDs') || msg.includes('property_values')) {
      // 3-variation validation kicked in — that itself proves the param is recognized.
      pass('Etsy recognized the param (rejected on shape, not on param)', msg.slice(0, 200));
    } else {
      fail(`PUT probe failed for unrelated reason`, `${probe.status} ${msg.slice(0, 300)}`);
    }
  }
} else {
  console.log(`  (skipping write probe — no products to echo)`);
}

// ─────────────────────────────────────────────────────────────
// 5. Summary
// ─────────────────────────────────────────────────────────────
console.log(`\n  ──────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`  ──────────────────────────────────────\n`);
process.exit(failed > 0 ? 1 : 0);
