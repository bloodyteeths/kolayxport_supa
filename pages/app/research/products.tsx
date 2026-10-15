// /app/research/products — Product finder (research.md §5). Flag `research` (lib/ds/uiFlags.ts): the hub tool, or
// the legacy research page for the requested marketplace while the flag is off (ResearchRouteGate).
import { useRouter } from 'next/router';
import withAuth from '@/components/withAuth';
import { ResearchRouteGate } from '@/components/domain/research/ResearchLayout';
import { ProductFinder } from '@/components/domain/research/products/ProductFinder';

const ProductFinderWithAuth = withAuth(ProductFinder);

export default function ProductFinderRoute() {
  const router = useRouter();
  return (
    <ResearchRouteGate mkt={router.query.mkt}>
      <ProductFinderWithAuth />
    </ResearchRouteGate>
  );
}
