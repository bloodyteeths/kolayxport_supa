// Research hub fixtures (research.md §16): mixed currency, a $9,999 placeholder, entity titles, small samples.
import type { EtsySearchItem } from '@/lib/research/etsySearch';

export const NOW = Date.parse('2026-10-15T12:00:00Z');
const DAY = 86_400;
const nowSec = Math.floor(NOW / 1000);

let seq = 1_000_000_000;
export function item(over: Partial<EtsySearchItem> = {}): EtsySearchItem {
  seq += 1;
  return {
    listingId: String(seq),
    title: 'Halloween Decor Spooky Sign',
    description: '',
    price: 25,
    currency: 'USD',
    views: 100,
    favorites: 120,
    tags: ['halloween decor', 'spooky sign', 'fall decor'],
    shopId: `shop${seq % 17}`,
    taxonomyId: 1027,
    url: `https://www.etsy.com/listing/${seq}`,
    quantity: 5,
    originalCreatedAt: nowSec - 400 * DAY,
    renewedAt: nowSec - 3 * DAY,
    state: 'active',
    isPersonalizable: false,
    hasVariations: false,
    ...over,
  };
}

/** "halloween decor": 30 USD listings $15–$59, 5 JPY, 3 INR (no FX rate), 1 $9,999 placeholder. */
export function halloweenItems(): EtsySearchItem[] {
  const out: EtsySearchItem[] = [];
  for (let i = 0; i < 30; i++) out.push(item({ price: 15 + i * 1.5 }));
  for (let i = 0; i < 5; i++) out.push(item({ price: 3000 + i * 200, currency: 'JPY' }));
  for (let i = 0; i < 3; i++) out.push(item({ price: 1500, currency: 'INR' }));
  out.push(item({ price: 9999, currency: 'USD', title: 'Halloween &amp; Fall Bundle &#39;Placeholder&#39;' }));
  return out;
}

/** Raw Etsy `/listings/active` entry. */
export function rawListing(over: Record<string, unknown> = {}) {
  return {
    listing_id: 1490012234,
    title: 'Mom&#39;s &quot;Best&quot; Keepsake Box &amp;amp; Gift',
    description: 'A box &amp; more',
    price: { amount: 4500, divisor: 100, currency_code: 'usd' },
    views: 1200,
    num_favorers: 340,
    tags: ['keepsake box', 'memory box'],
    shop_id: 555,
    taxonomy_id: 1234,
    url: 'https://www.etsy.com/listing/1490012234/x',
    quantity: 3,
    original_creation_timestamp: nowSec - 800 * DAY,
    created_timestamp: nowSec - 2 * DAY,
    state: 'active',
    ...over,
  };
}
