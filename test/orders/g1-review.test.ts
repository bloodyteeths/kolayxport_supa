import { describe, it, expect } from 'vitest';
import {
  ADDRESS_INCOMPLETE_SQL,
  NO_POSTAL_COUNTRIES,
  NO_POSTAL_NAMES,
  ORDER_STATUS_FILTER_KEYS,
  VIEW_COUNTS_FINGERPRINT_SQL,
  jsonStringFieldRe,
  matchesOrderView,
  matchesStatusKey,
  statusKeyWhereSql,
} from '@/lib/orders/views';
import { resolveCountryCode, shipToMissing, toOrderRow, viewFactsOf } from '@/lib/orders/toOrderRows';
import type { ApiOrder } from '@/lib/orders/types';
import {
  NOW,
  YESTERDAY,
  ALL_FIXTURES,
  REVIEW_FIXTURES,
  amazonFba,
  amazonOpen,
  ghanaByName,
  manualLabeled,
  postalInFallback,
  stringifiedAddress,
  veeqoSellable,
} from './g1-fixtures';

const ctx = { now: NOW, etsyShopNames: ['BelleCoutureGifts'] };
const facts = (o: ApiOrder) => viewFactsOf(o, toOrderRow(o, ctx).shipTo.missing.length > 0);

/** The SQL regex in JS syntax (POSIX class → \s); same capture semantics. */
const jsRe = (key: string) => new RegExp(jsonStringFieldRe(key).replace(/\[\[:space:\]\]/g, '\\s'));

describe('address twin — stringified shippingAddress (jsonb string scalar)', () => {
  it('the client parses the string: complete address, To ship pill, labelable', () => {
    const r = toOrderRow(stringifiedAddress, ctx);
    expect(r.shipTo.missing).toEqual([]);
    expect(r.status.key).toBe('to_ship');
    expect(r.canLabel).toBe(true);
    expect(matchesOrderView(facts(stringifiedAddress), 'problems', NOW)).toBe(false);
  });

  it('the SQL reads a string address by regex over its JSON text, guarded by jsonb_typeof (no ::jsonb cast)', () => {
    expect(ADDRESS_INCOMPLETE_SQL).toContain(`jsonb_typeof(o."shippingAddress") WHEN 'object'`);
    expect(ADDRESS_INCOMPLETE_SQL).toContain(`WHEN 'string' THEN substring(o."shippingAddress" #>> '{}' from`);
    expect(ADDRESS_INCOMPLETE_SQL).not.toMatch(/"shippingAddress"[^,]*::jsonb/);
    const text = String(stringifiedAddress.shippingAddress);
    expect(text.match(jsRe('street1'))?.[1]).toBe('12 Oak St');
    expect(text.match(jsRe('city'))?.[1]).toBe('Austin');
    expect(text.match(jsRe('postal'))?.[1]).toBe('78701');
    expect(text.match(jsRe('country'))?.[1]).toBe('US');
    expect(text.match(jsRe('note'))?.[1]).toBe('say \\"hi\\"'); // escaped quotes stay inside the value
    expect(text.match(jsRe('zip'))).toBeNull();
    expect('{"street1": ""}'.match(jsRe('street1'))?.[1]).toBe('');
  });
});

describe('address twin — postal-free countries and fallback sources', () => {
  it('every postal-free country name the SQL accepts resolves to a postal-free ISO2 code on the client', () => {
    for (const name of NO_POSTAL_NAMES) {
      expect(NO_POSTAL_COUNTRIES as readonly string[], name).toContain(resolveCountryCode(name));
    }
    expect(shipToMissing({ street1: 'x', city: 'y', postal: '', country: 'Ghana' })).toEqual([]);
  });

  it('a Ghana order sent by name without postal code is complete (not a Problem)', () => {
    const r = toOrderRow(ghanaByName, ctx);
    expect(r.shipTo.country).toBe('GH');
    expect(r.shipTo.missing).toEqual([]);
    expect(r.status.key).toBe('to_ship');
  });

  it('a postal code found only in a fallback source completes the address (SQL ORs every source per field)', () => {
    const r = toOrderRow(postalInFallback, ctx);
    expect(r.shipTo.street1).toBe('Hauptstr. 1');
    expect(r.shipTo.postal).toBe('10115');
    expect(r.shipTo.missing).toEqual([]);
  });

  it('the Trendyol country default (TR) of the API flattening is a SQL country source too', () => {
    expect(ADDRESS_INCOMPLETE_SQL).toContain(`o."marketplace" = 'Trendyol'`);
    expect(ADDRESS_INCOMPLETE_SQL).toContain(`THEN 'TR' END`);
  });
});

describe('status filter keys mean what the pill means', () => {
  const variants: ApiOrder[] = [
    ...ALL_FIXTURES,
    ...REVIEW_FIXTURES,
    { ...amazonOpen, id: 'v-overdue', line_items: [{ id: 'iv1', title: 'N', value: 1, quantity: 1, shipBy: YESTERDAY, labelJobs: [] }] },
    { ...amazonOpen, id: 'v-hold', status: 'on_hold' },
    { ...amazonOpen, id: 'v-undeliv', status: 'Undelivered' },
    { ...amazonFba, id: 'v-fba-open', status: 'Unshipped' },
    { ...manualLabeled, id: 'v-labelled-ok', trackingSubmissions: [] },
    { ...veeqoSellable, id: 'v-cancelled', status: 'cancelled' },
  ];

  it('pill key k ⇒ the row matches key k and no other key (pure twin of statusKeyWhereSql)', () => {
    for (const o of variants) {
      const pill = toOrderRow(o, ctx).status.key;
      const f = facts(o);
      const matched = ORDER_STATUS_FILTER_KEYS.filter((k) => matchesStatusKey(f, k, NOW));
      expect(matched, `${o.id} pill=${pill}`).toEqual([pill]);
    }
  });

  it('Status: To ship never lists a row with a label or an address problem; Status: Problem lists address problems', () => {
    expect(matchesStatusKey(facts(manualLabeled), 'to_ship', NOW)).toBe(false);
    expect(matchesStatusKey(facts(manualLabeled), 'label_created', NOW)).toBe(true);
    const voided = ALL_FIXTURES.find((o) => o.id === 'o-void')!; // DE without postal code
    expect(matchesStatusKey(facts(voided), 'problem', NOW)).toBe(true);
    expect(matchesStatusKey(facts(voided), 'to_ship', NOW)).toBe(false);
  });

  it('the SQL keys are built from the same clauses', () => {
    expect(statusKeyWhereSql('to_ship')).toContain(ADDRESS_INCOMPLETE_SQL);
    expect(statusKeyWhereSql('to_ship')).toContain('NOT COALESCE(');
    expect(statusKeyWhereSql('problem')).toContain(ADDRESS_INCOMPLETE_SQL);
    expect(statusKeyWhereSql('label_created')).toContain('"Shipment"');
  });
});

describe('view counts fingerprint', () => {
  it('one row, $1 only, covers orders, labels, tracking pushes and extension addresses', () => {
    expect(VIEW_COUNTS_FINGERPRINT_SQL).not.toMatch(/\$2/);
    for (const t of ['"Order"', '"Shipment"', '"LabelJob"', '"TrackingSubmission"', '"EtsyAddress"']) {
      expect(VIEW_COUNTS_FINGERPRINT_SQL).toContain(t);
    }
    expect(VIEW_COUNTS_FINGERPRINT_SQL).toContain('AS "fp"');
  });
});
