import { describe, expect, it } from 'vitest';
import { CREDIT_PACKS, canAfford, creditPeriod, creditPeriodEnd, extendCredits, imageCredits, monthlyAllowance, packSaving, videoCredits } from '@/lib/billing/aiCredits';
import { safeReturnPath } from '@/lib/billing/aiCreditsPurchase';

describe('AI kredisi costs', () => {
  it('video: per second × variants, by quality and resolution', () => {
    expect(videoCredits({ quality: 'fast', resolution: '1080p', durationSec: 8 })).toBe(96);
    expect(videoCredits({ quality: 'best', resolution: '1080p', durationSec: 8, variants: 2 })).toBe(640);
    expect(videoCredits({ quality: 'fast', resolution: '4k', durationSec: 8 })).toBe(240);
    expect(videoCredits({ quality: 'x', resolution: 'y', durationSec: 4, variants: 9 })).toBe(10 * 4 * 4);
    expect(extendCredits('fast')).toBe(70);
    expect(imageCredits(2)).toBe(30);
  });
  it('every pack sells above the ~$0.012 worst-case cost per credit', () => {
    for (const p of CREDIT_PACKS) expect(p.price.USD / p.credits).toBeGreaterThan(0.015);
    expect(packSaving(CREDIT_PACKS[0], 'USD')).toBe(0);
    expect(packSaving(CREDIT_PACKS[3], 'USD')).toBeGreaterThan(40);
  });
  it('plan allowances: enterprise unlimited, expired handled by the server', () => {
    expect(monthlyAllowance('starter')).toBe(300);
    expect(monthlyAllowance('enterprise')).toBe(10000);
    expect(canAfford({ total: null }, 9999)).toBe(true);
    expect(canAfford({ total: 50 }, 96)).toBe(false);
  });
  it('the plan allowance renews on the 1st (UTC)', () => {
    const d = new Date(Date.UTC(2026, 9, 31, 23, 0));
    expect(creditPeriod(d)).toBe('2026-10');
    expect(creditPeriodEnd(d).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
  it('checkout return paths stay on the site', () => {
    expect(safeReturnPath('/app/video-studio')).toBe('/app/video-studio');
    expect(safeReturnPath('//evil.com')).toBe('/app/video-studio');
    expect(safeReturnPath('https://evil.com')).toBe('/app/video-studio');
  });
});
