// @vitest-environment jsdom
// test/ds/m1b-review.test.tsx — regressions for the M1-b review fixes (EN + TR).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { zIndex } from '@/lib/ds/tokens';
import {
  Button, Combobox, DateRangeField, DateTimeField, FieldSuggestion, FormField, ImageGrid, PhoneInput, RadioCards, RateList,
  TagInput, type ComboboxOption,
} from '@/components/ds/inputs';
import { renderDs, cleanup, LOCALES } from './m1b-harness';
import { m1bInputs, withM1b, type Locale } from './m1b-messages';
import { m1aMessages } from './m1a-i18n';

afterEach(() => { cleanup(); vi.useRealTimers(); });

type Tree = { [k: string]: string | Tree };
function merge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = typeof v === 'object' && typeof cur === 'object' ? merge(cur, v) : v;
  }
  return out;
}
/** withM1b + M1-a's term messages (FormField `hint="hs"` renders M1-a's TermHint). */
function renderWithTerms(ui: ReactElement, locale: Locale) {
  return render(
    <NextIntlClientProvider locale={locale} messages={merge(withM1b(locale), m1aMessages(locale)) as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </NextIntlClientProvider>,
  );
}

const fmt = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);

describe.each(LOCALES)('ImageGrid review fixes (%s)', (locale) => {
  const msg = m1bInputs[locale].images as Record<string, string>;
  const images = [
    { id: 'a', src: '/a.jpg', alt: 'Front' },
    { id: 'b', src: '/b.jpg', alt: 'Side' },
    { id: 'd', src: '/d.jpg', alt: 'Old', staged: 'delete' as const },
  ];
  const grid = (over: Partial<React.ComponentProps<typeof ImageGrid>> = {}) => {
    const fns = { onReorder: vi.fn(), onUpload: vi.fn(), onDelete: vi.fn(), onOpen: vi.fn(), onUndoDelete: vi.fn() };
    const r = renderDs(<ImageGrid images={images} max={4} {...fns} {...over} />, locale);
    return { ...fns, ...r };
  };

  it('keys on the inner remove / Undo buttons do not reach the tile', () => {
    const { onOpen, onDelete, onUndoDelete } = grid();
    const removeBtn = screen.getByRole('button', { name: fmt(msg.remove, { position: 2 }) });
    fireEvent.keyDown(removeBtn, { key: 'Enter' });
    fireEvent.keyDown(removeBtn, { key: ' ' });
    const undoBtn = screen.getByRole('button', { name: msg.undo });
    fireEvent.keyDown(undoBtn, { key: 'Backspace' });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onUndoDelete).not.toHaveBeenCalled();
    expect(screen.getAllByRole('listitem')[1].getAttribute('aria-grabbed')).toBeNull();
  });

  it('Delete on a tile staged for removal undoes it instead of deleting again', () => {
    const { onDelete, onUndoDelete } = grid();
    fireEvent.keyDown(screen.getAllByRole('listitem')[2], { key: 'Delete' });
    expect(onUndoDelete).toHaveBeenCalledWith('d');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('a file dropped on a tile uploads once, capped at the free slots', () => {
    const { onUpload } = grid();
    const files = [1, 2, 3].map((i) => new File(['x'], `${i}.png`, { type: 'image/png' }));
    fireEvent.drop(screen.getAllByRole('listitem')[0], { dataTransfer: { files } });
    expect(onUpload).toHaveBeenCalledTimes(1);
    // max 4, 2 live photos (the staged delete does not count) → 2 free.
    expect(onUpload).toHaveBeenCalledWith(files.slice(0, 2));
  });

  it('drops are ignored when full or disabled', () => {
    const files = [new File(['x'], 'x.png', { type: 'image/png' })];
    const full = grid({ max: 2 });
    fireEvent.drop(screen.getByRole('list'), { dataTransfer: { files } });
    expect(full.onUpload).not.toHaveBeenCalled();
    cleanup();
    const off = grid({ disabled: true });
    fireEvent.drop(screen.getByRole('list'), { dataTransfer: { files } });
    expect(off.onUpload).not.toHaveBeenCalled();
  });
});

describe.each(LOCALES)('PhoneInput typed one key at a time (%s)', (locale) => {
  function Harness({ onEmit }: { onEmit: (v: string) => void }) {
    const [v, setV] = useState('');
    return <FormField label="Phone"><PhoneInput value={v} onChange={(x) => { setV(x); onEmit(x); }} /></FormField>;
  }
  it('"+", "4", "4", "2", "0" emits +4420 and keeps the "+"', () => {
    const onEmit = vi.fn();
    renderDs(<Harness onEmit={onEmit} />, locale);
    const input = screen.getByLabelText('Phone') as HTMLInputElement;
    let typed = '';
    for (const ch of ['+', '4', '4', '2', '0']) {
      typed = `${input.value}${ch}`;
      fireEvent.change(input, { target: { value: typed } });
      if (ch === '+') expect(input.value).toBe('+');
    }
    expect(onEmit).toHaveBeenLastCalledWith('+4420');
    const country = screen.getByRole('combobox', { name: (m1bInputs[locale].phone as Record<string, string>).country }) as HTMLInputElement;
    expect(country.value).toBe('🇬🇧 +44');
  });
});

describe.each(LOCALES)('Combobox async spinner (%s)', (locale) => {
  it('closing before the debounce fires clears the spinner', () => {
    vi.useFakeTimers();
    const load = vi.fn(async (): Promise<ComboboxOption[]> => []);
    const { container } = renderDs(<Combobox value={null} onChange={() => undefined} loadOptions={load} aria-label="Find" />, locale);
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'bab' } });
    expect(container.querySelector('.MuiCircularProgress-root')).not.toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector('.MuiCircularProgress-root')).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});

describe.each(LOCALES)('DateTimeField / DateRangeField review fixes (%s)', (locale) => {
  it('inside a FormField the popover time Select does not reuse the field id', () => {
    renderDs(
      <FormField label="Send at" htmlFor="sendAt">
        <DateTimeField value={new Date('2026-10-20T06:15:00Z')} onChange={() => undefined} timezone="Europe/Istanbul" forceMobile={false} />
      </FormField>,
      locale,
    );
    fireEvent.click(screen.getByLabelText('Send at'));
    expect(document.querySelectorAll('#sendAt').length).toBe(1);
  });

  it('mobile sheets open in the popover layer (above a DS Modal)', () => {
    renderDs(<DateTimeField value={null} onChange={() => undefined} timezone="Europe/Istanbul" forceMobile aria-label="When" />, locale);
    fireEvent.click(screen.getByLabelText('When'));
    const sheet = document.querySelector('.MuiDrawer-root') as HTMLElement;
    expect(Number(getComputedStyle(sheet).zIndex)).toBe(zIndex.popover);
    expect(zIndex.popover).toBeGreaterThan(zIndex.modal);
    cleanup();
    renderDs(<DateRangeField value={{ preset: 'last30', from: null, to: null } as never} onChange={() => undefined} forceMobile />, locale);
    fireEvent.click(screen.getByRole('button'));
    const sheet2 = document.querySelector('.MuiDrawer-root') as HTMLElement;
    expect(Number(getComputedStyle(sheet2).zIndex)).toBe(zIndex.popover);
  });

  it('trigger uses the app datetime format (locale hour cycle, no year this year)', () => {
    const at = new Date('2026-10-20T19:15:00Z');
    renderDs(<DateTimeField value={at} onChange={() => undefined} timezone="Europe/Istanbul" aria-label="When" />, locale);
    const text = screen.getByLabelText('When').textContent ?? '';
    expect(text).toBe(locale === 'en' ? 'Oct 20, 10:15 PM' : '20 Eki 22:15');
  });
});

describe.each(LOCALES)('RadioCards with no selection (%s)', (locale) => {
  const options = [
    { value: 'off', title: 'Off', disabledReason: 'n/a' },
    { value: 'a', title: 'A' },
    { value: 'b', title: 'B' },
    { value: 'c', title: 'C' },
  ];
  it('ArrowUp lands on the last enabled card, ArrowDown on the first; tab stop skips disabled', () => {
    const onChange = vi.fn();
    renderDs(<RadioCards aria-label="Mode" value={null} onChange={onChange} options={options} />, locale);
    const radios = screen.getAllByRole('radio');
    expect(radios[0].getAttribute('tabindex')).toBe('-1');
    expect(radios[1].getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(radios[1], { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(radios[1], { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });
});

describe.each(LOCALES)('RateList note + action (%s)', (locale) => {
  it('disabled row shows reason + a working link; failed check keeps the row enabled with a note', () => {
    const onChange = vi.fn();
    renderDs(
      <RateList
        value={null}
        onChange={onChange}
        state="ready"
        rates={[
          { id: 'ups', carrier: 'ups', service: 'UPS Saver', unavailableReason: 'Connect UPS in Settings', action: { label: 'Connect', href: '/ayarlar?tab=connections&provider=ups' } },
          { id: 'fx', carrier: 'fedex', service: 'FedEx Priority', note: 'Couldn’t check FedEx', transitDays: 2 },
        ]}
      />,
      locale,
    );
    const link = screen.getByRole('link', { name: 'Connect' });
    expect(link.getAttribute('href')).toBe('/ayarlar?tab=connections&provider=ups');
    link.addEventListener('click', (e) => e.preventDefault()); // jsdom cannot navigate
    fireEvent.click(link);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Couldn’t check FedEx')).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios[1].getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(radios[1]);
    expect(onChange).toHaveBeenCalledWith('fx');
  });
});

describe.each(LOCALES)('TagInput comma entry of a too-long tag (%s)', (locale) => {
  function Tags() {
    const [tags, setTags] = useState<string[]>([]);
    return <FormField label="Tags"><TagInput value={tags} onChange={setTags} max={13} maxLength={20} /></FormField>;
  }
  it('is not added and the text stays in the input', () => {
    renderDs(<Tags />, locale);
    const input = screen.getByLabelText('Tags') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'personalized baby blanket,' } });
    expect(input.value).toBe('personalized baby blanket');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('25/20')).toBeNull();
  });
});

describe.each(LOCALES)('Button loading width (%s)', (locale) => {
  it('locks the idle label width when loading starts', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return (this.textContent ?? '').length * 10;
    });
    const { rerender } = renderDs(<Button loadingLabel="…">Create shipping label</Button>, locale);
    const ui = (loading: boolean) => (
      <NextIntlClientProvider locale={locale} messages={withM1b(locale) as never} timeZone="Europe/Istanbul">
        <ThemeProvider theme={theme}><Button loading={loading} loadingLabel="…">Create shipping label</Button></ThemeProvider>
      </NextIntlClientProvider>
    );
    rerender(ui(true));
    expect(getComputedStyle(screen.getByRole('button')).minWidth).toBe(`${'Create shipping label'.length * 10}px`);
    spy.mockRestore();
  });
});

describe.each(LOCALES)('FieldSuggestion credit tooltip / FormField TermKey hint (%s)', (locale) => {
  const msg = m1bInputs[locale].suggestion as Record<string, string>;
  it('Try again has a visible tooltip ending with the credit cost', () => {
    renderDs(<FieldSuggestion value="New title" credits={1} onUse={() => undefined} onRetry={() => undefined} onDismiss={() => undefined} />, locale);
    const cost = msg.retryCost.startsWith('Try') ? 'Try again · 1 credit' : 'Tekrar dene · 1 kredi';
    // MUI Tooltip labels its child wrapper with the title (the visible tooltip text on hover/focus).
    expect(document.querySelector(`[aria-label="${cost}"]`)).not.toBeNull();
  });
  it('hint="hs" renders the M1-a TermHint', () => {
    renderWithTerms(<FormField label="HS" hint="hs"><input /></FormField>, locale);
    expect(screen.getByRole('button', { name: locale === 'en' ? 'What is HS code?' : 'GTİP nedir?' })).toBeTruthy();
  });
});
