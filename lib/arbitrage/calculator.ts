import type { TrendyolProduct, EbayComparable, ArbitrageResult } from './types';
import { calculateEbayFees } from './categoryFees';

interface CalcInput {
  trendyol: TrendyolProduct;
  ebayItems: EbayComparable[];
  exchangeRate: number;
  shippingCostUsd: number;
  feeOverridePercent?: number;
  includeInternationalFee: boolean;
  highDefectRate?: boolean;
}

export function calculateArbitrage(input: CalcInput): ArbitrageResult | null {
  const { trendyol, ebayItems, exchangeRate, shippingCostUsd, feeOverridePercent, includeInternationalFee, highDefectRate } = input;

  if (ebayItems.length === 0) return null;

  const prices = ebayItems.map(i => i.price).sort((a, b) => a - b);
  const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;
  const medianPrice = prices[Math.floor(prices.length / 2)];
  const avgSold = ebayItems.reduce((s, i) => s + (i.soldQuantity || 0), 0) / ebayItems.length;

  // Use primary category from most common item
  const categoryCounts = new Map<string, number>();
  ebayItems.forEach(i => {
    if (i.categoryId) categoryCounts.set(i.categoryId, (categoryCounts.get(i.categoryId) || 0) + 1);
  });
  let topCategoryId = '';
  let topCategoryName = '';
  let topCount = 0;
  categoryCounts.forEach((count, id) => {
    if (count > topCount) { topCategoryId = id; topCount = count; }
  });
  const topItem = ebayItems.find(i => i.categoryId === topCategoryId);
  topCategoryName = topItem?.categoryName || '';

  // Suggest selling at median price (conservative)
  const suggestedPrice = medianPrice;
  const costTry = trendyol.priceTry;
  const costUsd = costTry * exchangeRate;

  const fees = calculateEbayFees(suggestedPrice, topCategoryId, {
    feeOverridePercent,
    includeInternational: includeInternationalFee,
    highDefectRate,
  });

  const totalCost = costUsd + shippingCostUsd + fees.totalFees;
  const profit = suggestedPrice - totalCost;
  const roi = costUsd > 0 ? (profit / costUsd) * 100 : 0;
  const margin = suggestedPrice > 0 ? (profit / suggestedPrice) * 100 : 0;

  // Opportunity score: profitability + demand signals
  const profitScore = Math.min(40, Math.max(0, profit * 4)); // up to 40 pts
  const roiScore = Math.min(30, Math.max(0, roi * 0.3)); // up to 30 pts
  const demandScore = Math.min(30, Math.max(0, avgSold * 3 + Math.min(ebayItems.length, 20))); // up to 30 pts
  const score = Math.round(Math.min(100, profitScore + roiScore + demandScore));

  const verdict: ArbitrageResult['verdict'] =
    score >= 70 ? 'excellent' :
    score >= 45 ? 'good' :
    score >= 25 ? 'marginal' : 'skip';

  return {
    trendyol,
    ebay: {
      avgPrice: Math.round(avgPrice * 100) / 100,
      medianPrice: Math.round(medianPrice * 100) / 100,
      minPrice: prices[0],
      maxPrice: prices[prices.length - 1],
      totalListings: ebayItems.length,
      avgSold: Math.round(avgSold * 10) / 10,
      topItems: ebayItems.slice(0, 5),
      categoryId: topCategoryId,
      categoryName: topCategoryName,
    },
    financials: {
      costTry,
      costUsd: Math.round(costUsd * 100) / 100,
      shippingUsd: shippingCostUsd,
      suggestedPriceUsd: Math.round(suggestedPrice * 100) / 100,
      ebayFeePercent: fees.feeRate,
      ebayFeeName: fees.feeName,
      ebayFeeUsd: Math.round(fees.finalValueFee * 100) / 100,
      paymentFeeUsd: Math.round(fees.paymentFee * 100) / 100,
      internationalFeeUsd: Math.round(fees.internationalFee * 100) / 100,
      totalCostUsd: Math.round(totalCost * 100) / 100,
      profitUsd: Math.round(profit * 100) / 100,
      roiPercent: Math.round(roi * 10) / 10,
      marginPercent: Math.round(margin * 10) / 10,
    },
    exchangeRate,
    score,
    verdict,
  };
}
