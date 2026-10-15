// test/listingEditor/f-messages.ts — Group F strings (returned to the integrator as newI18nKeys) and an overlay
// for the render tests: messages/{en,tr}.json + Groups B / D / H listingEditor keys the eBay sections reuse + F.
// Once the integrator merges every group's keys the overlay is a no-op.
import { bListingEditor, withB, type Locale } from './b-messages';
import { dListingEditor } from './d-messages';
import { H_EN, H_TR, mergeMessages } from './h-messages';

type Tree = { [k: string]: string | Tree };

export const fKeys: Record<Locale, { listingEditor: Tree; ebay: Tree }> = {
  en: {
    listingEditor: {
      field: {
        shippingPolicy: 'Shipping policy',
        subtitleHelperEbay: 'Shown under the title in eBay search. eBay may charge a fee for a subtitle',
        currency: 'Currency',
        skuHelperEbayOwn: 'Your own SKU for stock matching. Leave empty to use {sku}',
        skuLockedEbay: 'eBay already has this listing under this SKU, so it can no longer be changed',
        priceDefaultForVariations: 'Starting price for new variations. Each variation has its own price below',
        categoryHelperEbay: 'Search eBay categories by what you sell',
        categorySearch: 'Search categories, e.g. wooden box',
        categoryId: 'Category #{id}',
        storeCategories: 'Store categories',
        storeCategoriesHelper: 'Up to {max}, from your eBay Store',
      },
      state: { crosslistFailed: "Couldn't load the Etsy listing to copy" },
      variations: {
        ebayCreateIntro: 'Sell this item in several options, such as colors or sizes. Each combination gets its own SKU, price and quantity.',
        ebayAddOption: 'Add option',
        ebayOptionName: 'Option name',
        ebayOptionNamePlaceholder: 'e.g. Color',
        ebayOptionValues: 'Values',
        ebayOptionValuesHelper: 'Type a value and press Enter or comma',
        ebayRemoveOption: 'Remove option {name}',
        ebayCombinations: '{count, plural, one {# combination} other {# combinations}}',
        ebayVariantSku: 'SKU for {variant}',
        ebayVariantPrice: 'Price for {variant}',
        ebayVariantQuantity: 'Quantity for {variant}',
      },
      needed: {
        categoryId: 'Category',
        fulfillmentPolicyId: 'Shipping policy',
        returnPolicyId: 'Return policy',
        paymentPolicyId: 'Payment policy',
      },
    },
    ebay: {
      draftSync: {
        draftNotFound: 'This draft no longer exists.',
        draftSyncing: 'This draft is being sent to eBay right now. Wait for it to finish.',
        notSyncable: "This draft can't be sent right now ({status}).",
        draftNotEditable: "This draft can't be changed right now ({status}).",
        conflict: 'This listing changed on eBay after you started editing.',
        missingOnEbay: 'This listing is no longer on eBay. Discard the draft.',
        missingAspects: 'eBay needs these item specifics before listing: {aspects}',
        missingAspectsShort: 'Some required item specifics are missing',
        locationRequired: 'eBay needs your item location. Add an address in eBay Seller Hub, then try again.',
        reauthRequired: 'Your eBay connection has expired. Reconnect eBay in Settings.',
        rejected: 'eBay rejected the change',
        skuExists: 'SKU {sku} is already used by another eBay listing. Nothing was changed on eBay.',
        skuExistsShort: 'This SKU is already used by another eBay listing',
        createIncomplete: 'Fill these before listing on eBay: {fields}',
        createIncompleteShort: 'Some required fields are empty',
        createdNotPublished: 'The listing was created on eBay but not published. Try sending again to publish it.',
        createdOnEbay: "Listing {sku} already exists on eBay as unpublished, so this draft can't be discarded. Send it again to finish it.",
        deleteOnNew: "A new listing can't be deleted on eBay. Discard the draft instead.",
        legacyNotEditable: "This listing was made outside the eBay Inventory API, so it can't be edited here. Copy it to a new listing instead.",
      },
      validation: {
        titleTooLong: 'Title is {length} / {max} characters',
        subtitleTooLong: 'Subtitle can be up to {max} characters',
        tooManyPhotos: 'eBay allows up to {max} photos',
        priceInvalid: 'Enter a price above 0',
        currencyInvalid: 'Choose USD, GBP, EUR or TRY',
        quantityInvalid: 'Enter a whole number of 0 or more',
        aspectTooLong: 'Item specifics longer than {max} characters are cut: {names}',
        titleRequired: 'Add a title',
        descriptionRequired: 'Add a description',
        photosRequired: 'Add at least 1 photo',
        categoryRequired: 'Choose a category',
        priceRequired: 'Enter a price',
        fulfillmentPolicyRequired: 'Choose a shipping policy',
        returnPolicyRequired: 'Choose a return policy',
        paymentPolicyRequired: 'Choose a payment policy',
        variationsRequired: 'Add at least one variation',
        variantSkuRequired: 'Every variation needs a SKU',
        variantSkuDuplicate: 'Each variation needs a different SKU',
        variantPriceRequired: 'Enter a price above 0 for every variation',
        skuInvalid: 'Use up to {max} letters, numbers, - _ or .',
      },
    },
  },
  tr: {
    listingEditor: {
      field: {
        shippingPolicy: 'Kargo politikası',
        subtitleHelperEbay: 'eBay aramasında başlığın altında görünür. eBay alt başlık için ücret alabilir',
        currency: 'Para birimi',
        skuHelperEbayOwn: 'Stok eşleştirmesi için kendi SKU kodunuz. Boş bırakırsanız {sku} kullanılır',
        skuLockedEbay: "eBay bu ilanı bu SKU ile zaten kaydetti, artık değiştirilemez",
        priceDefaultForVariations: 'Yeni varyasyonlar için başlangıç fiyatı. Her varyasyonun aşağıda kendi fiyatı var',
        categoryHelperEbay: 'Sattığınız ürünle eBay kategorilerinde arayın',
        categorySearch: 'Kategori arayın, ör. ahşap kutu',
        categoryId: 'Kategori #{id}',
        storeCategories: 'Mağaza kategorileri',
        storeCategoriesHelper: 'eBay Mağazanızdan en fazla {max}',
      },
      state: { crosslistFailed: 'Kopyalanacak Etsy ilanı yüklenemedi' },
      variations: {
        ebayCreateIntro: 'Bu ürünü renk veya beden gibi seçeneklerle satın. Her kombinasyonun kendi SKU kodu, fiyatı ve adedi olur.',
        ebayAddOption: 'Seçenek ekle',
        ebayOptionName: 'Seçenek adı',
        ebayOptionNamePlaceholder: 'ör. Renk',
        ebayOptionValues: 'Değerler',
        ebayOptionValuesHelper: 'Bir değer yazıp Enter veya virgüle basın',
        ebayRemoveOption: '{name} seçeneğini kaldır',
        ebayCombinations: '{count, plural, one {# kombinasyon} other {# kombinasyon}}',
        ebayVariantSku: '{variant} için SKU',
        ebayVariantPrice: '{variant} için fiyat',
        ebayVariantQuantity: '{variant} için adet',
      },
      needed: {
        categoryId: 'Kategori',
        fulfillmentPolicyId: 'Kargo politikası',
        returnPolicyId: 'İade politikası',
        paymentPolicyId: 'Ödeme politikası',
      },
    },
    ebay: {
      draftSync: {
        draftNotFound: 'Bu taslak artık yok.',
        draftSyncing: "Bu taslak şu anda eBay'e gönderiliyor. Bitmesini bekleyin.",
        notSyncable: 'Bu taslak şu anda gönderilemez ({status}).',
        draftNotEditable: 'Bu taslak şu anda değiştirilemez ({status}).',
        conflict: "Düzenlemeye başladıktan sonra bu ilan eBay'de değişti.",
        missingOnEbay: "Bu ilan artık eBay'de değil. Taslağı atın.",
        missingAspects: 'eBay listelemeden önce şu ürün özelliklerini istiyor: {aspects}',
        missingAspectsShort: 'Bazı zorunlu ürün özellikleri eksik',
        locationRequired: "eBay ürün konumunuzu istiyor. eBay Seller Hub'da bir adres ekleyip tekrar deneyin.",
        reauthRequired: "eBay bağlantınızın süresi doldu. Ayarlar'dan eBay'i yeniden bağlayın.",
        rejected: 'eBay değişikliği reddetti',
        skuExists: "{sku} SKU'su başka bir eBay ilanında kullanılıyor. eBay'de hiçbir şey değiştirilmedi.",
        skuExistsShort: 'Bu SKU başka bir eBay ilanında kullanılıyor',
        createIncomplete: "eBay'de listelemeden önce şunları doldurun: {fields}",
        createIncompleteShort: 'Bazı zorunlu alanlar boş',
        createdNotPublished: "İlan eBay'de oluşturuldu ama yayınlanmadı. Yayınlamak için tekrar göndermeyi deneyin.",
        createdOnEbay: "{sku} ilanı eBay'de yayınlanmamış olarak zaten var, bu yüzden taslak silinemez. Tamamlamak için tekrar gönderin.",
        deleteOnNew: "Yeni bir ilan eBay'de silinemez. Bunun yerine taslağı atın.",
        legacyNotEditable: "Bu ilan eBay Inventory API dışında oluşturulmuş, bu yüzden burada düzenlenemez. Bunun yerine yeni bir ilana kopyalayın.",
      },
      validation: {
        titleTooLong: 'Başlık {length} / {max} karakter',
        subtitleTooLong: 'Alt başlık en fazla {max} karakter olabilir',
        tooManyPhotos: 'eBay en fazla {max} fotoğrafa izin verir',
        priceInvalid: "0'dan büyük bir fiyat girin",
        currencyInvalid: 'USD, GBP, EUR veya TRY seçin',
        quantityInvalid: '0 veya daha büyük bir tam sayı girin',
        aspectTooLong: '{max} karakterden uzun ürün özellikleri kısaltılır: {names}',
        titleRequired: 'Bir başlık ekleyin',
        descriptionRequired: 'Bir açıklama ekleyin',
        photosRequired: 'En az 1 fotoğraf ekleyin',
        categoryRequired: 'Bir kategori seçin',
        priceRequired: 'Bir fiyat girin',
        fulfillmentPolicyRequired: 'Bir kargo politikası seçin',
        returnPolicyRequired: 'Bir iade politikası seçin',
        paymentPolicyRequired: 'Bir ödeme politikası seçin',
        variationsRequired: 'En az bir varyasyon ekleyin',
        variantSkuRequired: "Her varyasyonun bir SKU'su olmalı",
        variantSkuDuplicate: 'Her varyasyonun SKU kodu farklı olmalı',
        variantPriceRequired: "Her varyasyon için 0'dan büyük bir fiyat girin",
        skuInvalid: 'En fazla {max} harf, rakam, - _ veya . kullanın',
      },
    },
  },
};

export function withF(locale: Locale): Tree {
  let m = withB(locale);
  m = mergeMessages(m, locale === 'en' ? H_EN : H_TR);
  m = mergeMessages(m, { listingEditor: dListingEditor[locale] });
  // B's keys win over H's / D's for the fields several groups define (same text), F last.
  m = mergeMessages(m, { listingEditor: bListingEditor[locale] });
  return mergeMessages(m, fKeys[locale] as unknown as Tree);
}

/** Flat `{ namespace, key, en, tr }` rows (the newI18nKeys payload). */
export function flatKeys(): Array<{ namespace: string; key: string; en: string; tr: string }> {
  const rows: Array<{ namespace: string; key: string; en: string; tr: string }> = [];
  const walk = (ns: string, e: Tree, t: Tree, prefix: string) => {
    for (const [k, v] of Object.entries(e)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') rows.push({ namespace: ns, key, en: v, tr: String((t?.[k] as string) ?? '') });
      else walk(ns, v, (t?.[k] as Tree) ?? {}, key);
    }
  };
  walk('listingEditor', fKeys.en.listingEditor, fKeys.tr.listingEditor, '');
  walk('ebay', fKeys.en.ebay, fKeys.tr.ebay, '');
  return rows;
}
