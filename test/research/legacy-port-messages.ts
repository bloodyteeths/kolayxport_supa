// research legacy port (Price gap refresh, eBay item watches): the i18n keys this change uses, returned to the
// integrator as newI18nKeys (messages/*.json are not edited here). Tests merge these over messages/<locale>.json.
export const PORT_EN = {
  research: {
    gap: {
      refreshIndex: 'Refresh prices',
      indexUpdated: 'Prices updated {date}',
      refreshFailed: "Couldn't refresh the prices. Try again later",
    },
    shops: {
      watchEbayItem: 'eBay item · {item}',
      ebayItemPrompt: 'Paste an eBay seller link or name, or an eBay item link to follow its price and sales',
      itemSold: '{value} sold (all time)',
      itemSalesNote: "Measured from eBay's sold counter for this item · gaps are days without a usable reading",
      itemPriceChart: 'Price, 30 days',
      itemPriceNote: "The item's listed price at each daily reading",
      itemPriceNotYet: 'The price line appears after a few daily readings.',
      itemChartAria: 'Price of {item}, last 30 days',
      error: { itemNotFound: "Couldn't find this eBay item. It may have ended" },
    },
  },
} as const;

export const PORT_TR = {
  research: {
    gap: {
      refreshIndex: 'Fiyatları yenile',
      indexUpdated: 'Fiyatlar güncellendi: {date}',
      refreshFailed: 'Fiyatlar yenilenemedi. Daha sonra tekrar deneyin',
    },
    shops: {
      watchEbayItem: 'eBay ürünü · {item}',
      ebayItemPrompt: 'Bir eBay satıcı bağlantısı veya adı ya da fiyatını ve satışlarını izlemek için bir eBay ürün bağlantısı yapıştırın',
      itemSold: '{value} satıldı (tüm zamanlar)',
      itemSalesNote: "eBay'in bu ürün için satış sayacından ölçülür · boşluklar kullanılabilir okuma olmayan günlerdir",
      itemPriceChart: 'Fiyat, 30 gün',
      itemPriceNote: 'Ürünün her günlük okumadaki liste fiyatı',
      itemPriceNotYet: 'Fiyat çizgisi birkaç günlük okumadan sonra görünür.',
      itemChartAria: '{item} fiyatı, son 30 gün',
      error: { itemNotFound: 'Bu eBay ürünü bulunamadı. Satışı sona ermiş olabilir' },
    },
  },
} as const;
