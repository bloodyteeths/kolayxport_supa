import { describe, expect, it } from 'vitest';
import { meaningfulName } from '@/components/domain/settings/connections/connectionView';

describe('meaningfulName', () => {
  const spec = (name: string) => ({ name } as never);
  it('drops provider-only and provider + raw id names', () => {
    expect(meaningfulName(spec('Amazon'), 'Amazon A1Q4UP10N4XSPS')).toBeUndefined();
    expect(meaningfulName(spec('Trendyol'), 'Trendyol 312549')).toBeUndefined();
    expect(meaningfulName(spec('eBay'), 'eBay')).toBeUndefined();
  });
  it('keeps real shop names', () => {
    expect(meaningfulName(spec('Etsy'), 'BelleCoutureGifts')).toBe('BelleCoutureGifts');
    expect(meaningfulName(spec('Wix'), 'Wix Baby Store')).toBe('Wix Baby Store');
  });
});
