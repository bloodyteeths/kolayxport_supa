// /app/research/products — Product finder (research.md §5), incl. Price gap (`?source=trendyol`, §9).
import withAuth from '@/components/withAuth';
import { ProductFinder } from '@/components/domain/research/products/ProductFinder';

export default withAuth(ProductFinder);
