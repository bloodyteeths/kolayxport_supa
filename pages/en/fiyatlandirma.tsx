import SitePricing from '@/components/site/SitePricing';
import { siteMessageProps } from '@/lib/i18n/pageMessages';

export default function Page() {
  return <SitePricing locale="en" />;
}

export async function getStaticProps() {
  return { props: siteMessageProps('en', ['marketing.pricingV2']) };
}
