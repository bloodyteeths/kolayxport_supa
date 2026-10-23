import { TrendyolProfitPage } from '@/components/site/tools/ToolPages';
import { siteMessageProps } from '@/lib/i18n/pageMessages';

export default function Page({ usdTry }: { usdTry: number | null }) {
  return <TrendyolProfitPage locale="en" usdTry={usdTry} />;
}

// The USD/TRY rate for the Etsy side-by-side, refreshed every 6 hours (null hides the comparison).
export async function getStaticProps() {
  // Lazy import: lib/finance/fx touches the database, which a build without DATABASE_URL doesn't have.
  let rate: number | null = null;
  try {
    const { convertCurrency } = await import('@/lib/finance/fx');
    rate = await convertCurrency(1, 'USD', 'TRY');
  } catch {
    rate = null;
  }
  return { props: { ...siteMessageProps('en'), usdTry: rate && rate > 1 ? Math.round(rate * 100) / 100 : null }, revalidate: 21600 };
}
