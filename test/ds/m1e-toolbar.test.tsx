// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import {
  ActiveFilterChips,
  BulkActionBar,
  BulkBar,
  FilterBar,
  FilterButton,
  FiltersSheet,
  SavedViews,
  SearchField,
  Toolbar,
  countActive,
  formatFilterValue,
  pickVisibleFilters,
  useLocalSavedViews,
} from '@/components/ds/toolbar';
import type { FilterDef, FilterValues, SavedView } from '@/components/ds/toolbar';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { hasCoarse44, LOCALES, renderDs } from './m1e-helpers';

beforeEach(() => __resetShortcutsForTests());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const L = {
  en: { all: 'All', filters: 'Filters', clearAll: 'Clear all', results142: '142 results', result1: '1 result', selected: '12 selected', view: 'View:' },
  tr: { all: 'Tümü', filters: 'Filtreler', clearAll: 'Tümünü temizle', results142: '142 sonuç', result1: '1 sonuç', selected: '12 seçili', view: 'Görünüm:' },
} as const;

const storeOpts = [
  { value: 'etsy', label: 'Etsy' },
  { value: 'ebay', label: 'eBay' },
  { value: 'amazon', label: 'Amazon', disabledReason: 'Not connected' },
];

const FILTERS: FilterDef[] = [
  { key: 'store', label: 'Store', type: 'multiselect', options: storeOpts },
  { key: 'status', label: 'Status', type: 'select', options: [{ value: 'to_ship', label: 'To ship' }, { value: 'shipped', label: 'Shipped' }] },
  { key: 'section', label: 'Section', type: 'select', options: [{ value: 'a', label: 'A' }] },
  { key: 'gift', label: 'Gift', type: 'boolean' },
  { key: 'price', label: 'Price', type: 'range', unit: '$' },
];

function Controlled({ initial = {}, ...rest }: { initial?: FilterValues } & Partial<React.ComponentProps<typeof FilterBar>>) {
  const [values, setValues] = React.useState<FilterValues>(initial);
  return <FilterBar filters={FILTERS} values={values} onChange={setValues} resultCount={142} {...rest} />;
}

describe.each(LOCALES)('SearchField (%s)', (locale) => {
  it('debounces onChange and clears on Escape', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    renderDs(<SearchField value="" onChange={onChange} placeholder="Search orders" />, { locale });
    const input = screen.getByTestId('search-field-input');
    fireEvent.change(input, { target: { value: 'mug' } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onChange).toHaveBeenLastCalledWith('mug');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('"/" focuses the field (key-based)', () => {
    renderDs(<SearchField value="" onChange={() => undefined} placeholder="Search" />, { locale });
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(screen.getByTestId('search-field-input'));
  });

  it('clear button has a translated label', () => {
    renderDs(<SearchField value="abc" onChange={() => undefined} placeholder="Search" />, { locale });
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Clear search' : 'Aramayı temizle' })).toBeTruthy();
  });
});

describe.each(LOCALES)('FilterButton (%s)', (locale) => {
  it('reads "Label: All" when empty and "Label: Etsy +1" for two values', () => {
    const { rerender } = renderDs(<FilterButton label="Store" options={storeOpts} multiple onChange={() => undefined} />, { locale });
    expect(screen.getByTestId('filter-button').textContent).toBe(`Store:${L[locale].all}`);
    rerender(<FilterButton label="Store" value={['etsy', 'ebay']} options={storeOpts} multiple onChange={() => undefined} />);
    expect(screen.getByTestId('filter-button-value').textContent).toBe('Etsy +1');
  });

  it('single select picks and closes; disabled options do nothing', () => {
    const onChange = vi.fn();
    renderDs(<FilterButton label="Store" options={storeOpts} onChange={onChange} />, { locale });
    fireEvent.click(screen.getByTestId('filter-button'));
    fireEvent.click(screen.getByTestId('filter-option-amazon'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Not connected')).toBeTruthy();
    fireEvent.click(screen.getByTestId('filter-option-ebay'));
    expect(onChange).toHaveBeenCalledWith('ebay');
  });

  it('multi select toggles values; "All" clears', () => {
    const onChange = vi.fn();
    renderDs(<FilterButton label="Store" value={['etsy']} options={storeOpts} multiple onChange={onChange} />, { locale });
    fireEvent.click(screen.getByTestId('filter-button'));
    fireEvent.click(screen.getByTestId('filter-option-ebay'));
    expect(onChange).toHaveBeenLastCalledWith(['etsy', 'ebay']);
    fireEvent.click(screen.getByTestId('filter-option-all'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('long lists are searchable', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ value: `s${i}`, label: `Section ${i}` }));
    renderDs(<FilterButton label="Section" options={many} onChange={() => undefined} />, { locale });
    fireEvent.click(screen.getByTestId('filter-button'));
    const search = screen.getByRole('textbox', { name: locale === 'en' ? 'Search options' : 'Seçeneklerde ara' });
    fireEvent.change(search, { target: { value: 'Section 11' } });
    expect(screen.getAllByRole('option').filter((o) => o.getAttribute('data-testid') !== 'filter-option-all')).toHaveLength(1);
  });
});

describe.each(LOCALES)('FilterBar (%s)', (locale) => {
  it('desktop: ≤ 3 visible filters, the rest behind "Filters", count at the row end', () => {
    renderDs(<Controlled />, { locale });
    expect(screen.getByTestId('filter-store')).toBeTruthy();
    expect(screen.getByTestId('filter-status')).toBeTruthy();
    expect(screen.getByTestId('filter-section')).toBeTruthy();
    expect(screen.queryByTestId('filter-gift')).toBeNull();
    expect(screen.getByTestId('filters-button').textContent).toBe(L[locale].filters);
    expect(screen.getByTestId('toolbar-result-count').textContent).toBe(L[locale].results142);
  });

  it('pinned filters come first', () => {
    const defs: FilterDef[] = [...FILTERS.slice(0, 3), { ...FILTERS[3], pinned: true }];
    expect(pickVisibleFilters(defs, 3).map((f) => f.key)).toEqual(['gift', 'store', 'status']);
  });

  it('narrow (1024): folds one filter into "Filters • n" and moves the count to the chips row', () => {
    renderDs(<Controlled initial={{ section: 'a' }} />, { locale, viewport: 'narrow' });
    expect(screen.queryByTestId('filter-section')).toBeNull();
    expect(screen.getByTestId('filters-button').textContent).toBe(`${L[locale].filters} • 1`);
    const chipsRow = screen.getByTestId('active-filter-chips');
    expect(within(chipsRow).getByTestId('toolbar-result-count')).toBeTruthy();
  });

  it('active values become chips; removing one and "Clear all" work', () => {
    renderDs(<Controlled initial={{ store: ['etsy', 'ebay'], status: 'to_ship', price: { min: 10 } }} />, { locale });
    expect(screen.getByTestId('filter-chip-store').textContent).toBe('Store: Etsy +1');
    expect(screen.getByTestId('filter-chip-price').textContent).toBe('Price: ≥ 10 $');
    fireEvent.click(within(screen.getByTestId('filter-chip-status')).getByRole('button'));
    expect(screen.queryByTestId('filter-chip-status')).toBeNull();
    fireEvent.click(screen.getByText(L[locale].clearAll));
    expect(screen.queryByTestId('active-filter-chips')).toBeNull();
  });

  it('mobile: search full width + Filters button opens the bottom sheet with every filter', () => {
    renderDs(<Controlled search={{ value: '', onChange: () => undefined, placeholder: 'Search' }} />, { locale, viewport: 'mobile' });
    expect(screen.getByTestId('filter-bar').getAttribute('data-layout')).toBe('mobile');
    expect(screen.queryByTestId('filter-store')).toBeNull();
    fireEvent.click(screen.getByTestId('filters-button'));
    const sheet = screen.getByTestId('filters-sheet');
    for (const f of FILTERS) expect(within(sheet).getByTestId(`sheet-filter-${f.key}`)).toBeTruthy();
    expect(within(sheet).getByTestId('filters-sheet-show').textContent).toBe(locale === 'en' ? 'Show 142 results' : '142 sonucu göster');
  });
});

describe.each(LOCALES)('FiltersSheet (%s)', (locale) => {
  it('applies immediately and clears every filter', () => {
    const onChange = vi.fn();
    renderDs(
      <FiltersSheet open onClose={() => undefined} filters={FILTERS} values={{ status: 'to_ship' }} onChange={onChange} resultCount={1} variant="sheet" />,
      { locale },
    );
    fireEvent.click(screen.getByTestId('sheet-option-status-shipped'));
    expect(onChange).toHaveBeenLastCalledWith({ status: 'shipped' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Gift' }));
    expect(onChange).toHaveBeenLastCalledWith({ status: 'to_ship', gift: true });
    fireEvent.click(screen.getByTestId('filters-sheet-clear'));
    expect(onChange).toHaveBeenLastCalledWith({ store: [], status: undefined, section: undefined, gift: undefined, price: undefined });
    expect(screen.getByTestId('filters-sheet-show').textContent).toBe(locale === 'en' ? 'Show 1 result' : '1 sonucu göster');
  });

  it('daterange uses the caller render (M1-b DateRangeField)', () => {
    const render = vi.fn(() => <span data-testid="custom-date" />);
    renderDs(
      <FiltersSheet open onClose={() => undefined} filters={[{ key: 'd', label: 'Date', type: 'daterange', render }]} values={{}} onChange={() => undefined} variant="sheet" />,
      { locale },
    );
    expect(screen.getByTestId('custom-date')).toBeTruthy();
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ placement: 'sheet' }));
  });
});

describe.each(LOCALES)('ActiveFilterChips (%s)', (locale) => {
  it('renders nothing without chips or trailing; trailing alone keeps the row', () => {
    const { rerender } = renderDs(<ActiveFilterChips chips={[]} onClearAll={() => undefined} />, { locale });
    expect(screen.queryByTestId('active-filter-chips')).toBeNull();
    rerender(<ActiveFilterChips chips={[]} onClearAll={() => undefined} trailing={<span>{'n'}</span>} />);
    expect(screen.getByTestId('active-filter-chips')).toBeTruthy();
    expect(screen.queryByText(L[locale].clearAll)).toBeNull();
  });

  it('remove buttons carry a translated label', () => {
    const onRemove = vi.fn();
    renderDs(<ActiveFilterChips chips={[{ key: 'k', label: 'Store: Etsy', onRemove }]} onClearAll={() => undefined} />, { locale });
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Remove filter: Store: Etsy' : 'Filtreyi kaldır: Store: Etsy' }));
    expect(onRemove).toHaveBeenCalled();
  });
});

const VIEWS: SavedView[] = [
  { id: 'to_ship', label: 'To ship', count: 12 },
  { id: 'overdue', label: 'Overdue', count: 3, countTone: 'danger' },
  { id: 'all', label: 'All' },
  { id: 'u1', label: 'My Etsy', builtIn: false },
];

describe.each(LOCALES)('SavedViews (%s)', (locale) => {
  it('desktop dropdown: active view + count, select, save and delete user views', () => {
    const onSelect = vi.fn();
    const onSave = vi.fn();
    const onDelete = vi.fn();
    renderDs(<SavedViews views={VIEWS} activeId="to_ship" onSelect={onSelect} onSave={onSave} onDelete={onDelete} />, { locale });
    const trigger = screen.getByTestId('saved-views');
    expect(trigger.textContent).toBe(`${L[locale].view}To ship12`);
    fireEvent.click(trigger);
    expect(screen.queryByTestId('view-delete-to_ship')).toBeNull();
    fireEvent.click(screen.getByTestId('view-delete-u1'));
    expect(onDelete).toHaveBeenCalledWith('u1');
    fireEvent.click(screen.getByTestId('view-option-overdue'));
    expect(onSelect).toHaveBeenCalledWith('overdue');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('saved-views-save'));
    fireEvent.change(screen.getByTestId('saved-views-name'), { target: { value: 'Big orders' } });
    fireEvent.click(screen.getByTestId('saved-views-save-confirm'));
    expect(onSave).toHaveBeenCalledWith('Big orders');
  });

  it('mobile: scrollable chips with aria-selected', () => {
    const onSelect = vi.fn();
    renderDs(<SavedViews views={VIEWS} activeId="overdue" onSelect={onSelect} />, { locale, viewport: 'mobile' });
    expect(screen.getByTestId('saved-views').getAttribute('data-layout')).toBe('chips');
    expect(screen.getByTestId('view-chip-overdue').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('view-chip-all'));
    expect(onSelect).toHaveBeenCalledWith('all');
  });
});

describe('useLocalSavedViews', () => {
  function Harness() {
    const { views, save, remove } = useLocalSavedViews('orders');
    return (
      <div>
        <span data-testid="n">{views.length}</span>
        <button onClick={() => save('Mine', { view: 'all', store: ['etsy'] })}>{'save'}</button>
        <button onClick={() => views[0] && remove(views[0].id)}>{'remove'}</button>
      </div>
    );
  }
  it('persists per key and survives broken storage', () => {
    window.localStorage.clear();
    const { unmount } = renderDs(<Harness />);
    fireEvent.click(screen.getByText('save'));
    expect(screen.getByTestId('n').textContent).toBe('1');
    expect(JSON.parse(window.localStorage.getItem('kx.views.orders') ?? '[]')[0].query).toEqual({ view: 'all', store: ['etsy'] });
    unmount();
    renderDs(<Harness />);
    expect(screen.getByTestId('n').textContent).toBe('1');
    fireEvent.click(screen.getByText('remove'));
    expect(screen.getByTestId('n').textContent).toBe('0');
    window.localStorage.setItem('kx.views.orders', '{not json');
    cleanup();
    renderDs(<Harness />);
    expect(screen.getByTestId('n').textContent).toBe('0');
  });
});

describe.each(LOCALES)('BulkActionBar (%s)', (locale) => {
  it('desktop: count, primary, actions, select-all and Esc clears', () => {
    const onClear = vi.fn();
    const onSelectAll = vi.fn();
    renderDs(
      <BulkActionBar
        count={12}
        primary={{ id: 'grid', label: 'Edit in grid', onClick: vi.fn() }}
        actions={[{ id: 'price', label: 'Change price', onClick: vi.fn() }]}
        overflow={[{ id: 'del', label: 'Delete…', tone: 'danger', onClick: vi.fn() }]}
        selectAll={{ total: 1248, active: false, onChange: onSelectAll }}
        onClear={onClear}
      />,
      { locale },
    );
    expect(screen.getByTestId('bulk-count').textContent).toBe(L[locale].selected);
    expect(screen.getByTestId('action-grid')).toBeTruthy();
    expect(screen.getByTestId('action-price')).toBeTruthy();
    expect(screen.getByTestId('bulk-select-all').textContent).toBe(
      locale === 'en' ? 'Select all 1,248 in this view' : 'Bu görünümdeki 1.248 öğenin tümünü seç',
    );
    fireEvent.click(screen.getByTestId('bulk-select-all'));
    expect(onSelectAll).toHaveBeenCalledWith(true);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('renders nothing at count 0; BulkBar is the same component', () => {
    renderDs(<BulkBar count={0} onClear={() => undefined} />, { locale });
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull();
    expect(BulkBar).toBe(BulkActionBar);
  });

  it('mobile: becomes the StickyActionBar with the count as status', () => {
    renderDs(
      <BulkActionBar
        count={5}
        primary={{ id: 'labels', label: 'Create 4 labels', onClick: vi.fn() }}
        actions={[{ id: 'print', label: 'Print', onClick: vi.fn() }]}
        onClear={() => undefined}
      />,
      { locale, viewport: 'mobile' },
    );
    const bar = screen.getByTestId('bulk-action-bar');
    expect(bar.getAttribute('data-layout')).toBe('mobile');
    expect(within(bar).getByTestId('sticky-action-bar-status').textContent).toBe(locale === 'en' ? '5 selected' : '5 seçili');
    expect(within(bar).getByTestId('action-print')).toBeTruthy();
    expect(within(bar).getByTestId('action-labels')).toBeTruthy();
  });
});

describe.each(LOCALES)('Toolbar (%s)', (locale) => {
  it('one row: search, filters, views, density, count', () => {
    const onDensity = vi.fn();
    renderDs(
      <Toolbar
        search={{ value: '', onChange: () => undefined, placeholder: 'Search orders' }}
        filters={FILTERS}
        values={{}}
        onChange={() => undefined}
        views={{ views: VIEWS, activeId: 'to_ship', onSelect: () => undefined }}
        density={{ value: 'standard', onChange: onDensity }}
        resultCount={1}
      />,
      { locale },
    );
    expect(screen.getByTestId('toolbar')).toBeTruthy();
    expect(screen.getByTestId('search-field')).toBeTruthy();
    expect(screen.getByTestId('saved-views').getAttribute('data-layout')).toBe('menu');
    expect(screen.getByTestId('toolbar-result-count').textContent).toBe(L[locale].result1);
    fireEvent.click(screen.getByTestId('toolbar-density'));
    expect(onDensity).toHaveBeenCalledWith('compact');
  });

  it('a selection replaces the row in place', () => {
    renderDs(
      <Toolbar
        search={{ value: '', onChange: () => undefined, placeholder: 'Search' }}
        filters={FILTERS}
        values={{}}
        onChange={() => undefined}
        selection={{ count: 12, onClear: () => undefined, primary: { id: 'p', label: 'Create labels', onClick: vi.fn() } }}
      />,
      { locale },
    );
    expect(screen.queryByTestId('search-field')).toBeNull();
    expect(screen.getByTestId('bulk-action-bar')).toBeTruthy();
    expect(screen.getByTestId('toolbar').getAttribute('data-selecting')).toBe('true');
  });

  it('mobile: views as chips under the search', () => {
    renderDs(
      <Toolbar
        search={{ value: '', onChange: () => undefined, placeholder: 'Search' }}
        filters={FILTERS}
        values={{}}
        onChange={() => undefined}
        views={{ views: VIEWS, activeId: 'to_ship', onSelect: () => undefined }}
      />,
      { locale, viewport: 'mobile' },
    );
    expect(screen.getByTestId('saved-views').getAttribute('data-layout')).toBe('chips');
    expect(screen.queryByTestId('toolbar-density')).toBeNull();
  });
});

describe('filterUtils', () => {
  const labels = {
    yes: 'Yes',
    between: (a: string, b: string) => `${a} – ${b}`,
    atLeast: (a: string) => `≥ ${a}`,
    atMost: (a: string) => `≤ ${a}`,
    andMore: (f: string, n: number) => `${f} +${n}`,
    formatNumber: (n: number) => String(n),
    datePreset: (k: string) => `preset:${k}`,
    dateRange: (a: Date, b: Date) => `${a.getUTCDate()}..${b.getUTCDate()}`,
  };
  it('formats values per type and counts active filters', () => {
    expect(formatFilterValue(FILTERS[4], { min: 1, max: 5 }, labels)).toBe('1 $ – 5 $');
    expect(formatFilterValue(FILTERS[4], { max: 5 }, labels)).toBe('≤ 5 $');
    expect(formatFilterValue(FILTERS[3], true, labels)).toBe('Yes');
    expect(formatFilterValue(FILTERS[0], [], labels)).toBe('');
    expect(countActive(FILTERS, { store: [], status: 'to_ship', gift: false, price: {} })).toBe(1);
  });
});

describe('filterUtils daterange', () => {
  const labels = {
    yes: 'Yes',
    between: (a: string, b: string) => `${a} – ${b}`,
    atLeast: (a: string) => `≥ ${a}`,
    atMost: (a: string) => `≤ ${a}`,
    andMore: (f: string, n: number) => `${f} +${n}`,
    formatNumber: (n: number) => String(n),
    datePreset: (k: string) => `preset:${k}`,
    dateRange: (a: Date, b: Date) => `${a.toISOString().slice(0, 10)}..${b.toISOString().slice(0, 10)}`,
  };
  const def: FilterDef = { key: 'd', label: 'Order date', type: 'daterange', render: () => null };
  it('uses the preset label, the range formatter for dates, and accepts ISO strings', () => {
    expect(formatFilterValue(def, { from: null, to: null, preset: 'last30' }, labels)).toBe('preset:last30');
    const from = new Date('2026-10-01T12:00:00Z');
    const to = new Date('2026-10-14T12:00:00Z');
    expect(formatFilterValue(def, { from, to, preset: 'custom' }, labels)).toBe('2026-10-01..2026-10-14');
    expect(formatFilterValue(def, { from, to: null }, labels)).toBe('≥ 2026-10-01..2026-10-01');
    expect(formatFilterValue(def, { from: '2026-10-01T12:00:00Z' as unknown as Date, to: null }, labels)).toBe('≥ 2026-10-01..2026-10-01');
    expect(formatFilterValue(def, { from: null, to: null, preset: 'custom' }, labels)).toBe('');
  });
});

describe.each(LOCALES)('FilterBar daterange chip (%s)', (locale) => {
  const def: FilterDef = { key: 'd', label: 'Order date', type: 'daterange', render: () => null };
  it('reads as the translated preset, never the raw key', () => {
    renderDs(<FilterBar filters={[def]} values={{ d: { from: null, to: null, preset: 'last30' } }} onChange={() => undefined} />, { locale });
    expect(screen.getByTestId('filter-chip-d').textContent).toBe(locale === 'en' ? 'Order date: Last 30 days' : 'Order date: Son 30 gün');
  });
  it('reads a custom range in the lib/format range format', () => {
    const from = new Date('2026-10-01T09:00:00Z');
    const to = new Date('2026-10-14T09:00:00Z');
    renderDs(<FilterBar filters={[def]} values={{ d: { from, to, preset: 'custom' } }} onChange={() => undefined} />, { locale });
    const text = screen.getByTestId('filter-chip-d').textContent ?? '';
    expect(text).toMatch(locale === 'en' ? /Oct/ : /Eki/);
    expect(text).toContain('2026');
    expect(text).not.toMatch(/GMT|T09/);
  });
});

describe.each(LOCALES)('FiltersSheet range (%s)', (locale) => {
  const RANGE: FilterDef[] = [{ key: 'price', label: 'Price', type: 'range', unit: '$' }];
  function Harness({ onValues }: { onValues: (v: FilterValues) => void }) {
    const [values, setValues] = React.useState<FilterValues>({});
    return (
      <FiltersSheet
        open
        onClose={() => undefined}
        filters={RANGE}
        values={values}
        onChange={(v) => {
          setValues(v);
          onValues(v);
        }}
        variant="sheet"
      />
    );
  }
  it('Clear empties both inputs and a later edit does not resurrect a stale bound', () => {
    const onValues = vi.fn();
    renderDs(<Harness onValues={onValues} />, { locale });
    const min = () => screen.getByTestId('range-min-price') as HTMLInputElement;
    const max = () => screen.getByTestId('range-max-price') as HTMLInputElement;
    fireEvent.change(min(), { target: { value: '5' } });
    fireEvent.change(max(), { target: { value: '10' } });
    expect(onValues).toHaveBeenLastCalledWith({ price: { min: 5, max: 10 } });
    fireEvent.click(screen.getByTestId('filters-sheet-clear'));
    expect(onValues).toHaveBeenLastCalledWith({ price: undefined });
    expect(min().value).toBe('');
    expect(max().value).toBe('');
    fireEvent.change(max(), { target: { value: '7' } });
    expect(onValues).toHaveBeenLastCalledWith({ price: { min: undefined, max: 7 } });
  });
  it('keeps in-progress text and both bounds while typing', () => {
    const onValues = vi.fn();
    renderDs(<Harness onValues={onValues} />, { locale });
    const min = screen.getByTestId('range-min-price') as HTMLInputElement;
    fireEvent.change(min, { target: { value: '1,' } });
    expect(min.value).toBe('1,');
    fireEvent.change(min, { target: { value: '1,5' } });
    expect(onValues).toHaveBeenLastCalledWith({ price: { min: 1.5, max: undefined } });
  });
});

describe.each(LOCALES)('BulkActionBar slots (%s)', (locale) => {
  const split = <button type="button" data-testid="print-split">{'Print ▾'}</button>;
  it('mobile: primarySlot alone still renders the bar (orders: none labelable → Print ▾)', () => {
    const onClear = vi.fn();
    renderDs(<BulkActionBar count={5} primarySlot={split} overflow={[{ id: 'tag', label: 'Tag', onClick: vi.fn() }]} onClear={onClear} />, {
      locale,
      viewport: 'mobile',
    });
    const bar = screen.getByTestId('bulk-action-bar');
    expect(within(bar).getByTestId('sticky-action-bar-status').textContent).toBe(locale === 'en' ? '5 selected' : '5 seçili');
    expect(within(within(bar).getByTestId('sticky-action-bar-primary')).getByTestId('print-split')).toBeTruthy();
    fireEvent.click(within(bar).getByTestId('action-menu'));
    fireEvent.click(screen.getByTestId('menu-bulk-clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
  it('mobile: "5 selected · [Print ▾] [Create 4 labels]" via secondarySlot', () => {
    renderDs(
      <BulkActionBar count={5} primary={{ id: 'labels', label: 'Create 4 labels', onClick: vi.fn() }} secondarySlot={split} actions={[{ id: 'tag', label: 'Tag', onClick: vi.fn() }]} onClear={() => undefined} />,
      { locale, viewport: 'mobile' },
    );
    const bar = screen.getByTestId('bulk-action-bar');
    expect(within(within(bar).getByTestId('sticky-action-bar-secondary')).getByTestId('print-split')).toBeTruthy();
    expect(within(within(bar).getByTestId('sticky-action-bar-primary')).getByTestId('action-labels')).toBeTruthy();
    // The ActionSpec action moved to ⋯.
    expect(within(bar).queryByTestId('action-tag')).toBeNull();
  });
  it('mobile: never disappears while count > 0, even with no actions', () => {
    renderDs(<BulkActionBar count={2} onClear={() => undefined} />, { locale, viewport: 'mobile' });
    expect(screen.getByTestId('bulk-action-bar')).toBeTruthy();
    expect(screen.getByTestId('action-menu')).toBeTruthy();
  });
  it('desktop: [Create 4 labels] [Print ▾] [Export ▾] ⋯', () => {
    renderDs(
      <BulkActionBar
        count={5}
        primary={{ id: 'labels', label: 'Create 4 labels', onClick: vi.fn() }}
        secondarySlot={
          <>
            {split}
            <button type="button" data-testid="export-split">{'Export ▾'}</button>
          </>
        }
        overflow={[{ id: 'tag', label: 'Tag', onClick: vi.fn() }]}
        onClear={() => undefined}
      />,
      { locale },
    );
    const bar = screen.getByTestId('bulk-action-bar');
    const order = Array.from(bar.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid'));
    expect(order.indexOf('action-labels')).toBeLessThan(order.indexOf('print-split'));
    expect(order.indexOf('print-split')).toBeLessThan(order.indexOf('export-split'));
    expect(order.indexOf('export-split')).toBeLessThan(order.indexOf('action-menu'));
  });
});

describe.each(LOCALES)('toolbar touch targets (%s)', (locale) => {
  it('search clear, chip ×, saved-view delete, density and sheet close are 44 on coarse', () => {
    renderDs(<SearchField value="mug" onChange={() => undefined} />, { locale });
    expect(hasCoarse44(screen.getByTestId('search-field-clear'))).toBe(true);
    cleanup();
    renderDs(<ActiveFilterChips chips={[{ key: 'k', label: 'Store: Etsy', onRemove: () => undefined }]} onClearAll={() => undefined} />, { locale });
    expect(hasCoarse44(screen.getByTestId('filter-chip-remove-k'))).toBe(true);
    cleanup();
    renderDs(<SavedViews views={VIEWS} activeId="to_ship" onSelect={() => undefined} onDelete={() => undefined} />, { locale });
    fireEvent.click(screen.getByTestId('saved-views'));
    expect(hasCoarse44(screen.getByTestId('view-delete-u1'))).toBe(true);
    cleanup();
    renderDs(<Toolbar filters={FILTERS} values={{}} onChange={() => undefined} density={{ value: 'standard', onChange: () => undefined }} />, { locale });
    expect(hasCoarse44(screen.getByTestId('toolbar-density'))).toBe(true);
    cleanup();
    renderDs(<FiltersSheet open onClose={() => undefined} filters={FILTERS} values={{}} onChange={() => undefined} variant="sheet" />, { locale });
    expect(hasCoarse44(screen.getByTestId('filters-sheet-close'))).toBe(true);
  });
});
