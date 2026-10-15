// /app/trendyol-arastirma — old research route: a permanent server redirect into the Research hub (lib/research/legacyRoutes.ts).
// The URL stays because the Chrome extension, emails and bookmarks link into it.
import { legacyResearchRedirect } from '@/lib/research/legacyRoutes';

export const getServerSideProps = legacyResearchRedirect('trendyol');

export default function TrendyolResearchRedirect() {
  return null;
}
