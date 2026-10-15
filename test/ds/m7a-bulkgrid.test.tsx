// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider, type IntlError } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { FormatProvider } from '@/lib/format';
import { BulkGrid, usePasteSummary, type CellOrigin, type CellPatch, type GridColumn, type PasteOutcome } from '@/components/ds/data/BulkGrid';
import { deepMerge, m1dMessages, LOCALES, type TestLocale } from './m1d-render';
import { m7aEn, m7aTr } from './m7a-messages';
import { acceptanceSheet } from '../bulk/fixtures-m7a';

type Row = { id: string; title: string; price: number; quantity: number; tags: string[]; section: string; score: number; variations?: boolean; currency: string };

const intlErrors: string[] = [];
const onError = (e: IntlError) => { intlErrors.push(`${e.code}: ${e.message}`); };

function Providers({ locale, children }: { locale: TestLocale; children: ReactNode }) {
  const messages = deepMerge(m1dMessages(locale), (locale === 'en' ? m7aEn : m7aTr) as unknown as Record<string, unknown>);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Istanbul" onError={onError}>
      <FormatProvider timeZone="Europe/Istanbul">
        <ThemeProvider theme={theme}>{children}</ThemeProvider>
      </FormatProvider>
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);
beforeEach(() => { intlErrors.length = 0; try { window.localStorage.clear(); } catch { /* */ } });
afterEach(() => { expect(intlErrors).toEqual([]); });

const makeRows = (n: number, variationsAt: number | null = 2): Row[] => Array.from({ length: n }, (_, i) => ({
  id: `L${i + 1}`, title: `Listing ${i + 1}`, price: 10 + i, quantity: 500 + i, tags: i === 0 ? ['baby gift', 'newborn'] : [`gift ${i + 1}`], section: '1', score: 70,
  variations: i === variationsAt, currency: 'USD',
}));

const columns: GridColumn<Row>[] = [
  { key: 'thumb', header: '', field: 'thumb', type: 'thumb', width: 48, frozen: true, value: () => null },
  {
    key: 'title', header: 'Title', field: 'title', type: 'text-edit', width: 320, frozen: true, counter: 140,
    validate: (v) => (typeof v === 'string' && v.length > 140 ? "Etsy's limit is 140" : null),
  },
  {
    key: 'price', header: 'Price', field: 'price', type: 'money-edit', width: 104, currency: (r) => r.currency,
    editable: (r) => (r.variations ? { reason: 'Has variations' } : true),
    validate: (v) => (typeof v === 'number' && v < 0.2 ? "Etsy's minimum price is $0.20" : null),
  },
  { key: 'qty', header: 'Qty', field: 'quantity', type: 'int-edit', width: 72, editable: (r) => (r.variations ? { reason: 'Has variations' } : true) },
  { key: 'tags', header: 'Tags', field: 'tags', type: 'tags-edit', width: 240, maxTags: 13, maxTagLength: 20 },
  { key: 'section', header: 'Section', field: 'shop_section_id', type: 'select-edit', width: 140, value: (r) => r.section, options: [{ value: '1', label: 'Blankets' }, { value: '2', label: 'Boxes' }] },
  { key: 'health', header: 'Health', field: 'health', type: 'score', width: 88, value: (r) => r.score },
];

type Spy = { changes: { patches: CellPatch[]; origin: CellOrigin }[]; reverts: { rowId: string; field?: string }[][]; pastes: PasteOutcome[]; summary?: (o: PasteOutcome) => { tone: string; message: string } | null };

/** Minimal host: what useBulkStaging (M7-C) does with the grid callbacks. */
function Harness({ rows, spy, initialSelection = [], confirmFill }: { rows: Row[]; spy: Spy; initialSelection?: string[]; confirmFill?: () => Promise<boolean> }) {
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [dirty, setDirty] = useState(new Set<string>());
  const [invalid, setInvalid] = useState(new Map<string, string>());
  const [sel, setSel] = useState<string[]>(initialSelection);
  spy.summary = usePasteSummary();
  return (
    <>
      <BulkGrid<Row>
        rows={rows}
        getRowId={(r) => r.id}
        columns={columns}
        values={values}
        dirty={dirty}
        invalid={invalid}
        selection={{ ids: sel, onChange: setSel }}
        columnStateKey="test.bulk.v1"
        ariaLabel="Bulk edit"
        sourceLabel="Etsy"
        confirmFill={confirmFill}
        onPasteResult={(o) => spy.pastes.push(o)}
        onRevert={(cells) => spy.reverts.push(cells)}
        onCellsChange={(patches, origin) => {
          spy.changes.push({ patches, origin });
          setValues((prev) => {
            const next = { ...prev };
            for (const p of patches) next[p.rowId] = { ...(next[p.rowId] ?? {}), [p.field]: p.value };
            return next;
          });
          setDirty((prev) => { const d = new Set(prev); for (const p of patches) { if (p.error) d.delete(`${p.rowId}:${p.field}`); else d.add(`${p.rowId}:${p.field}`); } return d; });
          setInvalid((prev) => { const m = new Map(prev); for (const p of patches) { if (p.error) m.set(`${p.rowId}:${p.field}`, p.error); else m.delete(`${p.rowId}:${p.field}`); } return m; });
        }}
      />
      <output data-testid="selection">{sel.join(',')}</output>
    </>
  );
}

const newSpy = (): Spy => ({ changes: [], reverts: [], pastes: [] });
const cell = (r: number, c: number) => document.querySelector<HTMLElement>(`[data-gr="${r}"][data-gc="${c}"]`)!;
const TITLE = 1;
const PRICE = 2;
const QTY = 3;
const TAGS = 4;
const HEALTH = 6;

function setup(locale: TestLocale, n = 5, extra: Partial<Parameters<typeof Harness>[0]> = {}, variationsAt: number | null = 2) {
  const spy = newSpy();
  render(<Providers locale={locale}><Harness rows={makeRows(n, variationsAt)} spy={spy} {...extra} /></Providers>);
  return spy;
}

describe.each(LOCALES)('BulkGrid (%s)', (locale) => {
  it('grid roles, roving tabindex, frozen columns, read-only + typed cells', () => {
    setup(locale);
    const grid = screen.getByRole('grid', { name: 'Bulk edit' });
    expect(grid.getAttribute('aria-rowcount')).toBe('6');
    expect(grid.getAttribute('aria-colcount')).toBe('8');
    const focusable = grid.querySelectorAll('[role="gridcell"][tabindex="0"]');
    expect(focusable).toHaveLength(1);
    expect(cell(0, TITLE).style.position || getComputedStyle(cell(0, TITLE)).position).toBe('sticky');
    expect(cell(2, PRICE).getAttribute('aria-readonly')).toBe('true');
    expect(cell(0, HEALTH).getAttribute('aria-readonly')).toBe('true');
    expect(cell(0, PRICE).textContent).toBe(locale === 'en' ? '$10.00' : '$10,00');
    expect(cell(0, 5).textContent).toBe('Blankets');
  });

  it('acceptance: pasting the 200 × 3 Sheet at Title emits one onCellsChange with 597 edits + 3 invalid', () => {
    const spy = setup(locale, 250, {}, null); // ≥ 200 active non-variation listings (§9 fixture)
    fireEvent.mouseDown(cell(0, TITLE));
    fireEvent.paste(cell(0, TITLE), { clipboardData: { getData: () => acceptanceSheet() } });
    expect(spy.changes).toHaveLength(1);
    expect(spy.changes[0].origin).toBe('paste');
    expect(spy.changes[0].patches).toHaveLength(600);
    expect(spy.changes[0].patches.filter((p) => p.error)).toHaveLength(3);
    const out = spy.pastes[0];
    expect(out.kind === 'ok' && [out.rows, out.cols, out.edits, out.invalid]).toEqual([200, 3, 597, 3]);
    expect(spy.summary?.(out)).toEqual({
      tone: 'warning',
      message: locale === 'en' ? 'Pasted 200 rows × 3 columns · 597 edits · 3 invalid' : '200 satır × 3 sütun yapıştırıldı · 597 düzenleme · 3 geçersiz',
    });
    // overlay rendered: dirty, invalid (raw text kept), comma decimal parsed
    expect(cell(1, TITLE).textContent).toBe("Mom's Gift & Keepsake 2");
    expect(cell(1, TITLE).getAttribute('data-dirty')).toBe('true');
    expect(cell(0, TITLE).textContent).toBe("Mom's Gift & Keepsake 123/140"); // focused: value + counter caption
    expect(cell(31, PRICE).getAttribute('aria-invalid')).toBe('true');
    expect(cell(31, PRICE).textContent).toBe('abc');
    expect(cell(20, PRICE).textContent).toBe(locale === 'en' ? '$12.50' : '$12,50');
  });

  it('paste into a read-only column is refused with a banner message, nothing changes', () => {
    const spy = setup(locale);
    fireEvent.mouseDown(cell(0, HEALTH));
    fireEvent.paste(cell(0, HEALTH), { clipboardData: { getData: () => '50' } });
    expect(spy.changes).toHaveLength(0);
    expect(spy.summary?.(spy.pastes[0])).toEqual({
      tone: 'danger',
      message: locale === 'en' ? "Can’t paste into Health. Start the paste in an editable column." : 'Health sütununa yapıştırılamaz. Yapıştırmaya düzenlenebilir bir sütundan başlayın.',
    });
  });

  it('arrows / Home / End / ⌘↓ move the roving focus', () => {
    setup(locale);
    fireEvent.mouseDown(cell(0, TITLE));
    fireEvent.keyDown(cell(0, TITLE), { key: 'ArrowRight' });
    expect(cell(0, PRICE).tabIndex).toBe(0);
    expect(document.activeElement).toBe(cell(0, PRICE));
    fireEvent.keyDown(cell(0, PRICE), { key: 'ArrowDown', metaKey: true });
    expect(cell(4, PRICE).tabIndex).toBe(0);
    fireEvent.keyDown(cell(4, PRICE), { key: 'End' });
    expect(cell(4, HEALTH).tabIndex).toBe(0);
    fireEvent.keyDown(cell(4, HEALTH), { key: 'Home' });
    expect(cell(4, 0).tabIndex).toBe(0);
    fireEvent.keyDown(cell(4, 0), { key: 'Tab', shiftKey: true });
    expect(cell(3, HEALTH).tabIndex).toBe(0);
  });

  it('Enter edits, Enter commits (locale-free money parse) and moves down; Esc cancels', () => {
    const spy = setup(locale);
    fireEvent.mouseDown(cell(0, PRICE));
    fireEvent.keyDown(cell(0, PRICE), { key: 'Enter' });
    const input = within(cell(0, PRICE)).getByRole('textbox', { name: 'Price' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12,50' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy.changes.at(-1)).toEqual({ patches: [{ rowId: 'L1', field: 'price', value: 12.5 }], origin: 'edit' });
    expect(cell(1, PRICE).tabIndex).toBe(0);
    fireEvent.keyDown(cell(1, PRICE), { key: 'Enter' });
    const input2 = within(cell(1, PRICE)).getByRole('textbox');
    fireEvent.change(input2, { target: { value: '99' } });
    fireEvent.keyDown(input2, { key: 'Escape' });
    expect(spy.changes).toHaveLength(1);
    expect(within(cell(1, PRICE)).queryByRole('textbox')).toBeNull();
  });

  it('a printable key starts editing and replaces the value; invalid values stay local with the error', () => {
    const spy = setup(locale);
    fireEvent.mouseDown(cell(1, PRICE));
    fireEvent.keyDown(cell(1, PRICE), { key: '0' });
    const input = within(cell(1, PRICE)).getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('0');
    fireEvent.change(input, { target: { value: '0.10' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(spy.changes.at(-1)?.patches).toEqual([{ rowId: 'L2', field: 'price', value: '0.10', error: "Etsy's minimum price is $0.20" }]);
    expect(cell(1, PRICE).getAttribute('aria-invalid')).toBe('true');
    expect(cell(1, QTY).tabIndex).toBe(0); // Tab moved right
  });

  it('read-only cells do not open an editor', () => {
    const spy = setup(locale);
    fireEvent.mouseDown(cell(2, PRICE));
    fireEvent.keyDown(cell(2, PRICE), { key: 'Enter' });
    fireEvent.keyDown(cell(2, PRICE), { key: '5' });
    expect(within(cell(2, PRICE)).queryByRole('textbox')).toBeNull();
    expect(spy.changes).toHaveLength(0);
  });

  it('Delete clears text, refuses number cells', () => {
    const spy = setup(locale);
    fireEvent.mouseDown(cell(0, PRICE));
    fireEvent.keyDown(cell(0, PRICE), { key: 'Delete' });
    expect(spy.changes).toHaveLength(0);
    fireEvent.keyDown(cell(0, PRICE), { key: 'ArrowLeft' });
    fireEvent.keyDown(cell(0, TITLE), { key: 'Backspace' });
    expect(spy.changes.at(-1)?.patches).toEqual([{ rowId: 'L1', field: 'title', value: '' }]);
  });

  it('⌘D fills from the row above; with a selection fills the selected rows (variation rows skipped)', async () => {
    const spy = setup(locale, 5, { initialSelection: [] });
    fireEvent.mouseDown(cell(1, QTY));
    await act(async () => { fireEvent.keyDown(cell(1, QTY), { key: 'd', metaKey: true }); });
    expect(spy.changes.at(-1)).toEqual({ patches: [{ rowId: 'L2', field: 'quantity', value: 500 }], origin: 'fill' });
    cleanup();
    const spy2 = setup(locale, 5, { initialSelection: ['L2', 'L3', 'L4'] });
    fireEvent.mouseDown(cell(0, QTY));
    await act(async () => { fireEvent.keyDown(cell(0, QTY), { key: 'd', ctrlKey: true }); });
    expect(spy2.changes.at(-1)?.patches.map((p) => p.rowId)).toEqual(['L2', 'L4']);
  });

  it('tags fill over more than 10 rows asks first', async () => {
    const confirmFill = vi.fn().mockResolvedValue(false);
    const ids = Array.from({ length: 12 }, (_, i) => `L${i + 2}`);
    const spy = setup(locale, 14, { initialSelection: ids, confirmFill });
    fireEvent.mouseDown(cell(0, TAGS));
    await act(async () => { fireEvent.keyDown(cell(0, TAGS), { key: 'd', metaKey: true }); });
    expect(confirmFill).toHaveBeenCalledWith({ count: 12, tags: 2 });
    expect(spy.changes).toHaveLength(0);
  });

  it('Space toggles the row, ⌘A selects the page, Esc clears', () => {
    setup(locale, 3);
    fireEvent.mouseDown(cell(1, TITLE));
    fireEvent.keyDown(cell(1, TITLE), { key: ' ' });
    expect(screen.getByTestId('selection').textContent).toBe('L2');
    fireEvent.keyDown(cell(1, TITLE), { key: 'a', metaKey: true });
    expect(screen.getByTestId('selection').textContent).toBe('L2,L1,L3');
    fireEvent.keyDown(cell(1, TITLE), { key: 'Escape' });
    expect(screen.getByTestId('selection').textContent).toBe('');
  });

  it('⌥⌫ reverts the focused cell; with a selection, the selected rows', () => {
    const spy = setup(locale, 3);
    fireEvent.mouseDown(cell(0, PRICE));
    fireEvent.keyDown(cell(0, PRICE), { key: 'Backspace', altKey: true });
    expect(spy.reverts.at(-1)).toEqual([{ rowId: 'L1', field: 'price' }]);
    fireEvent.keyDown(cell(0, PRICE), { key: ' ' });
    fireEvent.keyDown(cell(0, PRICE), { key: 'Backspace', altKey: true });
    expect(spy.reverts.at(-1)).toEqual([{ rowId: 'L1' }]);
  });

  it('context menu offers Revert cell / Revert row', () => {
    const spy = setup(locale, 3);
    fireEvent.mouseDown(cell(0, PRICE));
    fireEvent.paste(cell(0, PRICE), { clipboardData: { getData: () => '15' } });
    fireEvent.contextMenu(cell(0, PRICE), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: locale === 'en' ? 'Revert cell' : 'Hücreyi geri al' }));
    expect(spy.reverts.at(-1)).toEqual([{ rowId: 'L1', field: 'price' }]);
  });

  it('copy puts the focused value on the clipboard as plain text', () => {
    setup(locale, 2);
    fireEvent.mouseDown(cell(1, PRICE));
    const setData = vi.fn();
    fireEvent.copy(cell(1, PRICE), { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', '11.00');
  });

  it('select cell opens the menu and commits the picked option', () => {
    const spy = setup(locale, 2);
    fireEvent.mouseDown(cell(0, 5));
    fireEvent.keyDown(cell(0, 5), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Boxes' }));
    expect(spy.changes.at(-1)).toEqual({ patches: [{ rowId: 'L1', field: 'shop_section_id', value: '2' }], origin: 'edit' });
    expect(cell(0, 5).textContent).toBe('Boxes');
  });

  it('paste summary names dropped columns, skip reasons and unchanged cells', () => {
    const spy = setup(locale, 2);
    const msg = spy.summary?.({
      kind: 'ok', patches: [], rows: 3, cols: 1, edits: 1, unchanged: 1, invalid: 0, skipped: 1,
      skippedReasons: [{ reason: 'Has variations', count: 1 }], overflow: 0, colOverflow: 2, intoSelection: false, rowIds: ['L1'],
    });
    expect(msg).toEqual({
      tone: 'warning',
      message: locale === 'en'
        ? 'Pasted 3 rows × 1 columns · 1 edits · 1 skipped · 2 columns didn’t fit and weren’t pasted · 1 cell skipped: Has variations · 1 cell already had this value'
        : '3 satır × 1 sütun yapıştırıldı · 1 düzenleme · 1 atlandı · 2 sütun sığmadı ve yapıştırılmadı · 1 hücre atlandı: Has variations · 1 hücre zaten bu değere sahipti',
    });
  });

  it('frozen offsets follow the rendered header widths; editable cells are capped at their width', () => {
    const widths = [46, 72, 320, 104, 72, 240, 140, 88];
    const spyRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const i = this.tagName === 'TH' && this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : -1;
      const width = i >= 0 ? widths[i] ?? 100 : 0;
      return { width, height: 36, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 36, toJSON: () => ({}) } as DOMRect;
    });
    try {
      setup(locale, 2);
      expect(getComputedStyle(cell(0, 0)).left).toBe('46px');
      expect(getComputedStyle(cell(0, TITLE)).left).toBe('118px'); // 46 + 72, not 40 + 48
      const cap = cell(0, TITLE).querySelector<HTMLElement>('[data-cell-cap="true"]');
      expect(cap).not.toBeNull();
      expect(getComputedStyle(cap!).maxWidth).toBe('296px'); // 320 − 2 × 12 padding
    } finally {
      spyRect.mockRestore();
    }
  });
});
