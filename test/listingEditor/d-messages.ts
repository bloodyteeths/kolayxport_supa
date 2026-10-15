// test/listingEditor/d-messages.ts — Group D `listingEditor.*` strings (returned to the integrator as newI18nKeys)
// and a helper that merges them into messages/{en,tr}.json for the render tests. Once the integrator merges the keys,
// `withD` is a no-op merge.
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

type Tree = { [k: string]: string | Tree };
export type Locale = 'en' | 'tr';

export const dListingEditor: { en: Tree; tr: Tree } = {
  en: {
    section: { variations: 'Variations', personalization: 'Personalization', specifics: 'Item specifics' },
    sheet: { done: 'Done', cancel: 'Cancel' },
    variations: {
      summary: '{variations, plural, one {# variation} other {# variations}} · {combos, plural, one {# combination} other {# combinations}}',
      summaryUnknown: 'Variations',
      none: 'No variations',
      add: 'Add variations',
      edit: 'Edit',
      createNeedsDraft: 'Variations can be added once this new listing is saved',
      stageFailed: "Couldn't save your variation changes. Try again",
      loadFailed: "Couldn't load variations",
      crashTitle: 'The variation editor stopped working',
      crashRetry: 'Try again',
      tabsLabel: 'Variation settings',
      editorSummary: '{combos, plural, one {# combination} other {# combinations}} · {stock} in stock · {axes}',
      clickToEdit: 'Click to edit',
      off: 'Off',
      addCount: 'Add {count, plural, one {# variation} other {# variations}}',
      addNeedsValuesAndPrice: 'Enter at least one value and a price',
      cancel: 'Cancel',
      ebaySummary: '{count, plural, one {# variation} other {# variations}}',
      ebayCreateHint: 'Variations for a new eBay listing are set up when you create it. Price and quantity per variation can be edited here once it is on eBay',
      ebayLoadFailed: "Couldn't load variations from eBay",
      ebayManageHint: 'Variation groups are set up on eBay',
      ebayEditHint: 'Each variation is sent to eBay with your next send',
      ebayReadOnlyHint: "Price and stock per variation can't be sent from here yet. Change them on eBay",
      view: 'View',
      ebayNoOffer: 'This variation has no offer on eBay yet, so its price is set there',
      ebayPriceInvalid: 'Enter a price above 0 for {sku}',
      ebayQuantityInvalid: 'Enter a whole number of 0 or more for {sku}',
    },
    personalization: {
      toggle: 'Ask buyers for personalization',
      toggleHelp: 'Buyers answer your questions when they order',
      summary: 'On · {required, select, true {Required} other {Optional}} · {count, plural, one {# question} other {# questions}}',
      off: 'Off',
      edit: 'Edit',
      setUp: 'Set up',
      questionN: 'Question {index}',
      removeQuestion: 'Remove question {index}',
      questionText: 'Question',
      questionPlaceholder: 'e.g. Name to embroider',
      answerType: 'Answer type',
      typeText: 'Text',
      typeDropdown: 'Dropdown',
      typeUpload: 'File upload',
      typeLabeledUpload: 'File upload with labels',
      instructions: 'Instructions for buyers',
      instructionsPlaceholder: 'e.g. Up to 10 letters, no emoji',
      charLimit: 'Character limit',
      charLimitHelp: 'From 1 to 1024',
      fileCount: 'Number of files',
      fileCountHelp: 'From 1 to 10',
      choices: 'Choices',
      choicesHelp: 'Up to 30 choices, 20 characters each',
      choicesPlaceholder: 'Type a choice, Enter to add',
      fileLabel: 'Label for file {index}',
      required: 'Buyers must answer',
      maxQuestions: 'Up to {max} questions per listing',
      addQuestion: 'Add a question',
      createNeedsDraft: 'Personalization can be set up once this new listing is saved',
      stageFailed: "Couldn't save your personalization changes. Try again",
      draftCheckFailed: "Couldn't check for unsent personalization changes",
    },
    specifics: {
      filled: '{filled} of {total} filled',
      required: 'Required',
      recommended: 'Recommended',
      custom: 'Your own specifics',
      chooseValue: 'Choose a value',
      typeOrChoose: 'Type or choose a value',
      valuePlaceholder: 'Type a value, Enter to add',
      tooLong: 'Up to {max} characters per value',
      remove: 'Remove {name}',
      name: 'Name',
      value: 'Value',
      add: 'Add',
      addNeedsBoth: 'Enter a name and a value',
      requiredMissing: 'eBay needs this before you send',
      fill: 'Fill item specifics',
      filling: 'Writing…',
      proposalTitle: 'Suggested item specifics',
      use: 'Use',
      skip: 'Skip',
      useAll: 'Use all',
      dismiss: 'Dismiss',
      garbled: "The suggestion didn't come out right",
      filledToast: '{count, plural, one {# item specific} other {# item specifics}} filled',
      noCategory: 'Choose a category to see its item specifics',
      loadFailed: "Couldn't load item specifics for this category",
    },
    condition: {
      label: 'Condition',
      placeholder: 'Choose a condition',
      description: 'Condition description',
      descriptionHelp: 'What a buyer should know about wear or defects',
      descriptionPlaceholder: 'e.g. Light scratches on the lid, works perfectly',
    },
  },
  tr: {
    section: { variations: 'Varyasyonlar', personalization: 'Kişiselleştirme', specifics: 'Ürün özellikleri' },
    sheet: { done: 'Tamam', cancel: 'İptal' },
    variations: {
      summary: '{variations} varyasyon · {combos} kombinasyon',
      summaryUnknown: 'Varyasyonlar',
      none: 'Varyasyon yok',
      add: 'Varyasyon ekle',
      edit: 'Düzenle',
      createNeedsDraft: 'Varyasyonlar, yeni ilan kaydedildikten sonra eklenebilir',
      stageFailed: 'Varyasyon değişiklikleri kaydedilemedi. Tekrar deneyin',
      loadFailed: 'Varyasyonlar yüklenemedi',
      crashTitle: 'Varyasyon düzenleyicisi çalışmayı durdurdu',
      crashRetry: 'Tekrar dene',
      tabsLabel: 'Varyasyon ayarları',
      editorSummary: '{combos} kombinasyon · {stock} stokta · {axes}',
      clickToEdit: 'Düzenlemek için tıklayın',
      off: 'Kapalı',
      addCount: '{count} varyasyon ekle',
      addNeedsValuesAndPrice: 'En az bir değer ve bir fiyat girin',
      cancel: 'İptal',
      ebaySummary: '{count} varyasyon',
      ebayCreateHint: "Yeni bir eBay ilanının varyasyonları ilanı oluştururken ayarlanır. İlan eBay'de olduğunda her varyasyonun fiyatı ve adedi burada düzenlenebilir",
      ebayLoadFailed: "Varyasyonlar eBay'den yüklenemedi",
      ebayManageHint: "Varyasyon grupları eBay'de ayarlanır",
      ebayEditHint: "Her varyasyon bir sonraki gönderiminizle eBay'e gönderilir",
      ebayReadOnlyHint: "Varyasyon başına fiyat ve stok henüz buradan gönderilemiyor. eBay'de değiştirin",
      view: 'Görüntüle',
      ebayNoOffer: "Bu varyasyonun eBay'de henüz bir teklifi yok, bu yüzden fiyatı orada ayarlanır",
      ebayPriceInvalid: '{sku} için 0’dan büyük bir fiyat girin',
      ebayQuantityInvalid: '{sku} için 0 veya daha büyük bir tam sayı girin',
    },
    personalization: {
      toggle: 'Alıcılardan kişiselleştirme iste',
      toggleHelp: 'Alıcılar sipariş verirken sorularınızı yanıtlar',
      summary: 'Açık · {required, select, true {Zorunlu} other {İsteğe bağlı}} · {count} soru',
      off: 'Kapalı',
      edit: 'Düzenle',
      setUp: 'Ayarla',
      questionN: 'Soru {index}',
      removeQuestion: '{index}. soruyu kaldır',
      questionText: 'Soru',
      questionPlaceholder: 'örn. İşlenecek isim',
      answerType: 'Yanıt türü',
      typeText: 'Metin',
      typeDropdown: 'Açılır liste',
      typeUpload: 'Dosya yükleme',
      typeLabeledUpload: 'Etiketli dosya yükleme',
      instructions: 'Alıcılar için talimat',
      instructionsPlaceholder: 'örn. En fazla 10 harf, emoji yok',
      charLimit: 'Karakter sınırı',
      charLimitHelp: '1 ile 1024 arası',
      fileCount: 'Dosya sayısı',
      fileCountHelp: '1 ile 10 arası',
      choices: 'Seçenekler',
      choicesHelp: 'En fazla 30 seçenek, her biri 20 karakter',
      choicesPlaceholder: 'Bir seçenek yazın, eklemek için Enter',
      fileLabel: '{index}. dosyanın etiketi',
      required: 'Alıcıların yanıtlaması zorunlu',
      maxQuestions: 'İlan başına en fazla {max} soru',
      addQuestion: 'Soru ekle',
      createNeedsDraft: 'Kişiselleştirme, yeni ilan kaydedildikten sonra ayarlanabilir',
      stageFailed: 'Kişiselleştirme değişiklikleri kaydedilemedi. Tekrar deneyin',
      draftCheckFailed: 'Gönderilmemiş kişiselleştirme değişiklikleri kontrol edilemedi',
    },
    specifics: {
      filled: '{total} özellikten {filled} tanesi dolu',
      required: 'Zorunlu',
      recommended: 'Önerilen',
      custom: 'Kendi özellikleriniz',
      chooseValue: 'Bir değer seçin',
      typeOrChoose: 'Bir değer yazın veya seçin',
      valuePlaceholder: 'Bir değer yazın, eklemek için Enter',
      tooLong: 'Değer başına en fazla {max} karakter',
      remove: '{name} özelliğini kaldır',
      name: 'Ad',
      value: 'Değer',
      add: 'Ekle',
      addNeedsBoth: 'Bir ad ve bir değer girin',
      requiredMissing: "eBay göndermeden önce bunu ister",
      fill: 'Ürün özelliklerini doldur',
      filling: 'Yazılıyor…',
      proposalTitle: 'Önerilen ürün özellikleri',
      use: 'Kullan',
      skip: 'Atla',
      useAll: 'Hepsini kullan',
      dismiss: 'Kapat',
      garbled: 'Öneri düzgün oluşmadı',
      filledToast: '{count} ürün özelliği dolduruldu',
      noCategory: 'Ürün özelliklerini görmek için bir kategori seçin',
      loadFailed: 'Bu kategorinin ürün özellikleri yüklenemedi',
    },
    condition: {
      label: 'Durum',
      placeholder: 'Bir durum seçin',
      description: 'Durum açıklaması',
      descriptionHelp: 'Alıcının aşınma veya kusurlar hakkında bilmesi gerekenler',
      descriptionPlaceholder: 'örn. Kapakta hafif çizikler var, sorunsuz çalışıyor',
    },
  },
};

function merge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = typeof v === 'object' && typeof cur === 'object' ? merge(cur, v) : v;
  }
  return out;
}

/** messages/{locale}.json + Group D keys (listingEditor.*). */
export function withD(locale: Locale): Tree {
  const base = (locale === 'en' ? en : tr) as unknown as Tree;
  return merge(base, { listingEditor: dListingEditor[locale] });
}

/** Flat `{ namespace, key, en, tr }` rows (newI18nKeys shape), for the parity test. */
export function flatKeys(): Array<{ key: string; en: string; tr: string }> {
  const rows: Array<{ key: string; en: string; tr: string }> = [];
  const walk = (e: Tree, t: Tree, prefix: string) => {
    for (const [k, v] of Object.entries(e)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') rows.push({ key: path, en: v, tr: String((t as Record<string, unknown>)[k] ?? '') });
      else walk(v, (t[k] as Tree) ?? {}, path);
    }
  };
  walk(dListingEditor.en, dListingEditor.tr, '');
  return rows;
}
