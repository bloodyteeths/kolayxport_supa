/**
 * Trendyol public product search via the discovery API.
 * Uses the new sfint-search-service endpoint on apigw.trendyol.com.
 * Runs from EU Vercel region to avoid geo-blocking.
 */
import fetch from 'node-fetch';
import type { TrendyolProduct } from '../arbitrage/types';

// New internal search API (replaced the old public.trendyol.com)
const SEARCH_BASE = 'https://apigw.trendyol.com/discovery-sfint-search-service/v2/api/infinite-scroll/sr';

interface TrendyolSearchParams {
  query: string;
  page?: number;
  limit?: number;
  sort?: 'BEST_SELLER' | 'MOST_FAVOURITE' | 'MOST_RATED' | 'PRICE_BY_ASC' | 'PRICE_BY_DESC' | 'MOST_RECENT';
}

interface TrendyolSearchResult {
  products: TrendyolProduct[];
  totalCount: number;
}

export async function searchTrendyolProducts(params: TrendyolSearchParams): Promise<TrendyolSearchResult> {
  const { query, page = 1, limit = 24, sort = 'BEST_SELLER' } = params;

  const sortMap: Record<string, string> = {
    'BEST_SELLER': '2',
    'MOST_FAVOURITE': '3',
    'PRICE_BY_ASC': '4',
    'PRICE_BY_DESC': '5',
    'MOST_RECENT': '1',
    'MOST_RATED': '6',
  };

  const url = new URL(SEARCH_BASE);
  url.searchParams.set('q', query);
  url.searchParams.set('pi', String(page));
  url.searchParams.set('os', sortMap[sort] || '2');
  url.searchParams.set('culture', 'tr-TR');
  url.searchParams.set('userGenderId', '0');
  url.searchParams.set('pId', '0');
  url.searchParams.set('scoringAlgorithmId', '2');
  url.searchParams.set('categoryRelevancyEnabled', 'false');
  url.searchParams.set('isLegalRequirementConfirmed', 'false');
  url.searchParams.set('searchStrategyType', 'DEFAULT');
  url.searchParams.set('productStampType', 'TypeA');
  url.searchParams.set('storefrontId', '1');
  url.searchParams.set('language', 'tr');
  url.searchParams.set('channelId', '1');

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://www.trendyol.com/',
      'Origin': 'https://www.trendyol.com',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Trendyol search failed: ${res.status} ${text.substring(0, 100)}`);
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
    return data?.rates?.USD || 0.028;
  } catch {
    return 0.028;
  }
}
