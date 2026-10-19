/**
 * /app/ortaklik — referral partner dashboard (docs/gtm/referral-spec.md §4.2). Partners only: the API answers 404
 * for everyone else (and for Shopify-connected accounts) and the page sends them back to /app.
 */
import React from 'react';
import { useTranslations } from 'next-intl';
import { Page } from '@/components/ds/page';
import PartnerDashboard from '@/components/domain/partners/PartnerDashboard';

export default function OrtaklikPage() {
  const t = useTranslations('partners.dashboard');
  return (
    <Page title={t('title')} width="form" data-testid="partner-dashboard-page">
      <PartnerDashboard />
    </Page>
  );
}
