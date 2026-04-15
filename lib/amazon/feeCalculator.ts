/**
 * Amazon Fee Calculator
 *
 * Calculates referral fees, FBA fulfillment fees, storage fees,
 * and net profit estimates for Amazon products.
 *
 * Fee data is based on Amazon US (ATVPDKIKX0DER) 2026 fee schedules.
 * Other marketplaces use similar structures with different rates.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FulfillmentType = 'FBA' | 'FBM';

export interface FeeInput {
  /** Selling price in the marketplace currency */
  price: number;
  /** Amazon category name or ID */
  category: string;
  /** FBA or FBM (Fulfilled by Merchant) */
  fulfillment: FulfillmentType;
  /** Product weight in pounds (for FBA fee tiers) */
  weightLb?: number;
  /** Longest side in inches */
  lengthIn?: number;
  /** Middle side in inches */
  widthIn?: number;
  /** Shortest side in inches */
  heightIn?: number;
  /** Cost of goods (for profit calculation) */
  cogs?: number;
  /** Shipping cost to Amazon FBA warehouse or to customer (FBM) */
  shippingCost?: number;
}

export interface FeeBreakdown {
  /** Sale price */
  price: number;
  /** Referral fee (percentage-based, category-specific) */
  referralFee: number;
  /** Referral fee percentage used */
  referralFeePercent: number;
  /** FBA fulfillment fee (0 if FBM) */
  fbaFee: number;
  /** FBA size tier */
  fbaSizeTier: string;
  /** Monthly storage fee estimate (per unit, assumes 1 month) */
  storageFee: number;
  /** Variable closing fee (media categories only) */
  closingFee: number;
  /** Total Amazon fees */
  totalFees: number;
  /** Total fees as percentage of price */
  totalFeesPercent: number;
  /** Net after all Amazon fees */
  netAfterFees: number;
  /** Net profit after fees + COGS + shipping (if provided) */
  netProfit: number | null;
  /** Profit margin percentage (if COGS provided) */
  profitMargin: number | null;
  /** ROI percentage (if COGS provided) */
  roi: number | null;
}

// ---------------------------------------------------------------------------
// Referral fee rates by category (Amazon US 2026)
// ---------------------------------------------------------------------------

/**
 * Category → referral fee percentage.
 * Some categories have tiered rates; we use the most common tier.
 * Minimum referral fee is $0.30 for most categories.
 */
const REFERRAL_FEES: Record<string, number> = {
  // Standard 15% categories
  'Home & Kitchen':           0.15,
  'Sports & Outdoors':        0.15,
  'Toys & Games':             0.15,
  'Health & Household':       0.15,
  'Beauty & Personal Care':   0.15,
  'Pet Supplies':             0.15,
  'Office Products':          0.15,
  'Garden & Outdoor':         0.15,
  'Baby':                     0.15,
  'Arts, Crafts & Sewing':    0.15,
  'Industrial & Scientific':  0.15,
  'Patio, Lawn & Garden':     0.15,
  'Handmade':                 0.15,

  // Higher rates
  'Clothing, Shoes & Jewelry': 0.17,
  "Women's Fashion":           0.17,
  "Men's Fashion":             0.17,
  "Girls' Fashion":            0.17,
  "Boys' Fashion":             0.17,
  'Watches':                   0.16,
  'Jewelry':                   0.20,
  'Amazon Device Accessories': 0.45,

  // Lower rates
  'Electronics':              0.08,
  'Computers':                0.08,
  'Video Games':              0.15,
  'Cell Phones & Accessories': 0.08,
  'Automotive':               0.12,
  'Tools & Home Improvement': 0.15,
  'Appliances':               0.15,

  // Media (also have closing fees)
  'Books':                    0.15,
  'Music':                    0.15,
  'DVD':                      0.15,
  'Software':                 0.15,
  'Video Games (Media)':      0.15,

  // Grocery
  'Grocery & Gourmet Food':   0.08, // 8% for items ≤$15, 15% for >$15
  'Collectibles & Fine Art':  0.20,

  // Default
  _default:                   0.15,
};

/** Minimum referral fee per item (USD) */
const MIN_REFERRAL_FEE = 0.30;

/** Media categories that have a variable closing fee */
const MEDIA_CATEGORIES = new Set([
  'Books', 'Music', 'DVD', 'Software', 'Video Games (Media)',
]);

/** Variable closing fee for media categories (USD) */
const MEDIA_CLOSING_FEE = 1.80;

// ---------------------------------------------------------------------------
// FBA fee tiers (Amazon US 2026)
// ---------------------------------------------------------------------------

export type FbaSizeTier =
  | 'Small Standard'
  | 'Large Standard'
  | 'Small Oversize'
  | 'Medium Oversize'
  | 'Large Oversize'
  | 'Special Oversize';

interface FbaFeeRule {
  tier: FbaSizeTier;
  maxWeightLb: number;
  maxLengthIn: number;
  maxWidthIn: number;
  maxHeightIn: number;
  /** Base fee for lightest items in tier */
  baseFee: number;
  /** Additional fee per lb over base weight */
  perLbOver?: number;
  /** Weight threshold where per-lb kicks in */
  baseWeightLb?: number;
}

/**
 * Simplified FBA fee tiers. Actual Amazon fees are more granular;
 * this covers the most common product sizes.
 */
const FBA_TIERS: FbaFeeRule[] = [
  {
    tier: 'Small Standard',
    maxWeightLb: 0.75,
    maxLengthIn: 15,
    maxWidthIn: 12,
    maxHeightIn: 0.75,
    baseFee: 3.22,
  },
  {
    tier: 'Large Standard',
    maxWeightLb: 20,
    maxLengthIn: 18,
    maxWidthIn: 14,
    maxHeightIn: 8,
    baseFee: 4.75,
    perLbOver: 0.42,
    baseWeightLb: 1,
  },
  {
    tier: 'Small Oversize',
    maxWeightLb: 70,
    maxLengthIn: 60,
    maxWidthIn: 30,
    maxHeightIn: 30,
    baseFee: 9.73,
    perLbOver: 0.42,
    baseWeightLb: 2,
  },
  {
    tier: 'Medium Oversize',
    maxWeightLb: 150,
    maxLengthIn: 108,
    maxWidthIn: 60,
    maxHeightIn: 60,
    baseFee: 19.05,
    perLbOver: 0.42,
    baseWeightLb: 2,
  },
  {
    tier: 'Large Oversize',
    maxWeightLb: 150,
    maxLengthIn: 108,
    maxWidthIn: 108,
    maxHeightIn: 108,
    baseFee: 89.98,
    perLbOver: 0.83,
    baseWeightLb: 90,
  },
  {
    tier: 'Special Oversize',
    maxWeightLb: Infinity,
    maxLengthIn: Infinity,
    maxWidthIn: Infinity,
    maxHeightIn: Infinity,
    baseFee: 158.49,
    perLbOver: 0.83,
    baseWeightLb: 90,
  },
];

// ---------------------------------------------------------------------------
// Storage fees (monthly, per cubic foot — averaged to per-unit estimate)
// ---------------------------------------------------------------------------

/** Standard-size monthly storage fee per cubic foot (Jan–Sep) */
const STORAGE_STANDARD_LOW = 0.87;
/** Standard-size monthly storage fee per cubic foot (Oct–Dec peak) */
const STORAGE_STANDARD_HIGH = 2.40;
/** Oversize monthly storage fee per cubic foot (Jan–Sep) */
const STORAGE_OVERSIZE_LOW = 0.56;
/** Oversize monthly storage fee per cubic foot (Oct–Dec peak) */
const STORAGE_OVERSIZE_HIGH = 1.40;

// ---------------------------------------------------------------------------
// Core calculation
// ---------------------------------------------------------------------------

/**
 * Determine the FBA size tier for a product.
 */
export function getFbaSizeTier(
  weightLb: number,
  lengthIn: number,
  widthIn: number,
  heightIn: number,
): FbaSizeTier {
  // Sort dimensions: length ≥ width ≥ height
  const dims = [lengthIn, widthIn, heightIn].sort((a, b) => b - a);
  const [l, w, h] = dims;

  for (const tier of FBA_TIERS) {
    if (
      weightLb <= tier.maxWeightLb &&
      l <= tier.maxLengthIn &&
      w <= tier.maxWidthIn &&
      h <= tier.maxHeightIn
    ) {
      return tier.tier;
    }
  }

  return 'Special Oversize';
}

/**
 * Calculate FBA fulfillment fee for a product.
 */
export function calculateFbaFee(
  weightLb: number,
  lengthIn: number,
  widthIn: number,
  heightIn: number,
): { fee: number; sizeTier: FbaSizeTier } {
  const dims = [lengthIn, widthIn, heightIn].sort((a, b) => b - a);
  const [l, w, h] = dims;

  for (const tier of FBA_TIERS) {
    if (
      weightLb <= tier.maxWeightLb &&
      l <= tier.maxLengthIn &&
      w <= tier.maxWidthIn &&
      h <= tier.maxHeightIn
    ) {
      let fee = tier.baseFee;
      if (tier.perLbOver && tier.baseWeightLb && weightLb > tier.baseWeightLb) {
        fee += (weightLb - tier.baseWeightLb) * tier.perLbOver;
      }
      return { fee: Math.round(fee * 100) / 100, sizeTier: tier.tier };
    }
  }

  // Special Oversize fallback
  const special = FBA_TIERS[FBA_TIERS.length - 1];
  let fee = special.baseFee;
  if (special.perLbOver && special.baseWeightLb && weightLb > special.baseWeightLb) {
    fee += (weightLb - special.baseWeightLb) * special.perLbOver;
  }
  return { fee: Math.round(fee * 100) / 100, sizeTier: 'Special Oversize' };
}

/**
 * Calculate monthly storage fee estimate per unit.
 */
export function calculateStorageFee(
  lengthIn: number,
  widthIn: number,
  heightIn: number,
  isOversize: boolean,
  isPeakSeason: boolean = false,
): number {
  const cubicFeet = (lengthIn * widthIn * heightIn) / 1728; // 12^3 = 1728
  const rate = isOversize
    ? (isPeakSeason ? STORAGE_OVERSIZE_HIGH : STORAGE_OVERSIZE_LOW)
    : (isPeakSeason ? STORAGE_STANDARD_HIGH : STORAGE_STANDARD_LOW);

  return Math.round(cubicFeet * rate * 100) / 100;
}

/**
 * Look up the referral fee percentage for a category.
 */
export function getReferralFeePercent(category: string): number {
  // Exact match
  if (REFERRAL_FEES[category] != null) return REFERRAL_FEES[category];

  // Substring match (case-insensitive)
  const lower = category.toLowerCase();
  for (const [key, rate] of Object.entries(REFERRAL_FEES)) {
    if (key === '_default') continue;
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return rate;
    }
  }

  return REFERRAL_FEES._default;
}

/**
 * Calculate complete fee breakdown for an Amazon product.
 */
export function calculateFees(input: FeeInput): FeeBreakdown {
  const { price, category, fulfillment, cogs, shippingCost } = input;

  // Defaults for dimensions (assume typical small/medium product)
  const weightLb = input.weightLb ?? 1;
  const lengthIn = input.lengthIn ?? 10;
  const widthIn = input.widthIn ?? 7;
  const heightIn = input.heightIn ?? 3;

  // 1. Referral fee
  const referralFeePercent = getReferralFeePercent(category);
  const referralFee = Math.max(
    MIN_REFERRAL_FEE,
    Math.round(price * referralFeePercent * 100) / 100,
  );

  // 2. FBA fee
  let fbaFee = 0;
  let fbaSizeTier = 'N/A (FBM)';

  if (fulfillment === 'FBA') {
    const fbaResult = calculateFbaFee(weightLb, lengthIn, widthIn, heightIn);
    fbaFee = fbaResult.fee;
    fbaSizeTier = fbaResult.sizeTier;
  }

  // 3. Storage fee (per-unit monthly estimate)
  const isOversize = fbaSizeTier.includes('Oversize');
  const storageFee = fulfillment === 'FBA'
    ? calculateStorageFee(lengthIn, widthIn, heightIn, isOversize)
    : 0;

  // 4. Closing fee (media categories only)
  const closingFee = MEDIA_CATEGORIES.has(category) ? MEDIA_CLOSING_FEE : 0;

  // 5. Totals
  const totalFees = Math.round((referralFee + fbaFee + storageFee + closingFee) * 100) / 100;
  const totalFeesPercent = price > 0
    ? Math.round((totalFees / price) * 10000) / 100
    : 0;
  const netAfterFees = Math.round((price - totalFees) * 100) / 100;

  // 6. Profit (if COGS provided)
  let netProfit: number | null = null;
  let profitMargin: number | null = null;
  let roi: number | null = null;

  if (cogs != null) {
    const totalCost = cogs + (shippingCost ?? 0);
    netProfit = Math.round((netAfterFees - totalCost) * 100) / 100;
    profitMargin = price > 0
      ? Math.round((netProfit / price) * 10000) / 100
      : 0;
    roi = totalCost > 0
      ? Math.round((netProfit / totalCost) * 10000) / 100
      : 0;
  }

  return {
    price,
    referralFee,
    referralFeePercent: Math.round(referralFeePercent * 100),
    fbaFee,
    fbaSizeTier,
    storageFee,
    closingFee,
    totalFees,
    totalFeesPercent,
    netAfterFees,
    netProfit,
    profitMargin,
    roi,
  };
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Quick profit estimate with minimal inputs.
 * Assumes FBA, standard-size product.
 */
export function quickProfitEstimate(
  price: number,
  category: string,
  cogs: number,
  shippingCost: number = 0,
): {
  netProfit: number;
  profitMargin: number;
  totalFees: number;
  breakdown: FeeBreakdown;
} {
  const breakdown = calculateFees({
    price,
    category,
    fulfillment: 'FBA',
    cogs,
    shippingCost,
  });

  return {
    netProfit: breakdown.netProfit ?? 0,
    profitMargin: breakdown.profitMargin ?? 0,
    totalFees: breakdown.totalFees,
    breakdown,
  };
}

/**
 * Compare FBA vs FBM profitability.
 */
export function compareFbaVsFbm(
  price: number,
  category: string,
  cogs: number,
  fbmShippingCost: number,
  fbaShippingCost: number = 0,
  weightLb?: number,
  lengthIn?: number,
  widthIn?: number,
  heightIn?: number,
): { fba: FeeBreakdown; fbm: FeeBreakdown; recommendation: 'FBA' | 'FBM' } {
  const fba = calculateFees({
    price,
    category,
    fulfillment: 'FBA',
    cogs,
    shippingCost: fbaShippingCost,
    weightLb,
    lengthIn,
    widthIn,
    heightIn,
  });

  const fbm = calculateFees({
    price,
    category,
    fulfillment: 'FBM',
    cogs,
    shippingCost: fbmShippingCost,
    weightLb,
    lengthIn,
    widthIn,
    heightIn,
  });

  const fbaProfit = fba.netProfit ?? 0;
  const fbmProfit = fbm.netProfit ?? 0;

  return {
    fba,
    fbm,
    recommendation: fbaProfit >= fbmProfit ? 'FBA' : 'FBM',
  };
}
