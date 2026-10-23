import { describe, expect, it } from 'vitest';
import { EDITOR_LIMITS, editorAllows, editorLockedBody, editorTierForPlan, sendWithinCap, tierFor } from '@/lib/billing/editorTier';

describe('editor tiers (Atilla 2026-10-24)', () => {
  it('maps every plan', () => {
    expect(['aylik', 'baslangic_yil', 'starter'].map(editorTierForPlan)).toEqual(['basic', 'basic', 'basic']);
    expect(['buyume_yil', 'growth'].map(editorTierForPlan)).toEqual(['plus', 'plus']);
    expect(['pro', 'pro_yil', 'enterprise', 'kurumsal', 'trial', 'shopify_free'].map(editorTierForPlan)).toEqual(Array(6).fill('pro'));
    expect(editorTierForPlan(undefined)).toBe('basic');
  });
  it('send caps: 100 / 500 / none', () => {
    expect(sendWithinCap('basic', 100)).toBe(true);
    expect(sendWithinCap('basic', 101)).toBe(false);
    expect(sendWithinCap('plus', 500)).toBe(true);
    expect(sendWithinCap('plus', 501)).toBe(false);
    expect(sendWithinCap('pro', 100_000)).toBe(true);
  });
  it('capabilities per tier and the tier that unlocks them', () => {
    expect(editorAllows('basic', 'findReplace')).toBe(false);
    expect(editorAllows('plus', 'schedule')).toBe(true);
    expect(editorAllows('plus', 'ai')).toBe(false);
    expect(Object.values(EDITOR_LIMITS.pro.capabilities).every(Boolean)).toBe(true);
    expect(tierFor('csv')).toBe('plus');
    expect(tierFor('ai')).toBe('pro');
    expect(editorLockedBody('basic', 'sendSize', { max: 100 })).toMatchObject({ limitType: 'editor', requiredTier: 'plus', max: 100 });
  });
});
