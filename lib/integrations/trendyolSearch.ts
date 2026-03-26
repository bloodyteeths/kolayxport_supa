/**
 * Trendyol public product search using the discovery API.
 * No authentication needed — uses the same API that powers trendyol.com search.
 */
import fetch from 'node-fetch';
import type { TrendyolProduct } from '../arbitrage/types';

const DISCOVERY_BASE = 'https://public.trendyol.com/discovery-web-searchgw-service/v2/api/infinite-scroll/sr';

interface TrendyolSearchParams {
  query: string;
  page?: number;
  limit?: number;
  sort?: 'MOST_FAVOURITE' | 'BEST_SELLER' | 'MOST_RATED' | 'PRICE_BY_ASC' | 'PRICE_BY_DESC' | 'MOST_RECENT';
}

interface TrendyolSearchResult {
  products: TrendyolProduct[];
  totalCount: number;
}

export async function searchTrendyolProducts(params: TrendyolSearchParams): Promise<TrendyolSearchResult> {
  const { query, page = 1, limit = 24, sort = 'BEST_SELLER' } = params;

  const url = new URL(DISCOVERY_BASE);
  url.searchParams.set('q', query);
  url.searchParams.set('pi', String(page));
  url.searchParams.set('ps', String(limit)); // Not guaranteed to be respected
  url.searchParams.set('os', sort === 'BEST_SELLER' ? '2' : sort === 'MOST_FAVOURITE' ? '3' : sort === 'PRICE_BY_ASC' ? '4' : sort === 'PRICE_BY_DESC' ? '5' : '1');
  url.searchParams.set('culture', 'tr-TR');
  url.searchParams.set('userGenderId', '0');
  url.searchParams.set('pId', '0');
  url.searchParams.set('scoringAlgorithmId', '2');
  url.searchParams.set('categoryRelevancyEnabled', 'false');
  url.searchParams.set('isLegalRequirementConfirmed', 'false');
  url.searchParams.set('searchStrategyType', 'DEFAULT');
  url.searchParams.set('productStampType', 'TypeA');

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'tr-TR,tr;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(`Trendyol search failed: ${res.status}`);
  }

  const data: any = await res.json();
  const raw = data?.result?.products || [];

  const products: TrendyolProduct[] = raw.map((p: any) => ({
    id: p.id,
    name: p.name || '',
    brand: p.brand?.name || '',
    priceTry: p.price?.sellingPrice || p.price?.originalPrice || 0,
    originalPriceTry: p.price?.originalPrice || p.price?.sellingPrice || 0,
    imageUrl: p.images?.[0] ? `https://cdn.dsmcdn.com/${p.images[0]}` : '',
    url: `https://www.trendyol.com${p.url || ''}`,
    categoryName: p.categoryName || '',
    ratingScore: p.ratingScore?.averageRating || 0,
    ratingCount: p.ratingScore?.totalCount || 0,
    merchantName: p.merchantName || '',
    freeShipping: p.freeCargo || false,
  }));

  return {
    products,
    totalCount: data?.result?.totalCount || products.length,
  };
}

/**
 * Fetch current TRY→USD exchange rate from a public API.
 */
export async function getExchangeRate(): Promise<number> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/TRY', {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Exchange rate API: ${res.status}`);
    const data: any = await res.json();
    return data?.rates?.USD || 0.028; // fallback ~1 TRY = 0.028 USD
  } catch {
    return 0.028;
  }
}
