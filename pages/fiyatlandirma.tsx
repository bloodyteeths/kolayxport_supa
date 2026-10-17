// /fiyatlandirma — public pricing (fast, server-rendered): components/site/SitePricing.tsx.
// Signed-in sellers are forwarded to /plan (the in-app checkout page, components/domain/pricing/PricingPage).
import SitePricing from '@/components/site/SitePricing';
import { siteMessageProps } from '@/lib/i18n/pageMessages';

export default function Page() {
  return <SitePricing locale="tr" />;
}

export async function getStaticProps() {
  return { props: siteMessageProps('tr', ['marketing.pricingV2']) };
}
