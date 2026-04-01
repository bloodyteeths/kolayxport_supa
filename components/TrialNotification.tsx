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

  if (!userSubscription ||
      userSubscription.subscriptionStatus !== 'trialing' ||
      !userSubscription.trialExpiresAt ||
      dismissed) {
    return null;
  }

  const daysUntilExpiry = differenceInDays(new Date(userSubscription.trialExpiresAt), new Date());
  const isUrgent = daysUntilExpiry <= 3;
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
    localStorage.setItem('trialNotificationDismissed', Date.now().toString());
  };

  // Check if notification was dismissed recently (within last 24 hours)
  useEffect(() => {
    const lastDismissed = localStorage.getItem('trialNotificationDismissed');
    if (lastDismissed) {
      const dismissedTime = parseInt(lastDismissed);
      const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
      if (dismissedTime > twentyFourHoursAgo && !isUrgent) {
        setDismissed(true);
      }
    }
  }, [isUrgent]);

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
