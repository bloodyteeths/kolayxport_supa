/**
 * eBay category-specific final value fee rates (US marketplace, 2024-2025).
 * Rates include per-order fee components baked in as percentage equivalents.
 * High-defect-rate sellers pay +5% surcharge on top.
 */

export interface CategoryFee {
  label: string;
  labelTr: string;
  rate: number; // percentage
  cap?: number; // max fee in USD
  ebayIds: string[]; // eBay category IDs that map to this fee
}

export const CATEGORY_FEES: CategoryFee[] = [
  { label: 'Most categories', labelTr: 'Genel Kategoriler', rate: 13.25, ebayIds: [] },
  { label: 'Books, DVDs & Movies', labelTr: 'Kitaplar, DVD & Film', rate: 14.95, ebayIds: ['267', '11232', '617'] },
  { label: 'Business & Industrial', labelTr: 'İş & Endüstriyel', rate: 4.0, ebayIds: ['12576', '58058'] },
  { label: 'Clothing, Shoes & Accessories', labelTr: 'Giyim & Aksesuar', rate: 13.25, ebayIds: ['11450', '15724', '93427'] },
  { label: 'Coins & Paper Money', labelTr: 'Madeni Para & Kağıt Para', rate: 6.35, ebayIds: ['11116', '3411'] },
  { label: 'Collectibles', labelTr: 'Koleksiyon', rate: 13.25, ebayIds: ['1', '73'] },
  { label: 'Computers & Tablets', labelTr: 'Bilgisayar & Tablet', rate: 8.0, ebayIds: ['58058', '175672', '171485'] },
  { label: 'Consumer Electronics', labelTr: 'Tüketici Elektroniği', rate: 8.0, ebayIds: ['293', '15052'] },
  { label: 'Cell Phones', labelTr: 'Cep Telefonları', rate: 8.0, ebayIds: ['15032', '9355'] },
  { label: 'Cameras & Photo', labelTr: 'Kamera & Fotoğraf', rate: 8.0, ebayIds: ['625', '31388'] },
  { label: 'Guitars & Basses', labelTr: 'Gitarlar & Baslar', rate: 3.5, ebayIds: ['33034', '38070'] },
  { label: 'Heavy Equipment', labelTr: 'Ağır Ekipman', rate: 2.0, cap: 300, ebayIds: ['177641', '25622'] },
  { label: 'Jewelry (≤$1000)', labelTr: 'Mücevher (≤$1000)', rate: 15.0, ebayIds: ['281'] },
  { label: 'Jewelry (>$1000)', labelTr: 'Mücevher (>$1000)', rate: 6.5, ebayIds: ['281'] },
  { label: 'Watches (≤$1000)', labelTr: 'Saat (≤$1000)', rate: 15.0, ebayIds: ['14324', '31387'] },
  { label: 'Watches (>$1000)', labelTr: 'Saat (>$1000)', rate: 6.5, ebayIds: ['14324', '31387'] },
  { label: 'Musical Instruments', labelTr: 'Müzik Aletleri', rate: 6.35, ebayIds: ['619', '16028'] },
  { label: 'Pet Supplies', labelTr: 'Evcil Hayvan', rate: 13.25, ebayIds: ['1281', '20754'] },
  { label: 'Sneakers (Auth Guarantee)', labelTr: 'Spor Ayakkabı (Auth)', rate: 8.0, ebayIds: ['15709', '93427'] },
  { label: 'Sporting Goods', labelTr: 'Spor Malzemeleri', rate: 13.25, ebayIds: ['382', '888'] },
  { label: 'Stamps', labelTr: 'Pullar', rate: 6.35, ebayIds: ['260'] },
  { label: 'Toys & Hobbies', labelTr: 'Oyuncak & Hobi', rate: 13.25, ebayIds: ['220', '2613'] },
  { label: 'Video Games', labelTr: 'Video Oyunları', rate: 13.25, ebayIds: ['1249', '139971'] },
  { label: 'Home & Garden', labelTr: 'Ev & Bahçe', rate: 13.25, ebayIds: ['11700', '159907'] },
  { label: 'Health & Beauty', labelTr: 'Sağlık & Güzellik', rate: 13.25, ebayIds: ['26395', '11838'] },
  { label: 'Art', labelTr: 'Sanat', rate: 13.25, ebayIds: ['550'] },
  { label: 'Crafts', labelTr: 'El Sanatları', rate: 13.25, ebayIds: ['14339', '160667'] },
  { label: 'Baby', labelTr: 'Bebek', rate: 13.25, ebayIds: ['2984', '19068'] },
  { label: 'Automotive Parts', labelTr: 'Otomotiv Parçaları', rate: 13.25, ebayIds: ['6000', '6028'] },
];

export const PAYMENT_PROCESSING_RATE = 0.0235; // 2.35%
export const PAYMENT_PROCESSING_FIXED = 0.30; // $0.30
export const INTERNATIONAL_FEE_RATE = 0.0165; // 1.65%
export const HIGH_DEFECT_SURCHARGE = 5.0; // +5% for below-standard sellers

/**
 * Look up the eBay fee rate for a given category ID.
 * Falls back to 13.25% (most categories) if not found.
 */
export function getFeeForCategory(categoryId: string, priceUsd?: number): CategoryFee {
  for (const cat of CATEGORY_FEES) {
    if (cat.ebayIds.includes(categoryId)) {
      // Handle tiered pricing for jewelry/watches
      if ((cat.label.includes('Jewelry') || cat.label.includes('Watches')) && priceUsd) {
        const isHighValue = priceUsd > 1000;
        if (cat.label.includes('>$1000') && isHighValue) return cat;
        if (cat.label.includes('≤$1000') && !isHighValue) return cat;
        continue;
      }
      return cat;
    }
  }
  return CATEGORY_FEES[0]; // default: 13.25%
}

/**
 * Calculate all eBay fees for a given sale price.
 */
export function calculateEbayFees(
  priceUsd: number,
  categoryId: string,
  options: {
    feeOverridePercent?: number;
    includeInternational?: boolean;
    highDefectRate?: boolean;
  } = {}
) {
  const categoryFee = getFeeForCategory(categoryId, priceUsd);
  let feeRate = options.feeOverridePercent ?? categoryFee.rate;
  if (options.highDefectRate) feeRate += HIGH_DEFECT_SURCHARGE;

  let finalValueFee = priceUsd * (feeRate / 100);
  if (categoryFee.cap && finalValueFee > categoryFee.cap) {
    finalValueFee = categoryFee.cap;
  }

  const paymentFee = priceUsd * PAYMENT_PROCESSING_RATE + PAYMENT_PROCESSING_FIXED;
  const internationalFee = options.includeInternational
    ? priceUsd * INTERNATIONAL_FEE_RATE
    : 0;

  return {
    feeRate,
    feeName: categoryFee.labelTr,
    finalValueFee,
    paymentFee,
    internationalFee,
    totalFees: finalValueFee + paymentFee + internationalFee,
  };
}
