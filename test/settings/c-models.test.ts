import { describe, expect, it } from 'vitest';
import {
  labelPreviewLines, phoneForStorage, phoneToE164, senderCurrencies, validateSender, REQUIRED_SENDER_FIELDS,
} from '@/components/domain/settings/sender/senderModel';
import {
  errorDetailsText, lastSuccess, runErrors, runType, toRunRow, isRunning, canRetry, type RawSyncRun,
} from '@/components/domain/settings/refresh/refreshModel';
import { historyKey } from '@/components/domain/settings/refresh/useRefreshHistory';
import { effectiveTimeZone, gmtOffset, listTimeZones, timeZoneLabel } from '@/components/domain/settings/PreferencesPanel';

const full = {
  shipperName: 'Modsons Yazılım', shipperPersonName: 'Tamer S.', shipperPhoneNumber: '905320000000',
  shipperTinNumber: '1234567890', shipperTinType: 'VAT', shipperStreet1: 'Atatürk Cd. 1', shipperCity: 'İstanbul',
  shipperPostalCode: '34000', shipperCountryCode: 'TR',
};

describe('sender model', () => {
  it('requires exactly the §6 fields', () => {
    const e = validateSender({}, null);
    expect(Object.keys(e).sort()).toEqual([...REQUIRED_SENDER_FIELDS].sort());
    expect(validateSender(full, { etgbEnabled: false })).toEqual({});
    expect(validateSender({ ...full, shipperCity: '  ' }, null)).toEqual({ shipperCity: 'required' });
  });

  it('validates the ETGB email only while ETGB is on', () => {
    expect(validateSender(full, { etgbEnabled: false, etgbRecipientEmail: 'nope' })).toEqual({});
    expect(validateSender(full, { etgbEnabled: true, etgbRecipientEmail: '' })).toEqual({ etgbRecipientEmail: 'required' });
    expect(validateSender(full, { etgbEnabled: true, etgbRecipientEmail: 'nope' })).toEqual({ etgbRecipientEmail: 'email' });
    expect(validateSender(full, { etgbEnabled: true, etgbRecipientEmail: 'a@b.co' })).toEqual({});
  });

  it('reads legacy free-text phones as E.164 without rewriting them', () => {
    expect(phoneToE164('', 'TR')).toBe('');
    expect(phoneToE164('05320000000', 'TR')).toBe('+905320000000');
    expect(phoneToE164('5320000000', 'TR')).toBe('+905320000000');
    expect(phoneToE164('+90 532 000 00 00', 'TR')).toBe('+905320000000');
    expect(phoneToE164('00905320000000', 'TR')).toBe('+905320000000');
    expect(phoneToE164('905320000000', 'TR')).toBe('+905320000000');
    expect(phoneToE164('2125550100', 'US')).toBe('+12125550100');
  });

  it('stores digits only (UPS sends the value verbatim)', () => {
    expect(phoneForStorage('+905320000000')).toBe('905320000000');
    expect(phoneForStorage('')).toBe('');
  });

  it('builds the label preview lines in print order and drops empties', () => {
    const lines = labelPreviewLines({ ...full, shipperStreet2: '', shipperStateCode: '' }, (c) => (c === 'TR' ? 'Türkiye' : c));
    expect(lines).toEqual(['Modsons Yazılım', 'Tamer S.', 'Atatürk Cd. 1', '34000 İstanbul', 'Türkiye', '+905320000000']);
    expect(labelPreviewLines({}, (c) => c)).toEqual([]);
  });

  it('puts the base currency first', () => {
    expect(senderCurrencies('TRY')).toEqual(['TRY', 'USD', 'EUR']);
    expect(senderCurrencies('USD')).toEqual(['USD', 'TRY', 'EUR']);
  });
});

const raw = (o: Partial<RawSyncRun>): RawSyncRun => ({
  id: 'r1', type: 'full', status: 'completed', startedAt: '2026-10-15T07:40:00.000Z', endedAt: '2026-10-15T07:41:12.000Z',
  processedOrders: 120, successfulOrders: 118, failedOrders: 2, errors: [], ...o,
});

describe('refresh model', () => {
  it('maps raw types to label keys (stores by name)', () => {
    expect(runType('full')).toEqual({ key: 'full', store: null });
    expect(runType('recent')).toEqual({ key: 'recent', store: null });
    expect(runType('product')).toEqual({ key: 'product', store: null });
    expect(runType('trendyol')).toEqual({ key: 'store', store: 'Trendyol' });
    expect(runType('veeqo_full')).toEqual({ key: 'store', store: 'Veeqo' });
    expect(runType('mng')).toEqual({ key: 'store', store: 'DHL eCommerce' });
    expect(runType('weird_thing')).toEqual({ key: 'other', store: null });
    expect(runType('')).toEqual({ key: 'other', store: null });
  });

  it('computes status and duration; none while running or out of order', () => {
    const done = toRunRow(raw({}));
    expect(done.status).toBe('completed');
    expect(done.durationMs).toBe(72_000);
    expect([done.processed, done.successful, done.failed]).toEqual([120, 118, 2]);
    expect(toRunRow(raw({ status: 'in_progress' })).durationMs).toBeNull();
    expect(toRunRow(raw({ status: 'in_progress' })).status).toBe('running');
    expect(toRunRow(raw({ endedAt: '2026-10-15T07:00:00.000Z' })).durationMs).toBeNull();
    expect(toRunRow(raw({ status: 'mystery' })).status).toBeNull();
    const now = Date.parse('2026-10-15T07:45:00.000Z');
    expect(isRunning([toRunRow(raw({ status: 'in_progress' }))], now)).toBe(true);
    // orphaned run (no heartbeat for > 15 min) does not count as running
    expect(isRunning([toRunRow(raw({ status: 'in_progress', endedAt: '2026-10-15T07:20:00.000Z' }))], now)).toBe(false);
    expect(isRunning([toRunRow(raw({ status: 'in_progress', startedAt: '2026-10-15T06:00:00.000Z', endedAt: null }))], now)).toBe(false);
    expect(isRunning([toRunRow(raw({ status: 'in_progress', startedAt: null, endedAt: null }))], now)).toBe(false);
    expect(canRetry(toRunRow(raw({ status: 'failed' })))).toBe(true);
    expect(canRetry(done)).toBe(false);
  });

  it('normalizes errors and copies them as JSON', () => {
    expect(runErrors([{ orderId: '3891', error: 'Address missing' }, 'boom', { message: 'x' }])).toEqual([
      { message: 'Address missing', orderId: '3891' }, { message: 'boom', orderId: null }, { message: 'x', orderId: null },
    ]);
    expect(runErrors(null)).toEqual([]);
    const row = toRunRow(raw({ errors: [{ orderId: '1', error: 'e' }] }));
    expect(JSON.parse(errorDetailsText(row))).toEqual([{ orderId: '1', error: 'e' }]);
  });

  it('last success = newest completed run + store names within 24 h', () => {
    const rows = [
      toRunRow(raw({ id: 'a', status: 'failed' })),
      toRunRow(raw({ id: 'b', type: 'etsy', endedAt: '2026-10-15T07:42:00.000Z' })),
      toRunRow(raw({ id: 'c', type: 'trendyol', endedAt: '2026-10-15T06:00:00.000Z' })),
      toRunRow(raw({ id: 'd', type: 'etsy', endedAt: '2026-10-15T05:00:00.000Z' })),
      toRunRow(raw({ id: 'e', type: 'ebay', startedAt: '2026-10-12T05:00:00.000Z', endedAt: '2026-10-12T05:01:00.000Z' })),
    ];
    expect(lastSuccess(rows)).toEqual({ at: '2026-10-15T07:42:00.000Z', sources: ['Etsy', 'Trendyol'] });
    expect(lastSuccess([toRunRow(raw({ status: 'failed' }))])).toBeNull();
  });

  it('pages by cursor and stops at the end', () => {
    expect(historyKey(0, null)).toBe('/api/sync/history');
    expect(historyKey(1, { syncs: [raw({})], nextCursor: '2026-10-15T07:40:00.000Z' })).toBe('/api/sync/history?cursor=2026-10-15T07%3A40%3A00.000Z');
    expect(historyKey(1, { syncs: [raw({})], nextCursor: null })).toBeNull();
    expect(historyKey(1, { syncs: [], nextCursor: 'x' })).toBeNull();
  });
});

describe('preferences timezone helpers', () => {
  it('lists IANA zones including Europe/Istanbul and UTC', () => {
    const z = listTimeZones();
    expect(z).toContain('Europe/Istanbul');
    expect(z).toContain('UTC');
    expect([...z].sort()).toEqual(z);
  });

  it('labels zones with their GMT offset', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    expect(timeZoneLabel('Europe/Istanbul', now)).toBe('Europe/Istanbul (GMT+3)');
    expect(timeZoneLabel('America/New_York', now)).toBe('America/New York (GMT-4)');
    expect(gmtOffset('Not/AZone', now)).toBe('');
  });

  it('falls back to Europe/Istanbul for null or invalid zones', () => {
    expect(effectiveTimeZone(null)).toBe('Europe/Istanbul');
    expect(effectiveTimeZone('Asia/Tokyo', ['Asia/Tokyo'])).toBe('Asia/Tokyo');
    expect(effectiveTimeZone('Not/AZone', ['Asia/Tokyo'])).toBe('Europe/Istanbul');
  });
});
