// components/domain/listing-editor/sections/PriceSection.tsx — listing-editor §2.1 #4 "Price & inventory" (Etsy).
// Price in the shop currency (MoneyField, no currency select: Etsy prices in shop currency only), quantity
// (read-only chip when stock sync manages it, BUILD_PLAN §7 item 7), and the market band from Etsy search
// (median + p25–p75, never a mean; honest "—" with the reason when the sample is too small; "Use $49" only when
// the band is in the shop currency). With variations, price and quantity become a read-only summary that links
// to Variations (the server rejects single price/quantity on multi-variation listings).
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { Button, FormField, MoneyField, NumberField } from '@/components/ds/inputs';
import { PriceBand, priceBandMode } from '@/components/ds/research/PriceBand';
import { SourceNote } from '@/components/ds/research/SourceNote';
import { useDsFormat } from '@/components/ds/data/fmt';
import { icons } from '@/lib/ds/icons';
import { accent, neutral, tone, type as typeScale } from '@/lib/ds/tokens';
import { sectionAnchorId } from '@/lib/listingEditor/sections';
import type { ListingSectionProps } from '@/lib/listingEditor/types';
import { useStockManaged } from '@/components/stock/useStockManaged';
import StockManagedQtyChip from '@/components/stock/StockManagedQtyChip';
import { fieldDomId, numberToPrice, priceToNumber } from './etsyShared';
import { useEtsySection, useFieldError } from './useEtsySection';
import type { MarketBand } from './sectionTypes';

export interface PriceSectionProps extends Partial<ListingSectionProps> {
  /**
   * Market band supplied by the frame / useListingAI ("Check price"). `undefined` → the section runs its own
   * `search_market` on the first title phrase when the user clicks "Check price". `null` → no data.
   */
  market?: MarketBand | null;
  marketLoading?: boolean;
  onCheckPrice?: () => void;
}

/** First phrase of the title (before the first comma), at most 6 words: the search the band is based on. */
export function marketQueryFromTitle(title: string): string {
  const first = title.split(',')[0] ?? '';
  return first.trim().split(/\s+/u).filter(Boolean).slice(0, 6).join(' ');
}

/** `search_market` JSON → MarketBand (USD robust stats; `avg` is never read). */
export function marketBandFromResponse(json: unknown, query: string): MarketBand | null {
  const j = json as { priceStats?: Record<string, unknown> | null; fetchedAt?: string } | null;
  const s = j?.priceStats;
  if (!s) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    p25: num(s.p25),
    median: num(s.median),
    p75: num(s.p75),
    n: num(s.n) ?? 0,
    currency: typeof s.currency === 'string' ? s.currency : 'USD',
    query,
    fetchedAt: j?.fetchedAt ?? new Date().toISOString(),
    excluded: (num(s.excludedNoFx) ?? 0) + (num(s.excludedImplausible) ?? 0),
    implausible: s.quality === 'implausible',
  };
}

export function PriceSection({ id = 'price', market: marketProp, marketLoading, onCheckPrice }: PriceSectionProps) {
  const t = useTranslations('listingEditor');
  const fmt = useDsFormat();
  const api = useEtsySection();
  const errorFor = useFieldError(api);
  const currency = api.currency || 'USD';
  const variations = api.facts.variations;
  const hasVariations = Boolean(variations && variations.count > 0);

  const editListingId = api.mode === 'edit' && api.listingId && !api.listingId.startsWith('-') ? api.listingId : null;
  const stock = useStockManaged(editListingId, api.shopId);
  const managed = stock.managed ? stock.get('') : undefined;

  // Self-managed market check when the frame does not supply one.
  const [own, setOwn] = useState<MarketBand | null | undefined>(undefined);
  const [ownLoading, setOwnLoading] = useState(false);
  const [ownFailed, setOwnFailed] = useState(false);
  const market = marketProp !== undefined ? marketProp : own;
  const loading = marketProp !== undefined ? Boolean(marketLoading) : ownLoading;
  const query = marketQueryFromTitle(api.fields.title || '');

  const checkPrice = async () => {
    if (onCheckPrice) { onCheckPrice(); return; }
    if (!query || ownLoading) return;
    setOwnLoading(true);
    setOwnFailed(false);
    try {
      const res = await fetch(`/api/clawd/etsy?action=search_market&keywords=${encodeURIComponent(query)}&limit=100`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOwn(marketBandFromResponse(await res.json(), query));
    } catch {
      setOwnFailed(true);
    } finally {
      setOwnLoading(false);
    }
  };

  // Score `price_market` uses the band only when it is in the shop currency (else comparing is meaningless).
  const comparable = Boolean(market && market.currency === currency && priceBandMode(market) !== 'insufficient' && priceBandMode(market) !== 'implausible');
  const { reportFacts } = api;
  useEffect(() => {
    if (market === undefined) return;
    reportFacts({
      market: comparable && market && market.p25 != null && market.p75 != null
        ? { p25: market.p25, p75: market.p75, median: market.median ?? undefined, n: market.n }
        : null,
    });
  }, [market, comparable, reportFacts]);

  const price = priceToNumber(api.fields.price);
  const range = variations?.priceRange;

  return (
    <Section id={sectionAnchorId(id)} title={t('section.price')} variant="plain" data-testid="le-section-price">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: 720 }}>
        {hasVariations ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', fontSize: typeScale.body[0], color: neutral[700] }}>
            <span>
              {range
                ? t('field.priceRange', { min: fmt.money(range.min, currency), max: fmt.money(range.max, currency) })
                : t('field.priceInVariations')}
            </span>
            {/* An inline link, not a ghost button: on phones the button wrapped onto its own padded row. */}
            <Box
              component="a"
              href={`#${sectionAnchorId('variations')}`}
              sx={{ color: accent[700], fontWeight: 500, textDecoration: 'none', whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' } }}
            >
              {t('field.editInVariations')}
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '200px 160px' }, gap: '16px', alignItems: 'start' }}>
            <FormField
              label={t('field.price')}
              htmlFor={fieldDomId('price')}
              error={errorFor('price')}
              dirty={api.isDirty('price')}
              onRevert={() => api.revert('price')}
              required
            >
              <MoneyField
                id={fieldDomId('price')}
                value={price}
                onChange={(v) => api.setField('price', numberToPrice(v))}
                currency={currency}
                min={0.2}
                readOnly={api.readOnly}
                data-testid="le-price-input"
              />
            </FormField>
            {managed && stock.live ? (
              <FormField label={t('field.quantity')} helper={t('field.quantityManaged')}>
                <Box sx={{ minHeight: 40, display: 'flex', alignItems: 'center' }}>
                  <StockManagedQtyChip qty={managed.canonical} live />
                </Box>
              </FormField>
            ) : (
              <FormField
                label={t('field.quantity')}
                htmlFor={fieldDomId('quantity')}
                error={errorFor('quantity')}
                dirty={api.isDirty('quantity')}
                onRevert={() => api.revert('quantity')}
                helper={managed ? <StockManagedQtyChip qty={managed.canonical} live={false} /> : undefined}
                required
              >
                <NumberField
                  id={fieldDomId('quantity')}
                  value={Number.isFinite(api.fields.quantity) ? api.fields.quantity : null}
                  onChange={(v) => api.setField('quantity', v == null ? 0 : Math.max(0, Math.trunc(v)))}
                  min={1}
                  max={999}
                  readOnly={api.readOnly}
                  data-testid="le-quantity-input"
                />
              </FormField>
            )}
          </Box>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }} data-testid="le-price-market">
          {market ? (
            <>
              <Box sx={{ fontSize: typeScale.label[0], fontWeight: typeScale.label[2], color: neutral[800] }}>{t('price.bandTitle')}</Box>
              <PriceBand p25={market.p25} median={market.median} p75={market.p75} n={market.n} currency={market.currency} implausible={market.implausible} />
              <SourceNote
                source="listingEditor.price.source"
                sourceParams={{ query: market.query }}
                fetchedAt={market.fetchedAt}
                sample={market.n}
                excluded={market.excluded ? { count: market.excluded } : undefined}
                kind="measured"
              />
              {market.currency !== currency ? (
                <Box sx={{ fontSize: 12, lineHeight: '16px', color: neutral[600] }}>{t('price.otherCurrency', { currency: market.currency, shopCurrency: currency })}</Box>
              ) : comparable && market.median != null && !hasVariations && !api.readOnly && Math.abs((price ?? 0) - market.median) >= 0.01 ? (
                <Box>
                  <Button variant="secondary" size="sm" onClick={() => api.setField('price', numberToPrice(market.median))}>
                    {t('price.use', { price: fmt.money(market.median, currency) })}
                  </Button>
                </Box>
              ) : null}
            </>
          ) : null}
          {!api.readOnly && query ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Button variant="ghost" size="sm" icon={icons.ai} onClick={checkPrice} loading={loading} loadingLabel={t('price.checking')}>
                {market ? t('price.checkAgain') : t('ai.checkPrice')}
              </Button>
              {market === null && !loading ? (
                <Box sx={{ fontSize: 12, color: neutral[600] }}>{t('price.noData', { query })}</Box>
              ) : null}
              {ownFailed ? (
                <Box role="alert" sx={{ fontSize: 12, color: tone.danger.fg }}>{t('price.checkFailed')}</Box>
              ) : null}
            </Box>
          ) : null}
        </Box>
      </Box>
    </Section>
  );
}

export default PriceSection;
