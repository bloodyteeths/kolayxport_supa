// /app/wix-urunler — Wix listings. Flag `listings-wix` (lib/ds/uiFlags.ts, DS §7.1.5, listings-grid §13–§14 G7): the shared
// listings grid (components/domain/listings/ListingsPage.tsx, configured by config/wix.ts) or the legacy page,
// moved unchanged to components/legacy/listings/WixListingsLegacy.tsx (deleted one release after the flag flips, G8).
import withAuth from '@/components/withAuth';
import ListingsPage from '@/components/domain/listings/ListingsPage';
import WixListingsLegacy from '@/components/legacy/listings/WixListingsLegacy';
import { useUiFlag } from '@/lib/ds/uiFlags';

function WixListingsV2() {
  return <ListingsPage marketplace="wix" />;
}

const WixListingsV2WithAuth = withAuth(WixListingsV2);

export default function WixListingsRoute() {
  const v2 = useUiFlag('listings-wix');
  // The legacy default export is already wrapped in withAuth (+ its own layout / RequireConnection).
  return v2 ? <WixListingsV2WithAuth /> : <WixListingsLegacy />;
}
