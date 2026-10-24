// /plan — plan choice + checkout for signed-in sellers (and the target of in-app "see plans" links via
// /fiyatlandirma). Same component the public pricing page used before the GTM rebuild. Not indexed.
// PRICING_V2 (server flag) decides v1 cards or the v2 packages; revalidated so a flip shows within 5 minutes.
import PricingPage from '@/components/domain/pricing/PricingPage';
import { pricingV2Enabled } from '@/lib/billing/pricingV2';

export default function PlanRoute({ v2 }: { v2?: boolean }) {
  return <PricingPage v2={Boolean(v2)} />;
}

export async function getStaticProps() {
  return { props: { v2: pricingV2Enabled() }, revalidate: 300 };
}
