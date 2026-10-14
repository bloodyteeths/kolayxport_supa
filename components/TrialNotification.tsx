import React, { useState, useEffect } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  IconButton,
} from '@mui/material';
import {
  Close,
  UpgradeOutlined,
  Schedule,
} from '@mui/icons-material';
import { differenceInDays } from 'date-fns';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';

// Trial quotas enforced server-side in lib/middleware/withUsageLimiter.ts
// (checkUsage → trialLimits). Used only when the settings payload doesn't carry
// explicit limits. Keep in sync with that middleware.
const TRIAL_LIMITS = { orderSync: 50, label: 10 } as const;
// Warn once usage reaches this share of the quota (same 80% the
// SubscriptionDashboard uses for "near limit").
const NEAR_LIMIT_RATIO = 0.8;

interface TrialNotificationProps {
  userSubscription?: {
    subscriptionPlan: string | null;
    subscriptionStatus: string | null;
    billingProvider?: string | null;
    trialExpiresAt: string | null;
    orderSyncCount: number;
    labelCount: number;
    /** Optional server-provided quotas; fall back to TRIAL_LIMITS when absent. */
    orderSyncLimit?: number | null;
    labelLimit?: number | null;
  } | null;
}

export default function TrialNotification({ userSubscription }: TrialNotificationProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const t = useTranslations('trial');

  const trialExpiresAt = userSubscription?.trialExpiresAt ?? null;
  const daysUntilExpiry = trialExpiresAt
    ? differenceInDays(new Date(trialExpiresAt), new Date())
    : null;
  const isUrgent = daysUntilExpiry !== null && daysUntilExpiry <= 3;

  // Check if notification was dismissed recently (within last 24 hours).
  // Must run before any early return: userSubscription arrives async, and a
  // hook that only runs once it's loaded changes the hook count (React #310).
  // Kept separate from `dismissed` so an urgent trial still shows even if the
  // subscription loads after this effect ran.
  const [recentlyDismissed, setRecentlyDismissed] = useState(false);
  useEffect(() => {
    try {
      const lastDismissed = localStorage.getItem('trialNotificationDismissed');
      if (lastDismissed) {
        const dismissedTime = parseInt(lastDismissed);
        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
        if (dismissedTime > twentyFourHoursAgo) {
          setRecentlyDismissed(true);
        }
      }
    } catch {
      // localStorage unavailable (private mode) — just show the notice
    }
  }, []);

  // Shopify-installed merchants are on the free tier — never show them
  // trial countdowns or Stripe upgrade prompts (App Store rule 1.2.1).
  if (!userSubscription ||
      userSubscription.billingProvider === 'shopify_free' ||
      userSubscription.subscriptionPlan === 'shopify_free' ||
      userSubscription.subscriptionStatus !== 'trialing' ||
      daysUntilExpiry === null ||
      dismissed ||
      (recentlyDismissed && !isUrgent)) {
    return null;
  }

  const hasExpired = daysUntilExpiry < 0;

  // Don't show if trial has more than 7 days left (unless urgent)
  if (daysUntilExpiry > 7 && !isUrgent) {
    return null;
  }

  const handleUpgrade = () => {
    router.push('/fiyatlandirma');
  };

  const handleDismiss = () => {
    setDismissed(true);
    // Store dismissal in localStorage to persist during session
    try {
      localStorage.setItem('trialNotificationDismissed', Date.now().toString());
    } catch {
      // ignore — dismissal still applies for this mount
    }
  };

  const getAlertSeverity = () => {
    if (hasExpired) return 'error';
    if (isUrgent) return 'warning';
    return 'info';
  };

  const getMessage = () => {
    if (hasExpired) {
      return t('expiredMessage');
    }
    if (daysUntilExpiry === 0) {
      return t('expiresToday');
    }
    if (daysUntilExpiry === 1) {
      return t('expiresTomorrow');
    }
    return t('expiresInDays', { days: daysUntilExpiry });
  };

  const getUsageWarning = () => {
    const positiveLimit = (v: unknown, fallback: number) =>
      typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
    const orderSyncLimit = positiveLimit(userSubscription.orderSyncLimit, TRIAL_LIMITS.orderSync);
    const labelLimit = positiveLimit(userSubscription.labelLimit, TRIAL_LIMITS.label);
    const orderSyncUsed = Number(userSubscription.orderSyncCount) || 0;
    const labelUsed = Number(userSubscription.labelCount) || 0;

    if (orderSyncUsed >= orderSyncLimit * NEAR_LIMIT_RATIO || labelUsed >= labelLimit * NEAR_LIMIT_RATIO) {
      return ` ${t('nearingLimit')}`;
    }
    return '';
  };

  // Rendered in normal flow at the top of the page content (AppLayout puts it
  // first inside <main>), so it pushes content down instead of covering it or
  // sitting above dialogs.
  return (
    <Box sx={{ mb: { xs: 1.5, sm: 2 } }}>
      <Alert
        severity={getAlertSeverity()}
        action={
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button
              size="small"
              variant="contained"
              color={hasExpired ? 'error' : 'primary'}
              startIcon={<UpgradeOutlined />}
              onClick={handleUpgrade}
              sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
            >
              {t('selectPlan')}
            </Button>
            {!hasExpired && (
              <IconButton
                size="small"
                onClick={handleDismiss}
                color="inherit"
                aria-label={t('dismiss')}
                sx={{ width: 44, height: 44 }}
              >
                <Close fontSize="small" />
              </IconButton>
            )}
          </Box>
        }
        icon={<Schedule />}
        sx={{
          flexWrap: { xs: 'wrap', sm: 'nowrap' },
          '& .MuiAlert-message': {
            flex: 1,
            minWidth: 0,
            alignSelf: 'center'
          },
          '& .MuiAlert-action': {
            ml: { xs: 0, sm: 'auto' },
            pl: { xs: 0, sm: 2 },
            width: { xs: '100%', sm: 'auto' },
            justifyContent: { xs: 'flex-end', sm: 'flex-start' },
          },
        }}
      >
        <AlertTitle>
          {hasExpired ? t('expired') : t('warning')}
        </AlertTitle>
        {getMessage()}{getUsageWarning()}
      </Alert>
    </Box>
  );
}
