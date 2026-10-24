// /fiyatlandirma — public pricing (fast, server-rendered): components/site/SitePricing.tsx.
// Signed-in sellers are forwarded to /plan (the in-app checkout page, components/domain/pricing/PricingPage).
import SitePricing from '@/components/site/SitePricing';
import { siteMessageProps } from '@/lib/i18n/pageMessages';
import { pricingV2Enabled } from '@/lib/billing/pricingV2';

export default function Page({ v2 }: { v2: boolean }) {
  return <SitePricing locale="tr" v2={v2} />;
}

export async function getStaticProps() {
  // PRICING_V2 is a server flag: the page is rebuilt on every deploy, and revalidated so a flip shows within 5 min.
  return { props: { ...siteMessageProps('tr', ['marketing.pricingV2']), v2: pricingV2Enabled() }, revalidate: 300 };
}
