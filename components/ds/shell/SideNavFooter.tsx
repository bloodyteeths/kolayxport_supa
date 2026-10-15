// components/ds/shell/SideNavFooter.tsx — the sidebar foot (shell-nav §3.1, §3.2, §5 "UsageMeter").
//
// Expanded: a plan card (plan line + `UsageMeter`s) above a ghost "Collapse sidebar  [" row.
// Rail: a Gauge icon only when a meter is ≥ 80 % (tooltip with the numbers, click → Plan & billing), then
// the expand button. The footer never scrolls away (SideNav keeps it outside the scroll area).
//
// Usage source (CRITIQUE C8): the UI reads usage through `useEntitlement()` once settings D ships it
// (M4). Until then `deriveShellUsage()` is that hook's fallback mode, from `GET /api/user/settings`
// `subscription.{subscriptionPlan, subscriptionStatus, trialExpiresAt, orderSyncCount, labelCount,
// usageResetAt, limits, period}`. Plan numbers are never hard-coded here: limits come from the server
// (`subscription.limits`) or, for an older payload, from `getPlanLimits()` (the enforced table).
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { UsageMeter, usageLevel } from '@/components/ds/data/UsageMeter';
import { Kbd } from '@/components/ds/format/Kbd';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { Bone } from '@/components/ds/state/Skeletons';
import { ICON_STROKE, icons } from '@/lib/ds/icons';
import { focusRing, neutral as n, px, radius, tone } from '@/lib/ds/tokens';
import { getPlanLimits, type LimitState } from '@/lib/billing/planLimits';
import type { UserSettingsResponse } from '@/lib/hooks/useSettings';
import { toDate, useFormatters } from '@/lib/format';

export const BILLING_HREF = '/ayarlar?tab=billing';

// ── Usage model (pure) ───────────────────────────────────────────────────────────────────────────────

export type ShellSubscription = NonNullable<UserSettingsResponse['subscription']>;
export type ShellMeterKind = 'label' | 'orderSync';
export type ShellMeter = { kind: ShellMeterKind; used: number; limit: number | null };

export type ShellUsage = {
  state: LimitState;
  plan: string | null;
  /** Shopify-free, enterprise, or every limit null: one line, no bars. */
  unlimited: boolean;
  /** `shell.usage.plan.*` key for the plan line (the trial line uses `trialDaysLeft` instead). */
  planKey: 'trial' | 'starter' | 'growth' | 'pro' | 'enterprise' | 'shopifyFree' | null;
  /** Whole days left in the trial (≥ 0), or null outside the trial. */
  trialDaysLeft: number | null;
  /** Meters to draw (labels first, then imported orders); empty when unlimited or blocked. */
  meters: ShellMeter[];
  /** Monthly reset date (ISO) for paid plans. */
  resetsAt: string | null;
  /** Account is blocked: the trial ended, or there is no active plan. */
  blocked: 'trialEnded' | 'noPlan' | null;
  /** First meter at or over its limit (warning banner). */
  limitReached: ShellMeter | null;
  /** Highest-ratio meter at ≥ 80 % (rail Gauge), or null. */
  nearLimit: ShellMeter | null;
};

const DAY_MS = 86_400_000;

function toFiniteCount(v: unknown): number {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/**
 * Pure: the sidebar / banner usage model from the settings `subscription` block. Returns null when there
 * is no subscription block (the footer and banner render nothing; P6: never invent a plan).
 */
export function deriveShellUsage(sub: ShellSubscription | null | undefined, now: Date = new Date()): ShellUsage | null {
  if (!sub || typeof sub !== 'object') return null;
  const isShopifyFree = sub.subscriptionPlan === 'shopify_free' || sub.billingProvider === 'shopify_free';
  const decision = getPlanLimits(isShopifyFree ? 'shopify_free' : sub.subscriptionPlan, sub.subscriptionStatus, sub.trialExpiresAt, now);
  // The server already resolved the limits (incl. an active ShopifyShop); prefer them over the local table.
  const limits = sub.limits && typeof sub.limits === 'object' ? sub.limits : decision.limits;
  const state = decision.state;

  const blocked: ShellUsage['blocked'] =
    state === 'noSubscription'
      ? sub.subscriptionPlan === 'trial' || sub.subscriptionStatus === 'trialing'
        ? 'trialEnded'
        : 'noPlan'
      : // `invalidPlan` (status active, plan unknown to the enforcer, e.g. a new tier) is a configuration gap,
        // not something the user did: no "you have no plan" banner for a paying customer.
        null;

  let trialDaysLeft: number | null = null;
  if (state === 'trial' && sub.trialExpiresAt) {
    const end = new Date(sub.trialExpiresAt).getTime();
    if (Number.isFinite(end)) trialDaysLeft = Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
  }

  const plan = decision.plan ?? sub.subscriptionPlan ?? null;
  const planKey: ShellUsage['planKey'] =
    state === 'shopify_free'
      ? 'shopifyFree'
      : state === 'trial'
        ? 'trial'
        : plan === 'starter' || plan === 'growth' || plan === 'pro' || plan === 'enterprise'
          ? plan
          : null;

  const allNull = limits.label === null && limits.orderSync === null;
  const unlimited = state === 'shopify_free' || plan === 'enterprise' || (allNull && (state === 'trial' || state === 'active'));
  const showMeters = !unlimited && !blocked && (state === 'trial' || state === 'active');
  const meters: ShellMeter[] = showMeters
    ? [
        { kind: 'label', used: toFiniteCount(sub.labelCount), limit: limits.label ?? null },
        { kind: 'orderSync', used: toFiniteCount(sub.orderSyncCount), limit: limits.orderSync ?? null },
      ]
    : [];

  const limitReached = meters.find((m) => m.limit !== null && m.limit > 0 && m.used >= m.limit) ?? null;
  let nearLimit: ShellMeter | null = null;
  let bestRatio = 0;
  for (const m of meters) {
    if (m.limit === null || m.limit <= 0) continue;
    const ratio = m.used / m.limit;
    if (ratio >= 0.8 && ratio > bestRatio) {
      bestRatio = ratio;
      nearLimit = m;
    }
  }

  return {
    state,
    plan,
    unlimited,
    planKey,
    trialDaysLeft,
    meters,
    resetsAt: state === 'active' && decision.period === 'month' ? sub.usageResetAt ?? null : null,
    blocked,
    limitReached,
    nearLimit,
  };
}

// ── Component ────────────────────────────────────────────────────────────────────────────────────────

export type SideNavFooterProps = {
  /** True when the sidebar shows labels (240 px, incl. the 900–1199 overlay). */
  expanded: boolean;
  /** `undefined` = loading (2-line skeleton); `null` = no data or error (hidden). */
  usage: ShellUsage | null | undefined;
  onToggle: () => void;
  /** Label of the toggle: collapse when the sidebar is open, expand otherwise. */
  toggleAction: 'collapse' | 'expand';
};

const METER_LABEL_KEY: Record<ShellMeterKind, 'usage.labels' | 'usage.ordersImported'> = {
  label: 'usage.labels',
  orderSync: 'usage.ordersImported',
};

export function SideNavFooter({ expanded, usage, onToggle, toggleAction }: SideNavFooterProps) {
  const t = useTranslations('shell');
  const toggleLabel = t(toggleAction === 'collapse' ? 'sidebar.collapse' : 'sidebar.expand');
  const ToggleIcon = toggleAction === 'collapse' ? icons.collapse : icons.expand;

  return (
    <Box
      data-testid="sidenav-footer"
      sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: px(4), px: px(8), pb: px(8), pt: px(4) }}
    >
      {expanded ? <PlanCard usage={usage} /> : <RailUsage usage={usage} />}
      {expanded ? (
        <ButtonBase
          onClick={onToggle}
          aria-label={toggleLabel}
          aria-keyshortcuts="["
          data-testid="sidenav-toggle"
          sx={{
            height: 32,
            px: px(8),
            gap: px(8),
            borderRadius: px(radius.sm),
            justifyContent: 'flex-start',
            color: n[600],
            '&:hover': { bgcolor: n[100] },
            '&.Mui-focusVisible': { boxShadow: focusRing },
          }}
        >
          <ToggleIcon size={18} strokeWidth={ICON_STROKE} aria-hidden color={n[500]} />
          <Typography component="span" variant="label" sx={{ flex: 1, textAlign: 'left', color: n[600] }}>
            {toggleLabel}
          </Typography>
          <Kbd keys="[" />
        </ButtonBase>
      ) : (
        <Tooltip title={toggleLabel} shortcut="[" placement="right">
          <ButtonBase
            onClick={onToggle}
            aria-label={toggleLabel}
            aria-keyshortcuts="["
            data-testid="sidenav-toggle"
            sx={railButtonSx}
          >
            <ToggleIcon size={20} strokeWidth={ICON_STROKE} aria-hidden />
          </ButtonBase>
        </Tooltip>
      )}
    </Box>
  );
}

const railButtonSx = {
  width: 40,
  height: 40,
  mx: 'auto',
  borderRadius: px(radius.sm),
  color: n[500],
  '&:hover': { bgcolor: n[100], color: n[800] },
  '&.Mui-focusVisible': { boxShadow: focusRing },
} as const;

function usePlanLine(usage: ShellUsage): string {
  const t = useTranslations('shell');
  if (usage.planKey === 'trial' && usage.trialDaysLeft !== null) return t('usage.trialDaysLeft', { days: usage.trialDaysLeft });
  if (usage.planKey) return t(`usage.plan.${usage.planKey}`);
  return '';
}

function PlanCard({ usage }: { usage: ShellUsage | null | undefined }) {
  if (usage === undefined) {
    return (
      <Box data-testid="usage-skeleton" aria-hidden sx={{ ...cardSx, gap: px(8) }}>
        <Bone w="60%" h={12} />
        <Bone w="100%" h={12} />
      </Box>
    );
  }
  if (usage === null || usage.blocked) return null;
  return <PlanCardBody usage={usage} />;
}

function PlanCardBody({ usage }: { usage: ShellUsage }) {
  const t = useTranslations('shell');
  const f = useFormatters();
  const planLine = usePlanLine(usage);
  const resetsAt = toDate(usage.resetsAt);
  if (!planLine && usage.meters.length === 0) return null;
  return (
    <Box
      component={NextLink}
      href={BILLING_HREF}
      data-testid="usage-card"
      aria-label={t('usage.region')}
      sx={{
        ...cardSx,
        textDecoration: 'none',
        color: 'inherit',
        '&:hover': { borderColor: n[300] },
        '&:focus-visible': { outline: 'none', boxShadow: focusRing },
      }}
    >
      {planLine ? (
        <Typography component="span" variant="label" sx={{ color: n[800] }}>
          {planLine}
        </Typography>
      ) : null}
      {usage.meters.map((m) => (
        <UsageMeter
          key={m.kind}
          size="sm"
          label={t(METER_LABEL_KEY[m.kind])}
          used={m.used}
          limit={m.limit}
          data-testid={`usage-meter-${m.kind}`}
        />
      ))}
      {resetsAt ? (
        <Typography component="span" variant="caption" sx={{ color: n[500] }}>
          {t('usage.resets', { date: f.date(resetsAt, 'date') })}
        </Typography>
      ) : null}
    </Box>
  );
}

function RailUsage({ usage }: { usage: ShellUsage | null | undefined }) {
  const t = useTranslations('shell');
  const tip = usage?.nearLimit ?? null;
  if (!usage || usage.blocked || !tip || tip.limit === null) return null;
  const parts = [
    t('usage.railTooltip', { kind: t(METER_LABEL_KEY[tip.kind]), used: tip.used, limit: tip.limit }),
  ];
  if (usage.planKey === 'trial' && usage.trialDaysLeft !== null) parts.push(t('usage.trialDaysLeft', { days: usage.trialDaysLeft }));
  const label = parts.join(' · ');
  const level = usageLevel(tip.used, tip.limit);
  const Gauge = icons.usage;
  return (
    <Tooltip title={label} placement="right">
      <ButtonBase
        component={NextLink}
        href={BILLING_HREF}
        aria-label={label}
        data-testid="rail-usage"
        sx={{ ...railButtonSx, color: level === 'over' ? tone.danger.fg : tone.warning.fg }}
      >
        <Gauge size={20} strokeWidth={ICON_STROKE} aria-hidden />
      </ButtonBase>
    </Tooltip>
  );
}

const cardSx = {
  display: 'flex',
  flexDirection: 'column',
  gap: px(8),
  p: px(12),
  mb: px(4),
  bgcolor: n[0],
  border: `1px solid ${n[200]}`,
  borderRadius: px(radius.md),
} as const;

export default SideNavFooter;
