// components/domain/listing-editor/sections/TrendyolPriceSection.tsx — M6b-D: Trendyol "Price & stock"
// (marketplace-editors §3 row 4, §4.1). List price, sale price (`price`), VAT, the discount caption and a
// `MarginLine` estimate that reads the per-category rate from `lib/trendyolCommissions.ts` (fixes §0 #7: no
// hard-coded "~18%", no `₺` + toFixed). Stock: quantity and stock code. Price / stock go through Trendyol's
// price-and-inventory batch at send (M6b-A executor); this section only calls `setField`.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { FormField, MoneyField, NumberField, Select, TextField } from '@/components/ds/inputs';
import { TermHint } from '@/components/ds/format';
import { useFormatters } from '@/lib/format';
import { neutral } from '@/lib/ds/tokens';
import { fieldAnchorId, sectionAnchorId } from '@/lib/listingEditor/sections';
import type { FieldIssue, ListingSectionProps } from '@/lib/listingEditor/types';
import { LIMITS, TRENDYOL_VAT_RATES } from '@/lib/catalogDrafts/schemas';
import { DEFAULT_COMMISSION_RATE, TRENDYOL_COMMISSION_RATES } from '@/lib/trendyolCommissions';
import { useRegisterDraftSection } from '../useListingDraft';
import { loadTrendyolLeafCategories } from './TrendyolDetailsSection';
import { money2, numOrBlank, toNum, toStr, useCatalogSection } from './marketplaceSectionShared';

/** Root-category words → commission group. Matched against the words of the path's first segment only. */
const ROOT_GROUPS: Array<[string, string[]]> = [
  ['Elektronik', ['elektronik']],
  ['Kozmetik', ['kozmetik', 'kişisel']],
  ['Yiyecek', ['süpermarket', 'gıda', 'yiyecek']],
  ['Bebek', ['bebek', 'anne', 'çocuk']],
  ['Kitap', ['kitap', 'kırtasiye']],
  ['Spor', ['spor', 'outdoor']],
  ['Takı & Aksesuar', ['takı', 'saat', 'aksesuar', 'bijuteri']],
  ['Moda', ['kadın', 'erkek', 'giyim', 'ayakkabı', 'çanta', 'moda']],
  ['Mutfak', ['mutfak']],
  ['Ev & Yaşam', ['ev', 'yaşam', 'mobilya', 'dekorasyon']],
  ['Hediyelik', ['hediyelik', 'hediye', 'hobi']],
];

/** Inside "Ev & Yaşam" (and similar home roots) the second segment can name a group with its own rate. */
const HOME_SUBGROUPS: Array<[string, string[]]> = [
  ['Mutfak', ['mutfak']],
  ['Tekstil', ['tekstil']],
];

/** Leaf-only fallback (no path): category words → group, most specific first. Lower-cased Turkish. */
const LEAF_KEYWORDS: Array<[string, string[]]> = [
  ['Bebek', ['bebek']],
  ['Mutfak', ['mutfak', 'tencere', 'tava']],
  ['Tekstil', ['nevresim', 'yatak örtüsü', 'perde', 'ev tekstili']],
  ['Kozmetik', ['kozmetik', 'parfüm', 'makyaj', 'cilt bakım']],
  ['Elektronik', ['elektronik', 'telefon', 'bilgisayar', 'tablet']],
  ['Kitap', ['kitap', 'kırtasiye']],
  ['Takı & Aksesuar', ['kolye', 'bileklik', 'küpe', 'yüzük', 'bijuteri']],
  ['Moda', ['elbise', 'tişört', 'pantolon', 'ayakkabı']],
];

function words(segment: string): string[] {
  return segment.toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** First group whose word appears in the segment (`prefix`: also as a word start, "tekstil" → "Tekstili"). */
function groupOf(segment: string, table: Array<[string, string[]]>, prefix = false): string | null {
  const w = words(segment);
  for (const [group, keys] of table) {
    if (keys.some((k) => w.some((x) => x === k || (prefix && x.startsWith(k))))) return group;
  }
  return null;
}

/**
 * Commission rate (percent) and group for a Trendyol category path ("Ev & Yaşam › Dekorasyon › Takı Kutusu") or a
 * leaf name. Pure. The root segment decides (a jewelry box under home decor is home decor, not jewelry); a leaf
 * name alone only matches unambiguous words. `known: false` → the default rate, the category was not matched.
 */
export function trendyolCommissionFor(category: string | null | undefined): { rate: number; group: string; known: boolean } {
  const segments = (category ?? '').split(/\s*[›>/]\s*/).map((x) => x.trim()).filter(Boolean);
  let group: string | null = null;
  if (segments.length >= 2) {
    group = groupOf(segments[0], ROOT_GROUPS);
    if (group === 'Ev & Yaşam') group = groupOf(segments[1], HOME_SUBGROUPS, true) ?? group;
  } else if (segments.length === 1) {
    const phrase = ` ${segments[0].toLocaleLowerCase('tr')} `;
    for (const [g, keys] of LEAF_KEYWORDS) {
      if (keys.some((k) => phrase.includes(k.includes(' ') ? k : ` ${k}`))) {
        group = g;
        break;
      }
    }
  }
  const r = group ? TRENDYOL_COMMISSION_RATES[group] : undefined;
  if (r) return { rate: r.rate, group: r.group, known: true };
  const other = TRENDYOL_COMMISSION_RATES['Diğer'];
  return { rate: other?.rate ?? DEFAULT_COMMISSION_RATE, group: other?.group ?? 'Diğer', known: false };
}

/**
 * Full path of the product's category. Create mode keeps it with the pick (`categoryPath`); edit mode only has the
 * leaf name, so the path is looked up in the cached category tree by id (null while loading / on failure).
 */
function useCategoryPath(categoryId: number | null, knownPath: string): string | null {
  const [resolved, setResolved] = React.useState<{ id: number; path: string } | null>(null);
  React.useEffect(() => {
    if (knownPath || !categoryId) return undefined;
    let cancelled = false;
    loadTrendyolLeafCategories()
      .then((leaves) => {
        const leaf = leaves.find((c) => c.id === categoryId);
        if (!cancelled && leaf) setResolved({ id: categoryId, path: leaf.path });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [categoryId, knownPath]);
  if (knownPath) return knownPath;
  return resolved && resolved.id === categoryId ? resolved.path : null;
}

/**
 * Seller's net estimate for a sale price that includes VAT: price − commission (on the VAT-inclusive price, as
 * Trendyol charges it) − the VAT inside the price. Pure. Null when the price is missing.
 */
export function trendyolNetEstimate(salePrice: number | null, commissionRatePct: number, vatRatePct: number | null): number | null {
  if (salePrice === null || !Number.isFinite(salePrice) || salePrice <= 0) return null;
  const vat = vatRatePct && vatRatePct > 0 ? (salePrice * vatRatePct) / (100 + vatRatePct) : 0;
  return money2(salePrice - (salePrice * commissionRatePct) / 100 - vat);
}

/** Discount ratio shown as "{pct} off" (list > sale > 0), else null. Pure. */
export function trendyolDiscountRatio(listPrice: number | null, salePrice: number | null): number | null {
  if (listPrice === null || salePrice === null || listPrice <= 0 || salePrice <= 0 || salePrice >= listPrice) return null;
  return (listPrice - salePrice) / listPrice;
}

export function TrendyolPriceSection({ id = 'price' }: Partial<ListingSectionProps>) {
  const t = useTranslations('listingEditor');
  const fmt = useFormatters();
  const { f, raw, ro, currency: metaCurrency, errorFor, dirty, set, revert } = useCatalogSection();
  const currency = metaCurrency || toStr(raw.currencyType) || 'TRY';
  const sale = toNum(f.price);
  const list = toNum(f.listPrice);
  const vat = toNum(f.vatRate);
  const quantity = toNum(f.quantity);
  const categoryPath = useCategoryPath(toNum(f.categoryId) ?? toNum(raw.categoryId), toStr(f.categoryPath));
  const categoryLabel = categoryPath || toStr(f.categoryName) || toStr(raw.categoryName);
  const commission = trendyolCommissionFor(categoryLabel);
  const net = trendyolNetEstimate(sale, commission.rate, vat);
  const discount = trendyolDiscountRatio(list, sale);

  const listBelowSale = list !== null && sale !== null && list > 0 && sale > 0 && list < sale;
  useRegisterDraftSection({
    id: 'price',
    key: 'price:trendyol',
    isDirty: () => false,
    stage: async () => undefined,
    validate: (): FieldIssue[] =>
      listBelowSale ? [{ field: 'listPrice', section: 'price', severity: 'block_sync', key: 'listingEditor.trendyol.listBelowSale' }] : [],
  });

  const vatOptions = TRENDYOL_VAT_RATES.map((r) => ({ value: r, label: fmt.percent(r / 100, { decimals: 0 }) }));
  const priceError = (key: string) => errorFor(key) ?? (key === 'listPrice' && listBelowSale ? t('trendyol.listBelowSale') : null);

  return (
    <Section id={sectionAnchorId(id)} title={t('section.priceStock')} variant="plain" data-testid="le-section-price">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 720 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '180px 180px 140px' }, gap: '12px', alignItems: 'end' }}>
          <FormField label={t('trendyol.listPrice')} htmlFor={fieldAnchorId('listPrice')} error={priceError('listPrice')} dirty={dirty('listPrice')} onRevert={() => revert('listPrice')} required>
            <MoneyField
              id={fieldAnchorId('listPrice')}
              currency={currency}
              value={list}
              onChange={(n) => set('listPrice', numOrBlank(n === null ? null : money2(n)))}
              min={0}
              readOnly={ro}
            />
          </FormField>
          <FormField label={t('trendyol.salePrice')} htmlFor={fieldAnchorId('price')} error={errorFor('price')} dirty={dirty('price')} onRevert={() => revert('price')} required>
            <MoneyField
              id={fieldAnchorId('price')}
              currency={currency}
              value={sale}
              onChange={(n) => set('price', numOrBlank(n === null ? null : money2(n)))}
              min={0}
              readOnly={ro}
            />
          </FormField>
          <FormField label={t('trendyol.vat')} htmlFor={fieldAnchorId('vatRate')} error={errorFor('vatRate')} dirty={dirty('vatRate')} onRevert={() => revert('vatRate')} required>
            <Select<number>
              id={fieldAnchorId('vatRate')}
              value={vat}
              options={vatOptions}
              onChange={(v) => set('vatRate', v)}
              disabled={ro}
              placeholder={t('field.choose')}
            />
          </FormField>
        </Box>

        {discount !== null || net !== null ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px', color: neutral[600], fontSize: 14 }} data-testid="le-trendyol-margin">
            {discount !== null ? <Box>{t('trendyol.discount', { pct: fmt.percent(discount, { decimals: 0 }) })}</Box> : null}
            {net !== null ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', fontVariantNumeric: 'tabular-nums' }}>
                {commission.known
                  ? t('trendyol.margin', {
                    net: fmt.money(net, currency),
                    rate: fmt.percent(commission.rate / 100, { decimals: 0 }),
                    category: commission.group,
                  })
                  : t('trendyol.marginDefault', {
                    net: fmt.money(net, currency),
                    rate: fmt.percent(commission.rate / 100, { decimals: 0 }),
                  })}
                <TermHint
                  label={t('trendyol.estimate')}
                  body={commission.known ? t('trendyol.marginHelp', { category: commission.group }) : t('trendyol.marginHelpDefault')}
                />
              </Box>
            ) : null}
          </Box>
        ) : null}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '180px 240px' }, gap: '12px', alignItems: 'end' }}>
          <FormField label={t('field.quantity')} htmlFor={fieldAnchorId('quantity')} error={errorFor('quantity')} dirty={dirty('quantity')} onRevert={() => revert('quantity')} required>
            <NumberField
              id={fieldAnchorId('quantity')}
              value={quantity}
              onChange={(n) => set('quantity', numOrBlank(n === null ? null : Math.max(0, Math.round(n))))}
              min={0}
              max={LIMITS.quantityMax}
              decimals={0}
              readOnly={ro}
            />
          </FormField>
          <FormField label={t('trendyol.stockCode')} htmlFor={fieldAnchorId('stockCode')} error={errorFor('stockCode')} dirty={dirty('stockCode')} onRevert={() => revert('stockCode')} required>
            <TextField
              id={fieldAnchorId('stockCode')}
              value={toStr(f.stockCode)}
              onChange={(v) => set('stockCode', v.replace(/\s+/g, ''))}
              maxLength={LIMITS.trendyolStockCode}
              readOnly={ro}
              mono
            />
          </FormField>
        </Box>
      </Box>
    </Section>
  );
}
