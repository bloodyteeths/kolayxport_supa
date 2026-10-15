// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { ManualOrderPanel } from '@/components/domain/orders/ManualOrderPanel';
import { G5_EN, G5_TR } from './g5-messages';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, G5_EN as unknown as Obj), tr: deepMerge(tr as Obj, G5_TR as unknown as Obj) };
type Locale = keyof typeof MESSAGES;

type Settings = { shipperProfile?: { shipperCountryCode?: string; defaultCurrencyCode?: string } | null };
let settingsBody: Settings;
let manualResponse: { status: number; body: unknown };
const fetchMock = vi.fn();

beforeEach(() => {
  settingsBody = { shipperProfile: { shipperCountryCode: 'TR', defaultCurrencyCode: 'USD' } };
  manualResponse = { status: 201, body: { success: true, order: { id: 'ord_1', orderNumber: 'IG-2026-031' } } };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/user/settings') return new Response(JSON.stringify(settingsBody), { status: 200 });
    if (url === '/api/orders/manual') return new Response(JSON.stringify(manualResponse.body), { status: manualResponse.status });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel(locale: Locale, props: Partial<React.ComponentProps<typeof ManualOrderPanel>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const onCreated = props.onCreated ?? vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
        <ThemeProvider theme={theme}>
          <ManualOrderPanel open onClose={onClose} onCreated={onCreated} />
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
  return { onClose, onCreated };
}

const M = (locale: Locale) => (MESSAGES[locale] as typeof G5_EN).orders.manual;

async function ready(locale: Locale) {
  await screen.findByLabelText(M(locale).name);
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillValid(locale: Locale) {
  const m = M(locale);
  type(m.name, 'Ayşe Yılmaz');
  type(m.orderNumber, 'IG-2026-031');
  type(m.street1, 'Bağdat Cd. 12');
  type(m.city, 'İstanbul');
  type(m.postal, '34710');
  type(m.productName, 'Baby blanket');
  type(m.price, '625');
}

function clickPrimary() {
  fireEvent.click(screen.getByTestId('action-manual-create'));
}

describe.each(['en', 'tr'] as Locale[])('ManualOrderPanel (%s)', (locale) => {
  it('defaults the currency to the account base currency (TR sender → TRY, not the stored USD)', async () => {
    renderPanel(locale);
    await ready(locale);
    const currency = within(screen.getByTestId('manual-currency')).getByRole('combobox') as HTMLInputElement;
    expect(currency.value).toContain('TRY');
    expect(screen.getByTestId('manual-total').textContent).toContain('₺');
  });

  it('submit with empty fields shows the summary banner and field errors, sends nothing', async () => {
    renderPanel(locale);
    await ready(locale);
    clickPrimary();
    expect(await screen.findAllByText(M(locale).validation.required)).not.toHaveLength(0);
    expect(screen.getByTestId('banner-danger')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/orders/manual')).toBe(false);
  });

  it('posts the legacy ManualOrderData body and reports the new order id', async () => {
    const { onCreated } = renderPanel(locale);
    await ready(locale);
    fillValid(locale);
    await act(async () => { clickPrimary(); });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ord_1'));
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/orders/manual');
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body).toEqual({
      customerName: 'Ayşe Yılmaz', customerEmail: '', customerPhone: '', orderNumber: 'IG-2026-031', currency: 'TRY',
      street1: 'Bağdat Cd. 12', street2: '', city: 'İstanbul', state: '', postal: '34710', country: 'TR',
      items: [{ productName: 'Baby blanket', quantity: 1, unitPrice: 625, weight: 0.5, sku: '', hsCode: '', countryOfOrigin: 'TR' }],
    });
  });

  it('a duplicate order number becomes a field error on Order number', async () => {
    manualResponse = { status: 400, body: { error: 'Bu sipariş numarası zaten mevcut', code: 'DUPLICATE_ORDER_NUMBER' } };
    const { onCreated } = renderPanel(locale);
    await ready(locale);
    fillValid(locale);
    await act(async () => { clickPrimary(); });
    expect(await screen.findByText(M(locale).duplicate)).toBeTruthy();
    expect(screen.getByLabelText(M(locale).orderNumber).getAttribute('aria-invalid')).toBe('true');
    expect(onCreated).not.toHaveBeenCalled();
    // Editing the number clears the server error.
    type(M(locale).orderNumber, 'IG-2026-032');
    expect(screen.queryByText(M(locale).duplicate)).toBeNull();
  });

  it('closing a dirty panel asks "Discard this order?" first', async () => {
    const { onClose } = renderPanel(locale);
    await ready(locale);
    type(M(locale).name, 'Ayşe');
    fireEvent.click(screen.getByTestId('action-manual-cancel'));
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText(M(locale).discardTitle)).toBeTruthy();
  });

  it('adds and removes items', async () => {
    renderPanel(locale);
    await ready(locale);
    fireEvent.click(screen.getByTestId('manual-add-item'));
    expect(screen.getByTestId('manual-item-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('manual-remove-item-1'));
    expect(screen.queryByTestId('manual-item-1')).toBeNull();
  });
});

describe('ManualOrderPanel review fixes', () => {
  function Harness({ open, onCreated }: { open: boolean; onCreated(id: string): void }) {
    return (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NextIntlClientProvider locale="en" messages={MESSAGES.en as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
          <ThemeProvider theme={theme}>
            <ManualOrderPanel open={open} onClose={vi.fn()} onCreated={onCreated} />
          </ThemeProvider>
        </NextIntlClientProvider>
      </SWRConfig>
    );
  }

  it('reopening never renders the previous order, not even for the first render', async () => {
    const onCreated = vi.fn();
    const { rerender } = render(<Harness open onCreated={onCreated} />);
    await ready('en');
    fillValid('en');
    await act(async () => { clickPrimary(); });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    rerender(<Harness open={false} onCreated={onCreated} />);
    rerender(<Harness open onCreated={onCreated} />);
    // Synchronously after the reopening render: the old customer name must not be in the DOM.
    expect(screen.queryByDisplayValue('Ayşe Yılmaz')).toBeNull();
    await ready('en');
    expect((screen.getByLabelText(M('en').name) as HTMLInputElement).value).toBe('');
  });

  it('a server 400 shows the localized failure body, never the Turkish server text', async () => {
    manualResponse = { status: 400, body: { error: 'Müşteri adı gerekli' } };
    render(<Harness open onCreated={vi.fn()} />);
    await ready('en');
    fillValid('en');
    await act(async () => { clickPrimary(); });
    expect(await screen.findByText(M('en').failedBody)).toBeTruthy();
    expect(screen.queryByText('Müşteri adı gerekli')).toBeNull();
  });
});
