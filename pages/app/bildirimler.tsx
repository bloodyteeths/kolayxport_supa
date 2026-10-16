/**
 * /app/bildirimler — notification center (owner W5).
 * Tabs: Unread / All / Activity / Preferences (?tab=). See
 * components/notification-center/* and docs/integration/parts/W5-notifications.md.
 * The DS `<Page>` registers the title with the shell (mobile TopBar + `<title>`); the
 * DS PageHeader inside NotificationCenterPage hides its title row on mobile.
 */
import React from 'react';
import { useTranslations } from 'next-intl';
import { Page } from '@/components/ds/page';
import NotificationCenterPage from '@/components/notification-center/NotificationCenterPage';

export default function BildirimlerPage() {
  const t = useTranslations('notificationCenter');
  return (
    <Page title={t('page.title')} width="form" data-testid="notification-center-page">
      <NotificationCenterPage />
    </Page>
  );
}
