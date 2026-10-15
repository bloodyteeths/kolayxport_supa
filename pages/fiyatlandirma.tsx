// /fiyatlandirma — public pricing page (components/domain/pricing/PricingPage.tsx, settings §17). No
// getServerSideProps: the page stays static/cacheable; Shopify gating happens on the client before any
// price is painted (settings §10.5).
import PricingPage from '@/components/domain/pricing/PricingPage';

export default function FiyatlandirmaRoute() {
  return <PricingPage />;
}
