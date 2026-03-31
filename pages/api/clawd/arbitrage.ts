import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '../../../lib/logger';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { getApplicationToken } from '../../../lib/integrations/ebayClient';
import { fetchTrendyolCategoryProducts, getExchangeRate, TRENDYOL_CATEGORIES } from '../../../lib/integrations/trendyolSearch';
import { calculateArbitrage } from '../../../lib/arbitrage/calculator';
import type { ArbitrageResult, EbayComparable, ArbitrageScanResponse } from '../../../lib/arbitrage/types';

export const config = { runtime: 'nodejs' };

const EBAY_API_BASE = 'https://api.ebay.com';

async function callEbayAPI(endpoint: string, token: string, marketplaceId = 'EBAY_US') {
  const url = endpoint.startsWith('http') ? endpoint : `${EBAY_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`eBay API ${response.status}: ${text.substring(0, 200)}`);
  }
  return response.json();
}

async function getItemDetails(legacyItemId: string, appToken: string) {
  const item = await callEbayAPI(
    `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${legacyItemId}`,
    appToken
  );
  return {
    title: item.title || '',
    price: parseFloat(item.price?.value || '0'),
    currency: item.price?.currency || 'USD',
    itemId: item.itemId || '',
    soldQuantity: item.estimatedAvailabilities?.[0]?.estimatedSoldQuantity || 0,
    condition: item.condition || '',
    imageUrl: item.image?.imageUrl || '',
    categoryId: item.categoryId || '',
    categoryName: item.categoryPath || '',
  } as EbayComparable;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const envApiKey = process.env.CLAWD_API_KEY;
  let authenticated = false;

  if (envApiKey && apiKey === envApiKey) {
    authenticated = true;
  }

  if (!authenticated) {
    const supabase = getSupabaseServerClient(req, res);
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) authenticated = true;
  }

  if (!authenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action } = req.body;

  try {
    switch (action) {
      case 'scan': {
        const startTime = Date.now();
        const {
          categories = [],
          minProfitUsd = 5,
          minRoiPercent = 20,
          shippingCostUsd = 15,
          feeOverridePercent,
          includeInternationalFee = true,
          maxTrendyolResults = 30,
          highDefectRate = false,
        } = req.body;

        if (!categories.length) {
          return res.status(400).json({ error: 'At least one category is required' });
        }

        // Get exchange rate
        const exchangeRate = req.body.exchangeRate || await getExchangeRate();

        // Get eBay app token
        const appToken = await getApplicationToken();

        // Process each category: fetch Trendyol products, search eBay with English terms,
        // then calculate arbitrage for each Trendyol product against eBay market data.
        const results: ArbitrageResult[] = [];
        let totalScannedCount = 0;
        const perCategoryLimit = Math.ceil(maxTrendyolResults / categories.length);

        for (const slug of categories) {
          try {
            // Fetch Trendyol products for this category
            const { products: trendyolProducts } = await fetchTrendyolCategoryProducts(slug);
            const categoryProducts = trendyolProducts.slice(0, perCategoryLimit);
            if (categoryProducts.length === 0) continue;
            totalScannedCount += categoryProducts.length;

            // Find the English search term for this category
            const categoryDef = TRENDYOL_CATEGORIES.find(c => c.slug === slug);
            const ebaySearchQuery = categoryDef?.ebaySearch || categoryDef?.label || slug.split('-x-c')[0].replace(/-/g, ' ');

            // Search eBay once per category using English terms
            const searchParams = new URLSearchParams();
            searchParams.set('q', ebaySearchQuery);
            searchParams.set('sort', 'newlyListed');
            searchParams.set('limit', '30');

            let ebayItems: any[] = [];
            try {
              const searchResult = await callEbayAPI(
                `/buy/browse/v1/item_summary/search?${searchParams.toString()}`,
                appToken
              );
              ebayItems = searchResult.itemSummaries || [];
            } catch (err) {
              logger.warn(`eBay search failed for "${ebaySearchQuery}"`, { error: String(err) });
              continue;
            }

            if (ebayItems.length === 0) continue;

            // Enrich top eBay items with sold quantity
            const enrichLimit = Math.min(ebayItems.length, 12);
            const enriched: EbayComparable[] = [];

            for (let i = 0; i < enrichLimit; i++) {
              const item = ebayItems[i];
              const legacyId = item.legacyItemId;
              if (!legacyId) {
                enriched.push({
                  title: item.title || '',
                  price: parseFloat(item.price?.value || '0'),
                  currency: item.price?.currency || 'USD',
                  itemId: item.itemId || '',
                  soldQuantity: 0,
                  condition: item.condition || '',
                  imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || '',
                  categoryId: item.categories?.[0]?.categoryId || '',
                  categoryName: item.categories?.[0]?.categoryName || '',
                });
                continue;
              }
              try {
                const details = await getItemDetails(legacyId, appToken);
                enriched.push(details);
              } catch {
                enriched.push({
                  title: item.title || '',
                  price: parseFloat(item.price?.value || '0'),
                  currency: item.price?.currency || 'USD',
                  itemId: item.itemId || '',
                  soldQuantity: 0,
                  condition: item.condition || '',
                  imageUrl: item.image?.imageUrl || '',
                  categoryId: item.categories?.[0]?.categoryId || '',
                  categoryName: item.categories?.[0]?.categoryName || '',
                });
              }
            }

            const validEbayItems = enriched.filter(i => i.price > 0);
            if (validEbayItems.length === 0) continue;

            // Calculate arbitrage for each Trendyol product against the eBay market data
            for (const tp of categoryProducts) {
              try {
                const result = calculateArbitrage({
                  trendyol: tp,
                  ebayItems: validEbayItems,
                  exchangeRate,
                  shippingCostUsd,
                  feeOverridePercent,
                  includeInternationalFee,
                  highDefectRate,
                });

                if (result) {
                  results.push(result);
                }
              } catch (err) {
                logger.warn(`Arbitrage calc failed for Trendyol product ${tp.id}`, { error: String(err) });
              }
            }
          } catch (err) {
            logger.warn(`Category scan failed for "${slug}"`, { error: String(err) });
          }
        }

        // Sort by score descending
        const sorted = results.sort((a, b) => b.score - a.score);

        const profitable = sorted.filter(
          r => r.financials.profitUsd >= minProfitUsd && r.financials.roiPercent >= minRoiPercent
        );

        return res.json({
          results: sorted,
          exchangeRate,
          totalScanned: totalScannedCount,
          profitable: profitable.length,
          scanDurationMs: Date.now() - startTime,
        } as ArbitrageScanResponse);
      }

      case 'categories': {
        return res.json({ categories: TRENDYOL_CATEGORIES });
      }

      case 'exchange_rate': {
        const rate = await getExchangeRate();
        return res.json({ rate, source: 'open.er-api.com' });
      }

      case 'test_trendyol': {
        const slug = req.body.slug || 'havlu-x-c104073';
        try {
          // Raw fetch to debug HTML content
          const rawRes = await fetch(`https://www.trendyol.com/${slug}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
              'Accept': 'text/html',
            },
            redirect: 'follow',
          });
          const html = await rawRes.text();
          const hasProducts = html.includes('"products":[');
          const hasDiscountedPrice = html.includes('"discountedPrice"');
          const hasPriceInfos = html.includes('"priceInfos"');
          const idMatches = html.match(/"id":\d+/g) || [];
          // Extract first full product object
          const productsIdx = html.indexOf('"products":[');
          let firstProduct = '';
          if (productsIdx > -1) {
            const arrStart = productsIdx + '"products":['.length;
            let depth = 0;
            let i = arrStart;
            for (; i < html.length && i < arrStart + 5000; i++) {
              if (html[i] === '{') depth++;
              if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
            }
            firstProduct = html.substring(arrStart, i);
          }

          const result = await fetchTrendyolCategoryProducts(slug);
          return res.json({
            success: true,
            httpStatus: rawRes.status,
            htmlLength: html.length,
            hasProducts,
            hasDiscountedPrice,
            hasPriceInfos,
            idCount: idMatches.length,
            firstProduct: firstProduct.substring(0, 2000),
            parsedCount: result.products.length,
            products: result.products.slice(0, 2).map(p => ({
              id: p.id, name: p.name, brand: p.brand,
              priceTry: p.priceTry, imageUrl: p.imageUrl,
            })),
          });
        } catch (err: any) {
          return res.json({ success: false, error: err.message });
        }
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    logger.error('Arbitrage API error', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
