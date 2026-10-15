// /fiyatlandirma — public pricing page. Flag `pricing` (lib/ds/uiFlags.ts, DS §7.1.5, settings §17): the new
// page (components/domain/pricing/PricingPage.tsx) or the legacy page, moved unchanged to
// components/legacy/pricing/PricingLegacy.js (deleted one release after the flag flips). No
// getServerSideProps: the page stays static/cacheable; Shopify gating happens on the client before any
// price is painted (settings §10.5).
import PricingPage from '@/components/domain/pricing/PricingPage';
import PricingLegacy from '@/components/legacy/pricing/PricingLegacy';
import { useUiFlag } from '@/lib/ds/uiFlags';

export default function FiyatlandirmaRoute() {
  const v2 = useUiFlag('pricing');
  return v2 ? <PricingPage /> : <PricingLegacy />;
}
