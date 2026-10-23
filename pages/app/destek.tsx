// /app/destek — support tickets (components/support/SupportCenter.tsx).
import React from 'react';
import { useTranslations } from 'next-intl';
import { Page, PageHeader } from '@/components/ds/page';
import SupportCenter from '@/components/support/SupportCenter';

export default function DestekPage() {
  const t = useTranslations('support.tickets');
  return (
    <Page title={t('title')} width="form" data-testid="support-page">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <SupportCenter />
    </Page>
  );
}
