// Product finder `/app/research/products` (research.md §5): "What should I make or sell next, and at what price?"
// Primary: "Draft a listing" once results exist (prefill → creator, nothing published); before that the search's
// "Research" button is the primary. Every number is a Metric with its kind, every card has a SourceNote, prices are
// the robust median / p25–p75 from lib/research/stats (no mean anywhere).
//
// URL (useUrlState): `?q=&mkt=&country=US&compare=q1|q2|q3&sort=` (`mkt` is the layout's). Searches run on Enter
// or the button (each search costs Etsy calls), never per keystroke. Turkish input offers "Translate to English
// keywords · 1 credit" (§3.3); the seeds become removable chips. Nothing here writes to a marketplace: "Use $49"
// and "Add 5 tags" stage drafts; "Draft a listing" writes a session prefill.
import * as React from 'react';
import { useRouter } from 'next/router';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { StickyActionBar, type ActionSpec } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { SearchField } from '@/components/ds/toolbar/SearchField';
import { FilterButton } from '@/components/ds/toolbar/FilterButton';
import { Button } from '@/components/ds/inputs/Button';
import { TextField } from '@/components/ds/inputs/TextField';
import { FormField } from '@/components/ds/inputs/FormField';
import { Modal } from '@/components/ds/overlay/Modal';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { Bone, TableSkeleton } from '@/components/ds/state/Skeletons';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import { urlField, useUrlState } from '@/lib/ds/useUrlState';
import { useUiFlag } from '@/lib/ds/uiFlags';
import { copyText } from '@/lib/hooks/useCopy';
import { broaderPhrase, isLikelyTurkish } from '@/lib/research/detectQuery';
import type { ProductsResult, ResearchMkt, TopListing } from '@/lib/research/types';
import {
  PRODUCT_SORTS,
  ResearchFetchError,
  requestSeeds,
  useResearchCompare,
  useResearchProducts,
  type ProductSort,
} from '@/lib/research/hooks/useResearchProducts';
import { contentWords } from '@/lib/etsy/seoRules';
import { exportToCSV } from '@/components/etsy/research/shared/exportUtils';
import { prefillHref, writeListingPrefill } from '@/components/etsy/research/shared/listingPrefill';
import { MKT_NAME, ResearchLayout, useResearchMkt } from '../ResearchLayout';
import { QuestionChips } from '../home/QuestionChips';
import { rememberSearch } from '../home/recentSearches';
import { routeResearchSearch, type QuestionKey } from '../home/routeSearch';
import { ApiSourceNote } from './ApiSourceNote';
import { EvidenceCard } from './EvidenceCard';
import { PriceCard } from './PriceCard';
import { CompetitionCard } from './CompetitionCard';
import { DemandCard } from './DemandCard';
import { NewcomersCard } from './NewcomersCard';
import { BuyerWordsCard } from './BuyerWordsCard';
import { TopListingsTable } from './TopListingsTable';
import { TopListingPanel } from './TopListingPanel';
import { ComparePanel } from './ComparePanel';
import { SeedChips } from './SeedChips';
import { StageToListingModal, type StageMode } from './StageToListingModal';

export const COUNTRIES = ['US', 'GB', 'DE', 'CA', 'AU', 'FR'] as const;
export const COMPARE_MAX = 3;

export const PRODUCTS_SCHEMA = {
  q: urlField.string(undefined, { maxLength: 200 }),
  country: urlField.enum(COUNTRIES, 'US'),
  compare: urlField.string(undefined, { maxLength: 640 }),
  sort: urlField.enum(PRODUCT_SORTS, 'relevance'),
  /** Set by the search router for a pasted Etsy listing / eBay item link (detectQuery.routeForQuery). */
  compareListing: urlField.string(undefined, { maxLength: 40 }),
  compareItem: urlField.string(undefined, { maxLength: 40 }),
};

/** Pure: `q1|q2|q3` → unique trimmed queries (≤ 3). */
export function parseCompare(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(new Set(raw.split('|').map((s) => s.trim()).filter(Boolean))).slice(0, COMPARE_MAX);
}

export function serializeCompare(list: string[]): string | undefined {
  const l = Array.from(new Set(list.map((s) => s.trim()).filter(Boolean))).slice(0, COMPARE_MAX);
  return l.length >= 2 ? l.join('|') : undefined;
}

/** Pure: the prefill payload for "Draft a listing" (research.md §5.1). Title is left to the creator's AI. */
export function draftPrefill(r: ProductsResult, shopCurrency: string | null) {
  const target: 'etsy' | 'ebay' = r.mkt === 'ebay' ? 'ebay' : 'etsy';
  const median = r.price.quality === 'ok' ? r.price.median : null;
  return {
    target,
    source: target === 'ebay' ? ('ebay-research' as const) : ('etsy-research' as const),
    title: undefined,
    tags: target === 'etsy' ? r.draftTags.slice(0, 13) : [],
    keywords: [r.query],
    // Median only when it is in the shop's currency (never a converted or mixed-currency number).
    price: median !== null && shopCurrency && shopCurrency.toUpperCase() === r.price.currency.toUpperCase() ? median : undefined,
    currency: median !== null && shopCurrency && shopCurrency.toUpperCase() === r.price.currency.toUpperCase() ? r.price.currency : undefined,
    categoryHint: r.categoryHint ?? undefined,
    research: { query: r.query, priceSummary: r.price, fetchedAt: r.fetchedAt, from: 'research-hub' },
  };
}

/** Pure: prefill for "Use this listing as a starting point": its tags + title words, never its title. */
export function startFromPrefill(row: TopListing, r: ProductsResult) {
  const target: 'etsy' | 'ebay' = r.mkt === 'ebay' ? 'ebay' : 'etsy';
  return {
    target,
    source: target === 'ebay' ? ('ebay-research' as const) : ('etsy-research' as const),
    title: undefined,
    tags: target === 'etsy' ? row.tags.filter((tag) => tag.length <= 20).slice(0, 13) : [],
    keywords: [r.query, ...contentWords(row.title).slice(0, 12)],
    categoryHint: r.categoryHint ?? undefined,
    research: { query: r.query, basedOn: { id: row.id, url: row.url }, priceSummary: r.price, fetchedAt: r.fetchedAt, from: 'research-hub' },
  };
}

/**
 * Pure: where the research prefill (`kx:listingPrefill`, ?prefill=session) is read. The M6 editor route
 * (§3.4 `/app/{mkt}-listings/new?prefill=session`) while its flag is on; otherwise the listings route, which keeps
 * serving the legacy page (and its creator) for `?prefill=session` even with the `listings-*` flag on
 * (lib/listings/legacyHandoff.ts). `listingsOn` is kept for callers; the hand-off no longer depends on it.
 */
export function prefillRoute(target: 'etsy' | 'ebay', flags: { listingsOn: boolean; editorOn: boolean }): string {
  return flags.listingsOn && flags.editorOn ? `/app/${target}-listings/new?prefill=session` : prefillHref(target);
}

async function fetchShopCurrency(mkt: 'etsy' | 'ebay'): Promise<string | null> {
  try {
    const res = await fetch(`/api/listings?marketplace=${mkt}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = (await res.json()) as { store?: { currency?: string | null } };
    return body.store?.currency ?? null;
  } catch {
    return null;
  }
}

function errorCause(t: (k: string) => string, root: { has: (k: string) => boolean; (k: string): string }, e: ResearchFetchError | undefined, mkt: ResearchMkt): string {
  if (e?.key && root.has(e.key)) return root(e.key);
  return mkt === 'ebay' ? t('error.ebay') : t('error.etsy');
}

function CardsSkeleton() {
  return (
    <Box data-testid="research-products-skeleton">
      <Box sx={{ mb: '16px' }}><Bone w="100%" h={96} /></Box>
      <Box sx={{ display: 'grid', gap: '16px', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, mb: '24px' }}>
        {[0, 1, 2, 3].map((i) => <Bone key={i} w="100%" h={140} />)}
      </Box>
      <TableSkeleton rows={6} thumb />
    </Box>
  );
}

export type ProductFinderProps = {
  /** Amazon Creators API eligibility (no source in v1). */
  amazonEligible?: boolean;
};

export function ProductFinder({ amazonEligible = false }: ProductFinderProps = {}) {
  const t = useTranslations('research');
  const root = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const mobile = useIsMobile();
  const market = useResearchMkt('products', { amazonEligible });
  const { mkt } = market;
  const [url, setUrl] = useUrlState(PRODUCTS_SCHEMA);
  const q = url.q?.trim() ?? '';
  const compareList = parseCompare(url.compare);
  const comparing = compareList.length >= 2;
  const amazonBlocked = mkt === 'amazon' && !amazonEligible;

  const [draft, setDraft] = React.useState(q);
  React.useEffect(() => setDraft(q), [q]);
  const [seeds, setSeeds] = React.useState<{ from: string; seeds: string[] } | null>(null);
  const [translating, setTranslating] = React.useState(false);
  const [translateNote, setTranslateNote] = React.useState<'failed' | 'noCredits' | null>(null);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [compareDraft, setCompareDraft] = React.useState('');
  const [stageMode, setStageMode] = React.useState<StageMode | null>(null);
  const [openRow, setOpenRow] = React.useState<TopListing | null>(null);
  const [hint, setHint] = React.useState<QuestionKey | null>(null);
  const listingsFlags = {
    etsy: { listingsOn: useUiFlag('listings-etsy'), editorOn: useUiFlag('editor-etsy') },
    ebay: { listingsOn: useUiFlag('listings-ebay'), editorOn: useUiFlag('editor-ebay') },
  };

  const params = !comparing && q && !amazonBlocked ? { q, mkt, country: url.country, sort: url.sort as ProductSort } : null;
  const result = useResearchProducts(params);
  const compare = useResearchCompare(comparing && !amazonBlocked ? compareList : [], { mkt, country: url.country });
  const data = result.data;
  const ready = Boolean(data) && (result.region.state === 'ready' || result.region.state === 'stale');

  // `#price` from the "What price should I charge?" chip: scroll once the card exists.
  React.useEffect(() => {
    if (!ready || typeof window === 'undefined' || window.location.hash !== '#price') return;
    document.getElementById('price')?.scrollIntoView({ block: 'start' });
  }, [ready]);

  const search = (text: string) => {
    const v = text.trim();
    if (!v) return;
    if (v !== q) setSeeds(null);
    rememberSearch({ q: v, tool: 'products', mkt });
    setUrl({ q: v, compare: undefined });
  };

  const onSearchSubmit = async (text: string) => {
    const v = text.trim();
    if (!v) return;
    // A pasted link (Etsy shop, eBay seller, own listing…) may belong to another tool (§4.3).
    if (/^(https?:\/\/|www\.)|\.(com|co\.uk|de|com\.tr)\//i.test(v)) {
      const href = await routeResearchSearch(v, { mkt });
      if (!href.startsWith('/app/research/products')) {
        void router.push(href);
        return;
      }
      const nextQ = new URLSearchParams(href.split('?')[1] ?? '').get('q');
      if (nextQ) return search(nextQ);
    }
    search(v);
  };

  const translate = async () => {
    const from = draft.trim() || q;
    if (!from) return;
    setTranslating(true);
    setTranslateNote(null);
    try {
      const list = await requestSeeds(from, mkt);
      if (!list.length) {
        setTranslateNote('failed');
        return;
      }
      setSeeds({ from, seeds: list });
      rememberSearch({ q: list[0], tool: 'products', mkt });
      setUrl({ q: list[0], compare: undefined });
    } catch (e) {
      setTranslateNote(e instanceof ResearchFetchError && e.status === 402 ? 'noCredits' : 'failed');
    } finally {
      setTranslating(false);
    }
  };

  const showTranslate = !seeds && mkt !== 'trendyol' && isLikelyTurkish(draft || q, locale);

  const addCompare = () => {
    const v = compareDraft.trim();
    if (!v) return;
    const base = comparing ? compareList : q ? [q] : [];
    setUrl({ compare: serializeCompare([...base, v]) });
    setCompareDraft('');
    setCompareOpen(false);
  };
  const removeCompare = (query: string) => {
    const rest = compareList.filter((x) => x !== query);
    setUrl(rest.length >= 2 ? { compare: serializeCompare(rest) } : { compare: undefined, q: rest[0] ?? q });
  };

  const draftTarget: 'etsy' | 'ebay' = data?.mkt === 'ebay' ? 'ebay' : 'etsy';
  const draftHref = prefillRoute(draftTarget, listingsFlags[draftTarget]);

  const draftListing = async () => {
    if (!data) return;
    const currency = await fetchShopCurrency(draftTarget);
    const ok = writeListingPrefill(draftPrefill(data, currency));
    if (!ok) {
      toast.error(t('toast.prefillFailed'), { persist: false });
      return;
    }
    void router.push(draftHref);
  };

  const startFrom = (row: TopListing) => {
    if (!data) return;
    const p = startFromPrefill(row, data);
    const href = prefillRoute(p.target, listingsFlags[p.target]);
    if (!writeListingPrefill(p)) {
      toast.error(t('toast.prefillFailed'), { persist: false });
      return;
    }
    void router.push(href);
  };

  const exportCsv = () => {
    if (!data?.top.length) return;
    exportToCSV(
      data.top.map((r) => ({
        title: r.title,
        price: r.price?.amount ?? '',
        currency: r.price?.currency ?? '',
        favorites_all_time: r.favorites ?? '',
        age_days: r.ageDays ?? '',
        shop: r.shop.name ?? '',
        tags: r.tags,
        url: r.url ?? '',
      })),
      `research-${data.query.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'results'}`,
    );
  };

  const copyLink = async () => {
    const ok = await copyText(window.location.href);
    if (ok) toast.success(t('toast.linkCopied'));
  };

  const stageMkt: 'etsy' | 'ebay' | null = mkt === 'etsy' || mkt === 'ebay' ? mkt : null;
  const sharesOf = (words: ProductsResult['buyerWords']) => Object.fromEntries(words.map((w) => [w.tag.toLowerCase(), w.share]));

  // ── header actions ─────────────────────────────────────────────────────────────────────────────────
  const primaryAction: ActionSpec | undefined =
    ready && data && !comparing
      ? {
          id: 'draft',
          label: t('action.draftListing'),
          icon: icons.add,
          onClick: () => void draftListing(),
        }
      : undefined;
  const overflowActions: ActionSpec[] =
    ready && data && !comparing
      ? [
          { id: 'export', label: t('action.export'), icon: icons.download, onClick: exportCsv, disabled: !data.top.length, disabledReason: data.top.length ? undefined : t('empty.products') },
          { id: 'copy', label: t('action.copyLink'), icon: icons.copy, onClick: () => void copyLink() },
        ]
      : [{ id: 'copy', label: t('action.copyLink'), icon: icons.copy, onClick: () => void copyLink() }];

  // ── toolbar ────────────────────────────────────────────────────────────────────────────────────────
  const countryOptions = COUNTRIES.map((c) => ({ value: c, label: c }));
  const searchPrimary = !ready || comparing;
  const toolbar = (
    <Box sx={{ mb: '12px' }}>
      <Box
        component="form"
        role="search"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          void onSearchSubmit(draft);
        }}
        sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}
      >
        <Box sx={{ flex: mobile ? '1 1 100%' : '1 1 360px', minWidth: 0, maxWidth: mobile ? undefined : 560, '& input': mobile ? { fontSize: 16 } : undefined }}>
          <SearchField
            value={draft}
            onChange={setDraft}
            onSubmit={(v) => void onSearchSubmit(v)}
            debounceMs={0}
            size="md"
            fullWidth
            placeholder={hint ? t(`qHint.${hint}`) : t('search.placeholderProducts')}
            ariaLabel={t('search.placeholderProducts')}
            data-testid="research-products-search"
          />
        </Box>
        <FilterButton
          label={t('toolbar.country')}
          value={url.country}
          options={countryOptions}
          required
          size={mobile ? 'md' : 'sm'}
          onChange={(v) => {
            const next = Array.isArray(v) ? v[0] : v;
            if (next && (COUNTRIES as readonly string[]).includes(next)) setUrl({ country: next as (typeof COUNTRIES)[number] });
          }}
          data-testid="research-country"
        />
        <Button
          variant="secondary"
          size={mobile ? 'md' : 'sm'}
          icon={icons.add}
          onClick={() => setCompareOpen(true)}
          disabled={(!q && !comparing) || compareList.length >= COMPARE_MAX}
          disabledReason={compareList.length >= COMPARE_MAX ? t('compare.max', { max: COMPARE_MAX }) : t('compare.needQuery')}
          data-testid="research-compare-add"
        >
          {t('action.compare')}
        </Button>
        <Button
          variant={searchPrimary ? 'primary' : 'secondary'}
          size={mobile ? 'md' : 'sm'}
          type="submit"
          loading={result.region.state === 'loading' && Boolean(params)}
          loadingLabel={t('search.loading')}
          data-testid="research-products-submit"
        >
          {t('search.cta')}
        </Button>
      </Box>
      {showTranslate ? (
        <Box sx={{ mt: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Button variant="ghost" size="sm" icon={icons.ai} onClick={() => void translate()} loading={translating} data-testid="research-translate">
            {t('translate.cta')}
          </Button>
          {translateNote ? (
            <Typography variant="caption" sx={{ color: neutral[600] }} role="status">
              {translateNote === 'noCredits' ? t('explain.noCredits') : t('translate.failed')}
            </Typography>
          ) : null}
        </Box>
      ) : null}
      {seeds ? (
        <Box sx={{ mt: '8px' }}>
          <SeedChips
            from={seeds.from}
            seeds={seeds.seeds}
            active={q}
            onPick={(s) => setUrl({ q: s, compare: undefined })}
            onRemove={(s) => {
              const rest = seeds.seeds.filter((x) => x !== s);
              setSeeds(rest.length ? { ...seeds, seeds: rest } : null);
              if (s === q && rest[0]) setUrl({ q: rest[0] });
            }}
          />
        </Box>
      ) : null}
    </Box>
  );

  // ── body ───────────────────────────────────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (amazonBlocked) {
    body = (
      <EmptyState
        kind="locked"
        icon={icons.research}
        title={t('mkt.amazonIneligible')}
        action={{ id: 'learn', label: t('mkt.learnHow'), href: '/app/amazon-research' }}
        data-testid="research-amazon-ineligible"
      />
    );
  } else if (comparing) {
    body = <ComparePanel entries={compare.entries} region={compare.region} source={compare.source} onRemove={removeCompare} />;
  } else if (!q) {
    body = (
      <EmptyState
        kind="first-use"
        icon={icons.research}
        // A pasted listing link with no readable title lands here: say why instead of the generic first-use text.
        title={url.compareListing || url.compareItem ? t('empty.linkNoTitle') : t('empty.products')}
        data-testid="research-products-empty"
      >
        <Box sx={{ mt: '12px' }}>
          <QuestionChips
            onPick={(k) => {
              if (draft.trim()) {
                void routeResearchSearch(draft, { mkt, question: k }).then((href) => router.push(href));
                return;
              }
              setHint(k);
              document.querySelector<HTMLInputElement>('[data-testid="research-products-search"] input')?.focus();
            }}
          />
        </Box>
      </EmptyState>
    );
  } else if (result.notice) {
    // Marketplace not served yet / budget with nothing cached: an info state, never an error page (§3.2).
    const n = result.notice;
    body = (
      <EmptyState
        kind="no-results"
        icon={icons.research}
        title={
          root.has(n.key)
            ? root(n.key, n.params ?? {})
            : n.key === 'research.error.budget'
              ? t('error.budget')
              : t('empty.notServed', { marketplace: MKT_NAME[mkt] })
        }
        data-testid="research-products-notice"
      />
    );
  } else if (result.region.state === 'loading') {
    body = <CardsSkeleton />;
  } else if (result.region.state === 'slow') {
    body = (
      <>
        <SlowState variant="inline" onRetry={result.region.retry} />
        <CardsSkeleton />
      </>
    );
  } else if (result.region.state === 'error') {
    body = <ErrorState variant="inline" title={t('error.generic')} cause={errorCause(t, root, result.error, mkt)} onRetry={result.region.retry} data-testid="research-products-error" />;
  } else if (result.region.state === 'empty' || !data) {
    const broader = broaderPhrase(q);
    body = (
      <EmptyState
        kind="no-results"
        title={t('empty.noResults', { marketplace: MKT_NAME[mkt], q })}
        action={broader ? { id: 'broader', label: t('empty.broader'), onClick: () => search(broader) } : undefined}
        data-testid="research-products-noresults"
      />
    );
  } else {
    const r = data;
    const sectionErr = (section: string) => result.errors.find((e) => e.section === section && e.key !== 'research.error.budget');
    const errNote = (section: string) => {
      const e = sectionErr(section);
      return e && root.has(e.key) ? root(e.key, e.params ?? {}) : null;
    };
    body = (
      <>
        {result.region.state === 'stale' ? (
          <Box sx={{ mb: '12px' }}>
            <ErrorState variant="stale" staleSince={new Date(r.fetchedAt)} onRetry={result.region.retry} />
          </Box>
        ) : null}
        <Box sx={{ mb: '12px' }}>
          <ApiSourceNote source={result.source} data-testid="research-products-source" />
        </Box>
        <EvidenceCard result={r} />
        <Box
          sx={{ display: 'grid', gap: '16px', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, mb: '24px' }}
          data-testid="research-cards"
        >
          <PriceCard price={r.price} onUsePrice={stageMkt ? (amount, currency) => setStageMode({ kind: 'price', amount, currency }) : undefined} />
          <CompetitionCard
            total={r.competition.total}
            top5Share={r.competition.top5Share}
            activeOnly={mkt === 'ebay'}
            onSeeTopShops={() => document.getElementById('research-top-title')?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
          />
          <DemandCard demand={r.demand} />
          <NewcomersCard newcomers={r.newcomers} />
        </Box>
        {['price', 'competition', 'demand', 'newcomers'].map((s) => {
          const note = errNote(s);
          return note ? (
            <Typography key={s} variant="caption" component="p" sx={{ mt: '-16px', mb: '16px', color: neutral[600] }}>
              {note}
            </Typography>
          ) : null;
        })}
        {mkt === 'etsy' && r.buyerWords.length ? (
          <BuyerWordsCard
            words={r.buyerWords}
            onAddTags={(tags) => setStageMode({ kind: 'tags', tags, shares: sharesOf(r.buyerWords) })}
          />
        ) : null}
        <TopListingsTable
          rows={r.top}
          mkt={mkt}
          total={r.competition.total.guard.ok ? r.competition.total.value : null}
          source={result.source}
          sort={url.sort as ProductSort}
          onSortChange={(s) => setUrl({ sort: s })}
          onOpen={setOpenRow}
          onStartFrom={startFrom}
          loading={result.isValidating && !ready}
        />
      </>
    );
  }

  const rows = data?.top ?? [];
  const openIdx = openRow ? rows.findIndex((x) => x.id === openRow.id) : -1;

  return (
    <ResearchLayout tab="products" market={market} primaryAction={primaryAction} overflowActions={overflowActions} mobilePrimary="none" toolbar={toolbar}>
      {result.budget && !result.notice ? (
        <Box sx={{ mb: '12px' }}>
          <Banner tone="info" title={t('error.budget')} data-testid="research-budget" />
        </Box>
      ) : null}
      {body}
      {mobile && primaryAction ? <StickyActionBar primary={primaryAction} /> : null}
      {stageMode && stageMkt ? <StageToListingModal open onClose={() => setStageMode(null)} mkt={stageMkt} mode={stageMode} /> : null}
      <TopListingPanel
        row={openRow}
        mkt={mkt}
        onClose={() => setOpenRow(null)}
        onStartFrom={startFrom}
        onPrev={openIdx > 0 ? () => setOpenRow(rows[openIdx - 1]) : undefined}
        onNext={openIdx >= 0 && openIdx < rows.length - 1 ? () => setOpenRow(rows[openIdx + 1]) : undefined}
      />
      <Modal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        size="sm"
        title={t('compare.addTitle')}
        primary={{ id: 'add', label: t('compare.add'), onClick: addCompare, disabled: !compareDraft.trim(), disabledReason: t('compare.needQuery') }}
        data-testid="research-compare-modal"
      >
        <Box component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); addCompare(); }}>
          <FormField label={t('compare.inputLabel')} helper={t('compare.max', { max: COMPARE_MAX })}>
            <TextField value={compareDraft} onChange={setCompareDraft} placeholder={t('compare.placeholder')} autoFocus data-testid="research-compare-input" />
          </FormField>
        </Box>
      </Modal>
    </ResearchLayout>
  );
}

export default ProductFinder;
