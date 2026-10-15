// Legacy body of components/settings/BillingPanel.tsx, moved unchanged (settings §17 Group D; only the
// SubscriptionDashboard import path changed). Rendered by the legacy settings page (flag `settings` off).
// Deleted with components/legacy/settings/SettingsLegacy.tsx one release after the flag flips.
import React from 'react';
// @ts-ignore
import axios from 'axios';
import { useRouter } from 'next/router';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import SubscriptionDashboard from '@/components/legacy/settings/SubscriptionDashboardLegacy';
import EmptyState from '@/components/ui/EmptyState';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import type { UserSettingsResponse } from '@/lib/hooks/useSettings';

export interface BillingPanelProps {
  subscriptionData: UserSettingsResponse['subscription'] | null;
  ready: boolean;
}

export default function BillingPanelLegacy({ subscriptionData, ready }: BillingPanelProps) {
  const t = useTranslations('settings');
  const router = useRouter();

  const handleUpgrade = () => router.push('/fiyatlandirma');
  const handleViewBillingHistory = () => router.push('/faturalar');
  const handleManageSubscription = async () => {
    try {
      const response = await axios.post('/api/stripe/create-portal-session');
      if (response.data.url) window.location.href = response.data.url;
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('subscriptionManageFailed'));
    }
  };

  if (!subscriptionData || !ready) {
    return <EmptyState icon={<CreditCardIcon sx={{ fontSize: 32 }} />} title={t('pageTitle')} />;
  }

  return (
    <SubscriptionDashboard
      // Type-only cast: useSettings (Group A, A7) widened the plan/status unions (pro, expired); the legacy
      // dashboard renders unknown values with its defaults, as before.
      subscriptionData={subscriptionData as React.ComponentProps<typeof SubscriptionDashboard>['subscriptionData']}
      onUpgrade={handleUpgrade}
      onManageSubscription={handleManageSubscription}
      onViewBillingHistory={handleViewBillingHistory}
    />
  );
}
