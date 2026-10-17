import { FeaturesPage } from '@/components/site/CompanyPages';
import { readInventory } from '@/lib/site/inventory';
import { siteMessageProps } from '@/lib/i18n/pageMessages';

export default function Page(props: any) {
  return <FeaturesPage {...props} />;
}

export async function getStaticProps() {
  // Public list = inventory rows that are live (production / beta / partial), minus internal areas.
  const HIDE = new Set(['Billing / plans', 'Onboarding & help', 'Account / settings']);
  const rows = readInventory().filter((r) => !HIDE.has(r.area) && ['production', 'beta', 'partial'].includes(r.level));
  return { props: { ...siteMessageProps('tr'), locale: 'tr', rows } };
}
