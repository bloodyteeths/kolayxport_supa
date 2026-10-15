// components/domain/messages/ProductContextCard.tsx — messages §2.2 rail, §4 "Rail: Product (Trendyol)",
// §5.1 rail row (group G6). Q&A payload `productInfo` plus `GET ?action=productContext&productMainId=`
// (local `TrendyolProduct` only, no Trendyol call). Price/stock/barcode and "Open listing" only when the
// product is in KolayXport; otherwise one caption, and the Q&A fields still show.
import Box from '@mui/material/Box';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { KeyValueList, type KeyValueItem } from '@/components/ds/data/KeyValueList';
import { Thumb } from '@/components/ds/data/Thumb';
import { Money } from '@/components/ds/format/Money';
import { Num } from '@/components/ds/format/Num';
import { Button } from '@/components/ds/inputs/Button';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { Bone } from '@/components/ds/state/Skeletons';
import { icons } from '@/lib/ds/icons';
import { neutral as n, type as typeScale } from '@/lib/ds/tokens';
import { listingHref as navListingHref, useNavLinks, type LinkFlags } from '@/lib/nav/links';
import type { ProductContext, UnifiedConversation } from '@/types/messages';
import { jsonFetcher, MESSAGES_API } from './useThread';

export function productContextUrl(productMainId: string): string {
  return `${MESSAGES_API}?action=productContext&productMainId=${encodeURIComponent(productMainId)}`;
}

/** "Open listing" target, flag-aware (lib/nav/links.ts): Trendyol grid, `?open=<barcode>` on v2. */
export function listingHref(barcode: string, flags?: LinkFlags): string {
  return navListingHref('trendyol', barcode, flags);
}

export interface UseProductContextResult {
  product: ProductContext | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

export function useProductContext(productMainId: string | null | undefined): UseProductContextResult {
  const { data, error, mutate } = useSWR<ProductContext>(productMainId ? productContextUrl(productMainId) : null, jsonFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 60_000,
  });
  return {
    product: data ?? null,
    loading: !!productMainId && !data && !error,
    error: !!error && !data,
    retry: () => void mutate(),
  };
}

export interface ProductContextCardProps {
  productInfo: NonNullable<UnifiedConversation['productInfo']>;
}

export function ProductContextCard({ productInfo }: ProductContextCardProps) {
  const t = useTranslations('messages.context');
  const tThread = useTranslations('messages.thread');
  const { flags } = useNavLinks();
  const { product, loading, error, retry } = useProductContext(productInfo.id);
  const [capSize, capLine] = typeScale.caption;
  const [titleSize, titleLine, titleWeight] = typeScale.titleSm;
  const title = product?.title || productInfo.title;
  const image = product?.thumbnailUrl || productInfo.imageUrl || null;

  const facts: KeyValueItem[] = [];
  if (product?.inCatalog) {
    facts.push({ label: t('price'), value: <Money amount={product.salePrice ?? null} currency={product.currency ?? 'TRY'} /> });
    facts.push({ label: t('stock'), value: <Num value={product.quantity ?? null} /> });
    if (product.barcode) facts.push({ label: t('barcode'), value: product.barcode, copy: product.barcode, mono: true });
  }

  return (
    <Box data-testid="product-context" sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Box sx={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <Thumb src={image} alt={title} size={64} />
        <Box sx={{ minWidth: 0, fontSize: titleSize, lineHeight: `${titleLine}px`, fontWeight: titleWeight, color: n[900], overflowWrap: 'anywhere' }}>
          {title}
        </Box>
      </Box>

      {loading && (
        <Box data-testid="product-context-loading" sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Bone w="70%" h={12} />
          <Bone w="50%" h={12} />
        </Box>
      )}
      {error && <ErrorState variant="inline" title={t('productError')} onRetry={retry} data-testid="product-context-error" />}
      {product && !product.inCatalog && (
        <Box data-testid="product-not-in-catalog" sx={{ fontSize: capSize, lineHeight: `${capLine}px`, color: n[500] }}>
          {t('notInCatalog')}
        </Box>
      )}
      {facts.length > 0 && <KeyValueList items={facts} />}

      {(product?.inCatalog && product.barcode) || productInfo.webUrl ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          {product?.inCatalog && product.barcode && (
            <Button variant="secondary" size="sm" href={listingHref(product.barcode, flags)} data-testid="open-listing">
              {t('openListing')}
            </Button>
          )}
          {productInfo.webUrl && (
            <Button variant="ghost" size="sm" icon={icons.externalLink} href={productInfo.webUrl} external data-testid="view-on-trendyol">
              {tThread('viewOnTrendyol')}
            </Button>
          )}
        </Box>
      ) : null}
    </Box>
  );
}

export default ProductContextCard;
