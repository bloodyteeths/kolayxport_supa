// test/listings/etsy-port-messages.ts — keys added by the Etsy legacy port (new-listing drafts, Set field, Copy to
// another shop, variation prices, profile delete). Returned to the integrator as newI18nKeys and mirrored here so
// the tests run before messages/*.json are merged.
export const ETSY_PORT_EN = {
  listings: {
    action: { setField: 'Set field…', copyToShop: 'Copy to another shop…' },
    newDrafts: {
      title: '{count, plural, one {# new listing is} other {# new listings are}} not on {marketplace} yet',
      show: 'Show them',
      hide: 'Hide',
      open: 'Open',
      discard: 'Discard',
      discardConfirm: 'Discard "{title}"?',
      discardBody: 'It was never sent, so nothing changes on {marketplace}. The draft and its staged photos are removed.',
      discarded: 'New listing discarded',
      untitled: 'Untitled listing',
      photos: '{count, plural, =0 {No photos} one {# photo} other {# photos}}',
      copyTo: 'Copy to {shop}',
      partiallyCreated: 'Partly created on {marketplace} (#{id}): open it to finish sending',
      willPublish: 'Goes live when sent',
      failed: 'Last send failed',
      sending: 'Sending…',
    },
    setField: {
      title: '{count, plural, one {Set a field on # listing} other {Set a field on # listings}}',
      help: 'Fills the drafts only. Nothing changes on Etsy until you send.',
      field: 'Field',
      itemDetails: 'Who made it, when, and what it is',
      dimensions: 'Size',
      keep: 'Keep as is',
      categoryHelp: "Category details are not changed here. Check them in each listing's editor.",
      materialsHelp: 'Replaces the materials on every selected listing',
      stage: '{count, plural, =0 {Stage changes} one {Stage # change} other {Stage # changes}}',
      pickValue: 'Choose a value first',
    },
    copyToShop: {
      title: '{count, plural, one {Copy # listing to another shop} other {Copy # listings to another shop}}',
      help: 'Each copy becomes a new listing in that shop when you send it. Photos, tags and details come along.',
      target: 'Shop',
      pick: 'Choose a shop',
      stage: '{count, plural, =0 {Stage copies} one {Stage # copy} other {Stage # copies}}',
      skipped: '{count, plural, one {# listing} other {# listings}} skipped: send or discard their other changes first',
      staged: "{count, plural, one {# copy} other {# copies}} to {shop} staged. Select the listings and send them when you're ready",
    },
    price: {
      variations: "{count, plural, one {# listing has} other {# listings have}} variations: every variation's price changes the same way",
      variationsSkipped:
        "{count, plural, one {# listing} other {# listings}} with variations skipped: their variations couldn't be read. Try again or change them in the editor",
    },
  },
  listingEditor: {
    profile: {
      delete: 'Delete profile',
      deleteConfirm: 'Delete the profile "{name}"?',
      deleted: 'Deleted profile "{name}"',
    },
  },
};

export const ETSY_PORT_TR = {
  listings: {
    action: { setField: 'Alan ayarla…', copyToShop: 'Başka mağazaya kopyala…' },
    newDrafts: {
      title: "{count, plural, one {# yeni ilan} other {# yeni ilan}} henüz {marketplace}'de değil",
      show: 'Göster',
      hide: 'Gizle',
      open: 'Aç',
      discard: 'Vazgeç',
      discardConfirm: '"{title}" silinsin mi?',
      discardBody: "Hiç gönderilmedi, bu yüzden {marketplace}'de hiçbir şey değişmez. Taslak ve hazırlanan fotoğrafları silinir.",
      discarded: 'Yeni ilan silindi',
      untitled: 'Başlıksız ilan',
      photos: '{count, plural, =0 {Fotoğraf yok} one {# fotoğraf} other {# fotoğraf}}',
      copyTo: '{shop} mağazasına kopya',
      partiallyCreated: "{marketplace}'de kısmen oluşturuldu (#{id}): göndermeyi tamamlamak için açın",
      willPublish: 'Gönderilince yayına girer',
      failed: 'Son gönderim başarısız',
      sending: 'Gönderiliyor…',
    },
    setField: {
      title: '{count, plural, one {# ilanda alan ayarla} other {# ilanda alan ayarla}}',
      help: "Yalnızca taslakları doldurur. Siz gönderene kadar Etsy'de hiçbir şey değişmez.",
      field: 'Alan',
      itemDetails: 'Kim yaptı, ne zaman yapıldı, ne olduğu',
      dimensions: 'Ölçü',
      keep: 'Olduğu gibi kalsın',
      categoryHelp: 'Kategori detayları burada değişmez. Her ilanın düzenleyicisinde kontrol edin.',
      materialsHelp: 'Seçili tüm ilanlarda malzemelerin yerine geçer',
      stage: '{count, plural, =0 {Değişiklikleri hazırla} one {# değişikliği hazırla} other {# değişikliği hazırla}}',
      pickValue: 'Önce bir değer seçin',
    },
    copyToShop: {
      title: '{count, plural, one {# ilanı başka mağazaya kopyala} other {# ilanı başka mağazaya kopyala}}',
      help: 'Her kopya, gönderdiğinizde o mağazada yeni bir ilan olur. Fotoğraflar, etiketler ve detaylar da gelir.',
      target: 'Mağaza',
      pick: 'Bir mağaza seçin',
      stage: '{count, plural, =0 {Kopyaları hazırla} one {# kopyayı hazırla} other {# kopyayı hazırla}}',
      skipped: '{count, plural, one {# ilan} other {# ilan}} atlandı: önce diğer değişikliklerini gönderin veya vazgeçin',
      staged: '{shop} için {count, plural, one {# kopya} other {# kopya}} hazırlandı. Hazır olduğunuzda ilanları seçip gönderin',
    },
    price: {
      variations: '{count, plural, one {# ilanın} other {# ilanın}} varyasyonları var: her varyasyonun fiyatı aynı şekilde değişir',
      variationsSkipped:
        '{count, plural, one {# varyasyonlu ilan} other {# varyasyonlu ilan}} atlandı: varyasyonları okunamadı. Tekrar deneyin veya düzenleyicide değiştirin',
    },
  },
  listingEditor: {
    profile: {
      delete: 'Profili sil',
      deleteConfirm: '"{name}" profili silinsin mi?',
      deleted: '"{name}" profili silindi',
    },
  },
};
