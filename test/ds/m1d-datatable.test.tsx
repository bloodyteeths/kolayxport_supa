// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DataTable, type Column } from '@/components/ds/data/DataTable';
import { pageList, parseLocaleNumberForTest } from './m1d-dt-helpers';
import { LOCALES, Providers, intlErrors } from './m1d-render';

afterEach(cleanup);
beforeEach(() => { intlErrors.length = 0; try { window.localStorage.clear(); } catch { /* */ } });
afterEach(() => { expect(intlErrors).toEqual([]); });

type Row = { id: string; title: string; sku: string; price: number; currency: string; qty: number; share: number; score: number | null; store: string; thumb?: string };

const rows: Row[] = [
  { id: 'a', title: 'Personalized Baby Blanket', sku: 'BB-PINK', price: 69.99, currency: 'USD', qty: 42, share: 0.6, score: 78, store: 'etsy', thumb: '/a.jpg' },
  { id: 'b', title: 'Wooden Keepsake Box', sku: 'KB-OAK', price: 1109.3, currency: 'TRY', qty: 0, share: 0.4, score: null, store: 'trendyol' },
];

const columns: Column<Row>[] = [
  { key: 'thumb', header: '', type: 'thumb', mobile: 'media', thumbAlt: (r) => r.title },
  { key: 'title', header: 'Listing', mobile: 'title', sortable: true },
  { key: 'sku', header: 'SKU', mobile: 'subtitle', hideable: true },
  { key: 'store', header: 'Store', type: 'brand', mobile: 'meta', hideable: true },
  { key: 'price', header: 'Price', type: 'money-edit', currency: (r) => r.currency, mobile: 'trailing', sortable: true },
  { key: 'qty', header: 'Qty', type: 'int-edit', mobile: 'hidden', readOnlyReason: (r) => (r.id === 'b' ? 'Has variations' : null) },
  { key: 'share', header: 'Share', type: 'share', mobile: 'meta', hideable: true, defaultHidden: true },
  { key: 'score', header: 'Health', type: 'score', mobile: 'status' },
];

function setup(locale: 'en' | 'tr', extra: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  const props = {
    rows, columns, getRowId: (r: Row) => r.id, state: 'ready' as const, columnStateKey: 'test.v1', ...extra,
  };
  return render(<Providers locale={locale}><DataTable<Row> {...props} /></Providers>);
}

describe('helpers', () => {
  it('pageList collapses with gaps', () => {
    expect(pageList(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageList(1, 26)).toEqual([1, 2, 'gap', 26]);
    expect(pageList(13, 26)).toEqual([1, 'gap', 12, 13, 14, 'gap', 26]);
  });
  it('parseLocaleNumber reads tr and en input', () => {
    expect(parseLocaleNumberForTest('1.109,30', 'tr')).toBe(1109.3);
    expect(parseLocaleNumberForTest('12.50', 'tr')).toBe(12.5);
    expect(parseLocaleNumberForTest('1,109.30', 'en')).toBe(1109.3);
    expect(parseLocaleNumberForTest('abc', 'en')).toBeNull();
  });
});

describe.each(LOCALES)('DataTable table layout (%s)', (locale) => {
  it('renders headers, typed cells, hides defaultHidden columns, no footer without pagination', () => {
    setup(locale, { caption: 'Orders · grouped by SKU · 10:42', ariaLabel: 'Listings' });
    const table = screen.getByRole('table', { name: 'Listings' });
    expect(within(table).getByText('Listing')).toBeTruthy();
    expect(within(table).queryByText('Share')).toBeNull();
    expect(table.textContent).toContain(locale === 'en' ? '$69.99' : '$69,99');
    expect(table.textContent).toContain(locale === 'en' ? '₺1,109.30' : '₺1.109,30');
    expect(table.textContent).toContain('—'); // null score
    expect(table.querySelector('caption')?.textContent).toContain('grouped by SKU');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('sorting calls onSortChange and sets aria-sort', () => {
    const onSortChange = vi.fn();
    setup(locale, { sort: { key: 'price', dir: 'asc' }, onSortChange });
    const priceHeader = screen.getByRole('columnheader', { name: /Price/ });
    expect(priceHeader.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(within(priceHeader).getByRole('button'));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'price', dir: 'desc' });
    fireEvent.click(within(screen.getByRole('columnheader', { name: /Listing/ })).getByRole('button'));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'title', dir: 'asc' });
  });

  it('selection: row checkbox, page checkbox, x key', () => {
    const onChange = vi.fn();
    setup(locale, { selection: { ids: [], onChange } });
    const selRow = locale === 'en' ? 'Select row' : 'Satırı seç';
    fireEvent.click(screen.getAllByRole('checkbox', { name: selRow })[1]);
    expect(onChange).toHaveBeenLastCalledWith(['b']);
    fireEvent.click(screen.getByRole('checkbox', { name: locale === 'en' ? 'Select all on this page' : 'Bu sayfadakilerin hepsini seç' }));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    const rowA = document.querySelector('[data-row-id="a"]') as HTMLElement;
    rowA.focus();
    fireEvent.keyDown(rowA, { key: 'x' });
    expect(onChange).toHaveBeenLastCalledWith(['a']);
  });

  it('row open on click and Enter, j/k moves focus, e edits', () => {
    const onRowOpen = vi.fn();
    const onRowEdit = vi.fn();
    setup(locale, { onRowOpen, onRowEdit, activeRowId: 'a' });
    const rowA = document.querySelector('[data-row-id="a"]') as HTMLElement;
    fireEvent.click(within(rowA).getByText('Personalized Baby Blanket'));
    expect(onRowOpen).toHaveBeenCalledWith(rows[0]);
    rowA.focus();
    fireEvent.keyDown(rowA, { key: 'j' });
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('b');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    expect(onRowOpen).toHaveBeenLastCalledWith(rows[1]);
    fireEvent.keyDown(document.activeElement as Element, { key: 'e' });
    expect(onRowEdit).toHaveBeenCalledWith(rows[1]);
  });

  it('money-edit: click → input, Enter commits a parsed value (stages), Esc cancels; dirty tint', () => {
    const onCellCommit = vi.fn();
    setup(locale, { onCellCommit, dirtyCells: new Set(['a:price']) });
    const rowA = document.querySelector('[data-row-id="a"]') as HTMLElement;
    expect(rowA.querySelector('td[data-dirty="true"]')).toBeTruthy();
    const label = locale === 'en' ? 'Edit Price' : 'Price düzenle';
    fireEvent.click(within(rowA).getByRole('button', { name: label }));
    const input = within(rowA).getByRole('textbox', { name: 'Price' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: locale === 'en' ? '54.50' : '54,50' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCellCommit).toHaveBeenCalledWith('a', 'price', 54.5);
    fireEvent.click(within(rowA).getByRole('button', { name: label }));
    const again = within(rowA).getByRole('textbox', { name: 'Price' });
    fireEvent.change(again, { target: { value: '1' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(onCellCommit).toHaveBeenCalledTimes(1);
  });

  it('int-edit rejects decimals; read-only cell has no edit button', () => {
    const onCellCommit = vi.fn();
    setup(locale, { onCellCommit });
    const rowA = document.querySelector('[data-row-id="a"]') as HTMLElement;
    const rowB = document.querySelector('[data-row-id="b"]') as HTMLElement;
    const qtyLabel = locale === 'en' ? 'Edit Qty' : 'Qty düzenle';
    expect(within(rowB).queryByRole('button', { name: qtyLabel })).toBeNull();
    fireEvent.click(within(rowA).getByRole('button', { name: qtyLabel }));
    const input = within(rowA).getByRole('textbox', { name: 'Qty' });
    fireEvent.change(input, { target: { value: locale === 'en' ? '2.5' : '2,5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCellCommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('blur with an invalid value keeps the draft and the inline error (never drops input silently)', () => {
    const onCellCommit = vi.fn();
    setup(locale, { onCellCommit });
    const rowA = document.querySelector('[data-row-id="a"]') as HTMLElement;
    fireEvent.click(within(rowA).getByRole('button', { name: locale === 'en' ? 'Edit Price' : 'Price düzenle' }));
    const input = within(rowA).getByRole('textbox', { name: 'Price' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    const still = within(rowA).getByRole('textbox', { name: 'Price' }) as HTMLInputElement;
    expect(still.value).toBe('abc');
    expect(still.getAttribute('aria-invalid')).toBe('true');
    expect(onCellCommit).not.toHaveBeenCalled();
    // A valid value commits on blur.
    fireEvent.change(still, { target: { value: '12' } });
    fireEvent.blur(still);
    expect(onCellCommit).toHaveBeenCalledWith('a', 'price', 12);
    expect(within(rowA).queryByRole('textbox', { name: 'Price' })).toBeNull();
  });

  it('typed cells use Money (approx + FX note) and DateText (<time>)', () => {
    type R2 = { id: string; amount: number; at: string };
    const cols: Column<R2>[] = [
      { key: 'amount', header: 'Amount', type: 'money', currency: () => 'EUR', fxNote: () => 'Converted at ECB rates', mobile: 'trailing' },
      { key: 'at', header: 'Date', type: 'date', mobile: 'meta' },
    ];
    render(
      <Providers locale={locale}>
        <DataTable<R2> rows={[{ id: '1', amount: 10, at: '2026-03-02T10:00:00Z' }]} columns={cols} getRowId={(r) => r.id} state="ready" columnStateKey="t2" />
      </Providers>,
    );
    const row = document.querySelector('[data-row-id="1"]') as HTMLElement;
    expect(row.textContent).toContain('≈');
    expect(row.querySelector('time')?.getAttribute('dateTime')).toBe('2026-03-02T10:00:00.000Z');
  });

  it('pages pagination footer: range, page buttons, page size', () => {
    const onChange = vi.fn();
    setup(locale, { pagination: { mode: 'pages', page: 2, pageSize: 50, total: 1284, onChange } });
    const nav = screen.getByRole('navigation');
    expect(nav.textContent).toContain(locale === 'en' ? '51–100 of 1,284' : '1.284 kayıttan 51–100');
    fireEvent.click(within(nav).getByRole('button', { name: locale === 'en' ? 'Next page' : 'Sonraki sayfa' }));
    expect(onChange).toHaveBeenCalledWith({ page: 3, pageSize: 50 });
    fireEvent.change(within(nav).getByRole('combobox'), { target: { value: '250' } });
    expect(onChange).toHaveBeenLastCalledWith({ page: 1, pageSize: 250 });
  });

  it('cursor pagination shows Load more', () => {
    const onLoadMore = vi.fn();
    setup(locale, { pagination: { mode: 'cursor', hasMore: true, onLoadMore } });
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Load more' : 'Daha fazla yükle' }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('row actions: one inline action + ⋯ menu with danger last', () => {
    const create = vi.fn();
    const del = vi.fn();
    setup(locale, {
      inlineAction: () => ({ id: 'label', label: 'Create label', onClick: create }),
      rowActions: () => [
        { id: 'del', label: 'Delete…', tone: 'danger', onClick: del },
        { id: 'copy', label: 'Copy listing' },
      ],
    });
    const rowA = document.querySelector('[data-row-id="a"]') as HTMLElement;
    fireEvent.click(within(rowA).getByRole('button', { name: 'Create label' }));
    expect(create).toHaveBeenCalled();
    fireEvent.click(within(rowA).getByRole('button', { name: locale === 'en' ? 'More actions' : 'Diğer işlemler' }));
    const items = screen.getAllByRole('menuitem').map((m) => m.textContent);
    expect(items).toEqual(['Copy listing', 'Delete…']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    expect(del).toHaveBeenCalled();
  });

  it('row ⋯ is the DS OverflowMenu; choosing an item never opens the row', () => {
    const onRowOpen = vi.fn();
    const copy = vi.fn();
    setup(locale, { onRowOpen, rowActions: () => [{ id: 'copy', label: 'Copy listing', onClick: copy }] });
    const rowA = document.querySelector('[data-row-id="a"]') as HTMLElement;
    const trigger = within(rowA).getByRole('button', { name: locale === 'en' ? 'More actions' : 'Diğer işlemler' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy listing' }));
    expect(copy).toHaveBeenCalled();
    expect(onRowOpen).not.toHaveBeenCalled();
  });

  it('thumb column without thumbAlt: decorative placeholder, no unnamed img role', () => {
    const cols: Column<Row>[] = [{ key: 'thumb', header: '', type: 'thumb', mobile: 'media' }, columns[1]];
    setup(locale, { columns: cols });
    const rowB = document.querySelector('[data-row-id="b"]') as HTMLElement; // no image → placeholder
    expect(within(rowB).queryByRole('img')).toBeNull();
    expect(rowB.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('wider-than-container table switches to horizontal scroll and pins the actions column', () => {
    const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return this.tagName === 'TABLE' ? 1032 : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 900; } });
    try {
      const { container } = setup(locale, { rowActions: () => [{ id: 'copy', label: 'Copy listing' }] });
      expect(container.querySelector('[data-layout="table"]')?.getAttribute('data-hscroll')).toBe('true');
    } finally {
      // jsdom defines these on Element.prototype; drop the HTMLElement overrides (or restore own ones).
      if (sw) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', sw);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
      if (cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  it('fits: page-sticky header, no horizontal scroll flag', () => {
    const { container } = setup(locale);
    expect(container.querySelector('[data-layout="table"]')?.getAttribute('data-hscroll')).toBeNull();
  });

  it('Columns menu toggles a hideable column and persists it', () => {
    setup(locale);
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Columns' : 'Sütunlar' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Share' }));
    expect(screen.getByRole('columnheader', { name: 'Share', hidden: true })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('kx.ds.columns.test.v1') as string)).toEqual({ hidden: [], shown: ['share'] });
  });

  it('stored column choices merge onto defaultHidden (a new default-hidden column stays hidden)', () => {
    // Legacy bare array from before: the user hid "sku"; "share" (defaultHidden) was never toggled.
    window.localStorage.setItem('kx.ds.columns.test.v1', '["sku"]');
    const { unmount } = setup(locale);
    expect(screen.queryByRole('columnheader', { name: 'SKU' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Share' })).toBeNull();
    unmount();
    // New shape: explicit choices only; "store" is shown by the user.
    window.localStorage.setItem('kx.ds.columns.test.v1', JSON.stringify({ hidden: [], shown: ['store'] }));
    setup(locale);
    expect(screen.getByRole('columnheader', { name: 'SKU' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Share' })).toBeNull();
  });

  it('share column renders a bar and percent', () => {
    window.localStorage.setItem('kx.ds.columns.test.v1', JSON.stringify({ hidden: [], shown: ['share'] }));
    setup(locale);
    const rowA = document.querySelector('[data-row-id="a"]') as HTMLElement;
    expect(rowA.textContent).toContain(locale === 'en' ? '60%' : '%60');
  });

  it('empty / error / loading slots', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = setup(locale, { state: 'empty', empty: <p>No orders match</p> });
      expect(screen.getByText('No orders match')).toBeTruthy();
      unmount();
      const e = setup(locale, { state: 'error' });
      expect(screen.getByRole('alert').textContent).toBe(locale === 'en' ? "Couldn't load this list" : 'Bu liste yüklenemedi');
      e.unmount();
      setup(locale, { state: 'loading' });
      expect(document.querySelectorAll('.MuiSkeleton-root').length).toBe(0); // no flash before 200 ms
      act(() => { vi.advanceTimersByTime(250); });
      expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.each(LOCALES)('DataTable cards layout (%s)', (locale) => {
  it('renders cards from mobile roles with media, title, subtitle, trailing, status, meta', () => {
    setup(locale, { layout: 'cards', inlineAction: () => ({ id: 'l', label: 'Create label' }) });
    const card = document.querySelector('li[data-row-id="a"]') as HTMLElement;
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/a.jpg');
    expect(card.textContent).toContain('Personalized Baby Blanket');
    expect(card.textContent).toContain('BB-PINK');
    expect(card.textContent).toContain(locale === 'en' ? '$69.99' : '$69,99');
    expect(card.textContent).toContain('78');
    expect(within(card).getByRole('button', { name: 'Create label' })).toBeTruthy();
    expect(document.querySelector('table')).toBeNull();
  });

  it('orders shape: card-only subtitle column (desktop: false) — title line 1, subtitle line 2, absent on desktop', () => {
    type Order = { id: string; title: string; number: string; buyer: string; country: string };
    const orderRows: Order[] = [{ id: 'o1', title: 'Baby blanket ×2', number: '#3381', buyer: 'Emma R.', country: 'US' }];
    const orderCols: Column<Order>[] = [
      { key: 'order', header: 'Order', mobile: 'title', render: (r) => r.title },
      { key: 'orderMeta', header: 'Order details', desktop: false, hideable: true, mobile: 'subtitle', render: (r) => `${r.number} · ${r.buyer} · ${r.country}` },
    ];
    const base = { rows: orderRows, columns: orderCols, getRowId: (r: Order) => r.id, state: 'ready' as const, columnStateKey: 'orders.v1' };
    const { unmount } = render(<Providers locale={locale}><DataTable<Order> {...base} layout="cards" /></Providers>);
    const card = document.querySelector('li[data-row-id="o1"]') as HTMLElement;
    expect(card.textContent).toContain('Baby blanket ×2');
    expect(card.textContent).toContain('#3381 · Emma R. · US');
    unmount();
    render(<Providers locale={locale}><DataTable<Order> {...base} layout="table" /></Providers>);
    expect(screen.queryByRole('columnheader', { name: 'Order details' })).toBeNull();
    expect(screen.getByRole('table').textContent).not.toContain('#3381');
    expect(screen.queryByRole('button', { name: locale === 'en' ? 'Columns' : 'Sütunlar' })).toBeNull();
  });

  it('Select mode reveals checkboxes; tapping a card toggles it; pages pagination with onLoadMore shows Load more', () => {
    const onChange = vi.fn();
    const onLoadMore = vi.fn();
    setup(locale, {
      layout: 'cards',
      selection: { ids: [], onChange },
      pagination: { mode: 'pages', page: 1, pageSize: 50, total: 120, onChange: () => {}, onLoadMore },
    });
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Select' : 'Seç' }));
    fireEvent.click(document.querySelector('li[data-row-id="b"]') as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith(['b']);
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Load more' : 'Daha fazla yükle' }));
    expect(onLoadMore).toHaveBeenCalled();
  });
});
