// /plan — plan choice + checkout for signed-in sellers (and the target of in-app "see plans" links via
// /fiyatlandirma). Same component the public pricing page used before the GTM rebuild. Not indexed.
import PricingPage from '@/components/domain/pricing/PricingPage';

export default function PlanRoute() {
  return <PricingPage />;
}
