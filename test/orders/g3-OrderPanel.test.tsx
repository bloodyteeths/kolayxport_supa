// @vitest-environment jsdom
// M3 orders-G3: OrderPanel render (EN/TR), primary rule, delete confirms, FBA read-only, tracking + ship-to writes.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import type { OrderRow } from '@/lib/orders/types';
import { G3_EN, G3_TR } from './g3-messages';
import { fbaRow, labeledRow, makeRow } from './g3-fixtures';

// ── module mocks ─────────────────────────────────────────────────────────────────────────────────────
const single = { row: undefined as OrderRow | undefined, state: 'loading' as string, mutate: vi.fn(async () => undefined) };
vi.mock('@/lib/hooks/useOrdersList', () => ({ useOrder: () => single }));

const lifecycle = { flags: {} as Record<string, unknown>, mutate: vi.fn() };
vi.mock('@/components/orders-live/useOrderLifecycleFlags', () => ({ useOrderLifecycleFlags: () => lifecycle }));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() };
vi.mock('@/components/ds/feedback/toast', () => ({ useToast: () => toast }));

// Imported after the mocks.
import { OrderPanel, orderPanelPrimary, hasLifecycleBadges } from '@/components/domain/orders/panel/OrderPanel';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, G3_EN), tr: deepMerge(tr as Obj, G3_TR) };
type Locale = keyof typeof MESSAGES;
const LOCALES: Locale[] = ['en', 'tr'];

function msg(locale: Locale, path: string): string {
  const v = path.split('.').reduce<unknown>((o, k) => (o as Obj)?.[k], MESSAGES[locale]);
  if (typeof v !== 'string') throw new Error(`missing ${locale}:${path}`);
  return v;
}

const fetchMock = vi.fn();
let responses: Record<string, { status: number; body: unknown }>;

beforeEach(() => {
  single.row = undefined;
  single.state = 'loading';
  lifecycle.flags = {};
  Object.values(toast).forEach((f) => f.mockReset());
  responses = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${(init?.method || 'GET').toUpperCase()} ${url}`;
    const r = responses[key] ?? { status: 200, body: { success: true } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type PanelProps = Partial<React.ComponentProps<typeof OrderPanel>> & { rows?: OrderRow[] };
function renderPanel(locale: Locale, props: PanelProps = {}) {
  const handlers = {
    onClose: props.onClose ?? vi.fn(),
    onNavigate: props.onNavigate ?? vi.fn(),
    onCreateLabel: props.onCreateLabel ?? vi.fn(),
    onChanged: props.onChanged ?? vi.fn(),
  };
  const tree = (p: PanelProps) => {
    const rows = p.rows ?? [makeRow()];
    return (
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
        <ThemeProvider theme={theme}>
          <OrderPanel
            orderId={p.orderId === undefined ? rows[0]?.id ?? null : p.orderId}
            rows={rows}
            initialAction={p.initialAction}
            onInitialActionHandled={p.onInitialActionHandled}
            {...handlers}
          />
        </ThemeProvider>
      </NextIntlClientProvider>
    );
  };
  const cache = new Map();
  const utils = render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{tree(props)}</SWRConfig>);
  const rerender = (p: PanelProps) => utils.rerender(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{tree(p)}</SWRConfig>);
  return { ...handlers, rerender };
}

function calls(method: string, url: string) {
  return fetchMock.mock.calls.filter(([u, init]) => u === url && ((init as RequestInit | undefined)?.method || 'GET').toUpperCase() === method);
}

async function openOverflow(locale: Locale) {
  const panel = screen.getByTestId('order-panel');
  const trigger = within(panel).getAllByTestId('overflow-trigger')[0];
  await act(async () => {
    fireEvent.click(trigger);
  });
  void locale;
}

// ── pure rules ───────────────────────────────────────────────────────────────────────────────────────
describe('orderPanelPrimary (P1)', () => {
  it('labelable → create label; labeled with a file → print; address problem → fix; FBA / closed → none', () => {
    expect(orderPanelPrimary(makeRow())).toBe('create_label');
    expect(orderPanelPrimary(labeledRow())).toBe('print_label');
    expect(orderPanelPrimary(labeledRow({ label: { ...labeledRow().label!, labelHref: null } }))).toBeNull();
    expect(orderPanelPrimary(makeRow({ canLabel: false, status: { domain: 'order', key: 'problem', raw: 'paid', reason: 'address_incomplete' }, shipTo: { ...makeRow().shipTo, postal: '', missing: ['postal'] } }))).toBe('fix_address');
    expect(orderPanelPrimary(fbaRow())).toBeNull();
    expect(orderPanelPrimary(makeRow({ canLabel: false, status: { domain: 'order', key: 'shipped', raw: 'Shipped' } }))).toBeNull();
  });

  it('closed orders never get Print label as the primary, even with a label file', () => {
    for (const key of ['cancelled', 'refunded', 'shipped', 'delivered'] as const) {
      expect(orderPanelPrimary(labeledRow({ status: { domain: 'order', key, raw: key } }))).toBeNull();
    }
  });

  it('lifecycle section only when a badge would render', () => {
    expect(hasLifecycleBadges(null)).toBe(false);
    expect(hasLifecycleBadges({ cancelled: false, late: false } as never)).toBe(false);
    expect(hasLifecycleBadges({ cancelledAfterLabel: true } as never)).toBe(true);
    expect(hasLifecycleBadges({ dispatchState: 'label_not_pushed' } as never)).toBe(true);
  });
});

describe.each(LOCALES)('OrderPanel (%s)', (locale) => {
  it('renders header, sections and the Create label primary', async () => {
    const h = renderPanel(locale);
    const panel = screen.getByTestId('order-panel');
    expect(within(panel).getByText(msg(locale, 'orders.panel.title').replace('{number}', '#3891'))).toBeTruthy();
    expect(within(panel).getByText('Personalized Baby Blanket')).toBeTruthy();
    expect(within(panel).getByText(msg(locale, 'orders.panel.labelTracking'))).toBeTruthy();
    expect(within(panel).getByText(msg(locale, 'orders.panel.noLabel'))).toBeTruthy();
    expect(within(panel).getByTestId('order-note')).toBeTruthy();
    expect(within(panel).getByTestId('ship-to-upgrade')).toBeTruthy();
    expect(within(panel).getByTestId('order-history')).toBeTruthy();
    const create = within(panel).getByRole('button', { name: msg(locale, 'orders.actions.createLabel') });
    fireEvent.click(create);
    expect(h.onCreateLabel).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }));
    expect(within(panel).getByRole('button', { name: msg(locale, 'orders.actions.printPackingSlip') })).toBeTruthy();
  });

  it('delete order: confirm names the order; cancel sends nothing; confirm deletes and closes', async () => {
    const h = renderPanel(locale);
    await openOverflow(locale);
    fireEvent.click(screen.getByTestId('overflow-item-delete-order'));
    const dialog = await screen.findByTestId('confirm-delete-order');
    expect(within(dialog).getByText(msg(locale, 'orders.confirm.deleteOrder.title').replace('{number}', '#3891'))).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: msg(locale, 'ds.overlay.cancel') }));
    expect(calls('DELETE', '/api/orders/o1/delete')).toHaveLength(0);

    await openOverflow(locale);
    fireEvent.click(screen.getByTestId('overflow-item-delete-order'));
    const again = await screen.findByTestId('confirm-delete-order');
    await act(async () => {
      fireEvent.click(within(again).getByRole('button', { name: msg(locale, 'orders.confirm.deleteOrder.confirm') }));
    });
    await waitFor(() => expect(calls('DELETE', '/api/orders/o1/delete')).toHaveLength(1));
    await waitFor(() => expect(h.onClose).toHaveBeenCalled());
    expect(h.onChanged).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('delete label only with a Shipment id; confirm says it is not voided; deletes the Shipment row', async () => {
    renderPanel(locale, { rows: [labeledRow()] });
    await openOverflow(locale);
    fireEvent.click(screen.getByTestId('overflow-item-delete-label'));
    const dialog = await screen.findByTestId('confirm-delete-label');
    expect(within(dialog).getByText(msg(locale, 'orders.confirm.deleteLabel.body'))).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: msg(locale, 'orders.confirm.deleteLabel.confirm') }));
    });
    await waitFor(() => expect(calls('DELETE', '/api/shipments/s1/delete')).toHaveLength(1));
  });

  it('no Delete label for a FedEx LabelJob label (no shipmentId); Print label is the primary', async () => {
    const row = labeledRow({ label: { source: 'labelJob', shipmentId: null, carrier: 'FedEx', trackingNumber: '794612900012', labelHref: 'https://x.test/l.pdf', createdAt: null } });
    renderPanel(locale, { rows: [row] });
    const panel = screen.getByTestId('order-panel');
    expect(within(panel).getByRole('button', { name: msg(locale, 'orders.actions.printLabel') })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: msg(locale, 'orders.actions.createLabel') })).toBeNull();
    await openOverflow(locale);
    expect(screen.queryByTestId('overflow-item-delete-label')).toBeNull();
    expect(screen.getByTestId('overflow-item-delete-order')).toBeTruthy();
  });

  it('FBA is read-only: no primary, no packing-slip button, no tracking action, the FBA line shows', async () => {
    renderPanel(locale, { rows: [fbaRow()] });
    const panel = screen.getByTestId('order-panel');
    expect(within(panel).getByTestId('label-fba').textContent).toBe(msg(locale, 'orders.row.fbaNoLabel'));
    expect(within(panel).queryByRole('button', { name: msg(locale, 'orders.actions.createLabel') })).toBeNull();
    expect(within(panel).queryByRole('button', { name: msg(locale, 'orders.actions.printPackingSlip') })).toBeNull();
    expect(within(panel).queryByTestId('label-add-tracking')).toBeNull();
    await openOverflow(locale);
    expect(screen.queryByTestId('overflow-item-add-tracking')).toBeNull();
    // FBA (not MCF) Amazon orders may still be messaged.
    expect(screen.getByTestId('overflow-item-message-buyer')).toBeTruthy();
  });

  it('manual orders get no tracking push', async () => {
    renderPanel(locale, { rows: [makeRow({ isManual: true, marketplace: 'Manual', store: { key: 'manual', marketplace: 'manual', shopName: null }, storeName: 'Manual', marketplaceUrl: null })] });
    expect(screen.queryByTestId('label-add-tracking')).toBeNull();
    await openOverflow(locale);
    expect(screen.queryByTestId('overflow-item-add-tracking')).toBeNull();
    expect(screen.queryByTestId('overflow-item-open-on')).toBeNull();
  });

  it('add tracking: prefilled from the latest label, posts the legacy body, reports a queued Etsy push', async () => {
    const row = labeledRow({ trackingSubmission: null });
    responses['POST /api/orders/o1/submit-tracking'] = { status: 200, body: { success: true, etsyPending: true } };
    const h = renderPanel(locale, { rows: [row], initialAction: 'addTracking' });
    const modal = await screen.findByTestId('add-tracking-modal');
    const input = within(modal).getByTestId('tracking-number').querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('1Z999AA10123456784');
    await act(async () => {
      fireEvent.click(within(modal).getByRole('button', { name: /Etsy/ }));
    });
    await waitFor(() => expect(calls('POST', '/api/orders/o1/submit-tracking')).toHaveLength(1));
    const body = JSON.parse(String((calls('POST', '/api/orders/o1/submit-tracking')[0][1] as RequestInit).body));
    expect(body).toEqual({ trackingNumber: '1Z999AA10123456784', carrierId: 5, notifyCustomer: true, updateRemoteOrder: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(msg(locale, 'orders.tracking.queued')));
    expect(h.onChanged).toHaveBeenCalled();
  });

  it('add tracking: a malformed number is a field error, nothing is sent', async () => {
    renderPanel(locale, { initialAction: 'addTracking' });
    const modal = await screen.findByTestId('add-tracking-modal');
    const input = within(modal).getByTestId('tracking-number').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    await act(async () => {
      fireEvent.click(within(modal).getByRole('button', { name: /Etsy/ }));
    });
    expect(within(modal).getByText(msg(locale, 'orders.tracking.invalid'))).toBeTruthy();
    expect(calls('POST', '/api/orders/o1/submit-tracking')).toHaveLength(0);
  });

  it('ship to edit saves the fields /api/orders/update reads (KolayXport only)', async () => {
    renderPanel(locale);
    const section = screen.getByTestId('panel-section-order-ship-to');
    fireEvent.click(within(section).getByRole('button', { name: msg(locale, 'orders.panel.edit') }));
    const city = within(section).getByTestId('shipto-city').querySelector('input') as HTMLInputElement;
    fireEvent.change(city, { target: { value: 'Round Rock' } });
    await act(async () => {
      fireEvent.click(within(section).getByTestId('ship-to-save'));
    });
    await waitFor(() => expect(calls('POST', '/api/orders/update')).toHaveLength(1));
    const body = JSON.parse(String((calls('POST', '/api/orders/update')[0][1] as RequestInit).body));
    expect(body).toMatchObject({
      id: 'o1', recipientFirstName: 'Sarah', recipientLastName: 'Miller', recipientStreet1: '12 Oak St', recipientStreet2: 'Apt 4',
      recipientCity: 'Round Rock', recipientState: 'TX', recipientPostal: '78701', recipientCountry: 'US', recipientPhone: '+15550134',
      shippingAddress: expect.objectContaining({ email: 'sarah@example.com', city: 'Round Rock' }),
    });
  });

  it('ship to edit: an empty required field blocks the save', async () => {
    renderPanel(locale);
    const section = screen.getByTestId('panel-section-order-ship-to');
    fireEvent.click(within(section).getByRole('button', { name: msg(locale, 'orders.panel.edit') }));
    const street = within(section).getByTestId('shipto-street1').querySelector('input') as HTMLInputElement;
    fireEvent.change(street, { target: { value: '' } });
    await act(async () => {
      fireEvent.click(within(section).getByTestId('ship-to-save'));
    });
    expect(within(section).getAllByText(msg(locale, 'createLabel.validation.required')).length).toBeGreaterThan(0);
    expect(calls('POST', '/api/orders/update')).toHaveLength(0);
  });

  it('an off-page order loads through useOrder: skeleton, then "no longer exists"', () => {
    single.state = 'loading';
    renderPanel(locale, { rows: [], orderId: 'gone-1' });
    expect(screen.getByTestId('order-panel-loading')).toBeTruthy();
    cleanup();
    single.state = 'empty';
    const h = renderPanel(locale, { rows: [], orderId: 'gone-1' });
    const gone = screen.getByTestId('order-panel-gone');
    expect(within(gone).getByText(msg(locale, 'orders.error.orderGone'))).toBeTruthy();
    fireEvent.click(within(gone).getByRole('button', { name: msg(locale, 'orders.error.backToOrders') }));
    expect(h.onClose).toHaveBeenCalled();
  });

  it('prev / next stay within the page; disabled at the edges', () => {
    const rows = [makeRow({ id: 'a', orderNumber: '1' }), makeRow({ id: 'b', orderNumber: '2' })];
    const h = renderPanel(locale, { rows, orderId: 'a' });
    const next = screen.getByTestId('panel-next');
    const prev = screen.getByTestId('panel-prev');
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(next);
    expect(h.onNavigate).toHaveBeenCalledWith('b');
  });

  it('message buyer (Amazon): loads allowed templates, requires text, posts the legacy body', async () => {
    const row = makeRow({
      id: 'a1', orderNumber: '113-1', marketplace: 'Amazon', store: { key: 'amazon', marketplace: 'amazon', shopName: null }, storeName: 'Amazon',
      raw: { id: 'a1', marketplace: 'Amazon', orderNumber: '113-1', rawData: { salesChannel: 'Amazon.com' } },
    });
    responses['GET /api/integrations/amazon/messages?orderId=113-1&marketplaceId=Amazon.com'] = { status: 200, body: { allowedActions: ['unexpectedProblem'] } };
    renderPanel(locale, { rows: [row], initialAction: 'messageBuyer' });
    const modal = await screen.findByTestId('message-buyer-modal');
    await waitFor(() => expect(calls('GET', '/api/integrations/amazon/messages?orderId=113-1&marketplaceId=Amazon.com')).toHaveLength(1));
    const send = within(modal).getByRole('button', { name: msg(locale, 'orders.messageBuyer.send') });
    await act(async () => {
      fireEvent.click(send);
    });
    expect(within(modal).getByText(msg(locale, 'orders.messageBuyer.textRequired'))).toBeTruthy();
    const textarea = within(modal).getByTestId('message-buyer-text').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Your parcel is delayed by one day.' } });
    await act(async () => {
      fireEvent.click(send);
    });
    await waitFor(() => expect(calls('POST', '/api/integrations/amazon/messages')).toHaveLength(1));
    const body = JSON.parse(String((calls('POST', '/api/integrations/amazon/messages')[0][1] as RequestInit).body));
    expect(body).toEqual({ orderId: '113-1', marketplaceId: 'Amazon.com', messageType: 'unexpectedProblem', text: 'Your parcel is delayed by one day.' });
    expect(toast.success).toHaveBeenCalledWith(msg(locale, 'orders.messageBuyer.sent'));
  });

  it('carrier cost saves on blur through the shipping-cost endpoint', async () => {
    responses['GET /api/user/settings'] = { status: 200, body: { shipperProfile: { shipperCountryCode: 'TR' } } };
    responses['PATCH /api/orders/o1/shipping-cost'] = { status: 200, body: { success: true, manualShippingCost: 412.5, manualShippingCostCurrency: 'TRY' } };
    renderPanel(locale);
    await waitFor(() => expect(calls('GET', '/api/user/settings')).toHaveLength(1));
    await act(async () => {
      await Promise.resolve();
    });
    const input = screen.getByTestId('carrier-cost').querySelector('input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: locale === 'tr' ? '412,50' : '412.50' } });
    await act(async () => {
      fireEvent.blur(input);
    });
    await waitFor(() => expect(calls('PATCH', '/api/orders/o1/shipping-cost')).toHaveLength(1));
    const body = JSON.parse(String((calls('PATCH', '/api/orders/o1/shipping-cost')[0][1] as RequestInit).body));
    expect(body).toEqual({ cost: 412.5, currency: 'TRY' });
  });

  it('carrier cost defaults to the account base currency (USD account)', async () => {
    responses['GET /api/user/settings'] = { status: 200, body: { shipperProfile: { shipperCountryCode: 'US', defaultCurrencyCode: 'USD' } } };
    responses['PATCH /api/orders/o1/shipping-cost'] = { status: 200, body: { success: true, manualShippingCost: 12.5, manualShippingCostCurrency: 'USD' } };
    renderPanel(locale);
    await waitFor(() => expect(calls('GET', '/api/user/settings')).toHaveLength(1));
    await act(async () => {
      await Promise.resolve();
    });
    const input = screen.getByTestId('carrier-cost').querySelector('input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: locale === 'tr' ? '12,50' : '12.50' } });
    await act(async () => {
      fireEvent.blur(input);
    });
    await waitFor(() => expect(calls('PATCH', '/api/orders/o1/shipping-cost')).toHaveLength(1));
    const body = JSON.parse(String((calls('PATCH', '/api/orders/o1/shipping-cost')[0][1] as RequestInit).body));
    expect(body).toEqual({ cost: 12.5, currency: 'USD' });
  });

  it('initialAction opens the modal once per request; a row that leaves and returns does not reopen it', async () => {
    const handled = vi.fn();
    const row = labeledRow({ trackingSubmission: null });
    const h = renderPanel(locale, { rows: [row], initialAction: 'addTracking', onInitialActionHandled: handled });
    const modal = await screen.findByTestId('add-tracking-modal');
    expect(handled).toHaveBeenCalledTimes(1);
    fireEvent.click(within(modal).getByRole('button', { name: msg(locale, 'ds.overlay.cancel') }));
    await waitFor(() => expect(screen.queryByTestId('add-tracking-modal')).toBeNull());
    // The row drops out of `rows` (revalidation) and comes back: still closed.
    single.state = 'loading';
    h.rerender({ rows: [], orderId: 'o1', initialAction: 'addTracking', onInitialActionHandled: handled });
    h.rerender({ rows: [row], orderId: 'o1', initialAction: 'addTracking', onInitialActionHandled: handled });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('add-tracking-modal')).toBeNull();
    // The parent clears the request, then asks again: the modal opens again.
    h.rerender({ rows: [row], orderId: 'o1', initialAction: null, onInitialActionHandled: handled });
    h.rerender({ rows: [row], orderId: 'o1', initialAction: 'addTracking', onInitialActionHandled: handled });
    expect(await screen.findByTestId('add-tracking-modal')).toBeTruthy();
    expect(handled).toHaveBeenCalledTimes(2);
  });

  it('the header order number is copyable', () => {
    renderPanel(locale);
    expect(within(screen.getByTestId('order-panel-number')).getByText('#3891')).toBeTruthy();
  });

  it('closing keeps the last order on screen while the panel slides out (no skeleton flash)', () => {
    const h = renderPanel(locale);
    h.rerender({ orderId: null });
    expect(screen.queryByTestId('order-panel-loading')).toBeNull();
  });

  it('ship to edit (TR): District / Neighbourhood are not offered, since the save cannot store them', () => {
    const row = makeRow({ shipTo: { ...makeRow().shipTo, country: 'TR', state: '', district: 'Kadıköy', neighbourhood: 'Moda' } });
    renderPanel(locale, { rows: [row] });
    const section = screen.getByTestId('panel-section-order-ship-to');
    fireEvent.click(within(section).getByRole('button', { name: msg(locale, 'orders.panel.edit') }));
    expect(section.querySelector('#order-shipto-district')).toBeNull();
    expect(section.querySelector('#order-shipto-neighbourhood')).toBeNull();
  });

  it('address saved toast names the marketplace, not the shop; manual orders get the plain message', async () => {
    renderPanel(locale);
    let section = screen.getByTestId('panel-section-order-ship-to');
    fireEvent.click(within(section).getByRole('button', { name: msg(locale, 'orders.panel.edit') }));
    await act(async () => {
      fireEvent.click(within(section).getByTestId('ship-to-save'));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(msg(locale, 'orders.panel.addressSaved').replace('{marketplace}', 'Etsy')));
    cleanup();
    toast.success.mockReset();
    renderPanel(locale, { rows: [makeRow({ isManual: true, marketplace: 'Manual', store: { key: 'manual', marketplace: 'manual', shopName: null }, storeName: 'Manual', marketplaceUrl: null })] });
    section = screen.getByTestId('panel-section-order-ship-to');
    fireEvent.click(within(section).getByRole('button', { name: msg(locale, 'orders.panel.edit') }));
    await act(async () => {
      fireEvent.click(within(section).getByTestId('ship-to-save'));
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(msg(locale, 'orders.panel.addressSavedManual')));
  });
});
