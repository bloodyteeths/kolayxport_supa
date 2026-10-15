// components/domain/listing-editor/sections/ShopifyOrgSection.tsx — M6b-D: Shopify "Tags & organization"
// (marketplace-editors §3 row 3, §4.3): `TagInput` (no count cap, ≤ 255 characters each, comma splits; replaces the
// legacy comma-string field, §0 #9), vendor and product type (creatable `Combobox`). Also the Shopify "Details"
// section (row 6): Status (Active / Draft / Archived; Draft by default on create) and Collections (read-only v1).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Combobox, FormField, Select, TagInput, type ComboboxOption } from '@/components/ds/inputs';
import { neutral } from '@/lib/ds/tokens';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { ListingSectionProps } from '@/lib/listingEditor/types';
import { LIMITS } from '@/lib/catalogDrafts/schemas';
import { rawRecord, toStr, toStrList, useCatalogSection } from './marketplaceSectionShared';

/** Shopify tag rules: trimmed, no commas, ≤ 255 characters; duplicates compare case-insensitively. Pure. */
export function normalizeShopifyTag(raw: string): string {
  return raw.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.shopifyText);
}

/** Distinct, sorted non-empty strings + the current value (creatable option lists). Pure. */
export function optionList(values: Array<string | null | undefined>, current: string): ComboboxOption[] {
  const set = new Map<string, string>();
  for (const v of [...values, current]) {
    const s = (v ?? '').trim();
    if (s && !set.has(s.toLocaleLowerCase('en'))) set.set(s.toLocaleLowerCase('en'), s);
  }
  return Array.from(set.values())
    .sort((a, b) => a.localeCompare(b))
    .map((s) => ({ value: s, label: s }));
}

export interface ShopifyOrgSectionProps extends Partial<ListingSectionProps> {
  /** Vendors already used in this shop (from the listings cache). Default: none (creatable). */
  vendors?: string[];
  /** Product types already used in this shop. */
  productTypes?: string[];
}

export function ShopifyOrgSection({ id = 'tags', vendors = [], productTypes = [] }: ShopifyOrgSectionProps) {
  const t = useTranslations('listingEditor');
  const { f, ro, errorFor, dirty, set, revert } = useCatalogSection();
  const tags = toStrList(f.tags);
  const vendor = toStr(f.vendor);
  const productType = toStr(f.productType);
  const vendorOptions = React.useMemo(() => optionList(vendors, vendor), [vendors, vendor]);
  const typeOptions = React.useMemo(() => optionList(productTypes, productType), [productTypes, productType]);
  const pick = (o: ComboboxOption | null) => (o ? (o.created ? o.label : o.value).trim().slice(0, LIMITS.shopifyText) : '');

  return (
    <Section id={sectionAnchorId(id)} title={t('section.tagsOrg')} variant="plain" data-testid="le-section-tags">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <FormField label={t('field.tags')} htmlFor={fieldAnchorId('tags')} helper={t('shopify.tagsHelper')} error={errorFor('tags')} dirty={dirty('tags')} onRevert={() => revert('tags')} optional>
          <TagInput
            id={fieldAnchorId('tags')}
            value={tags}
            onChange={(next) => set('tags', next)}
            maxLength={LIMITS.shopifyText}
            separators={[',']}
            normalize={normalizeShopifyTag}
            tagKey={(tag) => tag.toLocaleLowerCase('en')}
            placeholder={t('shopify.tagsPlaceholder')}
            disabled={ro}
          />
        </FormField>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '12px' }}>
          <FormField label={t('shopify.vendor')} htmlFor={fieldAnchorId('vendor')} error={errorFor('vendor')} dirty={dirty('vendor')} onRevert={() => revert('vendor')} optional>
            <Combobox
              id={fieldAnchorId('vendor')}
              value={vendor ? { value: vendor, label: vendor } : null}
              options={vendorOptions}
              creatable
              onChange={(o) => set('vendor', pick(o))}
              disabled={ro}
            />
          </FormField>
          <FormField label={t('shopify.productType')} htmlFor={fieldAnchorId('productType')} error={errorFor('productType')} dirty={dirty('productType')} onRevert={() => revert('productType')} optional>
            <Combobox
              id={fieldAnchorId('productType')}
              value={productType ? { value: productType, label: productType } : null}
              options={typeOptions}
              creatable
              onChange={(o) => set('productType', pick(o))}
              disabled={ro}
            />
          </FormField>
        </Box>
      </Box>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Details: status + collections (read-only v1)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ShopifyStatus = 'active' | 'draft' | 'archived';

/** Collection names the adapter attached to the product (`raw.collections`: strings or `{ title }`). Pure. */
export function shopifyCollectionNames(raw: Record<string, unknown>): string[] {
  const list = Array.isArray(raw.collections) ? raw.collections : [];
  return list
    .map((c) => (typeof c === 'string' ? c : toStr(rawRecord(c).title) || toStr(rawRecord(c).name)))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ShopifyDetailsSection({ id = 'details' }: Partial<ListingSectionProps>) {
  const t = useTranslations('listingEditor');
  const { f, raw, ro, mode, errorFor, dirty, set, revert } = useCatalogSection();
  const status = (toStr(f.status) || (mode === 'create' ? 'draft' : 'active')) as ShopifyStatus;
  const collections = shopifyCollectionNames(raw);
  const options: Array<{ value: ShopifyStatus; label: string; description?: string }> = [
    { value: 'active', label: t('shopify.status.active'), description: t('shopify.statusActiveHelp') },
    { value: 'draft', label: t('shopify.status.draft'), description: t('shopify.statusDraftHelp') },
    { value: 'archived', label: t('shopify.status.archived') },
  ];
  return (
    <Section id={sectionAnchorId(id)} title={t('section.details')} variant="plain" data-testid="le-section-details">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <FormField label={t('shopify.statusLabel')} htmlFor={fieldAnchorId('status')} error={errorFor('status')} dirty={dirty('status')} onRevert={() => revert('status')} width="short">
          <Select<ShopifyStatus>
            id={fieldAnchorId('status')}
            value={status}
            options={mode === 'create' ? options.filter((o) => o.value !== 'archived') : options}
            onChange={(v) => set('status', v)}
            disabled={ro}
          />
        </FormField>
        {mode === 'edit' && collections.length ? (
          <FormField label={t('shopify.collections')} helper={t('shopify.collectionsReadOnly')}>
            <Box sx={{ color: neutral[800], fontSize: 14 }}>{collections.join(' · ')}</Box>
          </FormField>
        ) : null}
      </Box>
    </Section>
  );
}
