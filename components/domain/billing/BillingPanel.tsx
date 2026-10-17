// components/domain/billing/BillingPanel.tsx — Settings › Plan & billing (settings §9). Self-contained:
// reads `useEntitlement()` (+ fallback), the A3 billing summary and the A1 invoices; every decision comes
// from `billingView()` (lib/billing/billingState.ts). Rendered by Group A's SettingsPage for `?tab=billing`
// (desktop content column and the mobile drill-in).
//
// Query params it reads: `invoices=all` (full invoice list, replaces /faturalar), `checkout=success` (§9.5).
// ⌘K (§12): Manage subscription · Update payment method · Compare plans · View invoices, registered only
// when Stripe surfaces are allowed (never for shopify_free / unknown).
import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { StickyActionBar, useIsMobile } from '@/components/ds/page';
import type { ActionSpec } from '@/components/ds/types/actions';
import { icons } from '@/lib/ds/icons';
import { usePageActions } from '@/lib/ds/usePageActions';
import { useSettingsShell } from '@/components/domain/settings/settingsNav';
import { PanelHeading } from '@/components/domain/settings/sender/PanelHeading';
import { billingView, type BillingAction } from '@/lib/billing/billingState';
import { useEntitlement } from '@/lib/billing/useEntitlement';
import { PlanCard } from './PlanCard';
import { UsageCard } from './UsageCard';
import { IncludedCard } from './IncludedCard';
import { CreditsCard } from './CreditsCard';
import { InvoicesCard } from './InvoicesCard';
import { useBillingSummary } from './useBillingSummary';
import { usePortal } from './usePortal';
import { useCheckoutReturn } from './CheckoutReturn';

export interface BillingPanelProps {
  /** Default true: section title + description (settings §1.3). */
  heading?: boolean;
}

export function BillingPanel({ heading = true }: BillingPanelProps) {
  const t = useTranslations('billing');
  const router = useRouter();
  const mobile = useIsMobile();
  const shell = useSettingsShell();
  const ent = useEntitlement();
  const e = ent.data;
  const view = useMemo(() => billingView(e), [e]);
  const stripe = view.mode === 'stripe';
  const summary = useBillingSummary(stripe && view.paymentDetails);
  const portal = usePortal();
  const checkout = useCheckoutReturn(e, ent.mutate);
  const all = router.query.invoices === 'all';

  const toSpec = useCallback(
    (a: BillingAction | null, labelKey?: string): ActionSpec | null => {
      if (!a) return null;
      const label = t(labelKey ?? `action.${a.id}`);
      if (a.kind === 'href') return { id: a.id, label, href: a.href };
      return {
        id: a.id,
        label,
        tone: a.id === 'cancel' ? 'danger' : 'default',
        loading: portal.pending === a.id,
        loadingLabel: t('action.opening'),
        onClick: () => { void portal.open(a.flow, a.id); },
      };
    },
    [t, portal],
  );

  const primary = toSpec(view.primary);
  const secondary = toSpec(view.secondary);
  const mobileSecondary = mobile ? toSpec(view.mobileSecondary) : null;
  const overflow = view.overflow.map((a) => toSpec(a)).filter((x): x is ActionSpec => !!x);
  // Row actions get their own ids (the same flows as the card actions, distinct test ids / loading state).
  const rowSpec = (id: string, flow: BillingAction & { kind: 'portal' }, labelKey: string): ActionSpec | null => {
    const spec = toSpec(flow, labelKey);
    return spec ? { ...spec, id, loading: portal.pending === id, onClick: () => { void portal.open(flow.flow, id); } } : null;
  };
  const updatePayment = stripe ? rowSpec('payment-method-update', { id: 'updatePayment', kind: 'portal', flow: 'payment_method_update' }, 'paymentMethod.update') : null;
  const editDetails = stripe ? rowSpec('billing-details-edit', { id: 'manageInStripe', kind: 'portal', flow: null }, 'details.edit') : null;

  const viewAll = useCallback(() => {
    if (shell) void shell.goToTab('billing', { invoices: 'all' });
    else void router.replace({ pathname: router.pathname, query: { ...router.query, tab: 'billing', invoices: 'all' } }, undefined, { shallow: true });
  }, [router, shell]);
  const manageStores = useCallback(() => {
    if (shell) void shell.goToTab('connections');
    else void router.push('/ayarlar?tab=connections');
  }, [router, shell]);

  // ⌘K entries (§12), Stripe accounts only.
  usePageActions(
    stripe
      ? [
          // Portal rows only when a Stripe customer exists (§9.3): trial / grace / expired have none, and the
          // portal would answer 400 no_customer.
          view.paymentDetails
            ? { id: 'billing-manage', label: t('palette.manage'), icon: icons.billing, onClick: () => { void portal.open(null, 'manageInStripe'); } }
            : null,
          view.paymentDetails
            ? { id: 'billing-update-payment', label: t('action.updatePayment'), onClick: () => { void portal.open('payment_method_update', 'updatePayment'); } }
            : null,
          { id: 'billing-compare', label: t('action.comparePlans'), href: '/fiyatlandirma?from=billing' },
          view.invoices !== 'hide' ? { id: 'billing-invoices', label: t('palette.invoices'), onClick: viewAll } : null,
        ]
      : [],
    { enabled: stripe },
  );

  // Shopify / unknown: `view.invoices === 'hide'` → no card and no request (§9.6, §11). Enterprise is neutral
  // (no Stripe actions) but keeps `ifAny` invoices per the §9.3 enterprise row.
  const showInvoices = view.invoices !== 'hide';

  return (
    <div data-testid="billing-panel" data-mode={view.mode} data-state={e?.state ?? 'unknown'}>
      {heading ? <PanelHeading title={t(view.mode === 'neutral' && view.planName !== 'enterprise' ? 'titleShopify' : 'title')} description={t('description')} /> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PlanCard
          view={view}
          state={e ? 'ready' : ent.state}
          onRetry={ent.retry}
          summary={summary.data}
          primaryInCard={!mobile}
          notice={checkout.notice}
          actions={{ primary, secondary, mobileSecondary, overflow, updatePayment, editDetails }}
        />
        {view.mode !== 'unknown' || ent.state === 'loading' || ent.state === 'slow' ? (
          <UsageCard
            entitlement={e}
            state={e ? 'ready' : ent.state}
            fallback={ent.fallback}
            onRetry={ent.retry}
            onManageStores={manageStores}
          />
        ) : null}
        <CreditsCard />
        <IncludedCard entitlement={e} />
        {showInvoices ? (
          <InvoicesCard
            enabled={showInvoices}
            onlyIfAny={view.invoices === 'ifAny'}
            all={all}
            onViewAll={viewAll}
            openFirst={view.invoicesOpenFirst}
          />
        ) : null}
      </div>
      {mobile ? <StickyActionBar primary={primary ?? undefined} visible={!!primary} ariaLabel={t('title')} /> : null}
    </div>
  );
}

export default BillingPanel;
