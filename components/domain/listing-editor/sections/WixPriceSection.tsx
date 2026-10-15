// components/domain/listing-editor/sections/WixPriceSection.tsx — M6b-D: Wix "Price & inventory"
// (marketplace-editors §3 row 4, §4.2). Price, discount (Amount / Percent + value, "Customers pay {price}"),
// inventory (Track inventory → quantity, else In stock), SKU and weight. One autosave to the draft, one Send:
// the legacy drawer's separate stock Save is gone (§0 #3) and the discount is part of the payload (§0 #1).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { FormField, MoneyField, NumberField, SegmentedControl, Switch } from '@/components/ds/inputs';
import { useFormatters } from '@/lib/format';
import { neutral } from '@/lib/ds/tokens';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { ListingSectionProps } from '@/lib/listingEditor/types';
import { LIMITS } from '@/lib/catalogDrafts/schemas';
import { NormalizedTextField, money2, numOrBlank, toBool, toNum, toStr, useCatalogSection } from './marketplaceSectionShared';

export type WixDiscountMode = 'AMOUNT' | 'PERCENT';

/** Highest percent discount the draft accepts (the adapter refuses ≥ 100% as `invalidDiscount`). */
export const WIX_MAX_PERCENT = 99.9;

/** Discount value as staged for a mode: rounded, percent capped below 100. Null / ≤ 0 → no discount. Pure. */
export function wixDiscountValue(mode: WixDiscountMode, v: number | null): number | null {
  if (v === null || !Number.isFinite(v) || v <= 0) return null;
  return mode === 'PERCENT' ? Math.min(WIX_MAX_PERCENT, Math.round(v * 10) / 10) : money2(v);
}

/** What the customer pays after the discount (never below 0). Pure; null without a price. */
export function wixCustomerPays(price: number | null, type: string, value: number | null): number | null {
  if (price === null || !Number.isFinite(price)) return null;
  if (!value || value <= 0 || (type !== 'AMOUNT' && type !== 'PERCENT')) return price;
  const off = type === 'PERCENT' ? (price * Math.min(value, 100)) / 100 : value;
  return money2(Math.max(0, price - off));
}

/** The product has several variants (the adapter's `variantCount`): price and stock are per variant in Wix. */
export function wixHasVariants(f: Record<string, unknown>, raw: Record<string, unknown>): boolean {
  const n = toNum(f.variantCount);
  return n !== null ? n > 1 : Array.isArray(raw.variants) && raw.variants.length > 1;
}

/** The product manages stock per variant (Wix `manageVariants`): product-level stock is read-only. */
export function wixManagesVariants(raw: Record<string, unknown>): boolean {
  if (raw.manageVariants === true) return true;
  return Array.isArray(raw.variants) && raw.variants.length > 1;
}

export function WixPriceSection({ id = 'price' }: Partial<ListingSectionProps>) {
  const t = useTranslations('listingEditor');
  const fmt = useFormatters();
  const { ed, f, raw, ro, currency: metaCurrency, errorFor, dirty, set, revert } = useCatalogSection();
  const currency = metaCurrency || toStr(raw.currency) || 'USD';
  const price = toNum(f.price);
  const type = toStr(f.discountType) || 'NONE';
  const value = toNum(f.discountValue);
  // The segment the seller picked last (kept while the value is empty / the discount is NONE).
  const [mode, setMode] = React.useState<WixDiscountMode>(type === 'PERCENT' ? 'PERCENT' : 'AMOUNT');
  const shownMode: WixDiscountMode = type === 'AMOUNT' || type === 'PERCENT' ? type : mode;
  const pays = wixCustomerPays(price, type, value);
  const tracked = toBool(f.trackInventory, true);
  // Same signal as the adapter (`variantCount > 1` → price / stock never staged from here).
  const multi = wixHasVariants(f, raw);
  const perVariant = multi || wixManagesVariants(raw);

  const setDiscount = (m: WixDiscountMode, v: number | null) => {
    const next = wixDiscountValue(m, v);
    if (next === null) ed.setFields({ discountType: 'NONE', discountValue: '' });
    else ed.setFields({ discountType: m, discountValue: next });
  };

  return (
    <Section id={sectionAnchorId(id)} title={t('section.price')} variant="plain" data-testid="le-section-price">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px 1fr' }, gap: '12px', alignItems: 'end' }}>
          <FormField
            label={t('field.price')}
            htmlFor={fieldAnchorId('price')}
            helper={multi ? t('wix.variantPrice') : undefined}
            error={errorFor('price')}
            dirty={dirty('price')}
            onRevert={() => revert('price')}
            required={!multi}
          >
            <MoneyField
              id={fieldAnchorId('price')}
              currency={currency}
              value={price}
              onChange={(n) => set('price', numOrBlank(n === null ? null : money2(n)))}
              min={0}
              readOnly={ro || multi}
            />
          </FormField>
          <FormField
            label={t('wix.discount')}
            htmlFor={fieldAnchorId('discountValue')}
            error={errorFor('discount') ?? errorFor('discountValue')}
            dirty={dirty('discountType') || dirty('discountValue')}
            onRevert={() => revert('discountType', 'discountValue')}
            optional
          >
            <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <SegmentedControl<WixDiscountMode>
                value={shownMode}
                onChange={(m) => {
                  // An amount is not a percent (150 TRY ≠ 150%): switching the kind clears the value.
                  if (m !== shownMode && type !== 'NONE') ed.setFields({ discountType: 'NONE', discountValue: '' });
                  setMode(m);
                }}
                options={[
                  { value: 'AMOUNT', label: t('wix.amount'), disabled: ro },
                  { value: 'PERCENT', label: t('wix.percent'), disabled: ro },
                ]}
                aria-label={t('wix.discount')}
              />
              <Box sx={{ width: 140 }}>
                {shownMode === 'PERCENT' ? (
                  <NumberField
                    id={fieldAnchorId('discountValue')}
                    value={type === 'PERCENT' ? value : null}
                    onChange={(n) => setDiscount('PERCENT', n)}
                    min={0}
                    max={WIX_MAX_PERCENT}
                    decimals={1}
                    unit="%"
                    readOnly={ro}
                  />
                ) : (
                  <MoneyField
                    id={fieldAnchorId('discountValue')}
                    currency={currency}
                    value={type === 'AMOUNT' ? value : null}
                    onChange={(n) => setDiscount('AMOUNT', n)}
                    min={0}
                    readOnly={ro}
                  />
                )}
              </Box>
            </Box>
          </FormField>
        </Box>
        {pays !== null && type !== 'NONE' && value ? (
          <Box sx={{ color: neutral[600], fontSize: 14, fontVariantNumeric: 'tabular-nums' }} data-testid="le-wix-customer-pays">
            {t('wix.customerPays', { price: fmt.money(pays, currency) })}
          </Box>
        ) : null}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Switch
            id={fieldAnchorId('trackInventory')}
            checked={tracked}
            onChange={(c) => set('trackInventory', c)}
            label={t('wix.trackInventory')}
            disabled={ro || perVariant}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '160px 200px 140px' }, gap: '12px', alignItems: 'end' }}>
            {tracked ? (
              <FormField
                label={t('field.quantity')}
                htmlFor={fieldAnchorId('quantity')}
                helper={perVariant ? t('wix.variantStock') : undefined}
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
                  readOnly={ro || perVariant}
                />
              </FormField>
            ) : (
              <Box sx={{ alignSelf: 'center' }}>
                <Switch
                  id={fieldAnchorId('inStock')}
                  checked={toBool(f.inStock, true)}
                  onChange={(c) => set('inStock', c)}
                  label={t('wix.inStock')}
                  disabled={ro || perVariant}
                />
              </Box>
            )}
            <FormField label={t('field.sku')} htmlFor={fieldAnchorId('sku')} error={errorFor('sku')} dirty={dirty('sku')} onRevert={() => revert('sku')} optional>
              <NormalizedTextField id={fieldAnchorId('sku')} value={toStr(f.sku)} onChange={(v) => set('sku', v)} maxLength={LIMITS.wixSku} readOnly={ro} mono />
            </FormField>
            <FormField label={t('wix.weight')} htmlFor={fieldAnchorId('weight')} error={errorFor('weight')} dirty={dirty('weight')} onRevert={() => revert('weight')} optional>
              <NumberField
                id={fieldAnchorId('weight')}
                value={toNum(f.weight)}
                onChange={(n) => set('weight', numOrBlank(n))}
                min={0}
                max={LIMITS.weightMax}
                decimals={3}
                readOnly={ro}
              />
            </FormField>
          </Box>
        </Box>
      </Box>
    </Section>
  );
}
