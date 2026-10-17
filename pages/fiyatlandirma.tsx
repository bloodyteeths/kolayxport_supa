// /fiyatlandirma — public pricing page (components/domain/pricing/PricingPage.tsx, settings §17). No
// getServerSideProps: the page stays static/cacheable; Shopify gating happens on the client before any
// price is painted (settings §10.5).
import PricingPage from '@/components/domain/pricing/PricingPage';
import { pickMessages, SITE_NAMESPACES } from '@/lib/i18n/pageMessages';

export default function FiyatlandirmaRoute() {
  return <PricingPage />;
}

// Server-rendered in Turkish with only the namespaces this page uses; the full dictionary loads after
// hydration (pages/_app.tsx), e.g. for visitors whose UI language is English.
export async function getStaticProps() {
  return { props: { messages: pickMessages('tr', [...SITE_NAMESPACES, 'marketing.pricingV2', 'billing', 'auth']), messagesLocale: 'tr' } };
}
