// @vitest-environment jsdom
// orders §13 G4 — CreateLabelPanel + BulkCreateLabelsPanel render/flow tests (EN + TR, strict i18n).
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import type { OrderRow } from '@/lib/orders/types';
import { withG4 } from './g4-messages';

const connState: { connections: Record<string, { connected: boolean; reason?: string }> } = { connections: {} };
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({
    connections: connState.connections,
    isLoading: false,
    error: undefined,
    get: (p: string) => connState.connections[p] ?? { connected: false, accounts: [], needsReauth: false },
    has: (p: string) => !!connState.connections[p]?.connected,
    mutate: async () => undefined,
  }),
}));

// Imported after the mock.
const { CreateLabelPanel } = await import('@/components/domain/shipping/CreateLabelPanel');
const { BulkCreateLabelsPanel } = await import('@/components/domain/shipping/BulkCreateLabelsPanel');

type Locale = 'en' | 'tr';
const sender = {
  shipperName: 'Belle Couture Gifts', shipperPersonName: 'Tamer S.', shipperPhoneNumber: '+905321112233', shipperStreet1: 'Atatürk Cad. 12',
  shipperCity: 'Bursa', shipperPostalCode: '16110', shipperCountryCode: 'TR', defaultCurrencyCode: 'USD', dutiesPaymentType: 'RECIPIENT',
};
let settingsBody: Record<string, unknown>;
const routes: Record<string, Array<{ status: number; body: unknown }>> = {};
const calls: Array<{ url: string; init?: RequestInit }> = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  if (url === '/api/user/settings') return new Response(JSON.stringify(settingsBody), { status: 200 });
  const q = routes[url];
  const next = q && q.length > 1 ? q.shift()! : q?.[0];
  if (next) return new Response(JSON.stringify(next.body), { status: next.status });
  return new Response('{}', { status: 404 });
});

function row(p: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'ord_1', orderNumber: '3891', marketplace: 'BelleCoutureGifts', store: { key: 'etsy', marketplace: 'etsy', shopName: 'BelleCoutureGifts' },
    storeName: 'BelleCoutureGifts', isManual: false, orderedAt: null, importedAt: null, shipBy: null, shippedAt: null, shippingUpgrade: null,
    total: 139.98, currency: 'USD', buyerName: 'Sarah Miller',
    items: [{ id: 'it_1', title: 'Personalized Baby Blanket', listingUrl: null, variant: null, sku: 'BB', quantity: 1, unitPrice: 139.98, image: null, personalization: null, weightKg: 0.8, hsCode: '630210', originCountry: 'TR', shipBy: null }],
    shipTo: { name: 'Sarah Miller', firstName: 'Sarah', lastName: 'Miller', phone: '+15550134', email: 'sarah@example.com', country: 'US', street1: '12 Oak St', street2: '', city: 'Austin', state: 'TX', postal: '78701', district: '', neighbourhood: '', missing: [], unavailable: false, nameHidden: false, enrichedFromEtsy: false },
    giftMessage: null, buyerNote: null, note: null,
    status: { domain: 'order', key: 'to_ship', raw: 'paid' }, rawStatus: 'paid',
    label: null, labelFailure: null, marketplaceCargoNumber: null, trackingSubmission: null, carrierCost: null,
    isFBA: false, isMCF: false, canLabel: true, marketplaceUrl: null, history: [],
    raw: { id: 'ord_1', marketplace: 'BelleCoutureGifts', orderNumber: '3891' },
    ...p,
  } as OrderRow;
}

function wrap(ui: React.ReactElement, locale: Locale = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={withG4(locale) as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  settingsBody = { shipperProfile: sender, shippingSettings: {}, subscription: { subscriptionPlan: 'starter', billingProvider: 'stripe' } };
  connState.connections = { fedex: { connected: false }, ups: { connected: true }, mng: { connected: false } };
  for (const k of Object.keys(routes)) delete routes[k];
  calls.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  try { window.localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const bodyFor = (url: string, n = 0) => JSON.parse(String(calls.filter((c) => c.url === url)[n]?.init?.body ?? 'null'));

describe('CreateLabelPanel', () => {
  for (const locale of ['en', 'tr'] as const) {
    it(`renders every section with the order phone prefilled (${locale})`, async () => {
      wrap(<CreateLabelPanel order={row()} open onClose={vi.fn()} onCreated={vi.fn()} />, locale);
      expect(await screen.findByTestId('label-carrier')).toBeTruthy();
      for (const id of ['label-from', 'label-shipto', 'label-package', 'label-customs', 'label-options']) expect(screen.getByTestId(id)).toBeTruthy();
      expect(screen.getByTestId('shipto-summary').textContent).toContain('+15550134');
      expect(screen.getByText(locale === 'en' ? 'Create label · Order #3891' : 'Etiket oluştur · Sipariş #3891')).toBeTruthy();
      // UPS is the only connected carrier: FedEx row says why it is disabled, DHL is TR-only.
      const list = screen.getByTestId('rate-list');
      expect(within(list).getAllByText(locale === 'en' ? 'Connect FedEx in Settings' : "FedEx hesabını Ayarlar'dan bağlayın").length).toBeGreaterThan(0);
      expect(within(list).getByText(locale === 'en' ? 'Turkey domestic only' : 'Yalnızca Türkiye içi')).toBeTruthy();
    });
  }

  it('creates a UPS label, refreshes, pushes tracking and reports Etsy as queued', async () => {
    routes['/api/labels/ups'] = [{ status: 200, body: { success: true, trackingNumber: '1Z999AA10123456784', labelUrl: 'data:image/gif;base64,R0lGODlh' } }];
    routes['/api/orders/ord_1/submit-tracking'] = [{ status: 200, body: { success: true, etsyPending: true } }];
    const onCreated = vi.fn();
    wrap(<CreateLabelPanel order={row()} open onClose={vi.fn()} onCreated={onCreated} />);
    const create = await screen.findByRole('button', { name: 'Create label' });
    fireEvent.click(create);
    await screen.findByTestId('label-success');
    expect(onCreated).toHaveBeenCalledWith({ orderId: 'ord_1', trackingNumber: '1Z999AA10123456784', labelHref: 'data:image/gif;base64,R0lGODlh' });
    const body = bodyFor('/api/labels/ups');
    expect(body.recipient).toMatchObject({ name: 'Sarah Miller', phone: '+15550134', countryCode: 'US', stateCode: 'TX' });
    expect(body.dutyPaymentType).toBe('RECEIVER');
    expect(await screen.findByText('Queued for the Chrome extension · Open Etsy to send it')).toBeTruthy();
    expect(bodyFor('/api/orders/ord_1/submit-tracking')).toMatchObject({ trackingNumber: '1Z999AA10123456784', carrierId: 5 });
    expect(screen.getByRole('button', { name: 'Print label' })).toBeTruthy();
  });

  it('409 ORDER_CANCELLED opens the cancelled-order dialog; "Create anyway" retries with forceCancelled', async () => {
    routes['/api/labels/ups'] = [
      { status: 409, body: { success: false, code: 'ORDER_CANCELLED', messageKey: 'x' } },
      { status: 200, body: { success: true, trackingNumber: '1Z999AA10123456784', labelUrl: null } },
    ];
    wrap(<CreateLabelPanel order={row({ marketplace: 'Manual', store: { key: 'manual', marketplace: 'manual', shopName: null } as never })} open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create label' }));
    const dialog = await screen.findByRole('dialog', { name: /cancelled/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /anyway/i }));
    await screen.findByTestId('label-success');
    expect(bodyFor('/api/labels/ups', 0).forceCancelled).toBeUndefined();
    expect(bodyFor('/api/labels/ups', 1).forceCancelled).toBe(true);
    // Manual order: no tracking push.
    expect(calls.some((c) => c.url.includes('submit-tracking'))).toBe(false);
  });

  it('402 shows the inline limit Banner and disables the primary (no toast)', async () => {
    routes['/api/labels/ups'] = [{ status: 402, body: { error: 'Payment Required' } }];
    wrap(<CreateLabelPanel order={row()} open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create label' }));
    expect(await screen.findByTestId('label-limit')).toBeTruthy();
    expect(screen.getByText('See plans')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create label' }) as HTMLButtonElement).getAttribute('aria-disabled') ?? (screen.getByRole('button', { name: 'Create label' }) as HTMLButtonElement).disabled).toBeTruthy();
  });

  it('shopify_free never sees "See plans"', async () => {
    settingsBody = { ...settingsBody, subscription: { subscriptionPlan: 'shopify_free', billingProvider: 'shopify_free' } };
    routes['/api/labels/ups'] = [{ status: 402, body: {} }];
    wrap(<CreateLabelPanel order={row()} open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create label' }));
    await screen.findByTestId('label-limit');
    expect(screen.queryByText('See plans')).toBeNull();
  });

  it('carrier error shows the carrier text inline and keeps the fields', async () => {
    routes['/api/labels/ups'] = [{ status: 400, body: { success: false, error: 'Postal code is invalid for US' } }];
    wrap(<CreateLabelPanel order={row()} open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create label' }));
    const err = await screen.findByTestId('label-error');
    expect(err.textContent).toContain('UPS said: Postal code is invalid for US');
  });

  it('incomplete sender profile: danger Banner and no request', async () => {
    settingsBody = { ...settingsBody, shipperProfile: { ...sender, shipperPhoneNumber: '' } };
    wrap(<CreateLabelPanel order={row()} open onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByTestId('sender-missing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create label' }));
    expect(calls.some((c) => c.url === '/api/labels/ups')).toBe(false);
  });

  it('validation on submit: summary Banner, only the missing Ship to field is asked', async () => {
    const r = row();
    wrap(<CreateLabelPanel order={{ ...r, shipTo: { ...r.shipTo, postal: '' } }} open onClose={vi.fn()} onCreated={vi.fn()} />);
    // Missing postal: the summary card stays, and only the postal field renders under it.
    expect(await screen.findByTestId('shipto-postal')).toBeTruthy();
    expect(screen.queryByTestId('ship-to-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create label' }));
    expect(await screen.findByText('Fix 1 field to continue')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/labels/ups')).toBe(false);
  });

  it('no carrier connected → first-use EmptyState', async () => {
    connState.connections = { fedex: { connected: false }, ups: { connected: false }, mng: { connected: false } };
    wrap(<CreateLabelPanel order={row()} open onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByText('Connect a carrier to create labels')).toBeTruthy();
  });

  it('an order with a label opens on that label; "Create another label…" is in ⋯', async () => {
    const r = row({ label: { source: 'shipment', shipmentId: 'sh_1', carrier: 'UPS', trackingNumber: '1ZEXISTING01', labelHref: 'https://x/l.pdf', createdAt: null } });
    wrap(<CreateLabelPanel order={r} open onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByText('This order already has a label')).toBeTruthy();
    expect(screen.getByText('1ZEXISTING01')).toBeTruthy();
    expect(screen.getByText('No preview for this file. Use Print label.')).toBeTruthy();
  });
  it('an existing label shows its stored tracking-push failure with Retry', async () => {
    routes['/api/orders/ord_1/submit-tracking'] = [{ status: 200, body: { success: true, etsyPending: true } }];
    const r = row({
      label: { source: 'shipment', shipmentId: 'sh_1', carrier: 'UPS', trackingNumber: '1ZEXISTING01', labelHref: 'https://x/l.pdf', createdAt: null },
      trackingSubmission: { state: 'failed', trackingNumber: '1ZEXISTING01', carrierName: 'UPS', submittedAt: null, deliveredAt: null, error: 'x' },
    });
    wrap(<CreateLabelPanel order={r} open onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByTestId('tracking-failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Queued for the Chrome extension · Open Etsy to send it')).toBeTruthy();
  });

  it('a Trendyol order offers no tracking push (submit-tracking has no Trendyol branch)', async () => {
    routes['/api/labels/ups'] = [{ status: 200, body: { success: true, trackingNumber: '1Z999AA10123456784', labelUrl: null } }];
    const r = row({ marketplace: 'Trendyol', store: { key: 'trendyol', marketplace: 'trendyol', shopName: null } as never });
    wrap(<CreateLabelPanel order={r} open onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByTestId('label-carrier');
    expect(screen.queryByTestId('option-send-tracking')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create label' }));
    await screen.findByTestId('label-success');
    expect(calls.some((c) => c.url.endsWith('/submit-tracking'))).toBe(false);
    expect(screen.queryByTestId('tracking-failed')).toBeNull();
  });
});

describe('BulkCreateLabelsPanel', () => {
  it('a failed tracking push shows on the created row with Retry and counts in the done line', async () => {
    routes['/api/labels/ups'] = [{ status: 200, body: { success: true, trackingNumber: '1Z999AA10123456784', labelUrl: 'https://x/a.gif' } }];
    routes['/api/orders/ord_1/submit-tracking'] = [
      { status: 200, body: { success: true, message: 'Tracking saved locally. eBay push failed: timeout' } },
      { status: 200, body: { success: true } },
    ];
    wrap(<BulkCreateLabelsPanel orders={[row({ marketplace: 'ebay', store: { key: 'ebay', marketplace: 'ebay', shopName: null } as never })]} open onClose={vi.fn()} onFixOrder={vi.fn()} onDone={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create 1 label' }));
    expect(await screen.findByText('1 labels created · 0 failed · 1 tracking push failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('1 labels created · 0 failed')).toBeTruthy());
  });


  it('splits Ready / Problem, creates sequentially and summarizes', async () => {
    routes['/api/labels/ups'] = [{ status: 200, body: { success: true, trackingNumber: '1Z999AA10123456784', labelUrl: 'https://x/a.gif' } }];
    routes['/api/orders/ord_1/submit-tracking'] = [{ status: 200, body: { success: true, etsyPending: true } }];
    const a = row();
    const b = row({ id: 'ord_2', orderNumber: '3892', shipTo: { ...a.shipTo, postal: '' } });
    const onDone = vi.fn();
    const onFix = vi.fn();
    wrap(<BulkCreateLabelsPanel orders={[a, b]} open onClose={vi.fn()} onFixOrder={onFix} onDone={onDone} />);
    expect(await screen.findByText('1 ready · 1 need details')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Fix' })[0]);
    expect(onFix).toHaveBeenCalledWith('ord_2');
    fireEvent.click(screen.getByRole('button', { name: 'Create 1 label' }));
    expect(await screen.findByText('1 labels created · 0 failed')).toBeTruthy();
    expect(calls.filter((c) => c.url === '/api/labels/ups')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Print 1 label' })).toBeTruthy();
    // The summary stays until the user closes; onDone fires then.
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('DHL eCommerce is disabled unless every order ships within Turkey (tr)', async () => {
    connState.connections = { fedex: { connected: true }, ups: { connected: true }, mng: { connected: true } };
    wrap(<BulkCreateLabelsPanel orders={[row()]} open onClose={vi.fn()} onFixOrder={vi.fn()} onDone={vi.fn()} />, 'tr');
    expect(await screen.findByText('DHL eCommerce yalnızca tüm siparişler Türkiye içine gönderiliyorsa kullanılabilir')).toBeTruthy();
  });
});

describe('DHL recipient phone: "Use my phone" (legacy MNG fallback, explicit only)', () => {
  const trRow = (p: Partial<OrderRow> = {}) => {
    const base = row({ marketplace: 'Trendyol', store: { key: 'trendyol', marketplace: 'trendyol', shopName: null } as never });
    return row({
      ...base,
      shipTo: { ...base.shipTo, name: 'Ayşe Yılmaz', phone: '', email: '', country: 'TR', street1: 'Cumhuriyet Mah. 5', city: 'Bursa', state: '', postal: '16000', district: 'Nilüfer' },
      ...p,
    });
  };

  it('pure: senderPhoneE164 normalizes the sender phone; withSenderPhone fills only empty phones', async () => {
    const { senderPhoneE164 } = await import('@/components/domain/orders/panel/ShipToForm');
    const { withSenderPhone } = await import('@/components/domain/shipping/BulkCreateLabelsPanel');
    expect(senderPhoneE164({ shipperPhoneNumber: '0532 111 22 33', shipperCountryCode: 'TR' })).toBe('+905321112233');
    expect(senderPhoneE164({ shipperPhoneNumber: '', shipperCountryCode: 'TR' })).toBe('');
    expect(senderPhoneE164(null)).toBe('');
    const mk = (phone: string) => ({ draft: { shipTo: { phone } } as never });
    const out = withSenderPhone([mk(''), mk('+905550000000')], '+905321112233');
    expect(out.map((r) => (r.draft as { shipTo: { phone: string } }).shipTo.phone)).toEqual(['+905321112233', '+905550000000']);
    expect(withSenderPhone([mk('')], '')[0].draft).toEqual(mk('').draft);
  });

  it.each(['en', 'tr'] as Locale[])('single label: DHL + no order phone offers the seller phone in one click (%s)', async (locale) => {
    connState.connections = { fedex: { connected: false }, ups: { connected: false }, mng: { connected: true } };
    wrap(<CreateLabelPanel order={trRow()} open onClose={vi.fn()} onCreated={vi.fn()} />, locale);
    const label = locale === 'en' ? 'Use my phone (+905321112233)' : 'Telefonumu kullan (+905321112233)';
    const btn = await screen.findByRole('button', { name: label });
    // Never applied automatically: the offer only renders while the phone is empty.
    const inputs = Array.from(screen.getByTestId('shipto-phone').querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs.some((i) => i.value.includes('5321112233'))).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByTestId('shipto-use-sender-phone')).toBeNull());
    const after = Array.from(screen.getByTestId('shipto-phone').querySelectorAll('input')) as HTMLInputElement[];
    expect(after.some((i) => i.value.replace(/\D/g, '').includes('5321112233'))).toBe(true);
  });

  it('single label: not offered for UPS/FedEx or when the order has a phone', async () => {
    connState.connections = { fedex: { connected: false }, ups: { connected: true }, mng: { connected: false } };
    wrap(<CreateLabelPanel order={row({ shipTo: { ...row().shipTo, phone: '' } })} open onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByTestId('label-carrier');
    expect(screen.queryByTestId('shipto-use-sender-phone')).toBeNull();
  });

  it('bulk: DHL rows missing only the phone become Ready after "Use my phone"', async () => {
    connState.connections = { fedex: { connected: false }, ups: { connected: false }, mng: { connected: true } };
    const a = trRow();
    const b = trRow({ id: 'ord_2', orderNumber: '3892' });
    wrap(<BulkCreateLabelsPanel orders={[a, b]} open onClose={vi.fn()} onFixOrder={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByText('2 orders have no recipient phone')).toBeTruthy();
    expect(screen.getByText('0 ready · 2 need details')).toBeTruthy();
    fireEvent.click(within(screen.getByTestId('bulk-no-phone')).getByRole('button', { name: 'Use my phone (+905321112233)' }));
    expect(await screen.findByText('2 ready · 0 need details')).toBeTruthy();
    expect(screen.queryByTestId('bulk-no-phone')).toBeNull();
  });
});
