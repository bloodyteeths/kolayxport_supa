// @vitest-environment jsdom
// Google Play app mode (lib/billing/playClient.ts): the launch marker, the request check, and that billing turns
// neutral (no prices, actions or invoices) while the plan itself stays visible.
import { afterEach, describe, expect, it } from 'vitest';
import { PLAY_COOKIE, isPlayClient, isPlayRequest, markPlayClient } from '@/lib/billing/playClient';
import { billingView, isNeutralBilling } from '@/lib/billing/billingState';
import { F, NOW } from './d-fixtures';

function clearCookie() {
  document.cookie = `${PLAY_COOKIE}=; Path=/; Max-Age=0`;
}

afterEach(() => {
  clearCookie();
  window.history.replaceState(null, '', '/');
});

describe('playClient', () => {
  it('is off by default and stays off on a normal web visit', () => {
    markPlayClient();
    expect(isPlayClient()).toBe(false);
  });

  it('turns on from the TWA launch URL and survives later pages', () => {
    window.history.replaceState(null, '', '/app?src=play');
    markPlayClient();
    window.history.replaceState(null, '', '/app/labels');
    expect(isPlayClient()).toBe(true);
  });

  it('reads the cookie on the server side', () => {
    expect(isPlayRequest({ cookies: { [PLAY_COOKIE]: 'play' } })).toBe(true);
    expect(isPlayRequest({ cookies: { [PLAY_COOKIE]: 'web' } })).toBe(false);
    expect(isPlayRequest({ cookies: {} })).toBe(false);
    expect(isPlayRequest({})).toBe(false);
  });
});

describe('billing in the Play app', () => {
  it('a Stripe trial account is neutral there, with its plan and pill but no actions', () => {
    expect(isNeutralBilling(F.trial())).toBe(false);
    expect(billingView(F.trial(), NOW).primary).not.toBeNull();

    window.history.replaceState(null, '', '/app?src=play');
    markPlayClient();
    expect(isNeutralBilling(F.trial())).toBe(true);
    const v = billingView(F.trial(), NOW);
    expect(v.mode).toBe('neutral');
    expect(v.planName).toBe('trial');
    expect(v.pill).toBe('trial');
    expect(v.lines).toEqual([]);
    expect(v.primary).toBeNull();
    expect(v.secondary).toBeNull();
    expect(v.overflow).toEqual([]);
    expect(v.invoices).toBe('hide');
  });

  it('Shopify accounts stay neutral with or without the Play cookie (Play mode only adds, never replaces)', () => {
    expect(isNeutralBilling(F.shopify())).toBe(true);
    expect(billingView(F.shopify(), NOW).lines).toEqual([{ key: 'shopify' }]);
    window.history.replaceState(null, '', '/app?src=play');
    markPlayClient();
    expect(isNeutralBilling(F.shopify())).toBe(true);
    expect(billingView(F.shopify(), NOW).primary).toBeNull();
  });
});
