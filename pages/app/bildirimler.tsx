/**
 * /app/bildirimler — notification center (owner W5).
 * Tabs: Unread / All / Activity / Preferences (?tab=). See
 * components/notification-center/* and docs/integration/parts/W5-notifications.md.
 */
import React from 'react';
import { useTranslations } from 'next-intl';
import AppLayout from '@/components/AppLayout';
import NotificationCenterPage from '@/components/notification-center/NotificationCenterPage';

export default function BildirimlerPage() {
  const t = useTranslations('notificationCenter');
  return (
    <AppLayout title={t('page.title')}>
      <NotificationCenterPage />
    </AppLayout>
  );
}
