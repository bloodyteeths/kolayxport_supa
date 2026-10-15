// components/domain/research/keywords/KeywordExplorer.tsx (research R2-B) — Keyword explorer (research.md §6).
// "Which tags and title words win for this listing?"
//
// variant "page" (`/app/research/keywords`, inside ResearchLayout): search a keyword OR pick one of your listings ·
// Country · Filters · views Suggested / Long-tail / Seasonal / Used in my shop / Tracked (SavedViews, built-in) ·
// DataTable (cards < 900) with progressive rows ("Checking 12 of 40 keywords…") · BulkActionBar "2 selected
// [Add 2 tags to…] [Add to title] [Track] · Clear (Esc)". URL: `?q=|listing=&shop=&mkt=&country=&view=&f.*=&sel=`.
//
// variant "panel" (SidePanel lg 720, from the editor / the listings quick view): one listing, views Suggested and
// Used in my shop only (SegmentedControl), 4 columns, 20 rows + "Show more", primary "Add N tags to this listing".
// `onApply(tags)` present → the tags go back to the caller (the editor's TagInput; its autosave stages them, one
// staging path per screen); absent → staged directly as a draft.
//
// Nothing here writes to a marketplace: tags/title changes are STAGED drafts (sent later from Listings), Track and
// "Etsy volume" write KolayXport rows only.
import * as React from 'react';
import { useRouter } from 'next/router';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import type { ActionSpec } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { SearchField } from '@/components/ds/toolbar/SearchField';
import { FilterButton } from '@/components/ds/toolbar/FilterButton';
import { Toolbar } from '@/components/ds/toolbar/Toolbar';
import type { FilterDef, FilterValues } from '@/components/ds/toolbar/types';
import { DataTable, Thumb, type DataTableState } from '@/components/ds/data';
import { useDsFormat } from '@/components/ds/data/fmt';
import { Button } from '@/components/ds/inputs/Button';
import { Combobox, type ComboboxOption } from '@/components/ds/inputs/Combobox';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { ConnectState } from '@/components/ds/state/ConnectState';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { CardListSkeleton, TableSkeleton } from '@/components/ds/state/Skeletons';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import { useUrlState } from '@/lib/ds/useUrlState';
import { copyText } from '@/lib/hooks/useCopy';
import type { KeywordView, ResearchMkt } from '@/lib/research/types';
import { COMPETITION_BANDS, type KeywordFilters, type KeywordMkt, type KeywordRowExt, type TrackedKeywordRow } from '@/lib/research/keywordTypes';
import { ResearchFetchError, trackKeywords, untrackKeywords, useKeywords, type KeywordsHookResult } from '@/lib/research/hooks/useKeywords';
import { exportToCSV } from '@/lib/research/exportCsv';
import { isLikelyTurkish } from '@/lib/research/detectQuery';
import { requestSeeds } from '@/lib/research/hooks/useResearchProducts';
import { SeedChips } from '../products/SeedChips';
import { MKT_NAME, ResearchLayout, useResearchMkt } from '../ResearchLayout';
import { ApiSourceNote } from '../products/ApiSourceNote';
import { useDemandInputLines } from '../products/cardParts';
import { keywordColumns, type KwT } from './keywordColumns';
import { KeywordPanel } from './KeywordPanel';
import { TrackedView } from './TrackedView';
import { VolumePopover } from './VolumePopover';
import { AddTagsAction, fetchOwnListings, type KeywordActionMode, type ListingTarget } from './AddTagsAction';
import {
  DEMAND_MIN_VALUES,
  ETSY_INSIGHTS_URL,
  KEYWORDS_URL_SCHEMA,
  KW_COUNTRIES,
  PANEL_PAGE,
  SELECTION_MAX,
  activeFilterCount,
  effectiveView,
  explorerHref,
  filtersFromUrl,
  isKeywordMkt,
  parseSel,
  serializeSel,
  sharesOf,
  shorten,
  viewsFor,
  type KwCountry,
} from './keywordModel';

const CONNECT_HREF = '/ayarlar?tab=connections';

export type KeywordExplorerProps =
  | {
      variant?: 'page';
      /** Navigation seam (tests). */
      navigate?: (href: string, opts?: { newTab?: boolean }) => void;
    }
  | {
      variant: 'panel';
      /** The listing the panel works on (Etsy). */
      listing: ListingTarget;
      open: boolean;
      onClose: () => void;
      /** Present = return the chosen tags to the caller (editor TagInput); absent = stage them as a draft. */
      onApply?: (tags: string[]) => void;
      navigate?: (href: string, opts?: { newTab?: boolean }) => void;
    };

export function KeywordExplorer(props: KeywordExplorerProps) {
  if (props.variant === 'panel') return <KeywordExplorerPanel {...props} />;
  return <KeywordExplorerPage navigate={props.navigate} />;
}

export default KeywordExplorer;

// ─── shared bits ────────────────────────────────────────────────────────────

function useGo(navigate?: (href: string, opts?: { newTab?: boolean }) => void) {
  const router = useRouter();
  return React.useCallback(
    (href: string, opts?: { newTab?: boolean }) => {
      if (navigate) return navigate(href, opts);
      if (opts?.newTab) window.open(href, '_blank', 'noopener,noreferrer');
      else void router.push(href);
    },
    [navigate, router],
  );
}

function tableState(k: KeywordsHookResult, rows: number): DataTableState {
  const s = k.region.state;
  if ((s === 'loading' || s === 'slow') && rows === 0) return 'loading';
  if (s === 'error' && rows === 0) return 'error';
  if (rows === 0 && !k.building && (s === 'empty' || s === 'ready' || s === 'stale')) return 'empty';
  if (rows === 0 && k.building) return 'loading';
  return 'ready';
}

function errorCause(root: KwT, t: KwT, e: ResearchFetchError | undefined, mkt: KeywordMkt): string {
  if (e?.key && (!root.has || root.has(e.key))) return root(e.key);
  return mkt === 'ebay' ? t('error.ebay') : t('error.etsy');
}

/** "Current tags 11 / 13 · 2 repeat title words · 1 over 20 characters" (only with `?listing`). */
function CurrentLine({ data, t }: { data: KeywordsHookResult['data']; t: KwT }) {
  const c = data?.current;
  if (!c) return null;
  return (
    <Typography variant="caption" component="p" sx={{ m: 0, mb: '8px', color: neutral[700] }} data-testid="kw-current">
      {t('kw.current', { count: c.issues.count, overlap: c.issues.overlap, long: c.issues.long })}
    </Typography>
  );
}

// ─── Listing picker (own Etsy listings) ────────────────────────────────────

function ListingPicker({
  value,
  onPick,
  size,
}: {
  value: ListingTarget | null;
  onPick: (l: ListingTarget | null) => void;
  size: 'sm' | 'md';
}) {
  const t = useTranslations('research');
  const known = React.useRef(new Map<string, ListingTarget>());
  const loadOptions = React.useCallback(async (query: string): Promise<ComboboxOption[]> => {
    // Every connected Etsy shop, each row with its own shop id (not only the default shop).
    const found = await fetchOwnListings('etsy', query);
    return found.map(({ row: r, shopId }) => {
      known.current.set(r.id, { id: r.id, shopId, title: r.title, thumbUrl: r.thumbUrl });
      return { value: r.id, label: r.title, leading: <Thumb src={r.thumbUrl} alt="" size={32} /> };
    });
  }, []);
  const option: ComboboxOption | null = value ? { value: value.id, label: value.title || value.id, leading: <Thumb src={value.thumbUrl ?? null} alt="" size={32} /> } : null;
  return (
    <Combobox
      value={option}
      onChange={(o) => onPick(o ? known.current.get(o.value) ?? { id: o.value, shopId: '', title: o.label } : null)}
      loadOptions={loadOptions}
      placeholder={t('kw.forListing')}
      noOptionsText={t('picker.none')}
      size={size}
      data-testid="kw-listing-picker"
    />
  );
}

// ─── Page variant ───────────────────────────────────────────────────────────

/** `fromSelection`: started from the `?sel` bulk bar, so a successful write clears the selection. */
type ActionState = { mode: KeywordActionMode; keywords: string[]; fromSelection?: boolean } | null;

function KeywordExplorerPage({ navigate }: { navigate?: (href: string, opts?: { newTab?: boolean }) => void }) {
  const market = useResearchMkt('keywords');
  return (
    <ExplorerForMkt market={market} navigate={navigate} />
  );
}

function ExplorerForMkt({ market, navigate }: { market: ReturnType<typeof useResearchMkt>; navigate?: (href: string, opts?: { newTab?: boolean }) => void }) {
  const t = useTranslations('research') as unknown as KwT;
  const root = useTranslations() as unknown as KwT;
  const locale = useLocale();
  const fmt = useDsFormat();
  const toast = useToast();
  const mobile = useIsMobile();
  const go = useGo(navigate);
  const demandLines = useDemandInputLines();
  const [url, setUrl] = useUrlState(KEYWORDS_URL_SCHEMA);
  const rawMkt: ResearchMkt = market.mkt;
  const mkt: KeywordMkt = isKeywordMkt(rawMkt) ? rawMkt : 'etsy';
  const view = effectiveView(url.view, mkt);
  const listingId = mkt === 'etsy' ? url.listing : undefined;
  const hasListing = Boolean(listingId);
  const filters: KeywordFilters = filtersFromUrl(url, hasListing);
  const etsyConnected = market.connected.etsy;
  const needsShop = view === 'mine' || view === 'tracked';

  const params = React.useMemo(
    () => ({ mkt, view, q: url.q, listing: listingId, shop: listingId ? url.shop : undefined, country: url.country, filters }),
    [mkt, view, url.q, listingId, url.shop, url.country, JSON.stringify(filters)],
  );
  const blockedByConnection = needsShop && etsyConnected === false;
  const k = useKeywords(blockedByConnection ? null : params);
  const data = k.data;
  const rows = data?.rows ?? [];
  const tracked = data?.tracked ?? [];

  // ── search / listing ───────────────────────────────────────────────────────────────────────────────
  const [draft, setDraft] = React.useState(url.q ?? '');
  React.useEffect(() => setDraft(url.q ?? ''), [url.q]);
  const submit = (v: string) => {
    const q = v.trim();
    if (!q) return;
    setUrl({ q, listing: undefined, shop: undefined, view: view === 'tracked' || view === 'mine' ? 'suggested' : view });
  };
  // Turkish input → "Translate to English keywords · 1 credit" (§3.3); keywords stay English (P5).
  const [seeds, setSeeds] = React.useState<{ from: string; seeds: string[] } | null>(null);
  const [translating, setTranslating] = React.useState(false);
  const [translateNote, setTranslateNote] = React.useState<'failed' | 'noCredits' | null>(null);
  const showTranslate = !seeds && isLikelyTurkish(draft || url.q || '', locale);
  const translate = async () => {
    const from = (draft || url.q || '').trim();
    if (!from) return;
    setTranslating(true);
    setTranslateNote(null);
    try {
      const list = await requestSeeds(from, mkt);
      if (!list.length) return setTranslateNote('failed');
      setSeeds({ from, seeds: list });
      submit(list[0]);
    } catch (e) {
      setTranslateNote(e instanceof ResearchFetchError && e.status === 402 ? 'noCredits' : 'failed');
    } finally {
      setTranslating(false);
    }
  };
  const knownListing = React.useRef<ListingTarget | null>(null);
  const cur = data?.current;
  const curMatch = Boolean(listingId && cur && cur.listingId === listingId);
  const known = knownListing.current && knownListing.current.id === listingId ? knownListing.current : null;
  // Memoised: a fresh object per render would re-seed the action modal's picker on every progressive poll.
  const currentListing: ListingTarget | null = React.useMemo(
    () =>
      listingId
        ? curMatch && cur
          ? { id: listingId, shopId: cur.shopId || url.shop || '', title: cur.title, thumbUrl: cur.thumbUrl }
          : known ?? { id: listingId, shopId: url.shop ?? '', title: listingId }
        : null,
    [listingId, curMatch, cur?.shopId, cur?.title, cur?.thumbUrl, url.shop, known],
  );
  /** `?listing` the server couldn't find: never preselect or stage on it (the user picks another one). */
  const listingMissing = hasListing && k.error?.status === 404;
  const pickListing = (l: ListingTarget | null) => {
    knownListing.current = l;
    if (!l) return setUrl({ listing: undefined, shop: undefined, 'f.notInTitle': false });
    setUrl({ listing: l.id, shop: l.shopId || undefined, q: undefined });
  };

  // ── selection (`sel=`, ≤ 13) ───────────────────────────────────────────────────────────────────────
  const sel = parseSel(url.sel);
  const setSel = (ids: string[]) => {
    if (ids.length > SELECTION_MAX) toast.info(t('kw.selectMax', { max: SELECTION_MAX }));
    setUrl({ sel: serializeSel(ids) });
  };
  const clearSel = () => setUrl({ sel: undefined });

  // ── actions ────────────────────────────────────────────────────────────────────────────────────────
  const [action, setAction] = React.useState<ActionState>(null);
  const [openKw, setOpenKw] = React.useState<string | null>(null);
  const [openTracked, setOpenTracked] = React.useState<TrackedKeywordRow | null>(null);
  const stageMkt: 'etsy' | 'ebay' | null = mkt === 'etsy' || mkt === 'ebay' ? mkt : null;
  const shares = React.useMemo(() => sharesOf(rows), [rows]);

  const track = async (keywords: string[], fromSelection = false) => {
    if (mkt !== 'etsy' || !keywords.length) return;
    if (currentListing && currentListing.shopId && !listingMissing) {
      try {
        const r = await trackKeywords({ listingId: currentListing.id, shopId: currentListing.shopId, keywords: keywords.slice(0, 13), listingTitle: currentListing.title });
        toast.info(t('kw.trackedToast', { count: r.data.tracked, title: shorten(currentListing.title ?? '') }));
        if (fromSelection) clearSel();
        k.mutate();
      } catch {
        toast.error(t('kw.trackFailed'), { persist: false });
      }
      return;
    }
    setAction({ mode: 'track', keywords, fromSelection });
  };

  const stopTracking = async (ids: string[]) => {
    try {
      const n = await untrackKeywords(ids);
      toast.info(t('kw.untrackedToast', { count: n }));
      setOpenTracked(null);
      k.mutate();
    } catch {
      toast.error(t('kw.untrackFailed'), { persist: false });
    }
  };

  const exportCsv = () => {
    if (!rows.length) return;
    exportToCSV(
      rows.map((r) => ({
        keyword: r.keyword,
        demand_signal: r.demand.tier ?? '',
        competition: r.competition.guard.ok ? r.competition.value ?? '' : '',
        top48_use: r.top48.guard.ok ? r.top48.value ?? '' : '',
        price_p25: r.priceBand.p25 ?? '',
        price_p75: r.priceBand.p75 ?? '',
        currency: r.priceBand.currency,
        in_my_shop: r.inMyShop,
        etsy_volume_you_entered: r.etsyVolume?.value ?? '',
      })),
      `keywords-${(data?.query ?? view).replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'results'}`,
    );
  };

  // ── header ─────────────────────────────────────────────────────────────────────────────────────────
  const selCount = sel.length;
  const addTags: ActionSpec | undefined =
    mkt === 'etsy'
      ? selCount
        ? { id: 'kw-add-tags', label: currentListing ? t('kw.addTagsToListing', { count: selCount, title: shorten(currentListing.title ?? '', 24) }) : t('action.addTags', { count: selCount }), icon: icons.add, onClick: () => setAction({ mode: 'tags', keywords: sel, fromSelection: true }) }
        : { id: 'kw-add-tags', label: t('kw.addToListing'), icon: icons.add, disabled: true, disabledReason: t('kw.selectFirst') }
      : undefined;
  const addTitle: ActionSpec | undefined = stageMkt
    ? { id: 'kw-add-title', label: t('action.addToTitle'), onClick: () => setAction({ mode: 'title', keywords: sel, fromSelection: true }), disabled: !selCount, disabledReason: selCount ? undefined : t('kw.selectFirst') }
    : undefined;
  const trackAction: ActionSpec | undefined =
    mkt === 'etsy' ? { id: 'kw-track', label: t('action.track'), onClick: () => void track(sel, true), disabled: !selCount, disabledReason: selCount ? undefined : t('kw.selectFirst') } : undefined;
  const primaryAction: ActionSpec | undefined = view === 'tracked' ? undefined : addTags ?? addTitle;
  const overflowActions: ActionSpec[] = [
    ...(rows.length && view !== 'tracked' ? [{ id: 'kw-export', label: t('action.export'), icon: icons.download, onClick: exportCsv }] : []),
    { id: 'kw-copy', label: t('action.copyLink'), icon: icons.copy, onClick: () => void copyText(window.location.href).then((ok) => ok && toast.success(t('toast.linkCopied'))) },
  ];

  // ── toolbar ────────────────────────────────────────────────────────────────────────────────────────
  const filterDefs: FilterDef[] =
    view === 'tracked'
      ? []
      : [
          ...(hasListing ? [{ key: 'notInTitle', label: t('kw.filter.notInTitle'), type: 'boolean' as const }] : []),
          ...(mkt === 'etsy' ? [{ key: 'maxLen', label: t('kw.filter.maxLen'), type: 'boolean' as const }] : []),
          ...(mkt !== 'amazon'
            ? [{ key: 'competition', label: t('kw.filter.competition'), type: 'select' as const, options: COMPETITION_BANDS.map((b) => ({ value: b, label: t(`kw.filter.band.${b}`) })) }]
            : []),
          { key: 'demand', label: t('kw.filter.demand'), type: 'select' as const, options: DEMAND_MIN_VALUES.map((d) => ({ value: d, label: t('kw.filter.demandAtLeast', { tier: Number(d) }) })) },
        ];
  const filterValues: FilterValues = {
    notInTitle: hasListing ? url['f.notInTitle'] || undefined : undefined,
    maxLen: url['f.maxLen'] === '20' || undefined,
    competition: url['f.competition'],
    demand: url['f.demand'],
  };
  const onFilters = (v: FilterValues) => {
    const s = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
    setUrl({
      'f.notInTitle': v.notInTitle === true,
      'f.maxLen': v.maxLen === true ? '20' : undefined,
      'f.competition': s(v.competition) as (typeof COMPETITION_BANDS)[number] | undefined,
      'f.demand': s(v.demand) as (typeof DEMAND_MIN_VALUES)[number] | undefined,
    });
  };
  const clearFilters = () => setUrl({ 'f.notInTitle': false, 'f.maxLen': undefined, 'f.competition': undefined, 'f.demand': undefined });

  const views = viewsFor(mkt).map((v) => ({ id: v, label: t(`kw.view.${v}`) }));
  const countryOptions = KW_COUNTRIES.map((c) => ({ value: c, label: c }));

  const searchRow = (
    <Box sx={{ mb: '8px' }}>
      <Box
        component="form"
        role="search"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          submit(draft);
        }}
        sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}
      >
        <Box sx={{ flex: mobile ? '1 1 100%' : '1 1 320px', minWidth: 0, maxWidth: mobile ? undefined : 480, '& input': mobile ? { fontSize: 16 } : undefined }}>
          <SearchField
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            debounceMs={0}
            size="md"
            fullWidth
            placeholder={t('kw.searchPlaceholder')}
            ariaLabel={t('kw.searchPlaceholder')}
            data-testid="kw-search"
          />
        </Box>
        {mkt === 'etsy' ? (
          <>
            <Typography variant="caption" component="span" sx={{ color: neutral[600] }}>{t('kw.or')}</Typography>
            <Box sx={{ flex: mobile ? '1 1 100%' : '0 1 300px', minWidth: 0 }}>
              <ListingPicker value={currentListing} onPick={pickListing} size={mobile ? 'md' : 'sm'} />
            </Box>
          </>
        ) : null}
        <FilterButton
          label={t('toolbar.country')}
          value={url.country}
          options={countryOptions}
          required
          size={mobile ? 'md' : 'sm'}
          onChange={(v) => {
            const next = Array.isArray(v) ? v[0] : v;
            if (next && (KW_COUNTRIES as readonly string[]).includes(next)) setUrl({ country: next as KwCountry });
          }}
          data-testid="kw-country"
        />
        <Button variant="secondary" size={mobile ? 'md' : 'sm'} type="submit" data-testid="kw-search-submit">
          {t('search.cta')}
        </Button>
      </Box>
      {showTranslate ? (
        <Box sx={{ mt: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Button variant="ghost" size="sm" icon={icons.ai} onClick={() => void translate()} loading={translating} data-testid="kw-translate">
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
            active={url.q ?? ''}
            onPick={(sd) => submit(sd)}
            onRemove={(sd) => {
              const rest = seeds.seeds.filter((x) => x !== sd);
              setSeeds(rest.length ? { ...seeds, seeds: rest } : null);
              if (sd === url.q && rest[0]) submit(rest[0]);
            }}
          />
        </Box>
      ) : null}
    </Box>
  );

  const selection =
    selCount > 0 && view !== 'tracked'
      ? {
          count: selCount,
          primary: addTags ?? addTitle,
          secondarySlot: mobile && trackAction ? (
            <Button variant="secondary" size="xl" onClick={() => void track(sel, true)} fullWidth data-testid="kw-track-mobile">{t('action.track')}</Button>
          ) : undefined,
          actions: [...(addTags && addTitle ? [addTitle] : []), ...(trackAction && !mobile ? [trackAction] : [])],
          onClear: clearSel,
          'data-testid': 'kw-bulk-bar',
        }
      : undefined;

  const toolbar = (
    <>
      {searchRow}
      <Toolbar
        filters={filterDefs}
        values={filterValues}
        onChange={onFilters}
        onClearAll={clearFilters}
        views={{
          views,
          activeId: view,
          onSelect: (id) => setUrl({ view: id as KeywordView }),
          label: t('kw.viewLabel'),
          'data-testid': 'kw-views',
        }}
        resultCount={view === 'tracked' ? tracked.length || undefined : rows.length || undefined}
        resultLabel={view === 'tracked' ? (tracked.length ? t('kw.trackedCount', { count: tracked.length }) : undefined) : rows.length ? t('kw.resultCount', { count: rows.length }) : undefined}
        selection={selection}
        data-testid="kw-toolbar"
      />
    </>
  );

  // ── body ───────────────────────────────────────────────────────────────────────────────────────────
  const meta = k.building && data?.progress ? t('kw.building', { done: data.progress.done, total: data.progress.total }) : undefined;
  const source = <ApiSourceNote source={k.source} sampleUnit="keywords" meta={meta} data-testid="kw-source" />;
  const loading = k.region.state === 'slow' ? <SlowState onRetry={k.region.retry} data-testid="kw-slow" /> : mobile ? <CardListSkeleton count={6} /> : <TableSkeleton rows={8} />;
  const errorNode = (
    <ErrorState
      variant="page"
      title={t('kw.loadFailed')}
      cause={errorCause(root, t, k.error, mkt)}
      onRetry={k.region.retry}
      data-testid="kw-error"
    />
  );

  let body: React.ReactNode;
  const notFound = k.error?.status === 404;
  if (notFound && hasListing && !blockedByConnection) {
    body = (
      <EmptyState
        kind="no-results"
        title={t('kw.listingNotFound')}
        action={{ id: 'kw-clear-listing', label: t('kw.clearListing'), onClick: () => pickListing(null) }}
        data-testid="kw-listing-missing"
      />
    );
  } else if (blockedByConnection || (notFound && view === 'mine')) {
    body = <ConnectState brand="etsy" title={t('kw.connectTitle')} body={t('kw.connectBody')} connectHref={CONNECT_HREF} data-testid="kw-connect" />;
  } else if (k.notice) {
    const n = k.notice;
    // Budget with nothing cached: there are no results to show, so don't say "showing cached results".
    const noticeTitle =
      n.key === 'research.error.budget'
        ? t('kw.budgetNoCache')
        : root.has && root.has(n.key)
          ? root(n.key, n.params ?? {})
          : t('empty.notServedKw', { marketplace: MKT_NAME[mkt] });
    body = (
      <EmptyState
        kind="no-results"
        icon={icons.research}
        title={noticeTitle}
        data-testid="kw-notice"
      />
    );
  } else if (view === 'tracked') {
    const tState = tableState(k, tracked.length);
    body = (
      <>
        <TrackedView
          rows={tracked}
          state={tState}
          loading={loading}
          empty={
            <EmptyState
              kind="first-use"
              icon={icons.research}
              title={t('empty.tracked')}
              action={{ id: 'kw-track-start', label: t('kw.trackForListing'), onClick: () => setUrl({ view: 'suggested' }) }}
              data-testid="kw-tracked-empty"
            />
          }
          error={errorNode}
          activeId={openTracked?.id ?? null}
          onOpen={(r) => setOpenTracked(r)}
          onFindBetter={(r) => setUrl({ view: 'suggested', listing: r.listing.id, shop: r.listing.shopId || undefined, q: undefined })}
          onStop={(r) => void stopTracking([r.id])}
          navigate={(href) => go(href)}
        />
        <Box sx={{ mt: '4px', px: '12px' }}>
          {source}
          <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[500] }}>{t('kw.rankNote')}</Typography>
        </Box>
      </>
    );
  } else if (!params.q?.trim() && !hasListing && view !== 'mine') {
    body = <EmptyState kind="first-use" icon={icons.research} title={t('empty.keywords')} body={mkt === 'etsy' ? t('kw.firstUseBody') : undefined} data-testid="kw-first-use" />;
  } else {
    const state = tableState(k, rows.length);
    const filtered = activeFilterCount(filters) > 0;
    const columns = keywordColumns({
      mkt,
      variant: 'page',
      view,
      volumeAvailable: Boolean(data?.volumeAvailable),
      hasListing,
      t,
      root,
      fmt,
      locale,
      demandLines,
      renderVolume: (r) => <VolumePopover row={r} onSaved={() => k.mutate()} />,
    });
    body = (
      <>
        {k.region.state === 'stale' ? (
          <Box sx={{ mb: '8px' }}>
            <ErrorState variant="stale" staleSince={data ? new Date(data.fetchedAt) : undefined} onRetry={k.region.retry} data-testid="kw-stale" />
          </Box>
        ) : k.stale ? (
          <Box sx={{ mb: '8px' }}>
            <Banner tone="info" title={t('error.stale')} data-testid="kw-stale-pool" />
          </Box>
        ) : null}
        <CurrentLine data={data} t={t} />
        <DataTable<KeywordRowExt>
          rows={rows}
          columns={columns}
          getRowId={(r) => r.keyword.toLowerCase()}
          state={state}
          loading={loading}
          empty={
            filtered ? (
              <EmptyState kind="no-results" title={t('kw.noMatches')} action={{ id: 'kw-clear', label: t('kw.clearFilters'), onClick: clearFilters }} data-testid="kw-no-matches" />
            ) : (
              <EmptyState kind="no-results" title={t('kw.noKeywords', { q: data?.query ?? params.q ?? '' })} body={t('empty.broader')} data-testid="kw-no-results" />
            )
          }
          error={errorNode}
          selection={{ ids: sel, onChange: setSel }}
          onRowOpen={(r) => setOpenKw(r.keyword)}
          rowActions={(r) => [
            ...(mkt === 'etsy' ? [{ id: 'kw-row-add', label: t('action.addTags', { count: 1 }), icon: icons.add, onClick: () => setAction({ mode: 'tags', keywords: [r.keyword] }) }] : []),
            ...(stageMkt ? [{ id: 'kw-row-title', label: t('action.addToTitle'), onClick: () => setAction({ mode: 'title', keywords: [r.keyword] }) }] : []),
            ...(mkt === 'etsy' && !r.trackedId ? [{ id: 'kw-row-track', label: t('action.track'), onClick: () => void track([r.keyword]) }] : []),
            ...(r.trackedId ? [{ id: 'kw-row-untrack', label: t('kw.stopTracking'), onClick: () => void stopTracking([r.trackedId as string]), tone: 'danger' as const }] : []),
          ]}
          columnStateKey={`research.keywords.${mkt}.v1`}
          ariaLabel={t('tabs.keywords')}
          activeRowId={openKw ? openKw.toLowerCase() : null}
          data-testid="kw-table"
        />
        <Box sx={{ mt: '4px', px: '12px' }}>
          {source}
          <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[500] }} data-testid="kw-demand-note">
            {t('card.demandNote')}
            {mkt === 'etsy' ? (
              <>
                {' '}
                <Box component="a" href={ETSY_INSIGHTS_URL} target="_blank" rel="noopener noreferrer" sx={{ color: neutral[700] }}>
                  {t('kw.openInsights')}
                </Box>
              </>
            ) : null}
          </Typography>
        </Box>
      </>
    );
  }

  const openIdx = openKw ? rows.findIndex((r) => r.keyword === openKw) : -1;
  const openRow = openIdx >= 0 ? rows[openIdx] : null;
  const trackedIdx = openTracked ? tracked.findIndex((r) => r.id === openTracked.id) : -1;

  return (
    <ResearchLayout
      tab="keywords"
      market={market}
      primaryAction={primaryAction}
      overflowActions={overflowActions}
      mobilePrimary="none"
      toolbar={toolbar}
      data-testid="research-keywords"
    >
      {k.budget && !k.notice ? (
        <Box sx={{ mb: '8px' }}>
          <Banner tone="info" title={t('error.budget')} data-testid="kw-budget" />
        </Box>
      ) : null}
      {body}
      <KeywordPanel
        keyword={openTracked ? openTracked.keyword : openKw}
        row={openTracked ? null : openRow}
        tracked={openTracked}
        mkt={mkt}
        country={url.country}
        listing={listingId}
        onClose={() => {
          setOpenKw(null);
          setOpenTracked(null);
        }}
        onPrev={
          openTracked ? (trackedIdx > 0 ? () => setOpenTracked(tracked[trackedIdx - 1]) : undefined) : openIdx > 0 ? () => setOpenKw(rows[openIdx - 1].keyword) : undefined
        }
        onNext={
          openTracked
            ? trackedIdx >= 0 && trackedIdx < tracked.length - 1 ? () => setOpenTracked(tracked[trackedIdx + 1]) : undefined
            : openIdx >= 0 && openIdx < rows.length - 1 ? () => setOpenKw(rows[openIdx + 1].keyword) : undefined
        }
        onAdd={stageMkt && !openTracked ? (kw) => setAction({ mode: mkt === 'etsy' ? 'tags' : 'title', keywords: [kw] }) : undefined}
        onTrack={mkt === 'etsy' ? (kw) => void track([kw]) : undefined}
        onStopTracking={(id) => void stopTracking([id])}
      />
      {action && stageMkt ? (
        <AddTagsAction
          open
          onClose={() => setAction(null)}
          mode={action.mode}
          mkt={action.mode === 'track' ? 'etsy' : stageMkt}
          keywords={action.keywords}
          shares={shares}
          preselected={listingMissing ? null : currentListing}
          onDone={(r) => {
            if (action.fromSelection) clearSel();
            if (r.mode !== 'title') k.mutate();
          }}
        />
      ) : null}
    </ResearchLayout>
  );
}

// ─── Panel variant (SidePanel lg 720) ───────────────────────────────────────

type PanelProps = Extract<KeywordExplorerProps, { variant: 'panel' }>;

function KeywordExplorerPanel({ listing, open, onClose, onApply, navigate }: PanelProps) {
  const t = useTranslations('research') as unknown as KwT;
  const root = useTranslations() as unknown as KwT;
  const locale = useLocale();
  const fmt = useDsFormat();
  const go = useGo(navigate);
  const demandLines = useDemandInputLines();
  const [view, setView] = React.useState<'suggested' | 'mine'>('suggested');
  const [sel, setSelState] = React.useState<string[]>([]);
  const [shown, setShown] = React.useState(PANEL_PAGE);
  const [staging, setStaging] = React.useState(false);
  // Reset when the panel closes AND when it moves to another listing while open: keywords picked for listing A must
  // never be applied to listing B.
  const lastListing = React.useRef(listing.id);
  React.useEffect(() => {
    const moved = lastListing.current !== listing.id;
    lastListing.current = listing.id;
    if (!open || moved) {
      setSelState([]);
      setShown(PANEL_PAGE);
      setStaging(false);
    }
  }, [open, listing.id]);
  const setSel = (ids: string[]) => setSelState(ids.slice(0, SELECTION_MAX));

  const k = useKeywords(open ? { mkt: 'etsy', view, listing: listing.id, shop: listing.shopId || undefined } : null);
  const rows = (k.data?.rows ?? []).filter((r) => !r.inCurrent);
  const visible = rows.slice(0, shown);
  const columns = keywordColumns({ mkt: 'etsy', variant: 'panel', view, volumeAvailable: false, hasListing: true, t, root, fmt, locale, demandLines });
  const state = tableState(k, rows.length);
  const shares = React.useMemo(() => sharesOf(rows), [rows]);
  const title = k.data?.current?.title || listing.title || listing.id;
  const meta = k.building && k.data?.progress ? t('kw.building', { done: k.data.progress.done, total: k.data.progress.total }) : undefined;

  const primary: ActionSpec = {
    id: 'kw-panel-apply',
    label: t('action.addTagsThis', { count: sel.length }),
    icon: icons.add,
    disabled: sel.length === 0,
    disabledReason: t('kw.selectFirst'),
    onClick: () => {
      if (!sel.length) return;
      if (onApply) {
        onApply(sel);
        onClose();
        return;
      }
      setStaging(true);
    },
  };

  return (
    <>
      <SidePanel
        open={open}
        onClose={onClose}
        size="lg"
        title={t('kw.panelTitle', { title: shorten(title, 48) })}
        leading={listing.thumbUrl !== undefined ? <Thumb src={listing.thumbUrl ?? null} alt="" size={40} /> : undefined}
        primary={primary}
        overflow={[{ id: 'kw-panel-full', label: t('kw.openFull'), icon: icons.externalLink, onClick: () => go(explorerHref(listing.id, listing.shopId, view), { newTab: true }) }]}
        saveNote={sel.length ? t('kw.selected', { count: sel.length }) : undefined}
        data-testid="kw-ideas-panel"
      >
        <CurrentLine data={k.data} t={t} />
        <Box sx={{ mb: '8px' }}>
          <SegmentedControl<'suggested' | 'mine'>
            value={view}
            onChange={(v) => {
              setView(v);
              setShown(PANEL_PAGE);
            }}
            options={[
              { value: 'suggested', label: t('kw.view.suggested') },
              { value: 'mine', label: t('kw.view.mine') },
            ]}
            size="sm"
            data-testid="kw-panel-views"
          />
        </Box>
        {k.budget ? (
          <Box sx={{ mb: '8px' }}>
            <Banner tone="info" title={t('error.budget')} />
          </Box>
        ) : null}
        <DataTable<KeywordRowExt>
          rows={visible}
          columns={columns}
          getRowId={(r) => r.keyword.toLowerCase()}
          state={state}
          layout="table"
          density="compact"
          loading={k.region.state === 'slow' ? <SlowState onRetry={k.region.retry} /> : <TableSkeleton rows={6} />}
          empty={<EmptyState kind="no-results" compact title={t('kw.noKeywords', { q: k.data?.query ?? title })} />}
          error={<ErrorState variant="inline" title={t('kw.loadFailed')} cause={errorCause(root, t, k.error, 'etsy')} onRetry={k.region.retry} />}
          selection={{ ids: sel, onChange: setSel }}
          columnStateKey="research.keywords.panel.v1"
          ariaLabel={t('kw.panelAria')}
          stickyHeader={false}
          data-testid="kw-panel-table"
        />
        {rows.length > shown ? (
          <Box sx={{ mt: '8px' }}>
            <Button variant="ghost" size="sm" onClick={() => setShown((s) => s + PANEL_PAGE)} data-testid="kw-panel-more">
              {t('kw.showMore')}
            </Button>
          </Box>
        ) : null}
        <Box sx={{ mt: '8px' }}>
          <ApiSourceNote source={k.source} sampleUnit="keywords" meta={meta} data-testid="kw-panel-source" />
        </Box>
      </SidePanel>
      {staging ? (
        <AddTagsAction
          open
          onClose={() => setStaging(false)}
          mode="tags"
          mkt="etsy"
          keywords={sel}
          shares={shares}
          preselected={listing}
          onDone={() => {
            setSel([]);
            k.mutate();
          }}
        />
      ) : null}
    </>
  );
}
