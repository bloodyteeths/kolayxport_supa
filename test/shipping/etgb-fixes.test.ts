import { describe, expect, it } from 'vitest';
import { rowHsCode, shortCommercialDescription } from '@/lib/services/etgbExcelService';
import { ordersMissingHs } from '@/lib/services/etgbService';

describe('ETGB row rules', () => {
  it('commercial description is short, whole words', () => {
    const long = 'Blush Christmas Tutu Dress for Girls – Sparkly Holiday Party Outfit, Santa Hat Photo Shoot Dress';
    const s = shortCommercialDescription(long);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(s)).toBe(true);
    expect(s.endsWith('–')).toBe(false);
    expect(shortCommercialDescription('Kız çocuk elbisesi')).toBe('Kız çocuk elbisesi');
    expect(shortCommercialDescription(null)).toBe('');
  });
  it('GTIP: order line, then order, then default', () => {
    expect(rowHsCode({ harmonizedCode: '6204.44' }, { harmonizedCode: '6109' }, '9999')).toBe('6204.44');
    expect(rowHsCode({ harmonizedCode: null }, { harmonizedCode: '6109' }, '9999')).toBe('6109');
    expect(rowHsCode(null, { harmonizedCode: null }, '6204.49.506')).toBe('6204.49.506');
    expect(rowHsCode(null, {}, null)).toBe('');
  });
  it('lists orders that would have a row without GTIP', () => {
    const orders = [
      { id: 'a', orderNumber: '100', harmonizedCode: null, items: [{ harmonizedCode: '6204' }] },
      { id: 'b', orderNumber: '101', harmonizedCode: null, items: [{ harmonizedCode: null }, { harmonizedCode: '6204' }] },
      { id: 'c', orderNumber: null, harmonizedCode: null, items: [] },
    ];
    expect(ordersMissingHs(orders, null)).toEqual(['101', 'c']);
    expect(ordersMissingHs(orders, '6204.49.506')).toEqual([]);
  });
});
