// lib/listingEditor/sections.ts — the one section config (listing-editor §2.1; M6b-C extends the marketplace
// rows, marketplace-editors §3: per-marketplace titles, the Trendyol create order, the catalog form keys).
// A section that does not apply to a marketplace is not rendered.
// Also maps every staged field key to its section (nav dots, score fixes, validation focus) and its
// change group ("Not sent yet").
import type { ChangeGroupKey, EditorMarketplace, EditorMode, SectionId } from './types';

export interface SectionDef {
  id: SectionId;
  /** Full i18n key of the section title (`listingEditor.section.*`). */
  titleKey: string;
  marketplaces: EditorMarketplace[];
  /** Holds required fields: never starts collapsed (§2.1 rule). */
  required?: boolean;
  /** Only rendered while creating. */
  createOnly?: boolean;
  /**
   * Marketplaces where the section only exists in edit mode (Trendyol / Wix / Shopify "Variants": a new product has
   * no variants to show, so no nav chip may point at it while creating).
   */
  editOnlyFor?: EditorMarketplace[];
  /** Heavy section shown as a one-line summary in edit mode until expanded (§2.1). */
  summaryInEdit?: boolean;
  /**
   * Per-marketplace title (marketplace-editors §3, §9): e.g. Trendyol "Price & stock", Shopify "Tags & organization".
   * `sectionsFor` resolves it into `titleKey`, so the frame always reads `titleKey`.
   */
  titleKeyBy?: Partial<Record<EditorMarketplace, string>>;
  /** Create-mode title per marketplace (Trendyol "Category & brand"). Wins over `titleKeyBy` while creating. */
  createTitleKeyBy?: Partial<Record<EditorMarketplace, string>>;
}

/** The three catalog marketplaces (M6b): photos without video, "Variants" wording. */
const PHOTOS_ONLY = 'listingEditor.section.photosEbay';
const VARIANTS = 'listingEditor.section.variants';

export const SECTION_DEFS: readonly SectionDef[] = [
  {
    id: 'photos',
    titleKey: 'listingEditor.section.photos',
    marketplaces: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'],
    required: true,
    titleKeyBy: { trendyol: PHOTOS_ONLY, wix: PHOTOS_ONLY, shopify: PHOTOS_ONLY },
  },
  { id: 'title', titleKey: 'listingEditor.section.title', marketplaces: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'], required: true },
  {
    id: 'tags',
    titleKey: 'listingEditor.section.tags',
    marketplaces: ['etsy', 'shopify'],
    titleKeyBy: { shopify: 'listingEditor.section.tagsOrg' },
  },
  { id: 'specifics', titleKey: 'listingEditor.section.specifics', marketplaces: ['ebay'], required: true },
  { id: 'attributes', titleKey: 'listingEditor.section.attributes', marketplaces: ['trendyol'], required: true },
  {
    id: 'price',
    titleKey: 'listingEditor.section.price',
    marketplaces: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'],
    required: true,
    titleKeyBy: { trendyol: 'listingEditor.section.priceStock' },
  },
  {
    id: 'variations',
    titleKey: 'listingEditor.section.variations',
    marketplaces: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'],
    summaryInEdit: true,
    titleKeyBy: { trendyol: VARIANTS, wix: VARIANTS, shopify: VARIANTS },
    editOnlyFor: ['trendyol', 'wix', 'shopify'],
  },
  {
    id: 'details',
    titleKey: 'listingEditor.section.details',
    marketplaces: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'],
    required: true,
    createTitleKeyBy: { trendyol: 'listingEditor.section.categoryBrand' },
  },
  { id: 'personalization', titleKey: 'listingEditor.section.personalization', marketplaces: ['etsy', 'wix'], summaryInEdit: true },
  // Wix keeps its weight in Price & inventory (marketplace-editors §3 row 8): no shipping section.
  { id: 'shipping', titleKey: 'listingEditor.section.shipping', marketplaces: ['etsy', 'ebay', 'trendyol', 'shopify'], required: true },
  { id: 'seo', titleKey: 'listingEditor.section.seo', marketplaces: ['shopify'] },
];

/**
 * Create-mode page order where it differs from `SECTION_DEFS` (marketplace-editors §5). Trendyol: category first
 * (it decides the attributes), then photos, title, attributes, price & stock, shipping.
 */
const CREATE_ORDER: Partial<Record<EditorMarketplace, readonly SectionId[]>> = {
  trendyol: ['details', 'photos', 'title', 'attributes', 'price', 'shipping'],
};

/** Sections rendered for a marketplace and mode, in page order. */
export function sectionsFor(marketplace: EditorMarketplace, mode: EditorMode): SectionDef[] {
  const defs = SECTION_DEFS.filter(
    (s) =>
      s.marketplaces.includes(marketplace) &&
      (!s.createOnly || mode === 'create') &&
      !(mode === 'create' && s.editOnlyFor?.includes(marketplace)),
  ).map(
    (s) => {
      const key = (mode === 'create' ? s.createTitleKeyBy?.[marketplace] : undefined) ?? s.titleKeyBy?.[marketplace];
      return key ? { ...s, titleKey: key } : s;
    },
  );
  const order = mode === 'create' ? CREATE_ORDER[marketplace] : undefined;
  if (!order) return defs;
  const rank = (id: SectionId) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  // Stable: sections the order does not name keep their relative SECTION_DEFS order at the end.
  return defs
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.id) - rank(b.s.id) || a.i - b.i)
    .map((x) => x.s);
}

/** DOM id of a section anchor (SectionNav scroll target). */
export function sectionAnchorId(id: SectionId): string {
  return `le-section-${id}`;
}

/** DOM id a field input should carry so a score fix / validation error can focus it. */
export function fieldAnchorId(field: string): string {
  return `le-field-${field.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/** Field key → section (Etsy fieldPatch keys + eBay/M6b keys the adapters use). */
export const FIELD_SECTION: Readonly<Record<string, SectionId>> = {
  images: 'photos',
  video: 'photos',
  title: 'title',
  subtitle: 'title',
  description: 'title',
  tags: 'tags',
  materials: 'tags',
  price: 'price',
  quantity: 'price',
  sku: 'price',
  currency: 'price',
  taxonomy_id: 'details',
  category: 'details',
  categoryId: 'details',
  properties: 'details',
  who_made: 'details',
  when_made: 'details',
  is_supply: 'details',
  shop_section_id: 'details',
  condition: 'details',
  conditionDescription: 'details',
  storeCategoryNames: 'details',
  aspects: 'specifics',
  shipping_profile_id: 'shipping',
  return_policy_id: 'shipping',
  processing_min: 'shipping',
  processing_max: 'shipping',
  readiness_state_id: 'shipping',
  item_weight: 'shipping',
  item_weight_unit: 'shipping',
  item_length: 'shipping',
  item_width: 'shipping',
  item_height: 'shipping',
  item_dimensions_unit: 'shipping',
  listingPolicies: 'shipping',
  packageWeightAndSize: 'shipping',
  inventory: 'variations',
  variations: 'variations',
  personalization: 'personalization',
  // M6b catalog form keys (Trendyol / Wix / Shopify adapters; marketplace-editors §6). Shared keys above
  // (title, description, price, quantity, sku, categoryId, images) keep their section.
  listPrice: 'price',
  vatRate: 'price',
  stockCode: 'price',
  discountType: 'price',
  discountValue: 'price',
  compareAtPrice: 'price',
  trackInventory: 'price',
  inStock: 'price',
  weight: 'shipping',
  weightUnit: 'shipping',
  dimensionalWeight: 'shipping',
  cargoCompanyId: 'shipping',
  shipmentAddressId: 'shipping',
  returningAddressId: 'shipping',
  attributes: 'attributes',
  brandId: 'details',
  barcode: 'details',
  productMainId: 'details',
  collectionIds: 'details',
  ribbon: 'details',
  visible: 'details',
  status: 'details',
  vendor: 'tags',
  productType: 'tags',
  seoTitle: 'seo',
  seoDescription: 'seo',
  customTextFields: 'personalization',
  variants: 'variations',
};

/**
 * Per-marketplace field → section where it differs from `FIELD_SECTION` (marketplace-editors §3): Wix keeps weight
 * in Price & inventory (it has no shipping section); Shopify SEO is its own section.
 */
export const FIELD_SECTION_BY: Readonly<Partial<Record<EditorMarketplace, Readonly<Record<string, SectionId>>>>> = {
  wix: { weight: 'price', weightUnit: 'price', discount: 'price', media: 'photos' },
  shopify: { seo: 'seo' },
};

/** Field key → change group (one "Not sent yet" line per group, listing-editor §5.2 count rule). */
export const FIELD_GROUP: Readonly<Record<string, ChangeGroupKey>> = {
  title: 'title',
  subtitle: 'title',
  description: 'description',
  tags: 'tags',
  materials: 'materials',
  price: 'price',
  currency: 'price',
  quantity: 'quantity',
  sku: 'sku',
  taxonomy_id: 'category',
  category: 'category',
  categoryId: 'category',
  properties: 'categoryDetails',
  who_made: 'itemDetails',
  when_made: 'itemDetails',
  is_supply: 'itemDetails',
  shop_section_id: 'shopSection',
  storeCategoryNames: 'shopSection',
  condition: 'condition',
  conditionDescription: 'condition',
  aspects: 'itemSpecifics',
  shipping_profile_id: 'shippingProfile',
  return_policy_id: 'returnPolicy',
  processing_min: 'processing',
  processing_max: 'processing',
  readiness_state_id: 'processing',
  item_weight: 'weightSize',
  item_weight_unit: 'weightSize',
  item_length: 'weightSize',
  item_width: 'weightSize',
  item_height: 'weightSize',
  item_dimensions_unit: 'weightSize',
  packageWeightAndSize: 'weightSize',
  listingPolicies: 'policies',
  // Photos as a URL-list field (eBay pictures, Trendyol / Wix / Shopify photos).
  images: 'photos',
  // M6b catalog form keys. Groups reuse the existing `listingEditor.changes.group.*` lines (no new ChangeGroupKey
  // here: lib/listingEditor/types.ts is the frame's file); the closest line is used.
  listPrice: 'price',
  vatRate: 'price',
  discountType: 'price',
  discountValue: 'price',
  compareAtPrice: 'price',
  stockCode: 'sku',
  trackInventory: 'quantity',
  inStock: 'quantity',
  weight: 'weightSize',
  weightUnit: 'weightSize',
  dimensionalWeight: 'weightSize',
  cargoCompanyId: 'shippingProfile',
  shipmentAddressId: 'shippingProfile',
  returningAddressId: 'shippingProfile',
  attributes: 'categoryDetails',
  brandId: 'itemDetails',
  barcode: 'itemDetails',
  productMainId: 'itemDetails',
  collectionIds: 'itemDetails',
  ribbon: 'itemDetails',
  visible: 'itemDetails',
  status: 'itemDetails',
  vendor: 'itemDetails',
  productType: 'itemDetails',
  seoTitle: 'itemDetails',
  seoDescription: 'itemDetails',
  customTextFields: 'personalization',
  variants: 'variations',
};

/** Change group → section (for groups that come from the draft row, not a field). */
export const GROUP_SECTION: Readonly<Record<ChangeGroupKey, SectionId>> = {
  title: 'title',
  description: 'title',
  tags: 'tags',
  materials: 'tags',
  price: 'price',
  quantity: 'price',
  sku: 'price',
  photos: 'photos',
  photoOrder: 'photos',
  altText: 'photos',
  video: 'photos',
  variations: 'variations',
  category: 'details',
  categoryDetails: 'details',
  itemDetails: 'details',
  shopSection: 'details',
  condition: 'details',
  personalization: 'personalization',
  shippingProfile: 'shipping',
  processing: 'shipping',
  returnPolicy: 'shipping',
  weightSize: 'shipping',
  policies: 'shipping',
  itemSpecifics: 'specifics',
};

/** Page order of the change groups (the change list and the count read in this order). */
export const GROUP_ORDER: readonly ChangeGroupKey[] = [
  'photos',
  'photoOrder',
  'altText',
  'video',
  'title',
  'description',
  'tags',
  'materials',
  'itemSpecifics',
  'price',
  'quantity',
  'sku',
  'variations',
  'category',
  'categoryDetails',
  'itemDetails',
  'condition',
  'shopSection',
  'personalization',
  'shippingProfile',
  'processing',
  'returnPolicy',
  'weightSize',
  'policies',
];

/** Field key → section; with a marketplace, its own mapping wins (`FIELD_SECTION_BY`). */
export function sectionForField(field: string, marketplace?: EditorMarketplace): SectionId | null {
  return (marketplace ? FIELD_SECTION_BY[marketplace]?.[field] : undefined) ?? FIELD_SECTION[field] ?? null;
}

export function groupForField(field: string): ChangeGroupKey | null {
  return FIELD_GROUP[field] ?? null;
}

/**
 * `location.hash` deep link → scroll target. Accepts a section id (`#photos`) or a staged field key (`#price`,
 * `#description`); anything else, or a section this marketplace/mode does not render, is ignored.
 */
export function resolveEditorHash(
  hash: string,
  marketplace: EditorMarketplace,
  mode: EditorMode,
): { section: SectionId; field?: string } | null {
  let key = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    key = decodeURIComponent(key);
  } catch {
    return null;
  }
  if (!key || key.length > 64) return null;
  const rendered = sectionsFor(marketplace, mode).map((s) => s.id);
  if ((rendered as string[]).includes(key)) return { section: key as SectionId };
  const section = sectionForField(key, marketplace);
  if (!section || !rendered.includes(section)) return null;
  return { section, field: key };
}
