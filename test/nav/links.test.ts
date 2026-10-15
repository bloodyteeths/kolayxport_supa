// lib/nav/links.ts — every Overview href in both flag states (overview §8 G4).
import { describe, expect, it } from 'vitest';
import {
  createLabelHref,
  listingDoctorHref,
  listingHref,
  listingsHref,
  ordersHref,
  reportsHref,
  settingsHref,
  type LinkFlags,
} from '@/lib/nav/links';

const OFF: LinkFlags = {};
const ON: LinkFlags = {
  orders: true,
  'listings-etsy': true,
  'listings-ebay': true,
  'listings-trendyol': true,
  'listings-wix': true,
  'listings-shopify': true,
  'editor-etsy': true,
  'editor-ebay': true,
  reports: true,
  research: true,
};

describe('ordersHref — legacy (orders flag off)', () => {
  it('KPI To ship / Overdue use the legacy unlabeled + onaylandi + shipBy query', () => {
    const toShip = '/app/labels?label=unlabeled&status=onaylandi&sort=shipBy&from=all';
    expect(ordersHref('to_ship', null, null, null, {}, OFF)).toBe(toShip);
    expect(ordersHref('overdue', null, null, null, {}, OFF)).toBe(toShip);
  });
  it('labels failed → label=failed', () => {
    expect(ordersHref('problems', null, null, null, {}, OFF)).toBe('/app/labels?label=failed&from=all');
  });
  it('tracking not sent → labeled + mp=etsy', () => {
    expect(ordersHref('label_created', null, 'etsy', null, {}, OFF)).toBe('/app/labels?label=labeled&mp=etsy&from=all');
  });
  it('overdue Create label → the order search by number', () => {
    expect(createLabelHref('ord_1', '1234', OFF)).toBe('/app/labels?q=1234&qt=order&label=all&from=all');
    expect(ordersHref('order', 'ord_1', null, '1234', {}, OFF)).toBe('/app/labels?q=1234&qt=order&label=all&from=all');
  });
  it('an order without a number falls back to the highlight param', () => {
    expect(ordersHref('order', 'ord_1', null, null, {}, OFF)).toBe('/app/labels?highlight=ord_1&label=all&from=all');
  });
  it('best sellers row → search across all labels and dates', () => {
    expect(ordersHref('search', null, null, 'SKU 1/2', {}, OFF)).toBe('/app/labels?q=SKU+1%2F2&label=all&from=all');
  });
  it('shipped and all', () => {
    expect(ordersHref('shipped', null, null, null, {}, OFF)).toBe('/app/labels?label=all&status=kargolandi&from=all');
    expect(ordersHref('all', null, null, null, {}, OFF)).toBe('/app/labels?label=all&from=all');
  });
});

describe('ordersHref — v2 (orders flag on)', () => {
  it('views map to ?view=', () => {
    expect(ordersHref('to_ship', null, null, null, {}, ON)).toBe('/app/labels?view=to_ship');
    expect(ordersHref('overdue', null, null, null, {}, ON)).toBe('/app/labels?view=overdue');
    expect(ordersHref('problems', null, null, null, {}, ON)).toBe('/app/labels?view=problems');
  });
  it('store filter', () => {
    expect(ordersHref('label_created', null, 'etsy', null, {}, ON)).toBe('/app/labels?view=label_created&store=etsy');
  });
  it('Create label opens the CreateLabelPanel', () => {
    expect(createLabelHref('ord_1', '1234', ON)).toBe('/app/labels?view=all&open=ord_1&panel=label');
    expect(ordersHref('overdue', 'ord_1', null, null, { createLabel: true }, ON)).toBe('/app/labels?view=overdue&open=ord_1&panel=label');
  });
  it('one order without the label panel', () => {
    expect(ordersHref('order', 'ord_1', null, null, {}, ON)).toBe('/app/labels?view=all&open=ord_1');
  });
  it('search', () => {
    expect(ordersHref('search', null, null, 'Mug', {}, ON)).toBe('/app/labels?view=all&q=Mug');
  });
  it('blank values are dropped', () => {
    expect(ordersHref('search', '  ', ' ', '', {}, ON)).toBe('/app/labels?view=all');
  });
});

describe('listing links', () => {
  it('listingHref: editor when its flag is on, else ?open=', () => {
    expect(listingHref('etsy', '123', ON)).toBe('/app/etsy-listings/123');
    expect(listingHref('ebay', 'SKU/1', ON)).toBe('/app/ebay-listings/SKU%2F1');
    expect(listingHref('etsy', '123', OFF)).toBe('/app/etsy-listings?open=123');
    expect(listingHref('ebay', '9', OFF)).toBe('/app/ebay-listings?open=9');
    expect(listingHref('etsy', '123', { 'listings-etsy': true })).toBe('/app/etsy-listings?open=123');
  });
  it('listingHref: Trendyol/Wix/Shopify full editor (M6b) only with their editor flag', () => {
    const cat: LinkFlags = { ...ON, 'editor-trendyol': true, 'editor-wix': true, 'editor-shopify': true };
    expect(listingHref('trendyol', 'BC-1', cat)).toBe('/app/trendyol-urunler/BC-1');
    expect(listingHref('wix', 'a1b2', cat)).toBe('/app/wix-urunler/a1b2');
    expect(listingHref('shopify', '42', cat)).toBe('/app/shopify-urunler/42');
    expect(listingHref('trendyol', 'BC-1', ON)).toBe('/app/trendyol-urunler?open=BC-1');
  });
  it('listingHref: Etsy shop scope', () => {
    expect(listingHref('etsy', '123', ON, { shop: '77' })).toBe('/app/etsy-listings/123?shop=77');
    expect(listingHref('etsy', '123', OFF, { shop: '77' })).toBe('/app/etsy-listings?shop=77&open=123');
  });
  it('listingsHref: v2 views, legacy bare route', () => {
    expect(listingsHref('etsy', 'changes_not_sent', ON)).toBe('/app/etsy-listings?view=not_sent');
    expect(listingsHref('ebay', 'send_failed', ON)).toBe('/app/ebay-listings?view=send_failed');
    expect(listingsHref('etsy', 'all', ON)).toBe('/app/etsy-listings');
    expect(listingsHref('etsy', 'changes_not_sent', OFF)).toBe('/app/etsy-listings');
    expect(listingsHref('ebay', 'not_sent', OFF)).toBe('/app/ebay-listings');
  });
  it('listingDoctorHref: R1 → M5 needs work → hidden', () => {
    expect(listingDoctorHref(ON)).toBe('/app/research/listings');
    expect(listingDoctorHref({ 'listings-etsy': true })).toBe('/app/etsy-listings?view=needs_work');
    expect(listingDoctorHref(OFF)).toBeNull();
  });
});

describe('reports / settings', () => {
  it('reportsHref', () => {
    expect(reportsHref(ON)).toBe('/app/reports');
    expect(reportsHref(OFF)).toBe('/app/analytics');
  });
  it('settingsHref', () => {
    expect(settingsHref('billing')).toBe('/ayarlar?tab=billing');
    expect(settingsHref('connections', 'etsy')).toBe('/ayarlar?tab=connections&provider=etsy');
    expect(settingsHref('senderProfile')).toBe('/ayarlar?tab=senderProfile');
  });
});
