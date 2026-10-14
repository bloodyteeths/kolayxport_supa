import React, { useState, useEffect } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Collapse,
  IconButton,
  Snackbar,
} from '@mui/material';
import {
  Close,
  UpgradeOutlined,
  Schedule,
} from '@mui/icons-material';
import { differenceInDays, format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { enUS } from 'date-fns/locale';
import { useRouter } from 'next/router';
import axios from 'axios';
import { useTranslations } from 'next-intl';
import useLocaleStore from '@/lib/stores/useLocaleStore';

interface TrialNotificationProps {
  userSubscription?: {
    subscriptionPlan: string | null;
    subscriptionStatus: string | null;
    billingProvider?: string | null;
    trialExpiresAt: string | null;
    orderSyncCount: number;
    labelCount: number;
  } | null;
}

export default function TrialNotification({ userSubscription }: TrialNotificationProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [showSnackbar, setShowSnackbar] = useState(false);
  const t = useTranslations('trial');
  const locale = useLocaleStore((s) => s.locale);
  const dateFnsLocale = locale === 'tr' ? tr : enUS;

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
    const orderSyncUsed = userSubscription.orderSyncCount;
    const labelUsed = userSubscription.labelCount;

    if (orderSyncUsed >= 40 || labelUsed >= 8) {
      return ` ${t('nearingLimit')}`;
    }
    return '';
  };

  return (
    <Box sx={{ position: 'fixed', top: 80, left: 0, right: 0, zIndex: 1300, px: 2 }}>
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
            >
              {t('selectPlan')}
            </Button>
            {!hasExpired && (
              <IconButton
                size="small"
                onClick={handleDismiss}
                color="inherit"
              >
                <Close fontSize="small" />
              </IconButton>
            )}
          </Box>
        }
        icon={<Schedule />}
        sx={{
          mb: 2,
          boxShadow: 3,
          '& .MuiAlert-message': {
            flex: 1,
            alignSelf: 'center'
          }
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
