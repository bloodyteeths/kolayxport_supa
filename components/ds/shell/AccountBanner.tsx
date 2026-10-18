// components/ds/shell/AccountBanner.tsx — the only account banner (shell-nav §5 "Account banner"; DS §3.13).
//
// Rendered at the top of the content column, above <Page>, only when the account is BLOCKED:
//   - trial ended / no active plan → danger "Your trial has ended…" / "You don't have an active plan…"
//     [Choose a plan] → /ayarlar?tab=billing
//   - a meter at its limit → warning "You've used all {limit} {kind} for this period." [Upgrade]
// Never for Shopify-free accounts (App Store rule 1.2.1; they are unlimited), never dismissible while
// blocking, and never a marketing banner (this replaces TrialNotification).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ds/feedback/Banner';
import { layout, px } from '@/lib/ds/tokens';
import { BILLING_HREF, type ShellMeterKind, type ShellUsage } from './SideNavFooter';
import { isPlayClient } from '@/lib/billing/playClient';

export type AccountBannerProps = {
  usage: ShellUsage | null | undefined;
  className?: string;
};

export type AccountBannerState =
  | { kind: 'trialEnded' }
  | { kind: 'noPlan' }
  | { kind: 'limitReached'; meter: ShellMeterKind; limit: number }
  | null;

/** Pure: which banner (if any) the account needs. */
export function accountBannerState(usage: ShellUsage | null | undefined): AccountBannerState {
  if (!usage || usage.state === 'shopify_free' || usage.planKey === 'shopifyFree' || isPlayClient()) return null;
  if (usage.blocked) return { kind: usage.blocked };
  const m = usage.limitReached;
  if (m && m.limit !== null && m.limit > 0) return { kind: 'limitReached', meter: m.kind, limit: m.limit };
  return null;
}

const KIND_KEY: Record<ShellMeterKind, 'usage.kind.labels' | 'usage.kind.orders'> = {
  label: 'usage.kind.labels',
  orderSync: 'usage.kind.orders',
};

export function AccountBanner({ usage, className }: AccountBannerProps) {
  const t = useTranslations('shell');
  const state = accountBannerState(usage);
  if (!state) return null;

  const banner =
    state.kind === 'limitReached' ? (
      <Banner
        tone="warning"
        title={t('banner.limitReached', { limit: state.limit, kind: t(KIND_KEY[state.meter]) })}
        action={{ id: 'upgrade', label: t('banner.upgrade'), href: BILLING_HREF }}
        data-testid="account-banner"
      />
    ) : (
      <Banner
        tone="danger"
        title={t(state.kind === 'trialEnded' ? 'banner.trialEnded' : 'banner.noPlan')}
        action={{ id: 'choose-plan', label: t('banner.choosePlan'), href: BILLING_HREF }}
        data-testid="account-banner"
      />
    );

  return (
    <Box
      className={className}
      data-banner={state.kind}
      sx={{ px: { xs: px(layout.gutterMobile), md: px(layout.gutter) }, pt: px(16), maxWidth: layout.maxList + 2 * layout.gutter, mx: 'auto', boxSizing: 'border-box' }}
    >
      {banner}
    </Box>
  );
}

export default AccountBanner;
