// lib/listingEditor/sections.ts — the one section config (listing-editor §2.1; M6b-C extends the marketplace
// rows, marketplace-editors §3). A section that does not apply to a marketplace is not rendered.
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
  /** Heavy section shown as a one-line summary in edit mode until expanded (§2.1). */
  summaryInEdit?: boolean;
}

export const SECTION_DEFS: readonly SectionDef[] = [
  { id: 'photos', titleKey: 'listingEditor.section.photos', marketplaces: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'], required: true },
  { id: 'title', titleKey: 'listingEditor.section.title', marketplaces: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'], required: true },
  { id: 'tags', titleKey: 'listingEditor.section.tags', marketplaces: ['etsy', 'shopify'] },
  { id: 'specifics', titleKey: 'listingEditor.section.specifics', marketplaces: ['ebay'], required: true },
  { id: 'attributes', titleKey: 'listingEditor.section.attributes', marketplaces: ['trendyol'], required: true },
  { id: 'price', titleKey: 'listingEditor.section.price', marketplaces: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'], required: true },
  { id: 'variations', titleKey: 'listingEditor.section.variations', marketplaces: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'], summaryInEdit: true },
  { id: 'details', titleKey: 'listingEditor.section.details', marketplaces: ['etsy', 'ebay', 'trendyol', 'wix', 'shopify'], required: true },
  { id: 'personalization', titleKey: 'listingEditor.section.personalization', marketplaces: ['etsy', 'wix'], summaryInEdit: true },
  { id: 'shipping', titleKey: 'listingEditor.section.shipping', marketplaces: ['etsy', 'ebay', 'trendyol', 'shopify'], required: true },
  { id: 'seo', titleKey: 'listingEditor.section.seo', marketplaces: ['shopify'] },
];

/** Sections rendered for a marketplace and mode, in page order. */
export function sectionsFor(marketplace: EditorMarketplace, mode: EditorMode): SectionDef[] {
  return SECTION_DEFS.filter((s) => s.marketplaces.includes(marketplace) && (!s.createOnly || mode === 'create'));
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

export function sectionForField(field: string): SectionId | null {
  return FIELD_SECTION[field] ?? null;
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
  const section = sectionForField(key);
  if (!section || !rendered.includes(section)) return null;
  return { section, field: key };
}
