// /fiyatlandirma — public pricing, v2 (yearly packages first, docs/gtm/pricing-v2.md): components/site/SitePricingYearly.tsx.
// Signed-in sellers are forwarded to /plan (the in-app checkout page). While PRICING_V2_DRAFT is true the page carries a draft
// banner and noindex; the English page (/en/pricing) keeps the current USD monthly pricing until international pricing is decided.
import SitePricingYearly from '@/components/site/SitePricingYearly';
import { siteMessageProps } from '@/lib/i18n/pageMessages';

export default function Page() {
  return <SitePricingYearly locale="tr" />;
}

export async function getStaticProps() {
  return { props: siteMessageProps('tr', ['marketing.pricingYearly']) };
}
