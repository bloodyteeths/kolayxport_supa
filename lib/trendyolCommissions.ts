/**
 * Trendyol category commission rates (approximate).
 * Source: Trendyol seller panel commission structure.
 * Rates may change — this is for the profit calculator.
 */

export interface TrendyolCommissionRate {
  group: string;
  rate: number; // percentage
  description: string;
}

export const TRENDYOL_COMMISSION_RATES: Record<string, TrendyolCommissionRate> = {
  'Elektronik': { group: 'Elektronik', rate: 10, description: 'Elektronik & Aksesuar' },
  'Moda': { group: 'Moda', rate: 22, description: 'Giyim, Ayakkabı, Çanta' },
  'Ev & Yaşam': { group: 'Ev & Yaşam', rate: 18, description: 'Ev Dekorasyon, Mobilya' },
  'Mutfak': { group: 'Mutfak', rate: 17, description: 'Mutfak Gereçleri, Pişirme' },
  'Kozmetik': { group: 'Kozmetik', rate: 18, description: 'Kozmetik & Kişisel Bakım' },
  'Yiyecek': { group: 'Yiyecek', rate: 12, description: 'Gıda & İçecek' },
  'Takı & Aksesuar': { group: 'Takı & Aksesuar', rate: 20, description: 'Takı, Saat, Gözlük' },
  'Tekstil': { group: 'Tekstil', rate: 20, description: 'Ev Tekstili, Havlu, Nevresim' },
  'Hediyelik': { group: 'Hediyelik', rate: 18, description: 'Hediyelik Eşya, El Sanatları' },
  'Bebek': { group: 'Bebek', rate: 15, description: 'Bebek Ürünleri' },
  'Spor': { group: 'Spor', rate: 18, description: 'Spor & Outdoor' },
  'Kitap': { group: 'Kitap', rate: 15, description: 'Kitap & Kırtasiye' },
  'Diğer': { group: 'Diğer', rate: 18, description: 'Diğer Kategoriler' },
};

export const DEFAULT_COMMISSION_RATE = 18;

// Turkish VAT rates
export const VAT_RATES = [0, 1, 10, 20] as const;

export interface TrendyolProfitCalcInput {
  salePrice: number;        // TRY
  costPrice: number;        // TRY
  cargoCost?: number;       // TRY (shipping)
  packagingCost?: number;   // TRY
  commissionRate: number;   // percentage
  vatRate: number;          // percentage (0, 1, 10, 20)
}

export interface TrendyolProfitCalcResult {
  salePrice: number;
  costPrice: number;
  cargoCost: number;
  packagingCost: number;
  commissionAmount: number;
  commissionRate: number;
  vatAmount: number;
  totalCost: number;
  netProfit: number;
  marginPercent: number;
  roiPercent: number;
  breakEvenPrice: number;
}

export function calculateTrendyolProfit(input: TrendyolProfitCalcInput): TrendyolProfitCalcResult {
  const { salePrice, costPrice, commissionRate, vatRate } = input;
  const cargoCost = input.cargoCost || 0;
  const packagingCost = input.packagingCost || 0;

  const commissionAmount = (salePrice * commissionRate) / 100;
  const vatAmount = (salePrice * vatRate) / 100;
  const totalCost = costPrice + cargoCost + packagingCost + commissionAmount;
  const netProfit = salePrice - totalCost;
  const marginPercent = salePrice > 0 ? (netProfit / salePrice) * 100 : 0;
  const roiPercent = costPrice > 0 ? (netProfit / costPrice) * 100 : 0;

  // Break-even: what sale price covers all costs at given commission rate
  const fixedCosts = costPrice + cargoCost + packagingCost;
  const breakEvenPrice = fixedCosts / (1 - commissionRate / 100);

  return {
    salePrice,
    costPrice,
    cargoCost,
    packagingCost,
    commissionAmount: Math.round(commissionAmount * 100) / 100,
    commissionRate,
    vatAmount: Math.round(vatAmount * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
    marginPercent: Math.round(marginPercent * 10) / 10,
    roiPercent: Math.round(roiPercent * 10) / 10,
    breakEvenPrice: Math.round(breakEvenPrice * 100) / 100,
  };
}
