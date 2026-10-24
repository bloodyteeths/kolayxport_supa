// @vitest-environment jsdom
// Settings Group E — public pricing page render tests (settings §10.2–§10.7, §11 pricing-page row), EN + TR.
// Hooks are stubbed at their module boundary (auth, entitlement, founding spots); the checkout and portal
// requests go through a fetch spy so the Shopify assertions can prove no Stripe call is made.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import type { Entitlement, FoundingSpots } from '@/lib/billing/types';
import { E_EN, E_TR } from './e-messages';

const h = vi.hoisted(() => ({
  router: {
    pathname: '/fiyatlandirma',
    asPath: '/fiyatlandirma',
    isReady: true,
    query: {} as Record<string, string>,
    events: { on: () => undefined, off: () => undefined, emit: () => undefined },
    push: vi.fn(() => Promise.resolve(true)),
    replace: vi.fn(() => Promise.resolve(true)),
    prefetch: vi.fn(() => Promise.resolve()),
  },
  auth: { session: null as unknown, isLoading: false },
  entitlement: { data: undefined as unknown, state: 'ready', isLoading: false, fallback: false, mutate: () => Promise.resolve(), retry: () => undefined },
  founding: { spots: null as unknown, isLoading: false, mutate: () => Promise.resolve() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
  mobile: false,
}));

vi.mock('next/router', () => ({ useRouter: () => h.router }));
vi.mock('next-seo', () => ({ NextSeo: () => null }));
// The SEO description lands in <head> (meta + og:description): expose it so the gating tests can read it.
vi.mock('@/components/PublicLayout', () => ({
  default: ({ children, description }: { children: React.ReactNode; description?: string }) => (
    <main data-testid="public-layout" data-description={description}>{children}</main>
  ),
}));
vi.mock('@/components/ds/page', async (orig) => ({ ...(await orig<object>()), useIsMobile: () => h.mobile }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/billing/useEntitlement', () => ({ useEntitlement: () => h.entitlement }));
vi.mock('@/lib/billing/useFoundingSpots', () => ({ useFoundingSpots: () => h.founding }));
vi.mock('@/components/ds/feedback', async (orig) => ({ ...(await orig<object>()), useToast: () => h.toast }));

import PricingPage from '@/components/domain/pricing/PricingPage';

type Locale = 'en' | 'tr';
type Tree = { [k: string]: unknown };
function merge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k] as Tree, v as Tree) : v;
  }
  return out;
}
const MESSAGES: Record<Locale, Tree> = {
  en: merge(en as unknown as Tree, E_EN as unknown as Tree),
  tr: merge(tr as unknown as Tree, E_TR as unknown as Tree),
};

function renderPage(locale: Locale, v2 = false) {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>
        <PricingPage v2={v2} />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

const DAY = 86_400_000;
function ent(over: Partial<Entitlement>): Entitlement {
  return {
    plan: 'trial', state: 'trial', stripeUpsell: true, interval: null, currency: null, foundingMember: false,
    trialEndsAt: new Date(Date.now() + 10 * DAY).toISOString(), graceEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
    period: null, meters: {}, features: { arbitrage: true, financials: true, bulkPhotoStudio: true },
    ...over,
  };
}
const OPEN: FoundingSpots = { active: true, total: 20, remaining: 7, percentOff: 40 };

const fetchSpy = vi.fn();
const assign = vi.fn();

beforeEach(() => {
  h.router.query = {};
  h.router.push.mockClear();
  h.router.replace.mockClear();
  h.auth = { session: null, isLoading: false };
  h.mobile = false;
  h.entitlement = { ...h.entitlement, data: undefined, state: 'ready', isLoading: false };
  h.founding = { spots: OPEN, isLoading: false, mutate: vi.fn(() => Promise.resolve()) };
  Object.values(h.toast).forEach((fn) => fn.mockClear());
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  assign.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...window.location, assign } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const plans = () => screen.getByTestId('pricing-plans');
const seoDescription = () => screen.getByTestId('public-layout').getAttribute('data-description') ?? '';
const primaries = () => plans().querySelectorAll('.MuiButton-contained');
const signedIn = (e: Entitlement | undefined, state = 'ready') => {
  h.auth = { session: { user: { email: 'x@y.z' } }, isLoading: false };
  h.entitlement = { ...h.entitlement, data: e, state, isLoading: !e && state !== 'error' };
};
const jsonRes = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) });

describe.each(['en', 'tr'] as const)('PricingPage anonymous (%s)', (locale) => {
  it('paints prices at once, founding line, 4 cards, Growth is the single primary', () => {
    renderPage(locale);
    expect(screen.getByTestId('pricing-page').getAttribute('data-gate')).toBe('show');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(locale === 'en' ? 'Pricing' : 'Fiyatlandırma');
    for (const p of ['starter', 'growth', 'pro', 'enterprise']) expect(screen.getByTestId(`plan-card-${p}`)).toBeTruthy();
    // EN defaults to USD, TR to TRY; founding monthly prices + struck list prices
    const growth = screen.getByTestId('plan-amount-growth').textContent;
    expect(growth).toBe(locale === 'en' ? '$59.40' : '₺2.999,40');
    expect(screen.getByTestId('plan-struck-growth').textContent).toBe(locale === 'en' ? '$99' : '₺4.999');
    expect(screen.getByTestId('founding-line').textContent).toContain(locale === 'en' ? '7 of 20 spots left' : '20 yerden 7 tanesi kaldı');
    expect(primaries()).toHaveLength(1);
    expect(within(screen.getByTestId('plan-card-growth')).getByTestId('plan-cta-growth').className).toContain('MuiButton-contained');
    expect(screen.getByTestId('plan-card-growth').getAttribute('data-recommended')).toBe('true');
  });

  it('Start free trial → signup (no checkout), Enterprise → Talk to us', () => {
    renderPage(locale);
    const cur = locale === 'en' ? 'usd' : 'try';
    const href = screen.getByTestId('plan-cta-starter').getAttribute('href') ?? '';
    expect(href.startsWith('/login?')).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(href.slice('/login?'.length)))).toEqual({ mode: 'signup', callbackUrl: '/app', plan: 'starter', interval: 'month', currency: cur });
    expect(screen.getByTestId('plan-cta-enterprise').getAttribute('href')).toBe('/iletisim?subject=enterprise');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('comparison, FAQ and English reviewer summary (lang="en" in every locale)', () => {
    renderPage(locale);
    expect(screen.getByTestId('compare-table').querySelectorAll('tbody tr')).toHaveLength(12);
    expect(screen.getByTestId('compare-row-orders').textContent).toMatch(locale === 'en' ? /2,000.*6,000/ : /2\.000.*6\.000/);
    const summary = screen.getByTestId('reviewer-summary');
    expect(summary.getAttribute('lang')).toBe('en');
    expect(summary.textContent).toContain('Starter: ₺2,499/month (₺24,990/year) or $59/month ($590/year). 500 orders, 250 labels, 2 connected stores and 300 AI credits a month.');
    expect(screen.getByTestId('faq-founding')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/30[- ]day|15%|API access|users/i);
  });
});

describe('PricingPage founding states', () => {
  it('≤ 5 spots: "Only 3 spots left"', () => {
    h.founding = { ...h.founding, spots: { ...OPEN, remaining: 3 } };
    renderPage('en');
    expect(screen.getByTestId('founding-count').textContent).toBe('Only 3 spots left');
  });

  it('offer off: no line, no struck price, no founding caption, no founding FAQ', () => {
    h.founding = { ...h.founding, spots: null };
    renderPage('tr');
    expect(screen.queryByTestId('founding-line')).toBeNull();
    expect(screen.queryByTestId('plan-struck-growth')).toBeNull();
    expect(screen.queryByTestId('plan-caption-growth')).toBeNull();
    expect(screen.getByTestId('plan-amount-growth').textContent).toBe('₺4.999');
    expect(screen.queryByTestId('faq-founding')).toBeNull();
  });

  it('loading: reserved skeleton line', () => {
    h.founding = { ...h.founding, spots: null, isLoading: true };
    renderPage('en');
    expect(screen.getByTestId('founding-line-skeleton')).toBeTruthy();
  });

  it('yearly from the URL: yearly founding price, struck list, per-month caption', () => {
    h.router.query = { interval: 'year', currency: 'try' };
    renderPage('en');
    expect(screen.getByTestId('plan-amount-starter').textContent).toBe('₺14,994');
    expect(screen.getByTestId('plan-struck-starter').textContent).toBe('₺24,990');
    expect(screen.getByTestId('plan-caption-starter').textContent).toBe('Founding price, for life · ₺1,249.50 a month');
    h.founding = { ...h.founding, spots: null };
    cleanup();
    renderPage('en');
    expect(screen.getByTestId('plan-caption-starter').textContent).toBe('₺2,082.50 a month · 2 months free');
  });

  it('toggles write the URL (shallow replace)', () => {
    renderPage('en');
    fireEvent.click(within(screen.getByTestId('pricing-interval')).getByRole('radio', { name: 'Yearly · 2 months free' }));
    expect(h.router.replace).toHaveBeenCalled();
    const arg = h.router.replace.mock.calls.at(-1)?.[0] as { query: Record<string, string> };
    expect(arg.query.interval).toBe('year');
  });
});

describe.each(['en', 'tr'] as const)('PricingPage Shopify gating (%s, §10.5, §11)', (locale) => {
  const noMoney = () => {
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/[₺$€]/);
    expect(text).not.toMatch(/Stripe/);
    expect(seoDescription()).not.toMatch(/[₺$€]/);
    expect(document.querySelector('a[href*="fiyatlandirma"]')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  };

  it('auth still loading: money region is a skeleton', () => {
    h.auth = { session: null, isLoading: true };
    renderPage(locale);
    expect(screen.getByTestId('pricing-page').getAttribute('data-gate')).toBe('skeleton');
    expect(plans().getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('reviewer-summary')).toBeNull();
    noMoney();
    // the limits table still renders
    expect(screen.getByTestId('compare-table')).toBeTruthy();
  });

  it('signed in, entitlement pending: skeleton, no price', () => {
    signedIn(undefined, 'loading');
    renderPage(locale);
    expect(screen.getByTestId('plan-cta-skeleton-growth')).toBeTruthy();
    noMoney();
  });

  it('shopify_free: redirect to billing before any price is painted', () => {
    signedIn(ent({ plan: 'shopify_free', state: 'shopify_free', stripeUpsell: false }));
    renderPage(locale);
    expect(h.router.replace).toHaveBeenCalledWith('/ayarlar?tab=billing');
    expect(screen.getByTestId('pricing-page').getAttribute('data-gate')).toBe('redirect');
    noMoney();
    expect(screen.queryByTestId('faq-founding')).toBeNull();
  });
});

describe('PricingPage signed-in CTAs (§10.4)', () => {
  it('trial: "Choose Growth" → checkout with expectFounding; trial carry caption', async () => {
    signedIn(ent({}));
    fetchSpy.mockResolvedValue(jsonRes(200, { url: 'https://checkout.stripe.com/c/1' }));
    renderPage('en');
    const btn = screen.getByTestId('plan-cta-growth');
    expect(btn.textContent).toBe('Choose Growth');
    expect(screen.getByTestId('plan-carry-growth').textContent).toMatch(/^You won't be charged until /);
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/1'));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/stripe/create-checkout-session');
    expect(JSON.parse(init.body as string)).toEqual({ plan: 'growth', interval: 'month', currency: 'usd', expectFounding: true });
  });

  it('founding race: 409 founding_full → Modal → Continue re-posts without founding', async () => {
    signedIn(ent({ trialEndsAt: new Date(Date.now() + DAY).toISOString() }));
    fetchSpy.mockResolvedValueOnce(jsonRes(409, { reason: 'founding_full' }));
    fetchSpy.mockResolvedValueOnce(jsonRes(200, { url: 'https://checkout.stripe.com/c/2' }));
    renderPage('tr');
    expect(screen.queryByTestId('plan-carry-growth')).toBeNull(); // < 49h left: charged now
    await act(async () => { fireEvent.click(screen.getByTestId('plan-cta-growth')); });
    const modal = await screen.findByTestId('founding-full-modal');
    expect(modal.textContent).toContain('Kurucu üye kontenjanı az önce doldu');
    expect(modal.textContent).toContain('Growth planı aylık ₺4.999. Ödemeye devam edilsin mi?');
    expect(h.founding.mutate).toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(modal).getByRole('button', { name: 'Devam et' })); });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/2'));
    expect(JSON.parse((fetchSpy.mock.calls[1] as [string, RequestInit])[1].body as string).expectFounding).toBe(false);
  });

  it('checkout 403 / 500 → i18n toasts, never server text; 401 → login', async () => {
    signedIn(ent({}));
    fetchSpy.mockResolvedValueOnce(jsonRes(403, { error: 'Shopify merchants...' }));
    renderPage('en');
    await act(async () => { fireEvent.click(screen.getByTestId('plan-cta-pro')); });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("This account can't buy a plan here.", { persist: false }));
    fetchSpy.mockResolvedValueOnce(jsonRes(500, { error: 'boom' }));
    await act(async () => { fireEvent.click(screen.getByTestId('plan-cta-pro')); });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Couldn't open checkout. Try again.", expect.objectContaining({ action: expect.any(Object) })));
    fetchSpy.mockResolvedValueOnce(jsonRes(401, {}));
    await act(async () => { fireEvent.click(screen.getByTestId('plan-cta-pro')); });
    await waitFor(() => expect(h.router.push).toHaveBeenCalledWith(`/login?callbackUrl=${encodeURIComponent('/fiyatlandirma?plan=pro&interval=month&currency=usd')}`));
  });

  it('active Growth: "Current plan" disabled, Pro "Switch to Pro" is the primary → portal subscription_update', async () => {
    signedIn(ent({ plan: 'growth', state: 'active', interval: 'month', currency: 'TRY' }));
    fetchSpy.mockResolvedValue(jsonRes(200, { url: 'https://billing.stripe.com/p/1' }));
    renderPage('en');
    const current = screen.getByTestId('plan-cta-growth');
    expect(current.textContent).toBe('Current plan');
    expect((current as HTMLButtonElement).disabled).toBe(true);
    expect(primaries()).toHaveLength(1);
    const pro = screen.getByTestId('plan-cta-pro');
    expect(pro.className).toContain('MuiButton-contained');
    expect(pro.textContent).toBe('Switch to Pro');
    // currency locked to the account's TRY even in EN
    expect(screen.getByTestId('plan-amount-growth').textContent).toBe('₺2,999.40');
    expect(screen.getByTestId('pricing-currency').getAttribute('data-locked')).toBe('true');
    await act(async () => { fireEvent.click(pro); });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p/1'));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/stripe/create-portal-session');
    expect(JSON.parse(init.body as string)).toEqual({ flow: 'subscription_update' });
  });

  it('past due: danger banner + every plan button disabled', () => {
    signedIn(ent({ plan: 'growth', state: 'past_due_grace', interval: 'month' }));
    renderPage('en');
    expect(screen.getByRole('button', { name: 'Update payment method' })).toBeTruthy();
    expect(document.body.textContent).toContain('Your last payment failed.');
    for (const p of ['starter', 'growth', 'pro']) {
      const b = screen.getByTestId(`plan-cta-${p}`) as HTMLButtonElement;
      expect(b.textContent).toBe('Update payment first');
      expect(b.disabled).toBe(true);
    }
  });

  it('provider unknown: fails closed — no prices, no toggles, inline error with Reload', () => {
    signedIn(undefined, 'error');
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...window.location, assign, reload } });
    renderPage('tr');
    expect(screen.getByTestId('pricing-page').getAttribute('data-gate')).toBe('error');
    expect(screen.getByTestId('pricing-account-error').textContent).toContain('Hesabınız kontrol edilemedi');
    expect(screen.queryByTestId('plan-card-growth')).toBeNull();
    expect(screen.queryByTestId('pricing-controls-skeleton')).toBeNull();
    expect(screen.queryByTestId('reviewer-summary')).toBeNull();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/[₺$€]/);
    expect(seoDescription()).not.toMatch(/[₺$€]/);
    expect(screen.queryByText('Ücretsiz denemeyi başlat')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(reload).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('mobile: same DOM as server render (no reorder after hydration → no layout shift); Growth first via CSS order', () => {
    h.mobile = true;
    renderPage('en');
    // DOM order never depends on the viewport: re-ordering after hydration moved every card ~360px (CLS 0.29).
    const ids = Array.from(plans().querySelectorAll('article')).map((a) => a.getAttribute('data-testid'));
    expect(ids).toEqual(['plan-card-starter', 'plan-card-growth', 'plan-card-pro', 'plan-card-enterprise']);
    // The visual mobile order (Growth first) is a CSS rule on the grid below 900px.
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent || '').join('\n');
    expect(css).toMatch(/max-width:\s*899\.95px[\s\S]*#plan-card-growth[\s\S]*order:\s*0/);
  });

  it('desktop: Starter first; anonymous SEO description carries the from-price', () => {
    renderPage('en');
    const ids = Array.from(plans().querySelectorAll('article')).map((a) => a.getAttribute('data-testid'));
    expect(ids[0]).toBe('plan-card-starter');
    expect(seoDescription()).toBe('From $59 a month. 14 days free, no card needed.');
  });
});

// Pricing v2 ON (the /plan page's server prop): the Shopify / Play gate holds exactly as with v1 (-33, 24 Oct).
describe.each(['en', 'tr'] as const)('PricingPage v2 ON keeps the Shopify gating (%s)', (locale) => {
  const noMoney = () => {
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/[₺$€]/);
    expect(text).not.toMatch(/Stripe/);
    expect(screen.queryByTestId('pricing-v2-app')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  };
  it('auth loading: no v2 prices', () => {
    h.auth = { session: null, isLoading: true };
    renderPage(locale, true);
    noMoney();
  });
  it('entitlement pending: no v2 prices', () => {
    signedIn(undefined, 'loading');
    renderPage(locale, true);
    noMoney();
  });
  it('shopify_free: redirect, no v2 prices', () => {
    signedIn(ent({ plan: 'shopify_free', state: 'shopify_free', stripeUpsell: false }));
    renderPage(locale, true);
    expect(h.router.replace).toHaveBeenCalledWith('/ayarlar?tab=billing');
    noMoney();
  });
  it('trial seller: the v2 packages, and Buy starts the v2 checkout', async () => {
    signedIn(ent({}));
    fetchSpy.mockResolvedValue(jsonRes(200, { url: 'https://checkout.stripe.com/c/1' }));
    renderPage(locale, true);
    expect(screen.getByTestId('pricing-v2-app')).toBeTruthy();
    expect(document.body.textContent).toMatch(/₺/);
    fireEvent.click(screen.getByTestId('pricing-v2-buy-buyume_yil'));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(body).toMatchObject({ plan: 'buyume_yil', interval: 'year', currency: 'try' });
  });
});
