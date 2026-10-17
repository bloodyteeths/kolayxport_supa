// lib/ebay/legacyTrading.ts — editing listings created on eBay itself ("legacy", Trading API). SERVER ONLY.
//
// Founder 2026-10-17: all 31 of their eBay listings are legacy; the Inventory API cannot edit them, so the editor sent
// sellers to eBay. Verified the same day (scripts/ebay-legacy-description-test.ts): ReviseFixedPriceItem with the
// user's OAuth token edits an active listing and GetItem reads it back.
//
// The drafts keep the Inventory-API patch shapes the editor already writes (inventory.product.title/description,
// inventory.availability.shipToLocationAvailability.quantity, offer.pricingSummary.price, offer.listingDescription);
// this module maps them to the Trading API:
//  - title / description → ReviseFixedPriceItem
//  - price / quantity    → ReviseInventoryStatus (Quantity = quantity AVAILABLE, so sold units are never miscounted)
// Supported fields only: anything else staged on a legacy draft is refused before eBay is called.

import { EbayDraftError } from './draftErrors';

const TRADING_URL = 'https://api.ebay.com/ws/api.dll';
const COMPAT = '1193';

type JsonMap = Record<string, any>;

/** Typed refusal: stored as `ebay.<key>` (lib/drafts/syncErrors), with a fix in lib/listings/failureFix. */
function refuse(key: string, message: string, params?: Record<string, string | number>, status = 409) {
  return new EbayDraftError(key.split('.').pop()!.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase(), message, { status, key, params });
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cdata = (s: string) => `<![CDATA[${s.split(']]>').join(']]]]><![CDATA[>')}]]>`;
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1] ?? null;
const attrTag = (xml: string, name: string) => xml.match(new RegExp(`<${name}\\s+currencyID="([A-Z]{3})"[^>]*>([\\s\\S]*?)</${name}>`));

async function trading(token: string, call: string, body: string): Promise<string> {
  const res = await fetch(TRADING_URL, {
    method: 'POST',
    headers: {
      'X-EBAY-API-IAF-TOKEN': token,
      'X-EBAY-API-CALL-NAME': call,
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-COMPATIBILITY-LEVEL': COMPAT,
      'Content-Type': 'text/xml',
    },
    body: `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${call}Request>`,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`eBay Trading API ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

/** eBay's own error lines (LongMessage), joined; '' when none. Exported for tests. */
export function tradingErrors(xml: string): string {
  const errs = [...xml.matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)]
    .filter((m) => !/<SeverityCode>Warning<\/SeverityCode>/.test(m[1]))
    .map((m) => unescapeXml(tag(m[1], 'LongMessage') || tag(m[1], 'ShortMessage') || '').trim())
    .filter(Boolean);
  return errs.join(' ');
}

function assertOk(xml: string) {
  const ack = tag(xml, 'Ack');
  if (ack === 'Success' || ack === 'Warning') return;
  // classifyEbayDraftSyncError reads this message (ended listing, selling limit, …).
  throw new Error(`eBay API error: ${tradingErrors(xml) || ack || 'unknown'}`);
}

export type LegacyItem = {
  itemId: string;
  status: string | null;
  title: string;
  description: string;
  price: { value: string; currency: string } | null;
  /** Quantity available (Quantity − QuantitySold). */
  quantity: number;
  hasVariations: boolean;
};

/** GetItem XML → the fields KolayXport edits. Pure, exported for tests. */
export function parseLegacyItem(xml: string, itemId: string): LegacyItem {
  const item = tag(xml, 'Item') ?? '';
  const priceM = attrTag(item, 'CurrentPrice') ?? attrTag(item, 'StartPrice');
  const qty = Number(tag(item, 'Quantity') ?? 0);
  const sold = Number(tag(tag(item, 'SellingStatus') ?? '', 'QuantitySold') ?? 0);
  return {
    itemId,
    status: tag(tag(item, 'SellingStatus') ?? '', 'ListingStatus'),
    title: unescapeXml(tag(item, 'Title') ?? ''),
    description: unescapeXml(tag(item, 'Description') ?? ''),
    price: priceM ? { value: priceM[2].trim(), currency: priceM[1] } : null,
    quantity: Math.max(0, (Number.isFinite(qty) ? qty : 0) - (Number.isFinite(sold) ? sold : 0)),
    hasVariations: /<Variations>/.test(item),
  };
}

export async function getLegacyItem(token: string, itemId: string): Promise<LegacyItem> {
  const xml = await trading(token, 'GetItem', `<ItemID>${escapeXml(itemId)}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>false</IncludeItemSpecifics>`);
  if (tag(xml, 'Ack') === 'Failure') {
    const msg = tradingErrors(xml);
    if (/invalid item ?id|item .*not found|does not exist/i.test(msg)) throw refuse('draftSync.missingOnEbay', `eBay API error: ${msg}`);
    throw new Error(`eBay API error: ${msg}`);
  }
  return parseLegacyItem(xml, itemId);
}

/** A legacy item as the Inventory-API snapshot shapes the drafts and the diff use. Pure, exported for tests. */
export function legacySnapshots(item: LegacyItem): { inventory: JsonMap; offer: JsonMap } {
  return {
    inventory: {
      product: { title: item.title, description: item.description },
      availability: { shipToLocationAvailability: { quantity: item.quantity } },
    },
    offer: {
      ...(item.price ? { pricingSummary: { price: item.price } } : {}),
      listingDescription: item.description,
      listing: { listingId: item.itemId },
      ...(item.status ? { status: item.status } : {}),
    },
  };
}

/** What a legacy draft changes, read from its patches; `unsupported` lists any other staged field. Pure. */
export function legacyChanges(inventoryPatch: JsonMap | null | undefined, offerPatch: JsonMap | null | undefined) {
  const inv = inventoryPatch || {};
  const ofr = offerPatch || {};
  const out: { title?: string; description?: string; price?: { value: string; currency: string }; quantity?: number; unsupported: string[] } = { unsupported: [] };
  const product = inv.product || {};
  if (typeof product.title === 'string') out.title = product.title;
  const desc = typeof product.description === 'string' ? product.description : typeof ofr.listingDescription === 'string' ? ofr.listingDescription : undefined;
  if (desc !== undefined) out.description = desc;
  const q = inv.availability?.shipToLocationAvailability?.quantity;
  if (q !== undefined && q !== null) out.quantity = Math.max(0, Math.floor(Number(q) || 0));
  const p = ofr.pricingSummary?.price;
  if (p && p.value !== undefined) out.price = { value: String(p.value), currency: String(p.currency || 'USD') };
  for (const k of Object.keys(product)) if (k !== 'title' && k !== 'description') out.unsupported.push(`product.${k}`);
  for (const k of Object.keys(inv)) if (k !== 'product' && k !== 'availability') out.unsupported.push(k);
  for (const k of Object.keys(ofr)) if (k !== 'pricingSummary' && k !== 'listingDescription') out.unsupported.push(k);
  return out;
}

/** Fields of a legacy listing KolayXport can send (editor + staging use the same list). */
export const LEGACY_EDITABLE_PATHS = ['product.title', 'product.description', 'availability.shipToLocationAvailability.quantity', 'pricingSummary.price', 'listingDescription'] as const;

/**
 * Sends a legacy draft's changes. Refuses (no eBay call) on unsupported fields, an ended listing, or a price / stock
 * change on a listing with variations (those are per-variation on eBay). Returns what was sent.
 */
export async function reviseLegacyItem(token: string, item: LegacyItem, changes: ReturnType<typeof legacyChanges>) {
  if (changes.unsupported.length) {
    throw refuse('draftSync.legacyUnsupportedFields', 'Only title, description, price and quantity can be changed for this listing', { fields: changes.unsupported.join(', ') });
  }
  if (item.status && item.status !== 'Active') {
    throw refuse('draftSync.listingEnded', 'You are not allowed to revise ended listings.');
  }
  const sent: string[] = [];
  if (changes.title !== undefined || changes.description !== undefined) {
    const parts = [`<ItemID>${escapeXml(item.itemId)}</ItemID>`];
    if (changes.title !== undefined) parts.push(`<Title>${escapeXml(changes.title)}</Title>`);
    if (changes.description !== undefined) parts.push(`<Description>${cdata(changes.description)}</Description>`);
    assertOk(await trading(token, 'ReviseFixedPriceItem', `<Item>${parts.join('')}</Item>`));
    if (changes.title !== undefined) sent.push('title');
    if (changes.description !== undefined) sent.push('description');
  }
  if (changes.price !== undefined || changes.quantity !== undefined) {
    if (item.hasVariations) {
      throw refuse('draftSync.legacyVariationsPriceStock', 'Price and quantity of a listing with variations are set per variation on eBay');
    }
    const parts = [`<ItemID>${escapeXml(item.itemId)}</ItemID>`];
    if (changes.price !== undefined) parts.push(`<StartPrice>${escapeXml(changes.price.value)}</StartPrice>`);
    if (changes.quantity !== undefined) parts.push(`<Quantity>${changes.quantity}</Quantity>`);
    assertOk(await trading(token, 'ReviseInventoryStatus', `<InventoryStatus>${parts.join('')}</InventoryStatus>`));
    if (changes.price !== undefined) sent.push('price');
    if (changes.quantity !== undefined) sent.push('quantity');
  }
  return sent;
}
