// components/domain/listing-editor/sections/ShopifyVariantsSection.tsx — M6b-D: Shopify "Price & inventory"
// (single variant), "Variants" (variant table: price · compare-at · quantity · SKU) and "Shipping" (single-variant
// weight + unit) — marketplace-editors §3 rows 4, 5, 8, §4.3. Quantity is read-only for multi-location shops and
// untracked variants (the reason is in the cell tooltip / caption). The table stages `variants` edits with
// `expectedQuantity` (the quantity shown), so the executor keeps the per-variant optimistic check and the
// per-variant partial-failure handling of `action=updateVariants`. Only `setField` here.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { DataTable, type Column } from '@/components/ds/data';
import { Button, FormField, MoneyField, NumberField, Select } from '@/components/ds/inputs';
import { icons } from '@/lib/ds/icons';
import { neutral, tone } from '@/lib/ds/tokens';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { ListingSectionProps } from '@/lib/listingEditor/types';
import { LIMITS, SHOPIFY_WEIGHT_UNITS, type ShopifyVariantEdit } from '@/lib/catalogDrafts/schemas';
import {
  MobileEditSheet, NormalizedTextField, decodeVariantEdits, encodeVariantEdits, money2, numOrBlank, rawRecord, toNum, toStr,
  useCatalogSection,
} from './marketplaceSectionShared';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ShopifyVariantRow {
  id: string;
  /** "Pink / S" (option values) or the variant title. */
  label: string;
  price: number | null;
  compareAtPrice: number | null;
  quantity: number | null;
  sku: string;
  /** Shopify tracks stock for it (`inventory_management === 'shopify'`). */
  tracked: boolean;
}

/** Cache / REST `variants[]` → rows. Pure. */
export function parseShopifyVariants(list: unknown): ShopifyVariantRow[] {
  if (!Array.isArray(list)) return [];
  const out: ShopifyVariantRow[] = [];
  for (const v of list) {
    const r = rawRecord(v);
    const id = r.id !== undefined && r.id !== null ? String(r.id) : '';
    if (!id || out.some((x) => x.id === id)) continue;
    const options = [r.option1, r.option2, r.option3].map(toStr).filter(Boolean);
    const title = toStr(r.title);
    out.push({
      id,
      label: options.length ? options.join(' / ') : title || id,
      price: toNum(r.price),
      compareAtPrice: toNum(r.compare_at_price ?? r.compareAtPrice),
      quantity: toNum(r.inventory_quantity ?? r.inventoryQuantity),
      sku: toStr(r.sku),
      tracked: (r.inventory_management ?? r.inventoryManagement) === 'shopify' || r.tracked === true,
    });
  }
  return out;
}

export type VariantCellKey = 'price' | 'compareAtPrice' | 'quantity';

/**
 * Apply one cell commit to the staged edits. A value equal to Shopify's drops the key (and the edit when nothing is
 * left); quantity edits carry `expectedQuantity` = the quantity the table showed. Pure.
 */
export function applyVariantEdit(edits: ShopifyVariantEdit[], row: ShopifyVariantRow, key: VariantCellKey, value: number | null): ShopifyVariantEdit[] {
  const current: ShopifyVariantEdit = { ...(edits.find((e) => e.id === row.id) ?? { id: row.id }) };
  if (key === 'price') {
    if (value === null || money2(value) === row.price) delete current.price;
    else current.price = money2(value);
  } else if (key === 'compareAtPrice') {
    const v = value === null || value <= 0 ? null : money2(value);
    if (v === row.compareAtPrice) delete current.compareAtPrice;
    else current.compareAtPrice = v;
  } else {
    const q = value === null ? null : Math.max(0, Math.round(value));
    if (q === null || q === row.quantity) {
      delete current.inventoryQuantity;
      delete current.expectedQuantity;
    } else {
      current.inventoryQuantity = q;
      if (row.quantity !== null) current.expectedQuantity = row.quantity;
    }
  }
  const rest = edits.filter((e) => e.id !== row.id);
  const meaningful = Object.keys(current).some((k) => k !== 'id' && k !== 'expectedQuantity');
  return meaningful ? [...rest, current] : rest;
}

/** Row with the staged edit applied (what the table shows). Pure. */
export function viewVariant(row: ShopifyVariantRow, edit: ShopifyVariantEdit | undefined): ShopifyVariantRow {
  if (!edit) return row;
  return {
    ...row,
    price: edit.price ?? row.price,
    compareAtPrice: edit.compareAtPrice !== undefined ? edit.compareAtPrice : row.compareAtPrice,
    quantity: edit.inventoryQuantity ?? row.quantity,
  };
}

/** Active Shopify locations (`action=locations`). Pure. */
export function parseShopifyLocations(data: unknown): Array<{ id: string; name: string }> {
  const list = (data as { locations?: unknown[] } | null)?.locations;
  if (!Array.isArray(list)) return [];
  return list
    .map((l) => rawRecord(l))
    .filter((l) => l.active !== false)
    .map((l) => ({ id: String(l.id ?? ''), name: toStr(l.name) }))
    .filter((l) => l.id);
}

/** Shopify admin page of the product (`raw.adminUrl`, else built from `raw.shopDomain`). */
export function shopifyAdminUrl(raw: Record<string, unknown>, productId: string | null): string | null {
  const explicit = toStr(raw.adminUrl);
  if (explicit) return explicit;
  const domain = toStr(raw.shopDomain).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const id = toStr(raw.shopifyProductId) || toStr(raw.id) || productId;
  return domain && id && /^\d+$/.test(id) ? `https://${domain}/admin/products/${id}` : null;
}

/**
 * Active locations of the shop, as the adapter loaded them (`raw.locationCount`, else the form's `locationCount`).
 * The adapter drops quantity edits when this is > 1, so the sections read the same number (no second fetch that
 * could still be loading or fail while a quantity is typed). Pure.
 */
export function shopifyLocationCount(f: Record<string, unknown>, raw: Record<string, unknown>): number {
  return toNum(raw.locationCount) ?? toNum(f.locationCount) ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Price & inventory (single variant)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ShopifyPriceSection({ id = 'price' }: Partial<ListingSectionProps>) {
  const t = useTranslations('listingEditor');
  const { f, raw, ro, mode, currency: metaCurrency, errorFor, dirty, set, revert } = useCatalogSection();
  const currency = metaCurrency || toStr(raw.currency) || 'USD';
  const variants = parseShopifyVariants(raw.variants);
  const multi = variants.length > 1;
  const locationCount = shopifyLocationCount(f, raw);
  const multiLocation = locationCount > 1;
  const untracked = mode === 'edit' && variants.length === 1 && !variants[0].tracked;
  const qtyReason = multiLocation ? t('shopify.multiLocation', { count: locationCount }) : untracked ? t('shopify.notTracked') : null;

  if (multi) {
    return (
      <Section id={sectionAnchorId(id)} title={t('section.price')} variant="plain" data-testid="le-section-price">
        <Box sx={{ color: neutral[600], fontSize: 14 }}>{t('field.priceInVariations')}</Box>
      </Section>
    );
  }
  return (
    <Section id={sectionAnchorId(id)} title={t('section.price')} variant="plain" data-testid="le-section-price">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '180px 180px' }, gap: '12px', alignItems: 'end' }}>
          <FormField label={t('field.price')} htmlFor={fieldAnchorId('price')} error={errorFor('price')} dirty={dirty('price')} onRevert={() => revert('price')} required>
            <MoneyField id={fieldAnchorId('price')} currency={currency} value={toNum(f.price)} onChange={(n) => set('price', numOrBlank(n === null ? null : money2(n)))} min={0} readOnly={ro} />
          </FormField>
          <FormField label={t('shopify.compareAt')} htmlFor={fieldAnchorId('compareAtPrice')} error={errorFor('compareAtPrice')} dirty={dirty('compareAtPrice')} onRevert={() => revert('compareAtPrice')} optional>
            <MoneyField
              id={fieldAnchorId('compareAtPrice')}
              currency={currency}
              value={toNum(f.compareAtPrice) || null}
              onChange={(n) => set('compareAtPrice', numOrBlank(n === null || n <= 0 ? null : money2(n)))}
              min={0}
              readOnly={ro}
            />
          </FormField>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '180px 240px' }, gap: '12px', alignItems: 'start' }}>
          <FormField
            label={t('field.quantity')}
            htmlFor={fieldAnchorId('quantity')}
            helper={qtyReason ?? undefined}
            error={errorFor('quantity')}
            dirty={dirty('quantity')}
            onRevert={() => revert('quantity')}
          >
            <NumberField
              id={fieldAnchorId('quantity')}
              value={toNum(f.quantity)}
              onChange={(n) => set('quantity', numOrBlank(n === null ? null : Math.max(0, Math.round(n))))}
              min={0}
              max={LIMITS.quantityMax}
              decimals={0}
              readOnly={ro || Boolean(qtyReason)}
            />
          </FormField>
          <FormField label={t('field.sku')} htmlFor={fieldAnchorId('sku')} error={errorFor('sku')} dirty={dirty('sku')} onRevert={() => revert('sku')} optional>
            <NormalizedTextField id={fieldAnchorId('sku')} value={toStr(f.sku)} onChange={(v) => set('sku', v)} maxLength={LIMITS.shopifyText} readOnly={ro} mono />
          </FormField>
        </Box>
        {mode === 'create' ? <Box sx={{ color: neutral[600], fontSize: 13 }}>{t('shopify.addOptionsLater')}</Box> : null}
      </Box>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Variants table
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ShopifyVariantsSectionProps extends Partial<ListingSectionProps> {
  /** Per-variant send failures from the last send (`variantId → translated message`), shown on the row. */
  variantErrors?: Record<string, string>;
}

export function ShopifyVariantsSection({ id = 'variations', variantErrors }: ShopifyVariantsSectionProps) {
  const t = useTranslations('listingEditor');
  const { ed, f, raw, ro, currency: metaCurrency, dirty, set, revert } = useCatalogSection();
  const currency = metaCurrency || toStr(raw.currency) || 'USD';
  const rows = React.useMemo(() => parseShopifyVariants(raw.variants), [raw.variants]);
  const edits = React.useMemo(() => decodeVariantEdits(f.variants), [f.variants]);
  const locationCount = shopifyLocationCount(f, raw);
  const multiLocation = locationCount > 1;
  const adminUrl = shopifyAdminUrl(raw, ed.ctx.listingId);

  if (ed.mode === 'create' || rows.length <= 1) return null;

  const shown = rows.map((r) => viewVariant(r, edits.find((e) => e.id === r.id)));
  const dirtyCells = new Set<string>();
  for (const e of edits) {
    if (e.price !== undefined) dirtyCells.add(`${e.id}:price`);
    if (e.compareAtPrice !== undefined) dirtyCells.add(`${e.id}:compareAtPrice`);
    if (e.inventoryQuantity !== undefined) dirtyCells.add(`${e.id}:quantity`);
  }
  const qtyReason = (r: ShopifyVariantRow) =>
    ro ? t('shopify.readOnlySending') : multiLocation ? t('shopify.multiLocation', { count: locationCount }) : !r.tracked ? t('shopify.notTracked') : null;
  const columns: Column<ShopifyVariantRow>[] = [
    {
      key: 'label',
      header: t('shopify.option'),
      mobile: 'title',
      render: (r) => (
        <Box>
          <Box>{r.label}</Box>
          {variantErrors?.[r.id] ? <Box sx={{ color: tone.danger.fg, fontSize: 12 }}>{variantErrors[r.id]}</Box> : null}
        </Box>
      ),
    },
    {
      key: 'price',
      header: t('field.price'),
      type: 'money-edit',
      align: 'right',
      mobile: 'meta',
      currency: () => currency,
      value: (r) => r.price,
      readOnlyReason: () => (ro ? t('shopify.readOnlySending') : null),
      validate: (v) => (v === null || v <= 0 ? t('shopify.priceRequired') : null),
    },
    {
      key: 'compareAtPrice',
      header: t('shopify.compareAt'),
      type: 'money-edit',
      align: 'right',
      mobile: 'meta',
      currency: () => currency,
      value: (r) => r.compareAtPrice,
      readOnlyReason: () => (ro ? t('shopify.readOnlySending') : null),
    },
    {
      key: 'quantity',
      header: t('field.quantity'),
      type: 'int-edit',
      align: 'right',
      mobile: 'meta',
      value: (r) => r.quantity,
      readOnlyReason: qtyReason,
      validate: (v) => (v !== null && (v < 0 || v > LIMITS.quantityMax) ? t('shopify.quantityInvalid') : null),
    },
    { key: 'sku', header: t('field.sku'), mobile: 'subtitle', render: (r) => <Box component="span" sx={{ fontFamily: 'monospace' }}>{r.sku || '—'}</Box> },
  ];

  const onCommit = (rowId: string, key: string, value: number | null) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row || (key !== 'price' && key !== 'compareAtPrice' && key !== 'quantity')) return;
    set('variants', encodeVariantEdits(applyVariantEdit(edits, row, key, value)));
  };

  const edited = edits.length;
  const table = (
    <DataTable<ShopifyVariantRow>
      rows={shown}
      columns={columns}
      getRowId={(r) => r.id}
      state="ready"
      density="compact"
      columnStateKey="kx.listingEditor.shopifyVariants"
      ariaLabel={t('section.variants')}
      onCellCommit={onCommit}
      dirtyCells={dirtyCells}
      stickyHeader={false}
      layout="table"
    />
  );

  return (
    <Section id={sectionAnchorId(id)} title={t('shopify.variantsCount', { count: rows.length })} variant="plain" data-testid="le-section-variations">
      <Box id={fieldAnchorId('variants')} sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {dirty('variants') && !ro ? (
          <Box>
            <Button variant="ghost" size="sm" icon={icons.revert} onClick={() => revert('variants')}>{t('common.revertAll')}</Button>
          </Box>
        ) : null}
        <MobileEditSheet
          title={t('section.variants')}
          summary={edited ? t('shopify.variantsEdited', { count: edited }) : t('shopify.variantsCount', { count: rows.length })}
          keys={['variants']}
          disabled={ro}
          data-testid="le-shopify-variants-sheet"
        >
          {table}
        </MobileEditSheet>
        {multiLocation ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', color: neutral[600], fontSize: 13 }}>
            {t('shopify.multiLocation', { count: locationCount })}
            {adminUrl ? (
              <Button variant="ghost" size="sm" href={adminUrl} external trailingIcon={icons.externalLink}>
                {t('common.openIn', { marketplace: 'Shopify' })}
              </Button>
            ) : null}
          </Box>
        ) : null}
      </Box>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Shipping: weight + unit (single variant only)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ShopifyShippingSection({ id = 'shipping' }: Partial<ListingSectionProps>) {
  const t = useTranslations('listingEditor');
  const { f, raw, ro, errorFor, dirty, set, revert } = useCatalogSection();
  const multi = parseShopifyVariants(raw.variants).length > 1;
  return (
    <Section id={sectionAnchorId(id)} title={t('section.shipping')} variant="plain" data-testid="le-section-shipping">
      {multi ? (
        <Box sx={{ color: neutral[600], fontSize: 14 }}>{t('shopify.weightPerVariant')}</Box>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '160px 120px' }, gap: '12px', alignItems: 'end', maxWidth: 720 }}>
          <FormField label={t('field.weight')} htmlFor={fieldAnchorId('weight')} error={errorFor('weight')} dirty={dirty('weight')} onRevert={() => revert('weight')} optional>
            <NumberField id={fieldAnchorId('weight')} value={toNum(f.weight)} onChange={(n) => set('weight', numOrBlank(n))} min={0} max={LIMITS.weightMax} decimals={3} readOnly={ro} />
          </FormField>
          <FormField label={t('field.weightUnit')} htmlFor={fieldAnchorId('weightUnit')} dirty={dirty('weightUnit')} onRevert={() => revert('weightUnit')}>
            <Select<string>
              id={fieldAnchorId('weightUnit')}
              value={toStr(f.weightUnit) || 'kg'}
              options={SHOPIFY_WEIGHT_UNITS.map((u) => ({ value: u, label: u }))}
              onChange={(v) => set('weightUnit', v)}
              disabled={ro}
            />
          </FormField>
        </Box>
      )}
    </Section>
  );
}
