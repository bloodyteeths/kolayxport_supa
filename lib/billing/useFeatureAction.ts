// lib/billing/useFeatureAction.ts — pro-gating §1–§3: one decision for "can this account use a Pro
// feature, and how is its entry point shown". Pure `featureAccess()` (unit-tested) + the hook that reads
// `useEntitlement()` and the server's 402 `featureLocked` record (`useFeatureLockStore`, filled by
// lib/http/limitInterceptor.ts). The UI gate is presentation only: the server gate decides data access.
//
// Access values:
//   loading   entitlement not known yet (region: skeleton; action: visible, no tag)
//   unknown   entitlement failed (render normally, let the server decide; never "See plans")
//   allowed   in the plan (Pro / Enterprise): no tag
//   trial     in the plan through the trial: `PlanTag` with "Included in your trial until {date}"
//   locked    Stripe account without the feature: entry visible + `PlanTag`, gated route shows §3.2
//   paused    as locked, but the account is expired / in grace: "Your plan is paused" + Reactivate
//   neutral   stripeUpsell false (Shopify) without the feature: entry NOT rendered, URL → neutral locked
import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useFeatureLockStore, type FeatureLockInfo } from '@/lib/http/limitInterceptor';
import { isNeutralBilling } from './billingState';
import { seePlansHref } from './featureMap';
import { useEntitlement } from './useEntitlement';
import type { Entitlement, Feature } from './types';

export type FeatureAccess = 'loading' | 'unknown' | 'allowed' | 'trial' | 'locked' | 'paused' | 'neutral';

export interface FeatureAccessInput {
  entitlement: Entitlement | null | undefined;
  /** true while the entitlement is still loading (no data, no error). */
  loading?: boolean;
  /** Latest server 402 `featureLocked` for this feature, if any (the server wins). */
  serverLock?: Pick<FeatureLockInfo, 'neutral'> | null;
}

/** Pure decision (pro-gating §2 matrix). */
export function featureAccess(feature: Feature, { entitlement: e, loading, serverLock }: FeatureAccessInput): FeatureAccess {
  if (serverLock) {
    // Neutral when the server says so, or when the account may not see upsells (or is unknown).
    if (serverLock.neutral === true || !e || isNeutralBilling(e)) return 'neutral';
    return e.state === 'expired' || e.state === 'grace' ? 'paused' : 'locked';
  }
  if (!e) return loading ? 'loading' : 'unknown';
  if (e.features[feature] === true) {
    return e.state === 'trial' && !isNeutralBilling(e) ? 'trial' : 'allowed';
  }
  if (isNeutralBilling(e)) return 'neutral';
  return e.state === 'expired' || e.state === 'grace' ? 'paused' : 'locked';
}

export interface FeatureActionState {
  access: FeatureAccess;
  /** Render the entry point at all (false only for neutral accounts without the feature). */
  visible: boolean;
  /** Show `<PlanTag plan="pro" />` after the label (trial and locked Stripe accounts). */
  tag: boolean;
  /** Trial end for the PlanTag tooltip (trial only). */
  trialEndsAt: Date | null;
  /** The entry point leads to the locked explanation instead of the feature. */
  locked: boolean;
  /**
   * For a locked entry point: navigates to `lockedHref` (the gated route, which renders the locked state)
   * or, without one, to "See plans". Undefined when the action is usable.
   */
  onBlockedClick?: () => void;
}

/** Pure: entry-point presentation for an access value. */
export function featureActionState(access: FeatureAccess, trialEndsAt: string | null | undefined): Omit<FeatureActionState, 'onBlockedClick'> {
  const trialEnd = access === 'trial' && trialEndsAt ? new Date(trialEndsAt) : null;
  return {
    access,
    visible: access !== 'neutral',
    tag: access === 'trial' || access === 'locked' || access === 'paused',
    trialEndsAt: trialEnd && Number.isFinite(trialEnd.getTime()) ? trialEnd : null,
    locked: access === 'locked' || access === 'paused',
  };
}

/** Access for `feature` from the live entitlement + server lock (shared by `FeatureGate`). */
export function useFeatureAccess(feature: Feature): { access: FeatureAccess; entitlement: Entitlement | undefined } {
  const { data, state } = useEntitlement();
  const serverLock = useFeatureLockStore((s) => s.locked[feature] ?? null);
  const loading = !data && (state === 'loading' || state === 'slow');
  return { access: featureAccess(feature, { entitlement: data, loading, serverLock }), entitlement: data };
}

/**
 * pro-gating §3.4 for bulk bars, menus and row actions:
 * `const photo = useFeatureAction('bulkPhotoStudio', { lockedHref: '/app/etsy-listings/photos' })`
 * → `photo.visible && <Action label=… trailing={photo.tag ? <PlanTag plan="pro" trialEndsAt={photo.trialEndsAt} /> : null}
 *    onClick={photo.onBlockedClick ?? openStudio} />`. Locked actions stay enabled (no disabledReason).
 */
export function useFeatureAction(feature: Feature, opts: { lockedHref?: string } = {}): FeatureActionState {
  const router = useRouter();
  const { access, entitlement } = useFeatureAccess(feature);
  const base = useMemo(() => featureActionState(access, entitlement?.trialEndsAt), [access, entitlement?.trialEndsAt]);
  const target = opts.lockedHref ?? seePlansHref(feature);
  const onBlockedClick = useCallback(() => { void router.push(target); }, [router, target]);
  return base.locked ? { ...base, onBlockedClick } : base;
}

export default useFeatureAction;
