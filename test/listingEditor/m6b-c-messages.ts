// test/listingEditor/m6b-c-messages.ts — M6b-C strings (returned to the integrator as newI18nKeys; messages/*.json are
// not edited here) and an overlay for the render tests. Root-relative keys (`listingEditor.*`, `listings.*`).
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

export type Locale = 'en' | 'tr';
type Tree = { [k: string]: string | Tree };

/** Flat key → [EN, TR]. */
export const M6BC_KEYS: Record<string, [string, string]> = {
  // Section titles (marketplace-editors §9; also in M6b-D's list with the same text).
  'listingEditor.section.categoryBrand': ['Category & brand', 'Kategori ve marka'],
  'listingEditor.section.priceStock': ['Price & stock', 'Fiyat ve stok'],
  'listingEditor.section.tagsOrg': ['Tags & organization', 'Etiketler ve düzen'],
  'listingEditor.section.variants': ['Variants', 'Varyantlar'],
  'listingEditor.common.newProduct': ['New product', 'Yeni ürün'],
  // Load states
  'listingEditor.trendyol.notFound': ["We couldn't find this product in your Trendyol catalog", 'Bu ürünü Trendyol kataloğunuzda bulamadık'],
  'listingEditor.wix.notFound': ["We couldn't find this product in your Wix store", 'Bu ürünü Wix mağazanızda bulamadık'],
  'listingEditor.shopify.notFound': ["We couldn't find this product in your Shopify store", 'Bu ürünü Shopify mağazanızda bulamadık'],
  // Route + validation
  // `marketplace` = the marketplace key (trendyol / wix / shopify): Turkish needs the accusative suffix (glossary §3.19).
  'listingEditor.catalog.connectTitle': [
    'Connect {marketplace, select, trendyol {Trendyol} wix {Wix} shopify {Shopify} other {your store}} to edit your products',
    "Ürünlerinizi düzenlemek için {marketplace, select, trendyol {Trendyol'u} wix {Wix'i} shopify {Shopify'ı} other {mağazanızı}} bağlayın",
  ],
  'listingEditor.catalog.connectBody': [
    'Your products and staged changes appear here once the store is connected.',
    'Mağaza bağlandığında ürünleriniz ve gönderilmemiş değişiklikleriniz burada görünür.',
  ],
  'listingEditor.catalog.storeFailed': ["Couldn't load your {marketplace} store", '{marketplace} mağazanız yüklenemedi'],
  'listingEditor.catalog.crosslistFailed': ["Couldn't load the listing to copy", 'Kopyalanacak ilan yüklenemedi'],
  'listingEditor.catalog.required': ['Required', 'Zorunlu'],
  'listingEditor.catalog.barcodeInvalid': [
    'Use up to {max} letters, digits, dots, dashes or underscores',
    'En fazla {max} harf, rakam, nokta, tire veya alt çizgi kullanın',
  ],
  'listingEditor.catalog.confirmRemoval': ['Confirm the removal before sending it', 'Göndermeden önce kaldırma işlemini onaylayın'],
  // Send / stage outcomes (review fixes)
  'listingEditor.catalog.sendPending': [
    'Sent. Trendyol is still processing it; this page updates when it is done.',
    'Gönderildi. Trendyol hâlâ işliyor; tamamlanınca bu sayfa güncellenir.',
  ],
  'listingEditor.catalog.archiveInGrid': [
    'Archiving is confirmed from the product list. Send it there, or remove it from this draft.',
    'Arşivleme ürün listesinden onaylanır. Oradan gönderin veya bu taslaktan kaldırın.',
  ],
  'listingEditor.catalog.createdReload': [
    'This product was already sent. Reload the page to edit it.',
    'Bu ürün zaten gönderildi. Düzenlemek için sayfayı yenileyin.',
  ],
  'listingEditor.catalog.crosslistPriceCleared': [
    "Price not copied: the listing is in another currency. Set a price in {currency}.",
    'Fiyat kopyalanmadı: ilan başka bir para biriminde. {currency} cinsinden fiyat girin.',
  ],
  'listingEditor.catalog.descriptionPreview': ['Description preview', 'Açıklama önizlemesi'],
  // Start faster copy picker
  'listingEditor.catalog.copyPickerCrosslistTitle': ['Copy an Etsy or eBay listing', 'Bir Etsy veya eBay ilanını kopyala'],
  'listingEditor.catalog.copyPickerProductTitle': ['Copy one of your products', 'Ürünlerinizden birini kopyala'],
  'listingEditor.catalog.copyPickerSearch': ['Search by title or ID', 'Başlık veya kimlikle arayın'],
  'listingEditor.catalog.copyPickerLoading': ['Loading listings…', 'İlanlar yükleniyor…'],
  'listingEditor.catalog.copyPickerEmpty': ['No listings match your search', 'Aramanızla eşleşen ilan yok'],
  'listingEditor.catalog.copyPickerFailed': ["Couldn't load your listings", 'İlanlarınız yüklenemedi'],
  'listingEditor.catalog.copyPickerRetry': ['Try again', 'Tekrar dene'],
  'listingEditor.catalog.copyPickerNotConnected': ['{marketplace} is not connected', '{marketplace} bağlı değil'],
  'listingEditor.catalog.copyPickerCopy': ['Copy', 'Kopyala'],
  'listingEditor.catalog.copyPickerChoose': ['Choose a listing first', 'Önce bir ilan seçin'],
  // Marketplace-specific guards (review fixes)
  'listingEditor.wix.discountUnknown': [
    "This product has a discount we can't read. Set the discount type and amount before changing the price.",
    'Bu üründe okuyamadığımız bir indirim var. Fiyatı değiştirmeden önce indirim türünü ve tutarını girin.',
  ],
  'listingEditor.wix.otherSite': [
    'This product is on another Wix site. For now the editor opens products of your first Wix site.',
    'Bu ürün başka bir Wix sitenizde. Düzenleyici şimdilik yalnızca ilk Wix sitenizin ürünlerini açar.',
  ],
  'listingEditor.shopify.seoUnavailable': [
    "We couldn't read this product's SEO. Reload the page before editing it.",
    'Bu ürünün SEO bilgileri okunamadı. Düzenlemeden önce sayfayı yenileyin.',
  ],
  // "Needed before sending" (the frame reads listingEditor.needed.<field> for each blocking create issue)
  'listingEditor.needed.barcode': ['Barcode', 'Barkod'],
  'listingEditor.needed.brandId': ['Brand', 'Marka'],
  'listingEditor.needed.stockCode': ['Stock code', 'Stok kodu'],
  'listingEditor.needed.listPrice': ['List price', 'Liste fiyatı'],
  'listingEditor.needed.vatRate': ['VAT rate', 'KDV oranı'],
  'listingEditor.needed.cargoCompanyId': ['Cargo company', 'Kargo firması'],
  'listingEditor.needed.dimensionalWeight': ['Desi', 'Desi'],
  // CatalogDraft validation keys the adapters show inline (server ERROR_META, M6b-A; same params as the server).
  'listings.draftError.invalidImages': ['Add 1 to {max} photos with https links', "https bağlantılı 1 ile {max} arası fotoğraf ekleyin"],
  'listings.draftError.listBelowSale': ["List price can't be lower than the sale price", 'Liste fiyatı satış fiyatından düşük olamaz'],
  'listings.draftError.invalidVat': ['Choose a VAT rate: 0, 1, 10 or 20%', 'Bir KDV oranı seçin: %0, %1, %10 veya %20'],
  'listings.draftError.textTooLong': ['Use up to {max} characters', 'En fazla {max} karakter kullanın'],
  'listings.draftError.invalidNumber': ['Enter a number from {min} to {max}', '{min} ile {max} arasında bir sayı girin'],
  'listings.draftError.invalidDiscount': ['The discount must be more than 0 and below the price', 'İndirim 0’dan büyük ve fiyatın altında olmalı'],
  'listings.draftError.invalidMedia': ['Use up to {max} photos with https links', 'https bağlantılı en fazla {max} fotoğraf kullanın'],
  'listings.draftError.invalidTextFields': ['Check the text fields: each needs a title', 'Metin alanlarını kontrol edin: her birinin bir başlığı olmalı'],
};

function merge(base: Tree, add: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(add)) {
    const cur = out[k];
    out[k] = typeof v === 'string' || typeof cur !== 'object' ? v : merge(cur as Tree, v);
  }
  return out;
}

function nest(locale: Locale): Tree {
  const out: Tree = {};
  for (const [key, pair] of Object.entries(M6BC_KEYS)) {
    const parts = key.split('.');
    let node = out;
    for (const p of parts.slice(0, -1)) node = (node[p] = (node[p] as Tree) ?? {}) as Tree;
    node[parts[parts.length - 1]] = pair[locale === 'en' ? 0 : 1];
  }
  return out;
}

/** messages/{locale}.json + the M6b-C keys (existing keys are never overwritten). */
export function withM6bC(locale: Locale): Tree {
  const base = (locale === 'en' ? en : tr) as unknown as Tree;
  return merge(nest(locale), base);
}
