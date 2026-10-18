// lib/mcp/listingTools.ts — listing work for the seller's own AI over MCP (SERVER ONLY): audit + SEO, market research,
// staged changes on every marketplace (text, price, stock), new listing drafts, photos and AI product images.
// Founder 2026-10-18: "can MCP also make listing audit & SEO & create listing with reference images, change prices?"
//
// Same rules as lib/mcp/tools: the userId comes only from the connection; every write is a STAGED DRAFT (nothing
// reaches a marketplace until the seller sends it in KolayXport); photo links must be public https (never local paths).
import { createTranslator } from 'next-intl';
import prisma from '@/lib/prisma';
import { scoreCacheRow, healthFailTokens, sortChecks, type ListingScoreMarketplace } from '@/lib/listingScore';
import { checkTags, checkTitle, TAG_MAX_COUNT, TAG_MAX_LEN, TITLE_MAX as ETSY_TITLE_MAX, TITLE_MIN as ETSY_TITLE_MIN } from '@/lib/etsy/seoRules';
import { TITLE_MAX as EBAY_TITLE_MAX } from '@/lib/ebay/payloadRules';
import { DESCRIPTION_MAX, TITLE_MAX as CATALOG_TITLE_MAX, isCatalogDraftError } from '@/lib/catalogDrafts/schemas';
import { stageCatalogDraft } from '@/lib/catalogDrafts/service';
import { lookupMessage } from '@/lib/notificationCenter/render';
import { formattersFor, userRateLimit } from '@/lib/research/etsySearch';
import { researchEbay, researchEtsy } from '@/pages/api/research/products';
import { sanitizeEtsyBatchFields } from '@/lib/bulk/batchStage';
import { assertAllowedSourceUrl } from '@/lib/etsy/mediaSafety';
import { assertShopOwnership, getEtsyAccessToken, upsertDraftPatch as stageEtsy } from '@/lib/etsy/draftService';
import { upsertDraftPatch as stageEbay } from '@/lib/ebay/draftService';
import { isLegacyEbaySku } from '@/lib/ebay/legacy';
import { IMAGE_CREDITS } from '@/lib/billing/aiCredits';
import { generateProductImage, ImageToolError, IMAGE_ASPECTS } from './images';
import { editorHref, newListingHref } from '@/lib/listingEditor/editorNav';
import { mcpBaseUrl, type McpAuth } from './tokens';
import { ToolError, type McpTool } from './types';

const SCORED = ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'] as const;
const ALL = ['etsy', 'ebay', 'trendyol', 'wix', 'shopify', 'hepsiburada'] as const;
type Mkt = (typeof ALL)[number];

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const mktOf = (v: unknown, list: readonly string[]): Mkt => {
  const m = str(v, 20).toLowerCase();
  if (!list.includes(m)) throw new ToolError(`marketplace must be one of: ${list.join(', ')}`);
  return m as Mkt;
};
const numOrUndef = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

/** Renders a listing-score i18n key (full dotted key + ICU params) on the server. */
function render(locale: 'en' | 'tr', key: string | undefined, params?: Record<string, string | number>): string | null {
  if (!key) return null;
  const tpl = lookupMessage(locale, key);
  if (!tpl) return null;
  try {
    let failed = false;
    const t = createTranslator({ locale, messages: { m: tpl } as any, timeZone: 'Europe/Istanbul', onError: () => { failed = true; } }) as any;
    const out = t('m', params ?? {});
    return failed || typeof out !== 'string' ? null : out;
  } catch {
    return null;
  }
}

/** Public https photo links only (the server downloads them on send); never local paths. */
function photoUrls(v: unknown, max: number): string[] {
  const list = Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const raw of list.slice(0, max)) {
    try {
      out.push(assertAllowedSourceUrl(String(raw)));
    } catch {
      throw new ToolError(`Not a usable photo link (public https only): ${String(raw).slice(0, 80)}`);
    }
  }
  return out;
}

function catalogError(err: unknown): never {
  if (isCatalogDraftError(err)) {
    const hint: Record<string, string> = {
      MULTI_VARIANT: 'This product has variants: price and stock are set per variant in KolayXport.',
      NOT_TRACKED: 'Stock is not tracked for this product.',
      DISCOUNTED: 'This Wix product has a discount: change the price in KolayXport.',
      STOCK_MANAGED: 'Stock sync manages this product\'s stock: change it in Stock sync.',
      ARCHIVED: 'This product is archived on Trendyol.',
      PRODUCT_NOT_FOUND: 'Listing not found (refresh listings in KolayXport).',
    };
    throw new ToolError(hint[err.code] ?? `KolayXport refused the change (${err.code}).`);
  }
  throw err;
}

async function etsyShopFor(userId: string, listingId: string): Promise<string> {
  const l = await prisma.etsyListing.findFirst({ where: { etsyListingId: BigInt(listingId), etsyShop: { userId } }, select: { etsyShopId: true } });
  if (!l) throw new ToolError('Listing not found');
  await assertShopOwnership(userId, l.etsyShopId);
  return l.etsyShopId;
}

const reviewEtsy = (shop: string, id: string) => `${mcpBaseUrl()}${editorHref('etsy', id, shop)}`;
const reviewEbay = (sku: string) => `${mcpBaseUrl()}${editorHref('ebay', sku)}`;
const reviewEdit = (m: Mkt, id: string) => `${mcpBaseUrl()}${editorHref(m, id)}`;
const reviewNew = (m: Mkt, draft: string, store?: string) => `${mcpBaseUrl()}${newListingHref(m, store ?? null, { draft })}`;
const NOTE = 'Staged as a draft: nothing changed on the marketplace. The seller reviews and sends it in KolayXport.';

// ── Audit + SEO ────────────────────────────────────────────────────────────────────────────────

const ROW_SELECT: Record<ListingScoreMarketplace, Record<string, true>> = {
  etsy: { title: true, description: true, tags: true, materials: true, priceAmount: true, priceDivisor: true, imageCount: true, hasVideo: true, shippingProfileId: true, processingMin: true, itemWeight: true },
  ebay: { title: true, description: true, imageCount: true, imageUrls: true, aspects: true, condition: true, conditionDescription: true, categoryId: true, fulfillmentPolicyId: true, paymentPolicyId: true, returnPolicyId: true, weightValue: true, lengthValue: true, widthValue: true, heightValue: true, priceValue: true, isLegacy: true },
  trendyol: { title: true, brandName: true, categoryName: true, description: true, images: true, imageCount: true, attributes: true, listPrice: true, salePrice: true, quantity: true, approved: true, rejected: true, blacklisted: true, dimensionalWeight: true },
  wix: { title: true, description: true, images: true, imageCount: true, collectionIds: true },
  shopify: { title: true, description: true, images: true, imageCount: true, seoTitle: true, seoDescription: true, tags: true },
};

async function cacheRow(userId: string, m: ListingScoreMarketplace, id: string): Promise<any | null> {
  const select = ROW_SELECT[m] as any;
  if (m === 'etsy') {
    if (!/^\d{1,20}$/.test(id)) throw new ToolError('Etsy listing id must be a number');
    return prisma.etsyListing.findFirst({ where: { etsyListingId: BigInt(id), etsyShop: { userId } }, select });
  }
  if (m === 'ebay') return prisma.ebayListing.findFirst({ where: { userId, sku: id }, select });
  if (m === 'trendyol') return prisma.trendyolProduct.findFirst({ where: { userId, barcode: id }, select });
  if (m === 'wix') return prisma.wixProduct.findFirst({ where: { userId, wixProductId: id }, select });
  return prisma.shopifyProduct.findFirst({ where: { userId, shopifyProductId: id }, select });
}

const auditListing: McpTool = {
  name: 'audit_listing',
  title: 'Audit a listing',
  description: 'KolayXport\'s listing health check for one listing (etsy, ebay, trendyol, wix, shopify): score 0–100 and every check (photos, title, tags, description, attributes, shipping, price …) with what to fix, worst first. For Etsy also the title and tag SEO rule check.',
  scope: 'read', readOnly: true,
  inputSchema: { type: 'object', required: ['marketplace', 'id'], properties: { marketplace: { type: 'string', enum: SCORED }, id: { type: 'string' }, language: { type: 'string', enum: ['en', 'tr'], description: 'Language of the check texts (default en)' } }, additionalProperties: false },
  async run(auth, a) {
    const m = mktOf(a.marketplace, SCORED) as ListingScoreMarketplace;
    const id = str(a.id, 120);
    const locale = a.language === 'tr' ? 'tr' : 'en';
    const row = await cacheRow(auth.userId, m, id);
    if (!row) throw new ToolError('Listing not found');
    const result = scoreCacheRow(row, m);
    const checks = sortChecks(result.checks).map((c) => ({
      id: c.id, status: c.status, scoreGainIfFixed: c.gain ?? 0,
      message: render(locale, c.label, c.params) ?? c.id,
      fix: c.fix ? render(locale, c.fix.label) ?? c.fix.label : null,
      ...(c.status === 'na' && c.naReason ? { notChecked: render(locale, c.naReason) ?? c.naReason } : {}),
    }));
    const seo = m === 'etsy' ? { title: checkTitle(row.title), tags: checkTags(row.tags ?? [], row.title ?? '') } : undefined;
    return { marketplace: m, id, score: result.score, band: result.band, checksUsed: result.checksUsed, failing: healthFailTokens(result), checks, ...(seo ? { etsySeo: seo } : {}) };
  },
};

const SEO_RULES: Record<Mkt, Record<string, unknown>> = {
  etsy: {
    title: { min: ETSY_TITLE_MIN, max: ETSY_TITLE_MAX, rules: ['Title Case (small words like for, of, the, and, with stay lowercase)', 'Commas are the only separators: no dashes, pipes, slashes or colons', 'Start with a letter or digit; % : & + at most once each', 'Most important search phrase first', 'No keyword stacking (the same idea repeated in different forms)', 'Keywords from real market research (use research_keywords), never invented'] },
    tags: { count: TAG_MAX_COUNT, maxLength: TAG_MAX_LEN, rules: ['Use all 13', 'Each at most 20 characters', 'Multi-word phrases buyers search for, not single words', 'Do not repeat words already in the title (Etsy indexes the title already)', 'No duplicates', 'Research-driven: phrases from research_keywords buyerWords / competitor tags'] },
    description: { max: 13000, rules: ['First 160 characters work as the search snippet: lead with what it is and who it is for', 'Materials, size, care, personalisation, shipping time'] },
    photos: { max: 20, recommended: 10, rules: ['Use all slots you can; first photo is the thumbnail', 'A product video helps'] },
    language: 'Keywords, title and tags in English (Etsy buyers search in English); only explanations may be in another language.',
  },
  ebay: {
    title: { max: EBAY_TITLE_MAX, recommendedMin: 60, rules: ['Brand + product + key specifics (size, colour, model)', 'No ALL CAPS or symbols', 'Use the item specifics words buyers filter by'] },
    itemSpecifics: 'Fill every required and recommended item specific (aspects), values at most 65 characters.',
    photos: { max: 24, recommendedMin: 8, rules: ['White or plain background for the first photo'] },
  },
  trendyol: { title: { max: CATALOG_TITLE_MAX.trendyol, rules: ['Brand and category words in the title', 'Turkish product naming'] }, description: { max: DESCRIPTION_MAX.trendyol }, photos: { max: 8 } },
  wix: { title: { max: CATALOG_TITLE_MAX.wix, recommendedMin: 40 }, description: { max: DESCRIPTION_MAX.wix }, photos: { maxAddsPerChange: 15 } },
  shopify: { title: { max: 70, rules: ['Clear product name; SEO title and meta description set separately'] }, seoTitle: { max: 70 }, seoDescription: { max: 160 }, tags: 'Used for collections and search' },
  hepsiburada: { note: 'Title, description and photos belong to Hepsiburada\'s catalog and cannot be changed from KolayXport; price and stock can.' },
};

const seoRules: McpTool = {
  name: 'seo_rules',
  title: 'Listing rules per marketplace',
  description: 'The title / tag / description / photo rules KolayXport applies for a marketplace (Etsy: the seller\'s own rules — Title Case, commas only, 100–140 characters, 13 tags of ≤ 20 characters not repeating title words, English keywords from research). Returns rules only; it does not check a text.',
  scope: 'read', readOnly: true,
  inputSchema: { type: 'object', required: ['marketplace'], properties: { marketplace: { type: 'string', enum: ALL } }, additionalProperties: false },
  async run(_auth, a) {
    const m = mktOf(a.marketplace, ALL);
    return { marketplace: m, ...SEO_RULES[m] };
  },
};

const checkListingText: McpTool = {
  name: 'check_listing_text',
  title: 'Check proposed listing text',
  description: 'Checks a proposed title (and Etsy tags) against the marketplace rules: length, separators, Title Case, repeated words, keyword stacking, tag length / count / overlap with the title. Returns the issues found; it changes nothing.',
  scope: 'read', readOnly: true,
  inputSchema: { type: 'object', required: ['marketplace'], properties: { marketplace: { type: 'string', enum: ALL }, title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
  async run(_auth, a) {
    const m = mktOf(a.marketplace, ALL);
    const title = typeof a.title === 'string' ? a.title : '';
    if (m === 'etsy') return { marketplace: m, title: title ? checkTitle(title) : null, tags: Array.isArray(a.tags) ? checkTags(a.tags, title) : null };
    const max = m === 'ebay' ? EBAY_TITLE_MAX : m === 'shopify' ? 70 : CATALOG_TITLE_MAX[m as 'trendyol' | 'wix' | 'hepsiburada'];
    const len = title.trim().length;
    return { marketplace: m, title: { length: len, max, ok: len > 0 && len <= max, issues: len === 0 ? ['empty'] : len > max ? ['too_long'] : [] } };
  },
};

const researchKeywords: McpTool = {
  name: 'research_keywords',
  title: 'Market research',
  description: 'What buyers and competitors use for a search on Etsy or eBay (KolayXport market research): price range, competition, the words buyers use (Etsy), suggested tags (Etsy) and the top listings with titles, prices, favourites and tags. Reads KolayXport\'s market research (live marketplace search results, cached).',
  scope: 'read', readOnly: true, openWorld: true,
  inputSchema: { type: 'object', required: ['marketplace', 'query'], properties: { marketplace: { type: 'string', enum: ['etsy', 'ebay'] }, query: { type: 'string' }, country: { type: 'string', description: 'Two-letter market, default US' } }, additionalProperties: false },
  async run(auth, a) {
    const m = mktOf(a.marketplace, ['etsy', 'ebay']);
    const q = str(a.query, 120);
    if (!q) throw new ToolError('Give a search query');
    if (!userRateLimit(auth.userId, 'mcp-research', 30, 3_600_000)) throw new ToolError('Research limit reached (30 searches an hour). Try again later.');
    const country = /^[A-Za-z]{2}$/.test(str(a.country, 2)) ? str(a.country, 2).toUpperCase() : 'US';
    const fmt = formattersFor('en');
    const { result } = m === 'etsy'
      ? await researchEtsy(q, { country, taxonomyId: null, sort: 'relevance', fmt })
      : await researchEbay(q, { country, sort: 'relevance', fmt });
    return {
      marketplace: m, query: q, country,
      price: result.price, competition: result.competition, demand: result.demand,
      buyerWords: (result.buyerWords ?? []).slice(0, 30), suggestedTags: result.draftTags ?? [], categoryHint: result.categoryHint ?? null,
      top: (result.top ?? []).slice(0, 20).map((x: any) => ({ title: x.title, price: x.price, favorites: x.favorites, ageDays: x.ageDays, tags: x.tags, url: x.url, shop: x.shop?.name ?? null })),
    };
  },
};

// ── Staged changes on every marketplace ────────────────────────────────────────────────────────

const stageListingChanges: McpTool = {
  name: 'stage_listing_changes',
  title: 'Stage listing changes',
  description: 'Prepares changes to an existing listing as a KolayXport draft — title, description, tags (Etsy, Shopify), price, quantity — on etsy, ebay, trendyol, wix, shopify (hepsiburada: price and quantity only). Staged draft only: nothing changes on the marketplace until the seller reviews and sends it in KolayXport (reviewUrl). Calling it again for the same listing updates the same draft.',
  scope: 'write', readOnly: false, idempotent: true,
  inputSchema: {
    type: 'object', required: ['marketplace', 'id'],
    properties: {
      marketplace: { type: 'string', enum: ALL }, id: { type: 'string', description: 'The listing id shown in listing results' },
      title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
      price: { type: 'number', description: 'Major units in the listing currency' }, quantity: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  async run(auth, a) {
    const m = mktOf(a.marketplace, ALL);
    const id = str(a.id, 120);
    const title = typeof a.title === 'string' ? a.title.trim() : undefined;
    const description = typeof a.description === 'string' ? a.description : undefined;
    const tags = Array.isArray(a.tags) ? a.tags.map((x: unknown) => String(x)) : undefined;
    const price = numOrUndef(a.price);
    const quantity = numOrUndef(a.quantity);
    if (price !== undefined && !(price > 0)) throw new ToolError('price must be above 0');
    if (quantity !== undefined && !(Number.isInteger(quantity) && quantity >= 0)) throw new ToolError('quantity must be a whole number ≥ 0');

    if (m === 'etsy') {
      if (!/^\d{1,20}$/.test(id)) throw new ToolError('Etsy listing id must be a number');
      const shop = await etsyShopFor(auth.userId, id);
      const raw: Record<string, unknown> = {};
      if (title !== undefined) raw.title = title;
      if (description !== undefined) raw.description = description;
      if (tags) raw.tags = tags;
      if (price !== undefined) raw.price = price;
      if (quantity !== undefined) raw.quantity = quantity;
      const { fields, rejected } = sanitizeEtsyBatchFields(raw);
      if (!Object.keys(fields).length) throw new ToolError(rejected.length ? `Nothing valid to stage: ${rejected.map((r) => r.field).join(', ')}` : 'Give at least one change');
      const token = await getEtsyAccessToken(shop, auth.userId).catch(() => undefined);
      await stageEtsy({ userId: auth.userId, shopId: shop, listingId: id, fields, ...(token ? { accessToken: token } : {}) });
      return { staged: true, marketplace: m, id, changed: Object.keys(fields), skipped: rejected.map((r) => r.field), reviewUrl: reviewEtsy(shop, id), note: NOTE };
    }

    if (m === 'ebay') {
      const l = await prisma.ebayListing.findFirst({ where: { userId: auth.userId, sku: id }, select: { sku: true, marketplaceId: true, offerId: true, priceCurrency: true } });
      if (!l) throw new ToolError('Listing not found');
      if (tags) throw new ToolError('eBay has no tags: put the words in the title and item specifics');
      const product: Record<string, unknown> = {};
      if (title !== undefined) product.title = title.slice(0, EBAY_TITLE_MAX);
      if (description !== undefined) product.description = description;
      const inventoryFields: Record<string, unknown> = {};
      if (Object.keys(product).length) inventoryFields.product = product;
      if (quantity !== undefined) inventoryFields.availability = { shipToLocationAvailability: { quantity } };
      const offerFields = price !== undefined ? { pricingSummary: { price: { value: price.toFixed(2), currency: l.priceCurrency || 'USD' } } } : undefined;
      if (!Object.keys(inventoryFields).length && !offerFields) throw new ToolError('Give at least one change');
      await stageEbay({ userId: auth.userId, sku: l.sku, marketplaceId: l.marketplaceId, ...(l.offerId ? { offerId: l.offerId } : {}), ...(Object.keys(inventoryFields).length ? { inventoryFields } : {}), ...(offerFields ? { offerFields } : {}) });
      return { staged: true, marketplace: m, id, changed: [...Object.keys(product), ...(quantity !== undefined ? ['quantity'] : []), ...(price !== undefined ? ['price'] : [])], reviewUrl: reviewEbay(id), note: NOTE };
    }

    // Trendyol / Wix / Shopify / Hepsiburada: catalog drafts.
    const fields: Record<string, unknown> = {};
    if (m === 'hepsiburada' && (title !== undefined || description !== undefined || tags)) throw new ToolError('Hepsiburada titles, descriptions and photos belong to its catalog: only price and quantity can change');
    if (title !== undefined) fields.title = title.slice(0, CATALOG_TITLE_MAX[m]);
    if (description !== undefined) fields.description = description.slice(0, DESCRIPTION_MAX[m]);
    if (tags) {
      if (m !== 'shopify') throw new ToolError(`${m} has no tags`);
      fields.tags = tags;
    }
    if (price !== undefined) fields.price = price;
    if (quantity !== undefined) fields.quantity = quantity;
    if (!Object.keys(fields).length) throw new ToolError('Give at least one change');
    try {
      await stageCatalogDraft({ userId: auth.userId, marketplace: m, externalId: id, fields });
    } catch (err) {
      catalogError(err);
    }
    return { staged: true, marketplace: m, id, changed: Object.keys(fields), reviewUrl: reviewEdit(m, id), note: NOTE };
  },
};

// ── New listings ───────────────────────────────────────────────────────────────────────────────

const createListingDraft: McpTool = {
  name: 'create_listing_draft',
  title: 'Create a new listing draft',
  description: 'Starts a NEW listing as a KolayXport draft on etsy, ebay, trendyol, wix or shopify with title, description, price, quantity, tags (Etsy, Shopify) and photos (public https links). Staged draft only: nothing is created on the marketplace; the seller completes the remaining fields (category, shipping, policies …) in the editor at reviewUrl and sends it.',
  scope: 'write', readOnly: false,
  inputSchema: {
    type: 'object', required: ['marketplace', 'title'],
    properties: {
      marketplace: { type: 'string', enum: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'] },
      title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
      price: { type: 'number' }, quantity: { type: 'integer', minimum: 0 }, currency: { type: 'string', description: 'eBay only, default USD' },
      photoUrls: { type: 'array', items: { type: 'string' }, description: 'Public https image links, first = main photo' },
      etsyShopId: { type: 'string', description: 'Etsy only, when the seller has several shops' },
    },
    additionalProperties: false,
  },
  async run(auth, a) {
    const m = mktOf(a.marketplace, ['etsy', 'ebay', 'trendyol', 'wix', 'shopify']);
    const title = str(a.title, 255);
    if (!title) throw new ToolError('Give a title');
    const description = typeof a.description === 'string' ? a.description : '';
    const tags = Array.isArray(a.tags) ? a.tags.map((x: unknown) => String(x)) : undefined;
    const price = numOrUndef(a.price);
    const quantity = numOrUndef(a.quantity);

    if (m === 'etsy') {
      const shops = await prisma.etsyShop.findMany({ where: { userId: auth.userId, isActive: true }, select: { shopId: true, isDefault: true } });
      const shop = str(a.etsyShopId, 30) ? shops.find((s) => s.shopId === str(a.etsyShopId, 30)) : shops.find((s) => s.isDefault) ?? shops[0];
      if (!shop) throw new ToolError('No connected Etsy shop');
      const raw: Record<string, unknown> = { title, ...(description ? { description } : {}), ...(tags ? { tags } : {}), ...(price !== undefined ? { price } : {}), ...(quantity !== undefined ? { quantity } : {}) };
      const { fields, rejected } = sanitizeEtsyBatchFields(raw, { replaceFields: true });
      const media = photoUrls(a.photoUrls, 20).map((sourceUrl, i) => ({ kind: 'image', operation: 'upload', sourceUrl, rank: i + 1 }));
      const localId = String(-Date.now());
      const draft: any = await stageEtsy({ userId: auth.userId, shopId: shop.shopId, listingId: localId, fields, replaceFields: true, queuedActions: [{ type: 'create_listing', payload: {} }], ...(media.length ? { media } : {}) });
      return {
        created: 'draft', marketplace: m, draftId: String(draft?.id ?? ''), photos: media.length, skipped: rejected.map((r) => r.field),
        reviewUrl: reviewNew('etsy', String(draft?.id ?? ''), shop.shopId),
        stillNeeded: ['category (taxonomy)', 'who made / when made / is supply', 'shipping profile'].concat(price === undefined ? ['price'] : [], quantity === undefined ? ['quantity'] : []),
        note: 'Nothing created on Etsy yet: the seller completes and sends it in KolayXport (it goes to Etsy as a draft listing).',
      };
    }

    if (m === 'ebay') {
      const sku = `KX-${Date.now().toString(36).toUpperCase()}`;
      const photos = photoUrls(a.photoUrls, 24);
      const product: Record<string, unknown> = { title: title.slice(0, EBAY_TITLE_MAX), ...(description ? { description } : {}), ...(photos.length ? { imageUrls: photos } : {}) };
      const inventoryFields: Record<string, unknown> = { product, condition: 'NEW', ...(quantity !== undefined ? { availability: { shipToLocationAvailability: { quantity } } } : {}) };
      const currency = /^[A-Za-z]{3}$/.test(str(a.currency, 3)) ? str(a.currency, 3).toUpperCase() : 'USD';
      const offerFields: Record<string, unknown> = { ...(price !== undefined ? { pricingSummary: { price: { value: price.toFixed(2), currency } } } : {}), ...(description ? { listingDescription: description } : {}) };
      const draft: any = await stageEbay({ userId: auth.userId, sku, inventoryFields, offerFields, queuedActions: [{ type: 'create' }] });
      return {
        created: 'draft', marketplace: m, sku, photos: photos.length, reviewUrl: reviewNew('ebay', String(draft?.id ?? sku)),
        stillNeeded: ['category', 'item specifics', 'shipping / return / payment policies'].concat(price === undefined ? ['price'] : [], photos.length ? [] : ['photos']),
        note: 'Nothing created on eBay yet: the seller completes and sends it in KolayXport.',
      };
    }

    const fields: Record<string, unknown> = { title: title.slice(0, CATALOG_TITLE_MAX[m]), ...(description ? { description: description.slice(0, DESCRIPTION_MAX[m]) } : {}), ...(price !== undefined ? { price } : {}), ...(quantity !== undefined ? { quantity } : {}) };
    const photos = photoUrls(a.photoUrls, m === 'trendyol' ? 8 : 15);
    if (photos.length) {
      if (m === 'trendyol') fields.images = photos;
      else if (m === 'wix') fields.media = photos.map((url) => ({ op: 'add', url }));
      else fields.images = photos.map((src, i) => ({ op: 'add', src, position: i + 1 }));
    }
    if (tags && m === 'shopify') fields.tags = tags;
    try {
      const rec: any = await stageCatalogDraft({ userId: auth.userId, marketplace: m, externalId: 'new', fields, queuedActions: [{ type: 'create' }] });
      return { created: 'draft', marketplace: m, draftId: String(rec?.id ?? ''), externalId: rec?.externalId ?? null, photos: photos.length, reviewUrl: reviewNew(m, String(rec?.id ?? ''), rec?.storeId ?? undefined), note: `Nothing created on ${m} yet: the seller completes and sends it in KolayXport.` };
    } catch (err) {
      catalogError(err);
    }
  },
};

// ── Photos ─────────────────────────────────────────────────────────────────────────────────────

const addListingPhotos: McpTool = {
  name: 'add_listing_photos',
  title: 'Add photos to a listing',
  description: 'Stages photos (public https links) onto an existing listing on etsy, ebay, trendyol, wix or shopify as a draft. Staged draft only: the photos are added on the marketplace only when the seller reviews and sends the draft in KolayXport.',
  scope: 'write', readOnly: false,
  inputSchema: { type: 'object', required: ['marketplace', 'id', 'photoUrls'], properties: { marketplace: { type: 'string', enum: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'] }, id: { type: 'string' }, photoUrls: { type: 'array', items: { type: 'string' }, minItems: 1 } }, additionalProperties: false },
  async run(auth, a) {
    const m = mktOf(a.marketplace, ['etsy', 'ebay', 'trendyol', 'wix', 'shopify']);
    const id = str(a.id, 120);
    if (m === 'etsy') {
      if (!/^\d{1,20}$/.test(id)) throw new ToolError('Etsy listing id must be a number');
      const shop = await etsyShopFor(auth.userId, id);
      const media = photoUrls(a.photoUrls, 20).map((sourceUrl) => ({ kind: 'image', operation: 'upload', sourceUrl }));
      const token = await getEtsyAccessToken(shop, auth.userId).catch(() => undefined);
      await stageEtsy({ userId: auth.userId, shopId: shop, listingId: id, media, ...(token ? { accessToken: token } : {}) });
      return { staged: true, marketplace: m, id, photos: media.length, reviewUrl: reviewEtsy(shop, id), note: NOTE };
    }
    if (m === 'ebay') {
      const l = await prisma.ebayListing.findFirst({ where: { userId: auth.userId, sku: id }, select: { sku: true, marketplaceId: true, offerId: true } });
      if (!l) throw new ToolError('Listing not found');
      if (isLegacyEbaySku(l.sku)) throw new ToolError('Photos of listings created on eBay itself are changed on eBay (KolayXport can change their title, description, price and stock).');
      // Built here (the eBay stage path keeps media as given): URL only, never a local path.
      const media = photoUrls(a.photoUrls, 24).map((imageUrl) => ({ kind: 'image', operation: 'add_url', imageUrl }));
      await stageEbay({ userId: auth.userId, sku: l.sku, marketplaceId: l.marketplaceId, ...(l.offerId ? { offerId: l.offerId } : {}), media });
      return { staged: true, marketplace: m, id, photos: media.length, reviewUrl: reviewEbay(id), note: NOTE };
    }
    const urls = photoUrls(a.photoUrls, 15);
    const fields: Record<string, unknown> = {};
    if (m === 'trendyol') {
      const row = await prisma.trendyolProduct.findFirst({ where: { userId: auth.userId, barcode: id }, select: { images: true } });
      if (!row) throw new ToolError('Listing not found');
      const current = (Array.isArray(row.images) ? row.images : []).map((x: any) => (typeof x === 'string' ? x : x?.url)).filter(Boolean) as string[];
      const next = Array.from(new Set([...current, ...urls])).slice(0, 8);
      if (next.length === current.length) throw new ToolError('Trendyol allows 8 photos and this product already has 8.');
      fields.images = next;
    } else if (m === 'wix') fields.media = urls.map((url) => ({ op: 'add', url }));
    else fields.images = urls.map((src) => ({ op: 'add', src }));
    try {
      await stageCatalogDraft({ userId: auth.userId, marketplace: m, externalId: id, fields });
    } catch (err) {
      catalogError(err);
    }
    return { staged: true, marketplace: m, id, photos: urls.length, reviewUrl: reviewEdit(m, id), note: NOTE };
  },
};

const generateImage: McpTool = {
  name: 'generate_product_image',
  title: 'Generate a product photo',
  description: `Makes a listing photo with AI (Nano Banana Pro) from the seller\'s reference photos and an instruction (e.g. "on a white background", "in a cosy nursery", "worn by a model"); the product stays exactly as in the references. Returns a public link to the image (it is not added to any listing). Cost: ${IMAGE_CREDITS} of the seller\'s KolayXport AI credits per image (refunded if generation fails); fails with a message when credits are insufficient.`,
  scope: 'write', readOnly: false, openWorld: true,
  inputSchema: {
    type: 'object', required: ['prompt'],
    properties: {
      prompt: { type: 'string' }, referencePhotoUrls: { type: 'array', items: { type: 'string' }, description: 'Up to 10 https photos of the product (e.g. the photo links of the listing)' },
      aspectRatio: { type: 'string', enum: IMAGE_ASPECTS }, whiteBackground: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  async run(auth, a) {
    const prompt = str(a.prompt, 2000);
    if (!prompt) throw new ToolError('Give a prompt');
    const refs = Array.isArray(a.referencePhotoUrls) ? photoUrls(a.referencePhotoUrls, 10) : [];
    try {
      const r = await generateProductImage({ userId: auth.userId, prompt, referenceUrls: refs, aspectRatio: str(a.aspectRatio, 5) || undefined, whiteBackground: a.whiteBackground === true });
      return { url: r.url, aspectRatio: r.aspectRatio, creditsUsed: r.creditsUsed, note: 'Show it to the seller; add it with add_listing_photos or create_listing_draft if they like it.' };
    } catch (err) {
      if (err instanceof ImageToolError) throw new ToolError(err.message);
      throw err;
    }
  },
};

export const LISTING_TOOLS: McpTool[] = [auditListing, seoRules, checkListingText, researchKeywords, stageListingChanges, createListingDraft, addListingPhotos, generateImage];

/** For tests: which tools write. */
export function writesOf(tools: McpTool[]): string[] {
  return tools.filter((t) => !t.readOnly).map((t) => t.name);
}

export type { McpAuth };
