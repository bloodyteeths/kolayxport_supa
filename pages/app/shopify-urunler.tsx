// /app/shopify-urunler — Shopify listings. Flag `listings-shopify` (lib/ds/uiFlags.ts, DS §7.1.5, listings-grid §13–§14 G7): the shared
// listings grid (components/domain/listings/ListingsPage.tsx, configured by config/shopify.ts) or the legacy page,
// moved unchanged to components/legacy/listings/ShopifyListingsLegacy.tsx (deleted one release after the flag flips, G8).
import withAuth from '@/components/withAuth';
import ListingsPage from '@/components/domain/listings/ListingsPage';
import ShopifyListingsLegacy from '@/components/legacy/listings/ShopifyListingsLegacy';
import { useUiFlag } from '@/lib/ds/uiFlags';

function ShopifyListingsV2() {
  return <ListingsPage marketplace="shopify" />;
}

const ShopifyListingsV2WithAuth = withAuth(ShopifyListingsV2);

export default function ShopifyListingsRoute() {
  const v2 = useUiFlag('listings-shopify');
  // The legacy default export is already wrapped in withAuth (+ its own layout / RequireConnection).
  return v2 ? <ShopifyListingsV2WithAuth /> : <ShopifyListingsLegacy />;
}
