// components/domain/listings/ListingsToolbar.tsx — listings-grid §2/§5 Toolbar (G5): SearchField · ≤ 3 pinned
// FilterButtons (config order) · Filters sheet · SavedViews (with counts) · density · result count. With a
// selection the DS BulkActionBar replaces the row in place (desktop) or becomes the StickyActionBar (mobile).
import * as React from 'react';
import useSWR from 'swr';
import { Toolbar, type Density } from '@/components/ds/toolbar';
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

  return (
    <Toolbar
      search={{ value: props.search, onChange: props.onSearch, placeholder: t('listings.search.placeholder') }}
      filters={filterDefs}
      values={props.values}
      onChange={props.onChange}
      onClearAll={props.onClearAll}
      resultCount={props.resultCount}
      resultLabel={
        props.updating ? t('listings.toolbar.updating') : props.resultCount !== undefined ? t('listings.toolbar.results', { count: props.resultCount }) : undefined
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
  );
}

export default ListingsToolbar;
