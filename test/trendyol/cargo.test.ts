import { describe, expect, it } from 'vitest';
import { code128Modules, code128Values } from '@/lib/barcode/code128';
import { trendyolCargoInfo } from '@/lib/trendyol/cargoInfo';

describe('code128', () => {
  it('each symbol has 6 elements and the stop 7', () => {
    for (let v = 0; v < 100; v++) {
      const text = String(v).padStart(2, '0').repeat(2); // set C: start + 2 pairs + check + stop
      expect(code128Modules(text)).toHaveLength(4 * 6 + 7);
    }
  });

  it('every pattern used is 11 modules wide (stop 13)', () => {
    const all = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
    for (const text of [all, '0123456789'.repeat(10), 'TY7280027504']) {
      const values = code128Values(text);
      const mods = code128Modules(text);
      expect(mods.reduce((a, b) => a + b, 0)).toBe(11 * (values.length - 1) + 13);
    }
  });

  it('digit strings use code set C pairs with a mod-103 check', () => {
    const v = code128Values('7280027504111111');
    expect(v[0]).toBe(105);
    expect(v.slice(1, -2)).toEqual([72, 80, 2, 75, 4, 11, 11, 11]);
    const check = v.slice(0, -2).reduce((s, x, i) => s + x * (i === 0 ? 1 : i), 0) % 103;
    expect(v[v.length - 2]).toBe(check);
    expect(v[v.length - 1]).toBe(106);
  });

  it('odd digit runs start in B then switch to C; letters stay in B', () => {
    expect(code128Values('12345').slice(0, 4)).toEqual([104, 17, 99, 23]);
    expect(code128Values('AB12')[0]).toBe(104);
    expect(() => code128Values('ç')).toThrow();
  });
});

describe('trendyolCargoInfo', () => {
  const raw = {
    cargoTrackingNumber: 7280027504111111, cargoProviderName: 'Trendyol Express', whoPays: 1,
    shipmentPackageId: 3330111111, shipmentPackageStatus: 'Created', lines: [{ lineId: 4765111111, quantity: 2 }, { id: 9, quantity: 1 }],
  };

  it('Trendyol Express on Trendyol-paid cargo has a common label; next status Picking', () => {
    expect(trendyolCargoInfo(raw)).toEqual({
      cargoNumber: '7280027504111111', carrier: 'Trendyol Express', packageId: '3330111111', packageStatus: 'Created',
      commonLabel: true, nextStatus: 'Picking', lines: [{ lineId: '4765111111', quantity: 2 }, { lineId: '9', quantity: 1 }],
    });
  });

  it('other carriers or seller-paid cargo get the PDF only; Picking → Invoiced; shipped → none', () => {
    expect(trendyolCargoInfo({ ...raw, cargoProviderName: 'Yurtiçi Kargo' }).commonLabel).toBe(false);
    expect(trendyolCargoInfo({ ...raw, whoPays: 2 }).commonLabel).toBe(false);
    expect(trendyolCargoInfo({ ...raw, cargoProviderName: 'Aras Kargo' }).commonLabel).toBe(true);
    expect(trendyolCargoInfo({ ...raw, shipmentPackageStatus: 'Picking' }).nextStatus).toBe('Invoiced');
    expect(trendyolCargoInfo({ ...raw, shipmentPackageStatus: 'Shipped' }).nextStatus).toBeNull();
    expect(trendyolCargoInfo({}).cargoNumber).toBeNull();
  });
});
