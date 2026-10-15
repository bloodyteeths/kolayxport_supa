// test/settings/c-messages.ts — settings group C strings (Sender profile, Preferences, Refresh history).
// Source of the group's newI18nKeys (the integrator merges them into messages/{en,tr}.json). `withGroupC`
// merges them into the real message files for the render tests; once merged it is a no-op merge.
// `saveBar` is group A's (settings §15.1 `settings.saveBar.*`), included here only so the tests render.
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

type Tree = { [k: string]: string | Tree };

export const groupC: { en: Tree; tr: Tree } = {
  en: {
    sender: {
      title: 'Sender profile',
      description: 'This address prints on every label and customs form.',
      group: { business: 'Business', address: 'Address', customs: 'Customs & currency', importer: 'Importer of record', etgb: 'ETGB' },
      field: {
        companyName: 'Company name',
        authorizedPerson: 'Authorized person',
        phone: 'Phone',
        taxNumber: 'Tax number',
        taxType: 'Tax number type',
        address1: 'Address line 1',
        address2: 'Address line 2',
        city: 'City',
        stateRegion: 'State or region',
        postalCode: 'Postal code',
        country: 'Country',
        defaultCurrency: 'Default currency',
        dutiesPaidBy: 'Duties paid by',
        shippingPaidBy: 'Shipping paid by',
        fedexFolderId: 'FedEx folder ID',
        etgbRecipientEmail: 'Recipient email',
      },
      error: { required: 'Fill this in to save', email: 'Enter a valid email address' },
      fixFields: '{count, plural, one {Fix 1 field to save} other {Fix # fields to save}}',
      labelPreview: 'Label preview',
      labelPreviewEmpty: 'Your sender address shows here as it prints on labels.',
      currencyDefaultHelp: 'Not set yet. Labels use {currency} until you choose one.',
      importerHelp: 'Only if someone other than the buyer imports the goods.',
      etgbSwitch: 'Send ETGB documents automatically',
      etgbOn: 'On · sent to {email}',
      etgbOff: 'Off',
      edit: 'Edit',
      loadFailed: "Couldn't load your sender profile",
    },
    preferences: {
      title: 'Preferences',
      description: 'Language and the timezone used for ship-by times and reports.',
      language: 'Language',
      languageHelp: 'Applies to this browser right away.',
      timezone: 'Timezone',
      timezoneHelp: 'Ship-by times and daily reports use this timezone.',
      saved: 'Preferences saved',
      saveFailed: "Couldn't save your timezone. Try again.",
      loadFailed: "Couldn't load your timezone",
      notifications: 'Notifications',
      notificationsLink: 'Notification settings',
    },
    refresh: {
      title: 'Refresh history',
      description: 'Every time KolayXport imported orders from your stores.',
      refreshAll: 'Refresh all orders',
      refreshing: 'Refreshing…',
      alreadyRunning: 'A refresh is already running',
      lastSuccess: 'Last successful refresh: {time} · {sources}',
      lastSuccessNoSources: 'Last successful refresh: {time}',
      col: { type: 'Type', status: 'Status', started: 'Started', duration: 'Duration', orders: 'Orders (processed / ok / failed)' },
      ordersAria: '{processed} processed, {successful} ok, {failed} failed',
      viewErrors: 'View errors',
      retry: 'Retry',
      retrying: 'Retrying…',
      retryBusy: 'Another retry is starting',
      copyErrors: 'Copy error details',
      copied: 'Error details copied',
      copyFailed: "Couldn't copy. Select the text instead.",
      errorsTitle: 'Errors in this refresh',
      orderRef: 'Order #{id}',
      noErrors: 'No errors in this refresh',
      empty: { title: 'No refreshes yet', body: 'Connect a store, then refresh to import your orders.' },
      loadFailed: "Couldn't load refresh history",
      loadMore: 'Load more',
      loadingMore: 'Loading…',
      loadMoreFailed: "Couldn't load more",
      confirm: { title: 'Refresh all orders?', body: 'KolayXport imports every order again from your connected stores. This can take a few minutes.' },
      started: 'Refresh started',
      startFailed: "Couldn't start the refresh. Try again.",
      retryConfirm: { title: 'Retry this refresh?', body: 'KolayXport runs the same refresh again.' },
      retryStarted: 'Retry started',
      retryFailed: "Couldn't start the retry. Try again.",
      types: {
        full: 'Full refresh',
        scheduled: 'Scheduled refresh',
        manual: 'Manual refresh',
        recent: 'Recent orders refresh',
        product: 'Product refresh',
        store: '{store} refresh',
        other: 'Refresh',
      },
    },
    saveBar: { status: 'Unsaved changes', discard: 'Discard', save: 'Save changes', saving: 'Saving…' },
  },
  tr: {
    sender: {
      title: 'Gönderici profili',
      description: 'Bu adres her etikette ve gümrük formunda yazdırılır.',
      group: { business: 'İşletme', address: 'Adres', customs: 'Gümrük ve para birimi', importer: 'Kayıtlı ithalatçı', etgb: 'ETGB' },
      field: {
        companyName: 'Şirket adı',
        authorizedPerson: 'Yetkili kişi',
        phone: 'Telefon',
        taxNumber: 'Vergi numarası',
        taxType: 'Vergi numarası türü',
        address1: 'Adres satırı 1',
        address2: 'Adres satırı 2',
        city: 'Şehir',
        stateRegion: 'Eyalet veya bölge',
        postalCode: 'Posta kodu',
        country: 'Ülke',
        defaultCurrency: 'Varsayılan para birimi',
        dutiesPaidBy: 'Gümrük vergisini ödeyen',
        shippingPaidBy: 'Kargo ücretini ödeyen',
        fedexFolderId: 'FedEx klasör ID',
        etgbRecipientEmail: 'Alıcı e-posta adresi',
      },
      error: { required: 'Kaydetmek için bu alanı doldurun', email: 'Geçerli bir e-posta adresi girin' },
      fixFields: 'Kaydetmek için {count} alanı düzeltin',
      labelPreview: 'Etiket önizlemesi',
      labelPreviewEmpty: 'Gönderici adresiniz burada etikette yazdırıldığı gibi görünür.',
      currencyDefaultHelp: 'Henüz seçilmedi. Siz seçene kadar etiketlerde {currency} kullanılır.',
      importerHelp: 'Yalnızca ürünleri alıcıdan başka biri ithal ediyorsa.',
      etgbSwitch: 'ETGB belgelerini otomatik gönder',
      etgbOn: 'Açık · {email} adresine gönderilir',
      etgbOff: 'Kapalı',
      edit: 'Düzenle',
      loadFailed: 'Gönderici profiliniz yüklenemedi',
    },
    preferences: {
      title: 'Tercihler',
      description: 'Dil ve kargo son tarihleri ile raporlarda kullanılan saat dilimi.',
      language: 'Dil',
      languageHelp: 'Bu tarayıcıda hemen uygulanır.',
      timezone: 'Saat dilimi',
      timezoneHelp: 'Kargo son tarihleri ve günlük raporlar bu saat dilimini kullanır.',
      saved: 'Tercihler kaydedildi',
      saveFailed: 'Saat diliminiz kaydedilemedi. Tekrar deneyin.',
      loadFailed: 'Saat diliminiz yüklenemedi',
      notifications: 'Bildirimler',
      notificationsLink: 'Bildirim ayarları',
    },
    refresh: {
      title: 'Yenileme geçmişi',
      description: "KolayXport'un mağazalarınızdan sipariş aktardığı her seferi gösterir.",
      refreshAll: 'Tüm siparişleri yenile',
      refreshing: 'Yenileniyor…',
      alreadyRunning: 'Zaten bir yenileme çalışıyor',
      lastSuccess: 'Son başarılı yenileme: {time} · {sources}',
      lastSuccessNoSources: 'Son başarılı yenileme: {time}',
      col: { type: 'Tür', status: 'Durum', started: 'Başlangıç', duration: 'Süre', orders: 'Siparişler (işlenen / başarılı / hatalı)' },
      ordersAria: '{processed} işlendi, {successful} başarılı, {failed} hatalı',
      viewErrors: 'Hataları gör',
      retry: 'Tekrar dene',
      retrying: 'Tekrar deneniyor…',
      retryBusy: 'Başka bir yeniden deneme başlatılıyor',
      copyErrors: 'Hata ayrıntılarını kopyala',
      copied: 'Hata ayrıntıları kopyalandı',
      copyFailed: 'Kopyalanamadı. Metni seçerek kopyalayın.',
      errorsTitle: 'Bu yenilemedeki hatalar',
      orderRef: 'Sipariş #{id}',
      noErrors: 'Bu yenilemede hata yok',
      empty: { title: 'Henüz yenileme yok', body: 'Bir mağaza bağlayın, ardından siparişlerinizi aktarmak için yenileyin.' },
      loadFailed: 'Yenileme geçmişi yüklenemedi',
      loadMore: 'Daha fazla göster',
      loadingMore: 'Yükleniyor…',
      loadMoreFailed: 'Daha fazlası yüklenemedi',
      confirm: { title: 'Tüm siparişler yenilensin mi?', body: 'KolayXport bağlı mağazalarınızdaki tüm siparişleri yeniden aktarır. Bu birkaç dakika sürebilir.' },
      started: 'Yenileme başladı',
      startFailed: 'Yenileme başlatılamadı. Tekrar deneyin.',
      retryConfirm: { title: 'Bu yenileme tekrar denensin mi?', body: 'KolayXport aynı yenilemeyi yeniden çalıştırır.' },
      retryStarted: 'Yeniden deneme başladı',
      retryFailed: 'Yeniden deneme başlatılamadı. Tekrar deneyin.',
      types: {
        full: 'Tam yenileme',
        scheduled: 'Zamanlanmış yenileme',
        manual: 'Elle yenileme',
        recent: 'Son siparişleri yenileme',
        product: 'Ürün yenileme',
        store: '{store} yenilemesi',
        other: 'Yenileme',
      },
    },
    saveBar: { status: 'Kaydedilmemiş değişiklikler', discard: 'Vazgeç', save: 'Değişiklikleri kaydet', saving: 'Kaydediliyor…' },
  },
};

/** Keys group C returns as newI18nKeys (everything except group A's saveBar). */
export const GROUP_C_OWNED = ['sender', 'preferences', 'refresh'] as const;

function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const cur = out[k];
    out[k] = typeof v === 'object' && cur && typeof cur === 'object' ? merge(cur, v) : v;
  }
  return out;
}

export function withGroupC(locale: 'en' | 'tr'): Tree {
  const base = (locale === 'en' ? en : tr) as unknown as Tree;
  return merge(base, { settings: merge((base.settings as Tree) ?? {}, groupC[locale]) });
}

/** Flattens a tree to dotted keys ("sender.field.city"). */
export function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
