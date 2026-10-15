// /app/trendyol-urunler — Trendyol listings. Flag `listings-trendyol` (lib/ds/uiFlags.ts, DS §7.1.5, listings-grid §13–§14 G7): the shared
// listings grid (components/domain/listings/ListingsPage.tsx, configured by config/trendyol.ts) or the legacy page,
// moved unchanged to components/legacy/listings/TrendyolListingsLegacy.tsx (deleted one release after the flag flips, G8).
import withAuth from '@/components/withAuth';
import ListingsPage from '@/components/domain/listings/ListingsPage';
import TrendyolListingsLegacy from '@/components/legacy/listings/TrendyolListingsLegacy';
import { useUiFlag } from '@/lib/ds/uiFlags';

function TrendyolListingsV2() {
  return <ListingsPage marketplace="trendyol" />;
}

const TrendyolListingsV2WithAuth = withAuth(TrendyolListingsV2);

export default function TrendyolListingsRoute() {
  const v2 = useUiFlag('listings-trendyol');
  // The legacy default export is already wrapped in withAuth (+ its own layout / RequireConnection).
  return v2 ? <TrendyolListingsV2WithAuth /> : <TrendyolListingsLegacy />;
}
