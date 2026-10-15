// Product finder "Source: From Trendyol" = Price gap: Türkiye → abroad (research.md §9, R4, Pro `features.arbitrage`).
//
// Exports (the Product finder owner mounts them; this file owns no route):
//   usePriceGapSource()        `?source=search|trendyol` (URL state, research.md §2.1)
//   <PriceGapSourceSegment>    SegmentedControl "Search | From Trendyol" + PlanTag (trial / locked Stripe accounts).
//                              shopify_free (stripeUpsell false, no feature): NOT rendered (pro-gating §2).
//   <PriceGap>                 the body for `source=trendyol`, wrapped in `FeatureGate feature="arbitrage"
//                              placement="region"`: locked accounts see the locked state instead of the table; a server
//                              402 `featureLocked` swaps it too (lib/http/limitInterceptor).
//
// Data: GET /api/research/price-gap (read-only). Every number carries its kind: TR price and marketplace medians are
// Measured (median, n; never a mean), shipping is your own labels' median (Measured) or your typed number (You
// entered), landed cost and margin are Estimates and are only shown when every input is known. Low-confidence AI
// matches are collapsed. Per row the one primary is "List on eBay": a session prefill that opens the creator;
// nothing is published and nothing is written to a marketplace here.
import * as React from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { DataTable, KeyValueList, PlanTag, Thumb, type Column } from '@/components/ds/data';
import { useDsFormat } from '@/components/ds/data/fmt';
import { Metric } from '@/components/ds/research/Metric';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { TextField } from '@/components/ds/inputs/TextField';
import { Button } from '@/components/ds/inputs/Button';
import { FilterButton } from '@/components/ds/toolbar/FilterButton';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { useToast } from '@/components/ds/feedback/toast';
import { Banner } from '@/components/ds/feedback/Banner';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { ConnectState } from '@/components/ds/state/ConnectState';
import { TableSkeleton } from '@/components/ds/state/Skeletons';
import type { ActionSpec } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { FeatureGate } from '@/components/domain/billing/FeatureGate';
import { useFeatureAction } from '@/lib/billing/useFeatureAction';
import { useEntitlement } from '@/lib/billing/useEntitlement';
import { LIMIT_UI_HEADER } from '@/lib/http/limitInterceptor';
import { useAsyncRegion } from '@/lib/ds/useAsyncState';
import { urlField, useUrlState } from '@/lib/ds/useUrlState';
import { useUiFlag } from '@/lib/ds/uiFlags';
import { icons } from '@/lib/ds/icons';
import { neutral, radius } from '@/lib/ds/tokens';
import { useConnections } from '@/lib/hooks/useConnections';
import { prefillHref, writeListingPrefill } from '@/components/etsy/research/shared/listingPrefill';
import {
  GAP_FROM,
  PRODUCT_SOURCES,
  WEIGHT_BANDS,
  bandBounds,
  bandsForCarrier,
  confidenceTier,
  ebayPrefill,
  parseTrendyolProductId,
  pickShipping,
  rowMargin,
  sortGapRows,
  splitByConfidence,
  type GapFrom,
  type PriceGapData,
  type PriceGapRow,
  type PriceSummary,
  type ProductSource,
  type RowMargin,
  type ShippingInput,
  type WeightBand,
} from '@/lib/research/priceGap';
import type { Guarded, ResearchResponse, ResearchSectionError } from '@/lib/research/types';
import { ApiSourceNote } from './ApiSourceNote';

// ─── URL state ────────────────────────────────────────────────────────────

export const PRICE_GAP_SCHEMA = {
  source: urlField.enum(PRODUCT_SOURCES, 'search'),
  from: urlField.enum(GAP_FROM, 'category'),
  cat: urlField.string(undefined, { maxLength: 120 }),
  url: urlField.string(undefined, { maxLength: 500 }),
  carrier: urlField.string(undefined, { maxLength: 24 }),
  band: urlField.optionalEnum(WEIGHT_BANDS),
  open: urlField.string(undefined, { maxLength: 20 }),
};

/** `?source=` of the Product finder: `[source, setSource]`. Leaving `trendyol` clears the Price gap params. */
export function usePriceGapSource(): [ProductSource, (s: ProductSource) => void] {
  const [url, setUrl] = useUrlState(PRICE_GAP_SCHEMA);
  const set = React.useCallback(
    (s: ProductSource) => setUrl(s === 'trendyol' ? { source: s } : { source: s, open: undefined }),
    [setUrl],
  );
  return [url.source, set];
}

// ─── Data ─────────────────────────────────────────────────────────────────

export class PriceGapFetchError extends Error {
  constructor(readonly status: number, readonly key?: string) {
    super(`price gap request failed (${status})`);
  }
}

/** SWR key, or null when there is nothing to ask (link source without a valid link). */
export function priceGapKey(p: { from: GapFrom; cat?: string; url?: string }): string | null {
  const sp = new URLSearchParams();
  sp.set('from', p.from);
  if (p.from === 'category' && p.cat) sp.set('cat', p.cat);
  if (p.from === 'link') {
    const id = parseTrendyolProductId(p.url);
    if (!id) return null;
    sp.set('url', String(id));
  }
  return `/api/research/price-gap?${sp.toString()}`;
}

async function fetchGap(url: string): Promise<ResearchResponse<PriceGapData>> {
  // Inline: a 402 featureLocked swaps the FeatureGate region (never the global limit dialog).
  const res = await fetch(url, { credentials: 'same-origin', headers: { [LIMIT_UI_HEADER]: 'inline' } });
  if (!res.ok) {
    let key: string | undefined;
    try {
      const b = (await res.json()) as { key?: unknown };
      if (typeof b?.key === 'string') key = b.key;
    } catch {
      /* non-JSON */
    }
    throw new PriceGapFetchError(res.status, key);
  }
  return (await res.json()) as ResearchResponse<PriceGapData>;
}

// ─── Source segment ───────────────────────────────────────────────────────

export type PriceGapSourceSegmentProps = {
  value: ProductSource;
  onChange: (s: ProductSource) => void;
  size?: 'sm' | 'md';
};

/** "Source: [Search] [From Trendyol] Pro". Not rendered for accounts that may not see the Pro feature at all. */
export function PriceGapSourceSegment({ value, onChange, size = 'sm' }: PriceGapSourceSegmentProps) {
  const t = useTranslations('research');
  const action = useFeatureAction('arbitrage');
  const { data: entitlement } = useEntitlement();
  if (!action.visible) return null;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }} data-testid="price-gap-source">
      <SegmentedControl<ProductSource>
        value={value}
        onChange={onChange}
        size={size}
        aria-label={t('gap.sourceAria')}
        options={[
          { value: 'search', label: t('source.search') },
          { value: 'trendyol', label: t('source.trendyol') },
        ]}
      />
      {action.tag ? <PlanTag plan="pro" trialEndsAt={action.trialEndsAt} stripeUpsell={entitlement?.stripeUpsell} data-testid="price-gap-plan-tag" /> : null}
    </Box>
  );
}

// ─── Body ─────────────────────────────────────────────────────────────────

export type PriceGapProps = {
  /** Amazon Creators API eligibility confirmed (research.md §3.2). Without it no Amazon column is ever rendered. */
  amazonEligible?: boolean;
  /** R3 watches (`POST /api/research/watches`) are live. Without it the Watch action is not rendered. */
  canWatch?: boolean;
};

export function PriceGap(props: PriceGapProps) {
  return (
    <FeatureGate feature="arbitrage" placement="region">
      <PriceGapBody {...props} />
    </FeatureGate>
  );
}

type GapRowView = PriceGapRow & { m: RowMargin };

const CONF_TONE: Record<string, string> = { high: neutral[900], medium: neutral[700], low: neutral[500] };

const SAMPLE_KEY = { ebay: 'research.gap.guard.ebaySample', etsy: 'research.gap.guard.etsySample', amazon: 'research.gap.guard.amazonSample' } as const;

function guarded(summary: PriceSummary | null, marketplace: keyof typeof SAMPLE_KEY = 'ebay'): Guarded<number> {
  if (!summary) return { value: null, kind: 'measured', guard: { ok: false, reasonKey: 'research.gap.guard.noMatch' } };
  if (summary.quality === 'insufficient') return { value: null, kind: 'measured', guard: { ok: false, reasonKey: SAMPLE_KEY[marketplace], reasonParams: { n: summary.n, min: 5 } } };
  if (summary.quality === 'implausible') return { value: null, kind: 'measured', guard: { ok: false, reasonKey: 'research.guard.implausible' } };
  return { value: summary.median, kind: 'measured', guard: { ok: true } };
}

function PriceGapBody({ amazonEligible = false, canWatch = false }: PriceGapProps) {
  const t = useTranslations('research');
  const root = useTranslations();
  const fmt = useDsFormat();
  const router = useRouter();
  const toast = useToast();
  const mobile = useIsMobile();
  const connections = useConnections();
  const listingsOn = useUiFlag('listings-ebay');
  const editorOn = useUiFlag('editor-ebay');
  const [url, setUrl] = useUrlState(PRICE_GAP_SCHEMA);
  const [linkDraft, setLinkDraft] = React.useState(url.url ?? '');
  const [linkInvalid, setLinkInvalid] = React.useState(false);
  const [showLow, setShowLow] = React.useState(false);
  const [showUnmatched, setShowUnmatched] = React.useState(false);
  const [ownShip, setOwnShip] = React.useState<number | null>(null);

  const key = priceGapKey({ from: url.from, cat: url.cat, url: url.url });
  const swr = useSWR<ResearchResponse<PriceGapData>, PriceGapFetchError>(key, fetchGap, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    shouldRetryOnError: (e: PriceGapFetchError) => e.status >= 500,
    errorRetryCount: 1,
  });
  const region = useAsyncRegion(swr, { isEmpty: () => false, idle: 'empty' });
  const data = swr.data?.data ?? null;
  const errors: ResearchSectionError[] = swr.data?.errors ?? [];

  // Shipping: the chosen own-label median, or the number the seller typed.
  const option = React.useMemo(
    () => (data ? pickShipping(data.shipping, { carrier: url.carrier, band: url.band ?? null, defaultKg: data.defaultWeightKg }) : null),
    [data, url.carrier, url.band],
  );
  const ship: ShippingInput | null = React.useMemo(
    () =>
      ownShip !== null
        ? { usd: ownShip, kind: 'user' }
        : option && option.medianUsd !== null
          ? { usd: option.medianUsd, kind: 'measured', n: option.n, carrier: option.carrier, band: option.band }
          : null,
    [ownShip, option],
  );

  const rows: GapRowView[] = React.useMemo(() => {
    if (!data) return [];
    const withM = data.rows.map((r) => ({ ...r, m: rowMargin(r, data.fx, ship) }));
    return sortGapRows(withM, (r) => r.m.margin.value);
  }, [data, ship]);
  const split = splitByConfidence(rows);
  const visible = [...split.main, ...(showLow ? split.low : []), ...(showUnmatched ? split.none : [])];
  const open = url.open ? rows.find((r) => r.id === url.open) ?? null : null;
  const openIdx = open ? visible.findIndex((r) => r.id === open.id) : -1;

  const bandLabel = (b: WeightBand) => {
    const { min, max } = bandBounds(b);
    return max === null ? t('gap.ship.bandOpen', { min: fmt.num(min, { decimals: 1 }) }) : t('gap.ship.bandValue', { min: fmt.num(min, { decimals: 1 }), max: fmt.num(max, { decimals: 1 }) });
  };
  const carrierName = (c: string) => (c === 'fedex' ? 'FedEx' : c === 'ups' ? 'UPS' : c === 'dhl' ? 'DHL' : c === 'mng' ? 'MNG' : c === 'ptt' ? 'PTT' : c.charAt(0).toUpperCase() + c.slice(1));
  const money = (v: number | null | undefined, cur = 'USD') => (v === null || v === undefined ? null : fmt.money(v, cur));

  const listOnEbay = (r: GapRowView) => {
    if (!writeListingPrefill(ebayPrefill(r, r.m, data?.from ?? url.from))) {
      toast.error(t('toast.prefillFailed'), { persist: false });
      return;
    }
    void router.push(listingsOn && editorOn ? '/app/ebay-listings/new?prefill=session' : prefillHref('ebay'));
  };

  const watch = async (r: GapRowView) => {
    try {
      const res = await fetch('/api/research/watches', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', [LIMIT_UI_HEADER]: 'inline' },
        body: JSON.stringify({ type: 'trendyolProduct', marketplace: 'trendyol', refId: r.id, label: r.title.slice(0, 120), alertRules: { marginOver: 15 } }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t('gap.toast.watched', { title: r.title.slice(0, 40) }));
    } catch {
      toast.error(t('gap.toast.watchFailed'), { persist: false });
    }
  };

  const researchEtsyHref = (r: GapRowView) => (r.englishQuery ? `/app/research/products?mkt=etsy&q=${encodeURIComponent(r.englishQuery)}` : null);

  // ── columns ──────────────────────────────────────────────────────────────
  const columns: Column<GapRowView>[] = [
    { key: 'thumb', header: '', type: 'thumb', width: 56, value: (r) => r.imageUrl, thumbAlt: () => '', mobile: 'media' },
    {
      key: 'product',
      header: t('gap.col.product'),
      minWidth: 240,
      render: (r) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: neutral[900], overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {r.title || '—'}
          </Typography>
          {r.brand ? <Typography variant="caption" sx={{ color: neutral[600] }}>{r.brand}</Typography> : null}
        </Box>
      ),
      mobile: 'title',
    },
    { key: 'trPrice', header: t('gap.col.trPrice'), type: 'money', width: 110, value: (r) => r.trPriceTry, currency: () => 'TRY', mobile: 'subtitle' },
    {
      key: 'ebayMedian',
      header: t('gap.col.ebayMedian'),
      width: 150,
      align: 'right',
      render: (r) => {
        const g = guarded(r.ebay);
        return (
          <Box>
            <Metric value={money(g.value)} kind="measured" guard={g.guard} data-testid={`gap-ebay-${r.id}`} />
            {r.ebay ? <Typography variant="caption" component="div" sx={{ color: neutral[600] }}>{t('gap.sample', { n: r.ebay.n })}</Typography> : null}
          </Box>
        );
      },
      mobile: 'meta',
    },
    {
      key: 'etsyMedian',
      header: t('gap.col.etsyMedian'),
      width: 140,
      align: 'right',
      hideable: true,
      render: (r) => {
        const g: Guarded<number> = r.etsy ? guarded(r.etsy, 'etsy') : { value: null, kind: 'measured', guard: { ok: false, reasonKey: 'research.gap.guard.notChecked' } };
        return (
          <Box>
            <Metric value={money(g.value)} kind="measured" guard={g.guard} />
            {r.etsy ? <Typography variant="caption" component="div" sx={{ color: neutral[600] }}>{t('gap.sample', { n: r.etsy.n })}</Typography> : null}
          </Box>
        );
      },
      mobile: 'hidden',
    },
    ...(amazonEligible && rows.some((r) => r.amazon)
      ? [{
          key: 'amazonMedian',
          header: t('gap.col.amazonMedian'),
          width: 140,
          align: 'right' as const,
          hideable: true,
          render: (r: GapRowView) => {
            const g = r.amazon ? guarded(r.amazon, 'amazon') : { value: null, kind: 'measured' as const, guard: { ok: false, reasonKey: 'research.gap.guard.noMatch' } };
            return <Metric value={money(g.value)} kind="measured" guard={g.guard} />;
          },
          mobile: 'hidden' as const,
        }]
      : []),
    {
      key: 'confidence',
      header: t('gap.col.confidence'),
      width: 120,
      render: (r) => (
        <Typography variant="body2" component="span" sx={{ color: r.confidence ? CONF_TONE[r.confidence] : neutral[500] }} data-testid={`gap-conf-${r.id}`}>
          {r.confidence ? t(`gap.confidence.${r.confidence}`) : t('gap.confidence.none')}
        </Typography>
      ),
      mobile: 'meta',
    },
    {
      key: 'landed',
      header: t('gap.col.landed'),
      width: 120,
      align: 'right',
      render: (r) => <Metric value={money(r.m.landed.value)} kind="estimate" guard={r.m.landed.guard} data-testid={`gap-landed-${r.id}`} />,
      mobile: 'hidden',
    },
    {
      key: 'margin',
      header: t('gap.col.margin'),
      width: 150,
      align: 'right',
      render: (r) => (
        <Metric
          value={r.m.breakdown ? t('gap.marginValue', { amount: fmt.money(r.m.breakdown.profitUsd, 'USD'), pct: fmt.percent(r.m.breakdown.marginFraction, 0) }) : null}
          kind="estimate"
          guard={r.m.margin.guard}
          data-testid={`gap-margin-${r.id}`}
        />
      ),
      mobile: 'trailing',
    },
  ];

  const inlineAction = (r: GapRowView): ActionSpec | null =>
    r.matches.length ? { id: 'list-ebay', label: t('gap.listOnEbay'), icon: icons.add, onClick: () => listOnEbay(r) } : null;
  const rowActions = (r: GapRowView): ActionSpec[] => {
    const etsyHref = researchEtsyHref(r);
    return [
      ...(r.url ? [{ id: 'open-trendyol', label: t('gap.openOnTrendyol'), icon: icons.externalLink, onClick: () => window.open(r.url as string, '_blank', 'noopener,noreferrer') }] : []),
      ...(etsyHref ? [{ id: 'research-etsy', label: t('gap.researchEtsy'), icon: icons.research, href: etsyHref }] : []),
      ...(canWatch ? [{ id: 'watch', label: t('gap.watch'), icon: icons.notifications, onClick: () => void watch(r) }] : []),
    ];
  };

  // ── toolbar ──────────────────────────────────────────────────────────────
  const fromOptions = GAP_FROM.map((f) => ({ value: f, label: t(`gap.from.${f}`) }));
  const catOptions = (data?.categories ?? []).map((c) => ({ value: c.slug, label: fmt.locale === 'tr' ? c.labelTr : c.label, count: c.products }));
  const submitLink = () => {
    const id = parseTrendyolProductId(linkDraft);
    setLinkInvalid(!id);
    if (id) setUrl({ url: linkDraft.trim(), open: undefined });
  };
  const toolbar = (
    <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', mb: '12px' }} data-testid="price-gap-toolbar">
      <FilterButton
        label={t('gap.from.label')}
        value={url.from}
        options={fromOptions}
        required
        size={mobile ? 'md' : 'sm'}
        onChange={(v) => {
          const next = Array.isArray(v) ? v[0] : v;
          if (next && (GAP_FROM as readonly string[]).includes(next)) setUrl({ from: next as GapFrom, open: undefined });
        }}
        data-testid="price-gap-from"
      />
      {url.from === 'category' && catOptions.length ? (
        <FilterButton
          label={t('gap.category.label')}
          value={data?.category ?? url.cat}
          options={catOptions}
          required
          size={mobile ? 'md' : 'sm'}
          onChange={(v) => {
            const next = Array.isArray(v) ? v[0] : v;
            if (next) setUrl({ cat: next, open: undefined });
          }}
          data-testid="price-gap-category"
        />
      ) : null}
      {url.from === 'link' ? (
        <Box
          component="form"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            submitLink();
          }}
          sx={{ display: 'flex', gap: '8px', flex: mobile ? '1 1 100%' : '1 1 360px', maxWidth: mobile ? undefined : 560, minWidth: 0, '& input': mobile ? { fontSize: 16 } : undefined }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <TextField
              value={linkDraft}
              onChange={(v) => { setLinkDraft(v); setLinkInvalid(false); }}
              placeholder={t('gap.link.placeholder')}
              aria-label={t('gap.link.placeholder')}
              invalid={linkInvalid}
              data-testid="price-gap-link"
            />
          </Box>
          <Button variant="secondary" size={mobile ? 'md' : 'sm'} type="submit" data-testid="price-gap-link-submit">{t('gap.link.cta')}</Button>
        </Box>
      ) : null}
    </Box>
  );

  // ── assumptions strip (FX + shipping) ───────────────────────────────────
  const carriers = Array.from(new Set((data?.shipping ?? []).map((o) => o.carrier)));
  // Bands of the chosen carrier (URL first, then the picked option): never another carrier's bands.
  const bands = bandsForCarrier(data?.shipping ?? [], url.carrier && carriers.includes(url.carrier) ? url.carrier : option?.carrier);
  const assumptions = data ? (
    <Box
      sx={{ border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px`, p: '12px', mb: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}
      data-testid="price-gap-assumptions"
    >
      <Typography variant="body2" sx={{ color: neutral[700] }} data-testid="price-gap-fx">
        {data.fx.usdPerTry
          ? t('gap.fx', { rate: fmt.num(1 / data.fx.usdPerTry, { decimals: 2 }), date: fmt.date(data.fx.fetchedAt) })
          : t('gap.fxMissing')}
      </Typography>
      <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="body2" component="span" sx={{ color: neutral[700] }}>{t('gap.ship.label')}</Typography>
        {carriers.length ? (
          <>
            <FilterButton
              label={t('gap.ship.carrier')}
              value={option?.carrier}
              options={carriers.map((c) => ({ value: c, label: carrierName(c) }))}
              required
              size={mobile ? 'md' : 'sm'}
              disabled={ownShip !== null}
              onChange={(v) => { const c = Array.isArray(v) ? v[0] : v; if (c) setUrl({ carrier: c, band: undefined }); }}
              data-testid="price-gap-carrier"
            />
            <FilterButton
              label={t('gap.ship.band')}
              value={option?.band}
              options={bands.map((b) => ({ value: b, label: bandLabel(b) }))}
              required
              size={mobile ? 'md' : 'sm'}
              disabled={ownShip !== null}
              onChange={(v) => { const b = Array.isArray(v) ? v[0] : v; if (b && (WEIGHT_BANDS as readonly string[]).includes(b)) setUrl({ band: b as WeightBand }); }}
              data-testid="price-gap-band"
            />
          </>
        ) : null}
        {ownShip === null ? (
          option && option.medianUsd !== null ? (
            <Metric
              value={t('gap.ship.measured', { amount: fmt.money(option.medianUsd, 'USD'), count: option.n })}
              kind="measured"
              tooltip={t('gap.ship.measuredTip')}
              data-testid="price-gap-ship"
            />
          ) : (
            <Typography variant="body2" component="span" sx={{ color: neutral[600] }} data-testid="price-gap-ship-none">
              {t('gap.ship.none', { min: 5 })}
            </Typography>
          )
        ) : null}
        <Box sx={{ width: mobile ? '100%' : 180 }}>
          <MoneyField
            value={ownShip}
            onChange={setOwnShip}
            currency="USD"
            size={mobile ? 'md' : 'sm'}
            placeholder={t('gap.ship.own')}
            aria-label={t('gap.ship.own')}
            data-testid="price-gap-own-ship"
          />
        </Box>
      </Box>
      {data.shippingExcluded > 0 ? (
        <Typography variant="caption" sx={{ color: neutral[600] }}>{t('gap.ship.excluded', { count: data.shippingExcluded })}</Typography>
      ) : null}
      {data.shippingExcludedDefaultWeight > 0 ? (
        <Typography variant="caption" sx={{ color: neutral[600] }} data-testid="price-gap-ship-default-weight">
          {t('gap.ship.excludedDefaultWeight', { count: data.shippingExcludedDefaultWeight })}
        </Typography>
      ) : null}
    </Box>
  ) : null;

  // ── body ────────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (url.from === 'link' && !key) {
    body = <EmptyState kind="first-use" icon={icons.research} title={t('gap.empty.link')} data-testid="price-gap-empty-link" />;
  } else if (region.state === 'loading') {
    body = <TableSkeleton rows={6} thumb columns={6} data-testid="price-gap-skeleton" />;
  } else if (region.state === 'slow') {
    body = (
      <>
        <SlowState variant="inline" onRetry={region.retry} />
        <TableSkeleton rows={6} thumb columns={6} />
      </>
    );
  } else if (region.state === 'error' || !data) {
    const e = swr.error;
    const cause = e?.key && root.has(e.key) ? root(e.key) : undefined;
    body = <ErrorState variant="inline" title={t('gap.error.generic')} cause={cause} onRetry={region.retry} data-testid="price-gap-error" />;
  } else if (url.from === 'mine' && !data.rows.length) {
    body = connections.has('trendyol') ? (
      <EmptyState
        kind="no-results"
        icon={icons.research}
        title={data.unresolved > 0 ? t('gap.empty.mineUnresolved', { count: data.unresolved }) : t('gap.empty.mineNone')}
        data-testid="price-gap-empty-mine"
      />
    ) : (
      <ConnectState brand="trendyol" title={t('gap.connect')} connectHref="/ayarlar?tab=connections" data-testid="price-gap-connect" />
    );
  } else if (url.from === 'category' && !data.categories.length) {
    body = <EmptyState kind="no-results" icon={icons.research} title={t('gap.empty.noCategories')} data-testid="price-gap-empty-index" />;
  } else {
    const notIndexed = url.from === 'link' && errors.some((e) => e.key === 'research.gap.error.notIndexed');
    const emptyTitle = notIndexed
      ? t('gap.error.notIndexed')
      : url.from === 'mine'
        ? t('gap.empty.mine')
        : url.from === 'link'
          ? t('gap.empty.linkNoMatch')
          : t('gap.empty.noMatches');
    const sectionNotes = errors
      .filter((e) => (e.section === 'source' || e.section === 'shipping') && !(notIndexed && e.key === 'research.gap.error.notIndexed'))
      .map((e) => (root.has(e.key) ? root(e.key, e.params ?? {}) : null))
      .filter((s): s is string => Boolean(s));
    body = (
      <>
        {region.state === 'stale' ? (
          <Box sx={{ mb: '12px' }}>
            <ErrorState variant="stale" staleSince={new Date(swr.data?.source.fetchedAt ?? Date.now())} onRetry={region.retry} />
          </Box>
        ) : null}
        {sectionNotes.map((n) => (
          <Box key={n} sx={{ mb: '12px' }}><Banner tone="info" title={n} /></Box>
        ))}
        {assumptions}
        <DataTable
          rows={visible}
          columns={columns}
          getRowId={(r) => r.id}
          state={visible.length ? 'ready' : 'empty'}
          empty={
            <EmptyState
              kind="no-results"
              compact
              title={emptyTitle}
              data-testid="price-gap-empty-rows"
            />
          }
          onRowOpen={(r) => setUrl({ open: r.id })}
          activeRowId={open?.id ?? null}
          inlineAction={inlineAction}
          rowActions={rowActions}
          columnStateKey="kx.research.gap"
          ariaLabel={t('gap.title')}
          data-testid="price-gap-table"
        />
        <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mt: '8px' }}>
          {split.low.length ? (
            <Button variant="ghost" size="sm" onClick={() => setShowLow((v) => !v)} data-testid="price-gap-toggle-low">
              {showLow ? t('gap.hideLowConfidence') : t('gap.lowConfidence', { count: split.low.length })}
            </Button>
          ) : null}
          {split.none.length ? (
            <Button variant="ghost" size="sm" onClick={() => setShowUnmatched((v) => !v)} data-testid="price-gap-toggle-unmatched">
              {showUnmatched ? t('gap.hideUnmatched') : t('gap.showUnmatched', { count: split.none.length })}
            </Button>
          ) : null}
        </Box>
        {url.from === 'category' && data.unmatched > 0 ? (
          <Typography variant="caption" component="p" sx={{ color: neutral[600], mt: '8px', mb: 0 }} data-testid="price-gap-unmatched">
            {t('gap.unmatched', { count: data.unmatched })}
          </Typography>
        ) : null}
        {url.from === 'mine' && data.unresolved > 0 ? (
          <Typography variant="caption" component="p" sx={{ color: neutral[600], mt: '8px', mb: 0 }} data-testid="price-gap-unresolved">
            {t('gap.unresolved', { count: data.unresolved })}
          </Typography>
        ) : null}
        <Box sx={{ mt: '8px' }}>
          <ApiSourceNote source={swr.data?.source} data-testid="price-gap-source-note" />
        </Box>
      </>
    );
  }

  return (
    <Box data-testid="price-gap">
      {toolbar}
      {body}
      <PriceGapPanel
        row={open}
        data={data}
        ship={ship}
        onClose={() => setUrl({ open: undefined })}
        onListOnEbay={listOnEbay}
        onWatch={canWatch ? (r) => void watch(r) : undefined}
        etsyHref={open ? researchEtsyHref(open) : null}
        onPrev={openIdx > 0 ? () => setUrl({ open: visible[openIdx - 1].id }) : undefined}
        onNext={openIdx >= 0 && openIdx < visible.length - 1 ? () => setUrl({ open: visible[openIdx + 1].id }) : undefined}
      />
    </Box>
  );
}

// ─── Row panel: MarginBox + matches ───────────────────────────────────────

type PriceGapPanelProps = {
  row: GapRowView | null;
  data: PriceGapData | null;
  ship: ShippingInput | null;
  onClose: () => void;
  onListOnEbay: (r: GapRowView) => void;
  onWatch?: (r: GapRowView) => void;
  etsyHref: string | null;
  onPrev?: () => void;
  onNext?: () => void;
};

function PriceGapPanel({ row, data, ship, onClose, onListOnEbay, onWatch, etsyHref, onPrev, onNext }: PriceGapPanelProps) {
  const t = useTranslations('research');
  const fmt = useDsFormat();
  const b = row?.m.breakdown ?? null;
  const usdPerTry = data?.fx.usdPerTry ?? null;

  const marginItems = row
    ? [
        {
          label: t('gap.panel.cost'),
          value:
            row.trPriceTry !== null && usdPerTry
              ? t('gap.panel.costValue', { try: fmt.money(row.trPriceTry, 'TRY'), usd: fmt.money(row.trPriceTry * usdPerTry, 'USD', { approx: true }) })
              : row.trPriceTry !== null
                ? fmt.money(row.trPriceTry, 'TRY')
                : '—',
        },
        {
          label: t('gap.panel.shipping'),
          value: ship && ship.usd !== null ? (
            <Metric
              value={fmt.money(ship.usd, 'USD')}
              kind={ship.kind}
              tooltip={ship.kind === 'measured' && ship.n ? t('gap.panel.shipMeasured', { count: ship.n }) : undefined}
            />
          ) : (
            <Metric value={null} kind="measured" guard={{ ok: false, reasonKey: 'research.gap.guard.noShipping', reasonParams: { min: 5 } }} />
          ),
        },
        { label: t('gap.panel.landed'), value: <Metric value={row.m.landed.value !== null ? fmt.money(row.m.landed.value, 'USD') : null} kind="estimate" guard={row.m.landed.guard} /> },
        { label: t('gap.panel.sell'), value: <Metric value={b ? fmt.money(b.sellUsd, 'USD') : null} kind="measured" guard={guarded(row.ebay).guard} /> },
        {
          label: t('gap.panel.fees'),
          value: b ? <Metric value={t('gap.panel.feesValue', { rate: fmt.num(b.feeRatePct, { decimals: 2 }), amount: fmt.money(b.feesUsd, 'USD') })} kind="estimate" tooltip={t('gap.panel.feeNote')} /> : '—',
        },
        {
          label: t('gap.panel.profit'),
          value: (
            <Metric
              value={b ? t('gap.marginValue', { amount: fmt.money(b.profitUsd, 'USD'), pct: fmt.percent(b.marginFraction, 0) }) : null}
              kind="estimate"
              guard={row.m.margin.guard}
              data-testid="price-gap-panel-margin"
            />
          ),
        },
      ]
    : [];

  return (
    <SidePanel
      open={Boolean(row)}
      onClose={onClose}
      size="md"
      title={row?.title || '—'}
      leading={row ? <Thumb src={row.imageUrl} alt="" size={40} /> : undefined}
      meta={row ? [row.brand, row.category.name, row.confidence ? t(`gap.confidence.${row.confidence}`) : null].filter(Boolean).join(' · ') : undefined}
      onPrev={onPrev}
      onNext={onNext}
      primary={row && row.matches.length ? { id: 'list-ebay', label: t('gap.listOnEbay'), icon: icons.add, onClick: () => onListOnEbay(row) } : undefined}
      secondary={row?.url ? { id: 'open-trendyol', label: t('gap.openOnTrendyol'), icon: icons.externalLink, onClick: () => window.open(row.url as string, '_blank', 'noopener,noreferrer') } : undefined}
      overflow={row && onWatch ? [{ id: 'watch', label: t('gap.watch'), icon: icons.notifications, onClick: () => onWatch(row) }] : undefined}
      data-testid="price-gap-panel"
    >
      {row ? (
        <>
          <SidePanelSection id="price-gap-margin" title={t('gap.panel.margin')}>
            <KeyValueList items={marginItems} data-testid="price-gap-marginbox" />
            <Typography variant="caption" component="p" sx={{ color: neutral[600], mt: '8px', mb: 0 }}>{t('gap.panel.feeNote')}</Typography>
          </SidePanelSection>
          <SidePanelSection id="price-gap-matches" title={t('gap.panel.matches', { count: row.matches.length })}>
            {row.matches.length ? (
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {row.matches.map((mt) => (
                  <Box component="li" key={mt.itemId} sx={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <Thumb src={mt.imageUrl} alt="" size={40} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      {mt.url ? (
                        <Typography component="a" href={mt.url} target="_blank" rel="noopener noreferrer" variant="body2" sx={{ color: neutral[900], display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {mt.title}
                        </Typography>
                      ) : (
                        <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mt.title}</Typography>
                      )}
                      <Typography variant="caption" sx={{ color: neutral[600] }}>
                        {[
                          fmt.money(mt.price, mt.currency),
                          t(`gap.confidence.${confidenceTier(mt.confidence, mt.matchType)}`),
                          mt.soldAllTime !== null ? t('gap.panel.sold', { count: fmt.num(mt.soldAllTime) }) : null,
                        ].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" sx={{ color: neutral[600] }}>{t('gap.guard.noMatch')}</Typography>
            )}
          </SidePanelSection>
          <SidePanelSection id="price-gap-etsy" title={t('gap.panel.etsy')}>
            {row.etsy && row.etsy.median !== null && row.etsy.quality !== 'insufficient' && row.etsy.quality !== 'implausible' ? (
              <Typography variant="body2">
                {t('gap.panel.etsyValue', { median: fmt.money(row.etsy.median, 'USD'), n: row.etsy.n, date: fmt.date(row.etsy.fetchedAt) })}
              </Typography>
            ) : (
              <Typography variant="body2" sx={{ color: neutral[600] }}>{t('gap.panel.etsyNot')}</Typography>
            )}
            {etsyHref ? (
              <Box sx={{ mt: '8px' }}>
                <Button variant="ghost" size="sm" icon={icons.research} href={etsyHref} data-testid="price-gap-research-etsy">{t('gap.researchEtsy')}</Button>
              </Box>
            ) : null}
          </SidePanelSection>
        </>
      ) : null}
    </SidePanel>
  );
}

export default PriceGap;
