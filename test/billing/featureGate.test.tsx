// @vitest-environment jsdom
// pro-gating G-pro-2: FeatureGate region/action per plan fixture (trial, starter/growth, pro, shopify_free,
// unknown), the 402 featureLocked swap (no toast, no LimitReachedDialog), and the §11 neutral assertions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { FeatureGate } from '@/components/domain/billing/FeatureGate';
import { useFeatureLockStore, useLimitReachedStore } from '@/lib/http/limitInterceptor';
import type { FeatureActionState } from '@/lib/billing/useFeatureAction';
import { F, ent } from './d-fixtures';
import { mockFetch, renderD } from './d-harness';

const h = vi.hoisted(() => ({
  router: { pathname: '/app/reports', query: {}, isReady: true, push: vi.fn(() => Promise.resolve(true)), replace: vi.fn(), events: { on: () => undefined, off: () => undefined } },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('next/router', () => ({ useRouter: () => h.router }));
vi.mock('@/components/ds/feedback', async (orig) => ({ ...(await orig<object>()), useToast: () => h.toast }));

beforeEach(() => {
  useFeatureLockStore.getState().clear();
  h.router.push.mockClear();
});
afterEach(cleanup);

const withEnt = (e: unknown) => mockFetch({ '/api/billing/entitlement': { body: e } });
const Body = () => <div data-testid="profit-body">{'profit'}</div>;

function region(locale: 'en' | 'tr' = 'en') {
  return renderD(<FeatureGate feature="financials" placement="region"><Body /></FeatureGate>, locale);
}

describe('FeatureGate placement="region"', () => {
  it('Pro: renders the feature', async () => {
    withEnt(F.pro());
    region();
    expect(await screen.findByTestId('profit-body')).toBeTruthy();
  });

  it('trial: renders the feature (Pro included in the trial)', async () => {
    withEnt(F.trial());
    region();
    expect(await screen.findByTestId('profit-body')).toBeTruthy();
  });

  it.each(['en', 'tr'] as const)('Growth (%s): locked state with one primary "See plans" → /fiyatlandirma?plan=pro&from=financials', async (locale) => {
    withEnt(F.growth());
    region(locale);
    const locked = await screen.findByTestId('feature-locked-financials');
    expect(locked.textContent).toContain(locale === 'en' ? 'Profit is part of Pro' : 'Kâr raporu Pro planına dahildir');
    const link = screen.getByTestId('action-see-plans');
    expect(link.getAttribute('href')).toBe('/fiyatlandirma?plan=pro&from=financials');
    expect(screen.queryByTestId('profit-body')).toBeNull();
    // previews are not produced yet (G-pro-3): no broken image
    expect(document.querySelector('img')).toBeNull();
  });

  it('after a trial: "Your trial included it until …" caption', async () => {
    withEnt(ent({ trialEndsAt: '2026-10-01T09:00:00Z' }));
    region();
    expect(await screen.findByText(/Your trial included it until/)).toBeTruthy();
  });

  it('expired: "Your plan is paused" + Reactivate → Plan & billing', async () => {
    withEnt(F.expired());
    region();
    expect(await screen.findByText('Your plan is paused')).toBeTruthy();
    expect(screen.getByTestId('action-reactivate').getAttribute('href')).toBe('/ayarlar?tab=billing');
  });

  it.each(['en', 'tr'] as const)('shopify_free (%s): neutral locked — no Pro, no Stripe, no pricing link, no currency, no action', async (locale) => {
    withEnt(F.shopify());
    region(locale);
    const locked = await screen.findByTestId('feature-locked-financials');
    expect(locked.textContent).toContain(locale === 'en' ? "This isn't included in your plan" : 'Bu özellik planınıza dahil değil');
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/Pro\b/);
    expect(html).not.toContain('Stripe');
    expect(html).not.toContain('/fiyatlandirma');
    expect(html).not.toMatch(/[₺$]/);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('unknown (entitlement + fallback fail): renders the feature, server decides', async () => {
    mockFetch({ '/api/billing/entitlement': { status: 500 }, '/api/user/settings': { status: 500 } });
    region();
    expect(await screen.findByTestId('profit-body')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('/fiyatlandirma');
  });

  it('402 featureLocked swaps the region to the locked state — no toast, no LimitReachedDialog', async () => {
    withEnt(F.pro());
    region();
    expect(await screen.findByTestId('profit-body')).toBeTruthy();
    act(() => { useFeatureLockStore.getState().markLocked({ feature: 'financials', at: Date.now() }); });
    expect(await screen.findByTestId('feature-locked-financials')).toBeTruthy();
    expect(h.toast.error).not.toHaveBeenCalled();
    expect(useLimitReachedStore.getState().current).toBeNull();
  });

  it('402 featureLocked while the provider is unknown → neutral copy (never "See plans")', async () => {
    mockFetch({ '/api/billing/entitlement': { status: 500 }, '/api/user/settings': { status: 500 } });
    region();
    await screen.findByTestId('profit-body');
    act(() => { useFeatureLockStore.getState().markLocked({ feature: 'financials', at: Date.now() }); });
    await waitFor(() => expect(screen.getByText("This isn't included in your plan")).toBeTruthy());
    expect(screen.queryByTestId('action-see-plans')).toBeNull();
  });
});

describe('FeatureGate placement="action" / useFeatureAction', () => {
  function action() {
    const seen: FeatureActionState[] = [];
    renderD(
      <FeatureGate feature="bulkPhotoStudio" placement="action" lockedHref="/app/etsy-listings/photos">
        {(s: FeatureActionState) => {
          seen.push(s);
          return <button type="button" data-testid="edit-photos" data-tag={String(s.tag)} onClick={s.onBlockedClick}>{'Edit photos…'}</button>;
        }}
      </FeatureGate>,
      'en',
    );
    return seen;
  }

  it('shopify_free: the entry point is not rendered', async () => {
    withEnt(F.shopify());
    action();
    await waitFor(() => expect(useFeatureLockStore.getState()).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('edit-photos')).toBeNull();
  });

  it('Growth: visible with a tag; click goes to the gated route', async () => {
    withEnt(F.growth());
    action();
    await waitFor(() => expect(screen.getByTestId('edit-photos').getAttribute('data-tag')).toBe('true'));
    screen.getByTestId('edit-photos').click();
    expect(h.router.push).toHaveBeenCalledWith('/app/etsy-listings/photos');
  });

  it('Pro: visible, no tag, no blocked handler', async () => {
    withEnt(F.pro());
    const seen = action();
    await waitFor(() => expect(seen.at(-1)?.access).toBe('allowed'));
    expect(seen.at(-1)).toMatchObject({ visible: true, tag: false, locked: false });
    expect(seen.at(-1)?.onBlockedClick).toBeUndefined();
  });

  it('trial: visible with a tag and the trial end, usable', async () => {
    withEnt(F.trial());
    const seen = action();
    await waitFor(() => expect(seen.at(-1)?.access).toBe('trial'));
    expect(seen.at(-1)?.tag).toBe(true);
    expect(seen.at(-1)?.trialEndsAt).toBeInstanceOf(Date);
    expect(seen.at(-1)?.onBlockedClick).toBeUndefined();
  });
});
