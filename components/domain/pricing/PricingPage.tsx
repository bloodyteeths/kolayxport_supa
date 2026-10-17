// components/domain/pricing/PricingPage.tsx — the public pricing page `/fiyatlandirma` (settings §10), flag
// `pricing`. PublicLayout frame, 1280 max width, 24px gutters (16 on mobile), neutral-50 background, DS
// parts only (no gradients, no motion lift, no colored badges, no uppercase, weights ≤ 600).
//
// Shopify gating without a flash (§10.5): while the auth session is unknown, or a signed-in viewer's
// entitlement is unresolved, the whole money region (prices, CTAs, founding line, FAQ, English summary)
// renders as a skeleton. `stripeUpsell === false` → `router.replace('/ayarlar?tab=billing')` and the
// skeleton stays: a shopify_free user never sees a price, not even for one frame. The header and the
// comparison table (limits only) render at once. A signed-in viewer whose provider stays unknown gets an
// inline error with Reload instead of prices (fails closed: they may be shopify_free). The SEO description
// carries a price only once the gate is 'show' (SSR always ships the price-free line: the NextAuth cookie
// is httpOnly, so anonymous vs signed-in cannot be told apart before the client session check).
//
// URL state (`router.replace`, shallow): `?interval=month|year&currency=try|usd&plan=starter|growth|pro`
// restores the choice after login (the old `?plan=&interval=` return keeps working and gains `currency`).
import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useRouter } from 'next/router';
import { NextSeo } from 'next-seo';
import { useLocale, useTranslations } from 'next-intl';
import PublicLayout from '@/components/PublicLayout';
import { Banner, useToast } from '@/components/ds/feedback';
import { Button } from '@/components/ds/inputs';
import { Bone, ErrorState } from '@/components/ds/state';
import { useIsMobile } from '@/components/ds/page';
import { requestPortal } from '@/components/domain/billing/usePortal';
import { useAuth } from '@/lib/auth-context';
import { useFormatters } from '@/lib/format';
import { urlField, useUrlState } from '@/lib/ds/useUrlState';
import { layout, neutral, radius } from '@/lib/ds/tokens';
import { ENTERPRISE_CONTACT_HREF, pricingCta, pricingPrimaryPlan, type PricingCta, type PricingViewer } from '@/lib/billing/billingState';
import { FOUNDING_INTERVALS } from '@/lib/billing/price';
import { useEntitlement } from '@/lib/billing/useEntitlement';
import { useFoundingSpots } from '@/lib/billing/useFoundingSpots';
import type { Currency, PortalFlow, PricedPlanKey } from '@/lib/billing/types';
import { PricingHeader } from './PricingHeader';
import { IntervalCurrencyControls } from './IntervalCurrencyControls';
import { FoundingLine } from './FoundingLine';
import { PlanCard } from './PlanCard';
import { CompareTable } from './CompareTable';
import { CompareMobile } from './CompareMobile';
import { PricingFaq } from './PricingFaq';
import { ReviewerSummary } from './ReviewerSummary';
import { FoundingFullModal } from './FoundingFullModal';
import { useCheckout } from './useCheckout';
import { MOBILE_ORDER, PRICING_PLANS, RECOMMENDED_PLAN, TAX_INCLUDED, defaultCurrency, fromPrice, pricingGate } from './pricingModel';

export { pricingGate, type PricingGate } from './pricingModel';

export const PRICING_URL_SCHEMA = {
  interval: urlField.enum(['month', 'year'] as const, 'month'),
  currency: urlField.optionalEnum(['try', 'usd'] as const),
  plan: urlField.optionalEnum(['starter', 'growth', 'pro', 'enterprise'] as const),
};

export function PricingPage() {
  const t = useTranslations('marketing.pricingV2');
  const f = useFormatters();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { session, isLoading: authLoading } = useAuth() as { session: unknown; isLoading: boolean };
  const signedIn = !!session;

  const [url, setUrl, urlHelpers] = useUrlState(PRICING_URL_SCHEMA);
  const ent = useEntitlement({ enabled: signedIn });
  const founding = useFoundingSpots();

  const entitlement = signedIn ? ent.data ?? null : null;
  const entitlementError = signedIn && !ent.data && ent.state === 'error';
  const gate = pricingGate({ authLoading, signedIn, entitlement, entitlementError });

  const lockedCurrency: Currency | null = entitlement?.currency ?? null;
  const currency: Currency = lockedCurrency ?? (url.currency ? (url.currency.toUpperCase() as Currency) : defaultCurrency(locale));
  const interval = url.interval;
  const viewer: PricingViewer = { signedIn, entitlement, entitlementError, interval, currency };

  // stripeUpsell false → billing settings, before any price is painted (the skeleton stays meanwhile).
  useEffect(() => {
    if (gate === 'redirect') void router.replace('/ayarlar?tab=billing');
  }, [gate, router]);

  const foundingPercent = founding.spots && FOUNDING_INTERVALS.includes(interval) ? founding.spots.percentOff : null;
  const checkout = useCheckout({ onFoundingFull: () => { void founding.mutate(); } });

  const [portalPending, setPortalPending] = useState<PricedPlanKey | 'payment' | null>(null);
  const openPortal = useCallback(
    async (flow: PortalFlow, key: PricedPlanKey | 'payment') => {
      setPortalPending(key);
      const result = await requestPortal(flow);
      if (result.ok) {
        window.location.assign(result.url);
        return;
      }
      setPortalPending(null);
      if (result.reason === 'managedElsewhere') toast.error(t('checkout.forbidden'), { persist: false });
      else toast.error(t('checkout.portalFailed'), { action: { onClick: () => { void openPortal(flow, key); } } });
    },
    [t, toast],
  );

  const onCheckout = useCallback(
    (cta: Extract<PricingCta, { kind: 'checkout' }>) => {
      void checkout.start({ plan: cta.plan, interval: cta.interval, currency: cta.currency, expectFounding: foundingPercent !== null });
    },
    [checkout, foundingPercent],
  );

  // `?plan=` (back from login, or "See plans" from a locked Pro feature): bring that card into view once.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!urlHelpers.ready || gate !== 'show' || !url.plan || scrolledFor.current === url.plan) return;
    scrolledFor.current = url.plan;
    const el = typeof document !== 'undefined' ? document.getElementById(`plan-card-${url.plan}`) : null;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [urlHelpers.ready, gate, url.plan]);

  const showMoney = gate === 'show';
  // Below 900px Growth (recommended) comes first: DOM order changes too, so reading/tab order match the screen.
  const isMobile = useIsMobile();
  const orderedPlans = isMobile ? MOBILE_ORDER : PRICING_PLANS;
  // The SEO description carries a price, so it is gated like the money region: SSR (session unknown) and
  // any signed-in viewer not yet cleared for Stripe prices get the price-free line.
  const seoDescription = showMoney
    ? t('seo.description', { price: f.money(fromPrice(currency), currency, { wholeIfIntegral: true }) })
    : t('seo.descriptionNeutral');
  const primaryPlan = pricingPrimaryPlan(viewer);
  const pending: PricedPlanKey | null = checkout.pending ?? (portalPending && portalPending !== 'payment' ? portalPending : null);
  const ctaFor = (plan: PricedPlanKey): PricingCta | 'skeleton' => (showMoney ? pricingCta(viewer, plan) : 'skeleton');
  const pastDue = showMoney && entitlement?.state === 'past_due_grace';

  return (
    <PublicLayout
      title={t('seo.title')}
      description={seoDescription}
    >
      <NextSeo openGraph={{ images: [{ url: 'https://kolayxport.com/og/default.png', width: 1200, height: 630, alt: t('seo.ogAlt') }] }} />
      <Box sx={{ bgcolor: neutral[50], color: neutral[800] }} data-testid="pricing-page" data-gate={gate}>
        <Box sx={{ maxWidth: layout.maxDetail, mx: 'auto', px: { xs: '16px', sm: '24px' }, pt: { xs: '24px', md: '48px' }, pb: '64px' }}>
          <PricingHeader />

          {/* Currency symbols are money too: the toggles join the gated region (no ₺/$ for shopify_free). */}
          {showMoney ? (
            <IntervalCurrencyControls
              interval={interval}
              currency={currency}
              lockedCurrency={lockedCurrency}
              onInterval={(v) => setUrl({ interval: v })}
              onCurrency={(v) => setUrl({ currency: v.toLowerCase() as 'try' | 'usd' })}
            />
          ) : gate === 'error' ? null : (
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: '8px', sm: '16px' } }} aria-hidden data-testid="pricing-controls-skeleton">
              <Box sx={{ width: { xs: '100%', sm: 280 } }}><Bone w="100%" h={40} r={radius.sm} /></Box>
              <Box sx={{ width: { xs: '100%', sm: 180 } }}><Bone w="100%" h={40} r={radius.sm} /></Box>
            </Box>
          )}

          <Box
            component="section"
            aria-label={t('plansRegion')}
            aria-busy={gate === 'skeleton' || gate === 'redirect' ? true : undefined}
            data-testid="pricing-plans"
          >
            {gate === 'error' ? (
              <Box sx={{ mt: '24px' }}>
                <ErrorState
                  variant="inline"
                  title={t('accountError.title')}
                  cause={t('accountError.cause')}
                  retryLabel={t('accountError.reload')}
                  onRetry={() => { window.location.reload(); }}
                  data-testid="pricing-account-error"
                />
              </Box>
            ) : (
            <>
              <FoundingLine spots={showMoney ? founding.spots : null} loading={!showMoney || founding.isLoading} />

              {pastDue ? (
                <Box sx={{ mt: '16px' }}>
                  <Banner
                    tone="danger"
                    title={t('pastDueBanner')}
                    action={{
                      id: 'update-payment',
                      label: t('updatePayment'),
                      loading: portalPending === 'payment',
                      onClick: () => { void openPortal('payment_method_update', 'payment'); },
                    }}
                  />
                </Box>
              ) : null}

              <Box
                sx={{
                  mt: '24px',
                  display: 'grid',
                  gap: '16px',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
                }}
              >
                {orderedPlans.map((plan) => (
                  <PlanCard
                    key={plan}
                    plan={plan}
                    interval={interval}
                    currency={currency}
                    foundingPercent={foundingPercent}
                    cta={ctaFor(plan)}
                    recommended={plan === RECOMMENDED_PLAN}
                    primary={plan === primaryPlan}
                    pending={pending}
                    onCheckout={onCheckout}
                    onSwitch={(p) => { void openPortal('subscription_update', p); }}
                  />
                ))}
              </Box>

              {showMoney && TAX_INCLUDED !== null ? (
                <Typography variant="caption" component="p" sx={{ m: 0, mt: '12px', color: neutral[500] }} data-testid="pricing-tax">
                  {TAX_INCLUDED ? t('taxIncluded') : t('taxExcluded')}
                </Typography>
              ) : null}
            </>
            )}
          </Box>

          <Box component="section" aria-labelledby="pricing-compare-title" sx={{ mt: '48px' }}>
            <Typography id="pricing-compare-title" variant="titleLg" component="h2" sx={{ m: 0, mb: '16px', color: neutral[900] }}>
              {t('compare.title')}
            </Typography>
            <CompareTable />
            <CompareMobile />
          </Box>

          {showMoney ? (
            <>
              <PricingFaq founding={founding.spots} />
              <ReviewerSummary />
            </>
          ) : null}

          <Box
            component="section"
            aria-labelledby="pricing-enterprise-title"
            sx={{
              mt: '48px', p: '16px', bgcolor: neutral[0], border: `1px solid ${neutral[200]}`, borderRadius: `${radius.md}px`,
              display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, gap: '12px',
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography id="pricing-enterprise-title" variant="titleSm" component="h2" sx={{ m: 0, color: neutral[900] }}>
                {t('enterprise.title')}
              </Typography>
              <Typography variant="body1" component="p" sx={{ m: 0, mt: '4px', color: neutral[700] }}>
                {t('enterprise.body')}
              </Typography>
            </Box>
            <Button variant="secondary" href={ENTERPRISE_CONTACT_HREF} data-testid="pricing-enterprise-cta">
              {t('cta.talk')}
            </Button>
          </Box>
        </Box>
      </Box>

      <FoundingFullModal
        request={checkout.foundingFull}
        onClose={checkout.dismissFoundingFull}
        onContinue={(req) => { void checkout.start(req); }}
      />
    </PublicLayout>
  );
}

export default PricingPage;
