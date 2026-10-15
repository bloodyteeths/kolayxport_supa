// lib/nav/links.ts — every Overview href (overview §8 G4).
import { describe, expect, it } from 'vitest';
import {
  createLabelHref,
  listingDoctorHref,
  listingHref,
  listingsHref,
  ordersHref,
  reportsHref,
  settingsHref,
} from '@/lib/nav/links';

describe('ordersHref', () => {
  it('views map to ?view=', () => {
    expect(ordersHref('to_ship')).toBe('/app/labels?view=to_ship');
    expect(ordersHref('overdue')).toBe('/app/labels?view=overdue');
    expect(ordersHref('problems')).toBe('/app/labels?view=problems');
  });
  it('store filter', () => {
    expect(ordersHref('label_created', null, 'etsy')).toBe('/app/labels?view=label_created&store=etsy');
  });
  it('Create label opens the CreateLabelPanel', () => {
    expect(createLabelHref('ord_1')).toBe('/app/labels?view=all&open=ord_1&panel=label');
    expect(ordersHref('overdue', 'ord_1', null, null, { createLabel: true })).toBe('/app/labels?view=overdue&open=ord_1&panel=label');
  });
  it('one order without the label panel', () => {
    expect(ordersHref('order', 'ord_1')).toBe('/app/labels?view=all&open=ord_1');
  });
  it('search', () => {
    expect(ordersHref('search', null, null, 'Mug')).toBe('/app/labels?view=all&q=Mug');
  });
  it('blank values are dropped', () => {
    expect(ordersHref('search', '  ', ' ', '')).toBe('/app/labels?view=all');
  });
});

describe('listing links', () => {
  it('listingHref: the full editor', () => {
    expect(listingHref('etsy', '123')).toBe('/app/etsy-listings/123');
    expect(listingHref('ebay', 'SKU/1')).toBe('/app/ebay-listings/SKU%2F1');
    expect(listingHref('trendyol', 'BC-1')).toBe('/app/trendyol-urunler/BC-1');
    expect(listingHref('wix', 'a1b2')).toBe('/app/wix-urunler/a1b2');
    expect(listingHref('shopify', '42')).toBe('/app/shopify-urunler/42');
    expect(listingHref('etsy', ' ')).toBe('/app/etsy-listings');
  });
  it('listingHref: Etsy shop scope', () => {
    expect(listingHref('etsy', '123', { shop: '77' })).toBe('/app/etsy-listings/123?shop=77');
    expect(listingHref('ebay', '9', { shop: '77' })).toBe('/app/ebay-listings/9');
  });
  it('listingsHref: views', () => {
    expect(listingsHref('etsy', 'changes_not_sent')).toBe('/app/etsy-listings?view=not_sent');
    expect(listingsHref('ebay', 'send_failed')).toBe('/app/ebay-listings?view=send_failed');
    expect(listingsHref('etsy', 'all')).toBe('/app/etsy-listings');
  });
  it('listingDoctorHref: the hub Listing doctor', () => {
    expect(listingDoctorHref()).toBe('/app/research/listings');
  });
});

describe('reports / settings', () => {
  it('reportsHref', () => {
    expect(reportsHref()).toBe('/app/reports');
  });
  it('settingsHref', () => {
    expect(settingsHref('billing')).toBe('/ayarlar?tab=billing');
    expect(settingsHref('connections', 'etsy')).toBe('/ayarlar?tab=connections&provider=etsy');
    expect(settingsHref('senderProfile')).toBe('/ayarlar?tab=senderProfile');
  });
});
