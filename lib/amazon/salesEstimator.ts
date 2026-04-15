/**
 * Amazon BSR-to-Sales Estimation Engine
 *
 * Estimates monthly unit sales from Best Seller Rank using
 * category-specific logarithmic decay curves.
 *
 * Formula: monthlySales = categoryBase * (bsr ^ -exponent)
 *
 * Calibrated against publicly available data points:
 *   BSR 1     → 3,000–10,000 units/month (varies by category)
 *   BSR 100   → 300–1,000 units/month
 *   BSR 1,000 → 50–200 units/month
 *   BSR 10,000 → 10–30 units/month
 */

// ---------------------------------------------------------------------------
// Category curves
// ---------------------------------------------------------------------------

export interface CategoryCurve {
  /** Human-readable name */
  name: string;
  /** Base monthly sales at BSR 1 */
  base: number;
  /** Power-law decay exponent (higher = steeper drop-off) */
  exponent: number;
}

/**
 * Top Amazon categories with calibrated curves.
 * Keys are Amazon browse-node root IDs (US marketplace).
 * A fallback key '_default' is used for unknown categories.
 */
export const CATEGORY_CURVES: Record<string, CategoryCurve> = {
  // High-volume categories
  '283155':  { name: 'Books',                   base: 10000, exponent: 0.63 },
  '11091801': { name: 'Clothing, Shoes & Jewelry', base: 8000, exponent: 0.60 },
  '3760911': { name: 'Sports & Outdoors',        base: 6000, exponent: 0.58 },
  '468642':  { name: 'Toys & Games',             base: 7000, exponent: 0.60 },
  '1055398': { name: 'Home & Kitchen',            base: 8000, exponent: 0.60 },
  '228013':  { name: 'Tools & Home Improvement',  base: 5000, exponent: 0.57 },
  '16310091': { name: 'Grocery & Gourmet Food',   base: 6000, exponent: 0.58 },

  // Medium-volume categories
  '3760901': { name: 'Health & Household',        base: 6000, exponent: 0.58 },
  '172282':  { name: 'Electronics',               base: 5000, exponent: 0.57 },
  '541966':  { name: 'Pet Supplies',              base: 5000, exponent: 0.57 },
  '2619533011': { name: 'Beauty & Personal Care', base: 6000, exponent: 0.58 },
  '15684181': { name: 'Automotive',               base: 4000, exponent: 0.55 },
  '165793011': { name: 'Baby',                    base: 5000, exponent: 0.57 },
  '2972638011': { name: 'Arts, Crafts & Sewing',  base: 4000, exponent: 0.55 },
  '2335752011': { name: 'Cell Phones & Accessories', base: 4000, exponent: 0.55 },
  '1063498':  { name: 'Office Products',          base: 4000, exponent: 0.55 },
  '1064954':  { name: 'Garden & Outdoor',         base: 5000, exponent: 0.57 },

  // Lower-volume / niche categories
  '2617941011': { name: 'Appliances',             base: 3000, exponent: 0.53 },
  '11260432011': { name: 'Handmade',              base: 2000, exponent: 0.50 },
  '3375251':  { name: 'Industrial & Scientific',  base: 3000, exponent: 0.53 },
  '15690151': { name: 'Collectibles & Fine Art',  base: 2000, exponent: 0.50 },
  '229534':   { name: 'Software',                 base: 2000, exponent: 0.50 },
  '11091801011': { name: 'Women\'s Fashion',      base: 7000, exponent: 0.60 },
  '7141123011': { name: 'Men\'s Fashion',         base: 5000, exponent: 0.57 },
  '7147440011': { name: 'Girls\' Fashion',        base: 3000, exponent: 0.53 },
  '7147441011': { name: 'Boys\' Fashion',         base: 3000, exponent: 0.53 },
  '154606011': { name: 'Video Games',             base: 4000, exponent: 0.55 },
  '2625373011': { name: 'Patio, Lawn & Garden',   base: 4000, exponent: 0.55 },

  // Fallback
  _default: { name: 'General', base: 5000, exponent: 0.57 },
};

// ---------------------------------------------------------------------------
// Confidence levels
// ---------------------------------------------------------------------------

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface SalesEstimate {
  /** Estimated monthly unit sales */
  monthlySales: number;
  /** Estimated monthly revenue (monthlySales × price) */
  monthlyRevenue: number | null;
  /** Confidence in the estimate */
  confidence: ConfidenceLevel;
  /** Category name used for the estimate */
  categoryName: string;
  /** The BSR that was used */
  bsr: number;
}

// ---------------------------------------------------------------------------
// Core estimation
// ---------------------------------------------------------------------------

/**
 * Estimate monthly sales from Best Seller Rank.
 *
 * @param bsr - The product's Best Seller Rank (must be ≥ 1)
 * @param categoryId - Amazon browse-node root ID (falls back to _default)
 * @param price - Optional product price for revenue estimation
 */
export function estimateMonthlySales(
  bsr: number,
  categoryId?: string,
  price?: number,
): SalesEstimate {
  if (!bsr || bsr < 1) {
    return {
      monthlySales: 0,
      monthlyRevenue: null,
      confidence: 'low',
      categoryName: 'Unknown',
      bsr: 0,
    };
  }

  const curve = (categoryId && CATEGORY_CURVES[categoryId]) || CATEGORY_CURVES._default;
  const raw = curve.base * Math.pow(bsr, -curve.exponent);

  // Clamp to reasonable range
  const monthlySales = Math.max(1, Math.round(raw));

  const confidence: ConfidenceLevel =
    bsr <= 5000 ? 'high' : bsr <= 50000 ? 'medium' : 'low';

  return {
    monthlySales,
    monthlyRevenue: price != null ? Math.round(monthlySales * price * 100) / 100 : null,
    confidence,
    categoryName: curve.name,
    bsr,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the category curve for a given category ID or name.
 * Tries exact ID match first, then name substring match.
 */
export function findCategoryCurve(categoryIdOrName: string): CategoryCurve {
  // Exact ID match
  if (CATEGORY_CURVES[categoryIdOrName]) {
    return CATEGORY_CURVES[categoryIdOrName];
  }

  // Name substring match (case-insensitive)
  const lower = categoryIdOrName.toLowerCase();
  for (const curve of Object.values(CATEGORY_CURVES)) {
    if (curve.name.toLowerCase().includes(lower)) {
      return curve;
    }
  }

  return CATEGORY_CURVES._default;
}

/**
 * Estimate daily sales from monthly estimate.
 */
export function estimateDailySales(bsr: number, categoryId?: string): number {
  const { monthlySales } = estimateMonthlySales(bsr, categoryId);
  return Math.max(1, Math.round(monthlySales / 30));
}

/**
 * Given a target monthly sales number, estimate the BSR needed.
 * Inverse of the estimation formula: bsr = (monthlySales / base) ^ (-1/exponent)
 */
export function estimateBsrForSales(
  targetMonthlySales: number,
  categoryId?: string,
): number {
  const curve = (categoryId && CATEGORY_CURVES[categoryId]) || CATEGORY_CURVES._default;
  const bsr = Math.pow(targetMonthlySales / curve.base, -1 / curve.exponent);
  return Math.max(1, Math.round(bsr));
}

/**
 * Competition score based on review counts.
 * Lower reviews = easier to compete.
 */
export function competitionScore(avgReviews: number): {
  score: number;
  label: string;
} {
  if (avgReviews < 50) return { score: 90, label: 'Very Low Competition' };
  if (avgReviews < 200) return { score: 70, label: 'Low Competition' };
  if (avgReviews < 500) return { score: 50, label: 'Moderate Competition' };
  if (avgReviews < 1500) return { score: 30, label: 'High Competition' };
  return { score: 10, label: 'Very High Competition' };
}

/**
 * Demand score based on BSR distribution of top results.
 */
export function demandScore(avgBsr: number, totalResults: number): {
  score: number;
  label: string;
} {
  // Lower average BSR = higher demand
  let bsrScore = 0;
  if (avgBsr < 5000) bsrScore = 90;
  else if (avgBsr < 20000) bsrScore = 70;
  else if (avgBsr < 50000) bsrScore = 50;
  else if (avgBsr < 100000) bsrScore = 30;
  else bsrScore = 15;

  // More results = more supply, but also indicates demand
  const volumeBonus = Math.min(10, Math.floor(totalResults / 1000));
  const score = Math.min(100, bsrScore + volumeBonus);

  let label: string;
  if (score >= 80) label = 'Very High Demand';
  else if (score >= 60) label = 'High Demand';
  else if (score >= 40) label = 'Moderate Demand';
  else if (score >= 20) label = 'Low Demand';
  else label = 'Very Low Demand';

  return { score, label };
}

/**
 * Opportunity score combining demand and competition.
 * Higher is better (high demand + low competition).
 */
export function opportunityScore(
  avgBsr: number,
  avgReviews: number,
  totalResults: number,
): {
  score: number;
  label: string;
  demand: ReturnType<typeof demandScore>;
  competition: ReturnType<typeof competitionScore>;
} {
  const demand = demandScore(avgBsr, totalResults);
  const competition = competitionScore(avgReviews);

  // Weighted: 50% demand, 50% competition (inverted: high competition = low score, but competitionScore already accounts for this)
  const score = Math.round(demand.score * 0.5 + competition.score * 0.5);

  let label: string;
  if (score >= 75) label = 'Excellent Opportunity';
  else if (score >= 55) label = 'Good Opportunity';
  else if (score >= 35) label = 'Fair Opportunity';
  else label = 'Difficult Market';

  return { score, label, demand, competition };
}
