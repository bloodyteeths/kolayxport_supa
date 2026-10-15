// components/domain/listings/ListingsToolbar.tsx — listings-grid §2/§5 Toolbar (G5): SearchField · ≤ 3 pinned
// FilterButtons (config order) · Filters sheet · SavedViews (with counts) · density · result count. With a
// selection the DS BulkActionBar replaces the row in place (desktop) or becomes the StickyActionBar (mobile).
import * as React from 'react';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import { Toolbar, type Density } from '@/components/ds/toolbar';
import { useIsMobile, useIsNarrow } from '@/components/ds/page/useViewport';
import type { BulkActionBarProps } from '@/components/ds/toolbar/BulkActionBar';
import type { FilterDef, FilterOption, FilterValues, SavedView } from '@/components/ds/toolbar/types';
import type { ListingRow } from '@/lib/listings/types';
import type { ListingFilterConfig, ListingFilterOptionsSource, ListingsConfig } from './config/types';
import type { ListingsT } from './columns';

// ─── Dynamic filter options ─────────────────────────────────────────────────

type Opt = { value: string; label: string };

const jsonFetcher = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`options ${res.status}`);
  return res.json();
};

/** Endpoint per dynamic source that has one (listings-grid §9.2); the rest are learned from loaded rows. */
export function optionsUrl(source: ListingFilterOptionsSource, storeId: string | null): string | null {
  if (source === 'sections') return storeId ? `/api/clawd/etsy?action=get_shop_sections&shop_id=${encodeURIComponent(storeId)}` : null;
  if (source === 'collections') return '/api/wix/collections';
  return null;
}

/** Normalises the section / collection payloads into options (pure, unit-tested). */
export function parseOptions(source: ListingFilterOptionsSource, data: unknown): Opt[] {
  const d = (data ?? {}) as Record<string, unknown>;
  if (source === 'sections') {
    const list = (Array.isArray(d.shop_sections) ? d.shop_sections : Array.isArray(d.results) ? d.results : []) as Record<string, unknown>[];
    return list
      .filter((s) => s && s.shop_section_id != null)
      .map((s) => ({ value: String(s.shop_section_id), label: String(s.title ?? s.shop_section_id) }));
  }
  if (source === 'collections') {
    const list = (Array.isArray(d.collections) ? d.collections : []) as Record<string, unknown>[];
    return list.filter((c) => c && c.id != null).map((c) => ({ value: String(c.id), label: String(c.name ?? c.id) }));
  }
  return [];
}

/** `extra` key a row-learned source reads (category, brand, productType, vendor). */
const EXTRA_KEY: Partial<Record<ListingFilterOptionsSource, string>> = {
  categories: 'category',
  brands: 'brand',
  productTypes: 'productType',
  vendors: 'vendor',
  conditions: 'condition',
  formats: 'format',
};

/**
 * Remembers the values seen in loaded rows (the read API has no facet endpoint yet: outOfScope G1 request).
 * The current URL value is always offered so an active filter never disappears from its own menu.
 */
function useLearnedOptions(rows: ListingRow[], sources: ListingFilterOptionsSource[]) {
  const seen = React.useRef(new Map<string, Set<string>>());
  const [, bump] = React.useState(0);
  React.useEffect(() => {
    let changed = false;
    for (const src of sources) {
      const key = EXTRA_KEY[src];
      if (!key) continue;
      const set = seen.current.get(src) ?? new Set<string>();
      for (const r of rows) {
        const v = r.extra[key];
        if (typeof v === 'string' && v && !set.has(v)) {
          set.add(v);
          changed = true;
        }
      }
      seen.current.set(src, set);
    }
    if (changed) bump((n) => n + 1);
  }, [rows, sources]);
  return (src: ListingFilterOptionsSource): Opt[] =>
    Array.from(seen.current.get(src) ?? [])
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v }));
}

/**
 * The one fetched option source of the config (Etsy sections, Wix collections), shared by the filter menu and
 * the id-valued column (SWR dedupes the request by key). `key` is the filter key, which is also the column key.
 */
export function useFetchedFilterOptions(config: Pick<ListingsConfig, 'filters'>, storeId: string | null) {
  const filter = React.useMemo(() => config.filters.find((f) => f.optionsSource && optionsUrl(f.optionsSource, 'x')) ?? null, [config.filters]);
  const source = filter?.optionsSource ?? null;
  const url = source ? optionsUrl(source, storeId) : null;
  const { data } = useSWR(url, jsonFetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 });
  const options = React.useMemo(() => (source ? parseOptions(source, data) : []), [source, data]);
  return { key: filter?.key ?? null, source, options };
}

// ─── Fit the row to its width (no horizontal overflow at 1024–1440px in Turkish) ───────────────────────

/** Widths (px) of the toolbar parts in Turkish, the longest locale: measured on production at 1332px. */
export const TOOLBAR_WIDTHS = {
  search: 220,
  filtersButton: 100,
  /** "Görünüm: Gönderilemeyenler 7 ▾". */
  views: 230,
  density: 36,
  pinned: 124,
  count: 90,
  gap: 8,
} as const;

/**
 * How many pinned FilterButtons fit, and whether the result count fits on the row (pure, unit-tested). The rest
 * fold into "Filters". The count is redundant with the view's own count until a search or filter narrows the
 * list, so the filters win the space then; with a search or filter active the count is kept first.
 */
export function fitToolbar(width: number, pinnedWanted: number, filtered: boolean): { pinned: number; showCount: boolean } {
  const w = TOOLBAR_WIDTHS;
  if (!(width > 0)) return { pinned: pinnedWanted, showCount: true };
  const base = w.search + w.filtersButton + w.views + w.density + 4 * w.gap;
  const countCost = w.count + w.gap;
  const slot = w.pinned + w.gap;
  let free = width - base;
  let showCount = false;
  if (filtered && free >= countCost) {
    showCount = true;
    free -= countCost;
  }
  const pinned = Math.max(0, Math.min(pinnedWanted, Math.floor(free / slot)));
  free -= pinned * slot;
  if (!showCount && free >= countCost) showCount = true;
  return { pinned, showCount };
}

/** Width of the toolbar's container (ResizeObserver on a zero-height probe, so the sticky row is not wrapped). */
const useIsoLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

function useContainerWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export type ListingsToolbarProps = {
  config: ListingsConfig;
  t: ListingsT;
  storeId: string | null;
  storeCurrency: string;
  rows: ListingRow[];
  search: string;
  onSearch: (q: string) => void;
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  onClearAll: () => void;
  resultCount?: number;
  updating?: boolean;
  /** A search or filter narrows the list (the count is then worth its room on the row). */
  filtered?: boolean;
  views: SavedView[];
  activeView: string;
  onSelectView: (id: string) => void;
  onSaveView: (label: string) => void;
  onDeleteView: (id: string) => void;
  density: Density;
  onDensity: (d: Density) => void;
  selection?: BulkActionBarProps;
  'data-testid'?: string;
};

export function ListingsToolbar(props: ListingsToolbarProps) {
  const { config, t, storeId, storeCurrency, rows } = props;

  const learnSources = React.useMemo(
    () => config.filters.map((f) => f.optionsSource).filter((s): s is ListingFilterOptionsSource => Boolean(s && EXTRA_KEY[s])),
    [config.filters],
  );
  // At most one fetched source per marketplace (sections or collections).
  const { source: fetchSource, options: fetchedOptions } = useFetchedFilterOptions(config, storeId);
  const learned = useLearnedOptions(rows, learnSources);

  const optionsFor = React.useCallback(
    (f: ListingFilterConfig): FilterOption[] | undefined => {
      if (f.options) return f.options.map((o) => ({ value: o.value, label: t(o.labelKey) }));
      if (!f.optionsSource) return undefined;
      const list = f.optionsSource === fetchSource ? [...fetchedOptions] : learned(f.optionsSource);
      const current = props.values[f.key];
      if (typeof current === 'string' && current && !list.some((o) => o.value === current)) list.unshift({ value: current, label: current });
      return list;
    },
    [t, fetchSource, fetchedOptions, learned, props.values],
  );

  const filterDefs = React.useMemo<FilterDef[]>(
    () =>
      config.filters.map((f) => ({
        key: f.key,
        label: t(f.labelKey),
        type: f.type,
        pinned: f.pinned,
        searchable: f.searchable,
        options: optionsFor(f),
        unit: f.unit === 'currency' ? storeCurrency : undefined,
      })),
    [config.filters, t, optionsFor, storeCurrency],
  );

  // Desktop: fold pinned filters into "Filters" and drop the duplicate count before the row would overflow. The DS
  // FilterBar already subtracts one pinned filter below 1200px, so add it back to land on the measured number.
  // Mobile: the count sits on the cards' "Select" row (ListingsTable), not on a row of its own.
  const mobile = useIsMobile();
  const narrow = useIsNarrow();
  const [probe, width] = useContainerWidth();
  const pinnedWanted = config.filters.filter((f) => f.pinned).length || 3;
  const fit = fitToolbar(width, Math.min(3, pinnedWanted), Boolean(props.filtered));
  const maxVisible = narrow ? fit.pinned + 1 : fit.pinned;
  const countOnRow = !mobile && fit.showCount;

  return (
    <>
    <Box ref={probe} aria-hidden sx={{ height: 0, width: '100%' }} data-testid="listings-toolbar-probe" />
    <Toolbar
      maxVisible={maxVisible}
      search={{ value: props.search, onChange: props.onSearch, placeholder: t('listings.search.placeholder') }}
      filters={filterDefs}
      values={props.values}
      onChange={props.onChange}
      onClearAll={props.onClearAll}
      resultCount={countOnRow ? props.resultCount : undefined}
      resultLabel={
        countOnRow ? (props.updating ? t('listings.toolbar.updating') : props.resultCount !== undefined ? t('listings.toolbar.results', { count: props.resultCount }) : undefined) : undefined
      }
      views={{
        views: props.views,
        activeId: props.activeView,
        onSelect: props.onSelectView,
        onSave: props.onSaveView,
        onDelete: props.onDeleteView,
        label: t('listings.view.label'),
      }}
      density={{ value: props.density, onChange: props.onDensity }}
      selection={props.selection}
      data-testid={props['data-testid'] ?? 'listings-toolbar'}
    />
    </>
  );
}

export default ListingsToolbar;
