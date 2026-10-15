// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import {
  Combobox, CountrySelect, CurrencySelect, PhoneInput, RateList, ImageGrid, FormField,
  type ComboboxOption,
} from '@/components/ds/inputs';
import { renderDs, cleanup, LOCALES } from './m1b-harness';
import { m1bInputs } from './m1b-messages';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const OPTS: ComboboxOption[] = [
  { value: 'necklace', label: 'Name Necklace Gold' },
  { value: 'blanket', label: 'Baby Blanket', description: 'Sold 12' },
];

describe.each(LOCALES)('Combobox (%s)', (locale) => {
  const msg = m1bInputs[locale].combobox as Record<string, string>;

  it('filters static options and picks one', () => {
    const onChange = vi.fn();
    renderDs(<Combobox aria-label="Product" value={null} onChange={onChange} options={OPTS} />, locale);
    const input = screen.getByRole('combobox', { name: 'Product' });
    input.focus();
    fireEvent.change(input, { target: { value: 'blan' } });
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option').length).toBe(1);
    fireEvent.click(within(list).getByText('Baby Blanket'));
    expect(onChange).toHaveBeenCalledWith(OPTS[1]);
  });

  it('creatable offers "Create “x”" and returns a created option', () => {
    const onChange = vi.fn();
    renderDs(<Combobox aria-label="Vendor" value={null} onChange={onChange} options={OPTS} creatable />, locale);
    const vendor = screen.getByRole('combobox', { name: 'Vendor' });
    vendor.focus();
    fireEvent.change(vendor, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByText(msg.create.replace('{value}', 'Acme')));
    expect(onChange).toHaveBeenCalledWith({ value: 'Acme', label: 'Acme', created: true });
  });

  it('async loadOptions is debounced; empty result says No results', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async (q: string) => (q === 'none' ? [] : [{ value: 'x', label: `Result ${q}` }]));
    renderDs(<Combobox aria-label="Category" value={null} onChange={() => undefined} loadOptions={load} debounceMs={200} />, locale);
    const input = screen.getByRole('combobox', { name: 'Category' });
    input.focus();
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'tea' } });
    expect(load).not.toHaveBeenCalledWith('tea');
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(load).toHaveBeenCalledWith('tea');
    expect(screen.getByText('Result tea')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'none' } });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(screen.getByText(msg.noResults)).toBeTruthy();
  });

  it('multiple renders removable chips', () => {
    const onChange = vi.fn();
    renderDs(<Combobox multiple aria-label="Collections" value={[OPTS[0]]} onChange={onChange} options={OPTS} />, locale);
    fireEvent.click(screen.getByRole('button', { name: msg.remove.replace('{value}', 'Name Necklace Gold') }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe.each(LOCALES)('country, currency, phone (%s)', (locale) => {
  it('CountrySelect pins the default country, shows localized name + ISO', () => {
    const onChange = vi.fn();
    renderDs(<FormField label="Country"><CountrySelect value="US" onChange={onChange} /></FormField>, locale);
    const input = screen.getByLabelText('Country') as HTMLInputElement;
    input.focus();
    expect(input.value).toBe(locale === 'en' ? 'United States (US)' : 'Amerika Birleşik Devletleri (US)');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.mouseDown(input);
    const first = within(screen.getByRole('listbox')).getAllByRole('option')[0];
    expect(first.textContent).toContain('(TR)');
    fireEvent.change(input, { target: { value: '(DE)' } });
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(onChange).toHaveBeenCalledWith('DE');
  });

  it('CurrencySelect: TRY first in TR, symbol + code, limited list', () => {
    renderDs(<CurrencySelect aria-label="Currency" value={null} onChange={() => undefined} />, locale);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Currency' }));
    const first = within(screen.getByRole('listbox')).getAllByRole('option')[0];
    expect(first.textContent).toContain(locale === 'tr' ? '₺ TRY' : '$ USD');
    cleanup();
    renderDs(<CurrencySelect aria-label="Currency" value="EUR" onChange={() => undefined} currencies={['USD', 'GBP', 'EUR', 'TRY']} />, locale);
    const input = screen.getByRole('combobox', { name: 'Currency' }) as HTMLInputElement;
    expect(input.value).toBe('€ EUR');
    input.focus();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.mouseDown(input);
    expect(within(screen.getByRole('listbox')).getAllByRole('option').length).toBe(4);
  });

  it('PhoneInput: prefilled E.164 splits into country + number; typing emits E.164', () => {
    const onChange = vi.fn();
    renderDs(<FormField label="Phone"><PhoneInput value="+15550134" onChange={onChange} /></FormField>, locale);
    const country = screen.getByRole('combobox', { name: (m1bInputs[locale].phone as Record<string, string>).country }) as HTMLInputElement;
    expect(country.value).toBe('🇺🇸 +1');
    const number = screen.getByLabelText('Phone') as HTMLInputElement;
    expect(number.value).toBe('5550134');
    fireEvent.change(number, { target: { value: '+90 532 000 00 00' } });
    expect(onChange).toHaveBeenLastCalledWith('+905320000000');
    expect(country.value).toBe('🇹🇷 +90');
  });
});

describe.each(LOCALES)('RateList (%s)', (locale) => {
  const msg = m1bInputs[locale].rates as Record<string, string>;
  const rates = [
    { id: 'fx-p', carrier: 'fedex' as const, service: 'FedEx International Priority', transitDays: 2, amount: 38.4, currency: 'USD', recommended: true },
    { id: 'ups-s', carrier: 'ups' as const, service: 'UPS Worldwide Saver', transitDays: [3, 5] as [number, number], amount: 41, currency: 'USD' },
    { id: 'dhl', carrier: 'dhl' as const, service: 'DHL eCommerce', unavailableReason: 'Turkey domestic only' },
  ];
  it('lists rates with price, transit, recommended and unavailable reason; keyboard moves', () => {
    const onChange = vi.fn();
    renderDs(<RateList value="fx-p" onChange={onChange} rates={rates} state="ready" renderCarrier={(c) => <span data-testid={`logo-${c}`} />} />, locale);
    expect(screen.getByText(msg.recommended)).toBeTruthy();
    expect(screen.getByText('Turkey domestic only')).toBeTruthy();
    expect(screen.getByText(locale === 'en' ? '$38.40' : '$38,40')).toBeTruthy();
    expect(screen.getByText(locale === 'en' ? '3–5 days' : '3–5 gün')).toBeTruthy();
    expect(screen.getByTestId('logo-ups')).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[2]);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('ups-s');
  });
  it('loading skeleton and error with Retry', () => {
    const retry = vi.fn();
    renderDs(<RateList value={null} onChange={() => undefined} rates={[]} state="loading" />, locale);
    expect(screen.getByLabelText(msg.loading).getAttribute('aria-busy')).toBe('true');
    cleanup();
    renderDs(<RateList value={null} onChange={() => undefined} rates={rates.map((r) => ({ ...r, amount: undefined }))} state="error" onRetry={retry} />, locale);
    expect(screen.getByRole('alert').textContent).toContain(msg.error);
    fireEvent.click(screen.getByRole('button', { name: msg.retry }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getAllByRole('radio').length).toBe(3);
  });
});

describe.each(LOCALES)('ImageGrid (%s)', (locale) => {
  const msg = m1bInputs[locale].images as Record<string, string>;
  const images = [
    { id: 'a', src: '/a.jpg', alt: 'Front' },
    { id: 'b', src: '/b.jpg' },
    { id: 'c', src: '/c.jpg', alt: 'Back', staged: 'add' as const },
    { id: 'd', src: '/d.jpg', alt: 'Old', staged: 'delete' as const },
  ];
  it('badges, count, open, delete, undo, keyboard reorder', () => {
    const onReorder = vi.fn(); const onDelete = vi.fn(); const onOpen = vi.fn(); const onUndo = vi.fn(); const onUpload = vi.fn();
    const { container } = renderDs(
      <ImageGrid images={images} max={20} onReorder={onReorder} onUpload={onUpload} onDelete={onDelete} onOpen={onOpen} onUndoDelete={onUndo} />,
      locale,
    );
    expect(screen.getByText('3 / 20')).toBeTruthy();
    expect(screen.getByText(msg.new)).toBeTruthy();
    expect(screen.getByText(msg.willBeRemoved)).toBeTruthy();
    expect(screen.getByTitle(msg.missingAlt)).toBeTruthy();
    const tiles = screen.getAllByRole('listitem');
    fireEvent.click(tiles[0]);
    expect(onOpen).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: msg.remove.replace('{position}', '2') }));
    expect(onDelete).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: msg.undo }));
    expect(onUndo).toHaveBeenCalledWith('d');
    fireEvent.keyDown(tiles[0], { key: ' ' });
    expect(tiles[0].getAttribute('aria-grabbed')).toBe('true');
    fireEvent.keyDown(tiles[0], { key: 'ArrowRight' });
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c', 'd']);
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledWith([file]);
  });
  it('hides the upload tile when full', () => {
    renderDs(<ImageGrid images={images.slice(0, 2)} max={2} onReorder={() => undefined} onUpload={() => undefined} onDelete={() => undefined} onOpen={() => undefined} />, locale);
    expect(screen.queryByRole('button', { name: msg.upload })).toBeNull();
  });
});
