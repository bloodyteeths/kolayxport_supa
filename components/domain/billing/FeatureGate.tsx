// components/domain/billing/FeatureGate.tsx — pro-gating §3.1–§3.5 (G-pro-2).
//
//   <FeatureGate feature="financials" placement="region">{profitBody}</FeatureGate>
//   <FeatureGate feature="bulkPhotoStudio" placement="action">{(a) => <MenuItem … tag={a.tag} onClick={a.onBlockedClick ?? open} />}</FeatureGate>
//
// page / region: skeleton while the entitlement loads; the children when the feature is in the plan
// (trial included) or the entitlement is unknown (the server decides; a 402 `featureLocked` recorded by
// lib/http/limitInterceptor.ts then swaps the region); otherwise the locked state:
//   locked  (Stripe account)  EmptyState kind="locked" + "See plans" (the view's only primary; mobile:
//                             StickyActionBar) + "Your trial included it until …" + optional FeaturePreview
//   paused  (expired / grace) "Your plan is paused" + "Reactivate" → Plan & billing
//   neutral (stripeUpsell false / server neutral) "This isn't included in your plan", no action, no preview
// No modal, no toast, no banner, nothing opens on load.
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useIsMobile, StickyActionBar } from '@/components/ds/page';
import { EmptyState, FeaturePreview, PanelSkeleton, type FeaturePreviewProps } from '@/components/ds/state';
import type { ActionSpec } from '@/components/ds/types/actions';
import { useFormatters } from '@/lib/format';
import { useFeatureLockStore } from '@/lib/http/limitInterceptor';
import { FEATURE_COPY, PREVIEW_READY, REACTIVATE_HREF, previewImage, seePlansHref } from '@/lib/billing/featureMap';
import { featureActionState, useFeatureAccess, useFeatureAction, type FeatureAccess, type FeatureActionState } from '@/lib/billing/useFeatureAction';
import type { Entitlement, Feature } from '@/lib/billing/types';

export type FeatureGatePlacement = 'page' | 'region' | 'action';

export interface FeatureGateProps {
  feature: Feature;
  placement: FeatureGatePlacement;
  /** page/region: the feature. action: a render function of the entry-point state. */
  children: ReactNode | ((state: FeatureActionState) => ReactNode);
  /** Overrides the registry preview (pro-gating §3.1). Shown only in the Stripe locked state. */
  preview?: FeaturePreviewProps;
  /** action: where a locked entry point leads (the gated route). Default "See plans". */
  lockedHref?: string;
  'data-testid'?: string;
}

/** Forget a stale server lock once the entitlement newly grants the feature (e.g. after an upgrade). */
function useClearLockOnGrant(feature: Feature, entitlement: Entitlement | undefined) {
  const granted = entitlement?.features?.[feature] === true;
  const prev = useRef<boolean | null>(null);
  useEffect(() => {
    if (prev.current === false && granted) useFeatureLockStore.getState().clear(feature);
    prev.current = entitlement ? granted : prev.current;
  }, [feature, granted, entitlement]);
}

export interface LockedFeatureProps {
  feature: Feature;
  access: Extract<FeatureAccess, 'locked' | 'paused' | 'neutral'>;
  /** Trial end, for the "Your trial included it until …" caption after a trial. */
  trialEndsAt?: string | null;
  preview?: FeaturePreviewProps;
  'data-testid'?: string;
}

/** The locked page / region body (pro-gating §3.2, §3.3). Exported for routes that only render it. */
export function LockedFeature({ feature, access, trialEndsAt, preview, 'data-testid': testId }: LockedFeatureProps) {
  const t = useTranslations('pro');
  const locale = useLocale();
  const f = useFormatters();
  const mobile = useIsMobile();
  const copy = FEATURE_COPY[feature];

  if (access === 'neutral') {
    return (
      <EmptyState
        kind="locked"
        title={t('locked.neutral.title')}
        body={t('locked.neutral.body')}
        data-testid={testId ?? `feature-locked-${feature}`}
      />
    );
  }

  const paused = access === 'paused';
  const action: ActionSpec = paused
    ? { id: 'reactivate', label: t('locked.reactivate'), href: REACTIVATE_HREF }
    : { id: 'see-plans', label: t('locked.seePlans'), href: seePlansHref(feature) };
  const ended = trialEndsAt && new Date(trialEndsAt).getTime() < Date.now() ? trialEndsAt : null;
  const shownPreview: FeaturePreviewProps | null = paused
    ? null
    : preview ?? (PREVIEW_READY[feature]
      ? { image: { ...previewImage(feature, locale), alt: t(copy.preview.altKey) }, points: copy.pointsKeys.map((k) => t(k)) }
      : null);

  return (
    <>
      <EmptyState
        kind="locked"
        title={paused ? t('locked.paused.title') : t(copy.titleKey)}
        body={t(copy.bodyKey)}
        action={mobile ? undefined : action}
        footnote={ended ? t('locked.trialEnded', { date: f.date(ended) }) : undefined}
        data-testid={testId ?? `feature-locked-${feature}`}
      >
        {shownPreview ? <FeaturePreview {...shownPreview} /> : null}
      </EmptyState>
      {mobile ? <StickyActionBar primary={action} ariaLabel={t(copy.titleKey)} /> : null}
    </>
  );
}

export function FeatureGate({ feature, placement, children, preview, lockedHref, 'data-testid': testId }: FeatureGateProps) {
  if (placement === 'action') {
    return <FeatureGateAction feature={feature} lockedHref={lockedHref}>{children}</FeatureGateAction>;
  }
  return <FeatureGateRegion feature={feature} preview={preview} data-testid={testId}>{children}</FeatureGateRegion>;
}

function FeatureGateAction({ feature, lockedHref, children }: Pick<FeatureGateProps, 'feature' | 'lockedHref' | 'children'>) {
  const state = useFeatureAction(feature, { lockedHref });
  if (!state.visible) return null;
  return <>{typeof children === 'function' ? children(state) : children}</>;
}

function FeatureGateRegion({ feature, preview, children, 'data-testid': testId }: Pick<FeatureGateProps, 'feature' | 'preview' | 'children' | 'data-testid'>) {
  const { access, entitlement } = useFeatureAccess(feature);
  useClearLockOnGrant(feature, entitlement);

  if (access === 'loading') return <PanelSkeleton data-testid={testId ? `${testId}-loading` : 'feature-gate-loading'} />;
  if (access === 'locked' || access === 'paused' || access === 'neutral') {
    return <LockedFeature feature={feature} access={access} trialEndsAt={entitlement?.trialEndsAt} preview={preview} data-testid={testId} />;
  }
  const state = featureActionState(access, entitlement?.trialEndsAt);
  return <>{typeof children === 'function' ? children(state) : children}</>;
}

export default FeatureGate;
