// /app/research/shops — Shop tracker (research.md §8, R3-B). ShopTracker renders ResearchLayout itself, so the header
// primary "Watch a shop" can follow the quota.
import withAuth from '@/components/withAuth';
import { ShopTracker } from '@/components/domain/research/shops/ShopTracker';

function ShopTrackerPage() {
  return <ShopTracker />;
}

export default withAuth(ShopTrackerPage);
