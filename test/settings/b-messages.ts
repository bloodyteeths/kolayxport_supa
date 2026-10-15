// Settings Group B (Connections + Carriers & API keys) i18n keys, EN + TR. The integrator merges these into
// messages/*.json (BUILD_PLAN §0.2); until then the Group B tests layer them over the real files.
// Every key here is returned in the Group B result's `newI18nKeys` (namespace `settings`).
export const settingsBEn = {
  connections: {
    title: 'Connections',
    description: 'Connect stores, carriers and tools. KolayXport reads orders and sends tracking through these.',
    group: { marketplaces: 'Stores', shipping: 'Shipping', accounting: 'Accounting', tools: 'Tools' },
    storesUsed: 'Stores · {used} of {limit} used',
    comparePlans: 'Compare plans',
    reauthBanner: {
      one: '{provider} needs reconnecting. Orders from {account} stopped on {date}.',
      oneNoDate: "{provider} needs reconnecting. Orders from {account} aren't coming in.",
      many: '{count} connections need attention.',
      reconnect: 'Reconnect {provider}',
      review: 'Review {count} connections',
    },
    loadFailed: "Couldn't check your connections",
    stale: 'Showing status from {time}',
    action: {
      connect: 'Connect {provider}', setUp: 'Set up', finishSetup: 'Finish setup', reconnect: 'Reconnect',
      manage: 'Manage', contactSupport: 'Contact support', checkAgain: 'Check again',
    },
    menu: {
      more: 'More actions for {provider}', refreshAll: 'Refresh all orders', guide: 'View setup guide',
      disconnect: 'Disconnect {provider}…', removeCredentials: 'Remove credentials…',
    },
    disconnectConfirm: { title: 'Disconnect {provider}?', confirm: 'Disconnect' },
    refreshConfirm: {
      title: 'Refresh all orders?',
      body: 'KolayXport imports orders from every connected store. This can take a few minutes.',
    },
    removeConfirm: {
      title: 'Remove {provider} credentials?',
      body: 'KolayXport stops using {provider} until you add them again. Your past data stays.',
      confirm: 'Remove',
    },
    toast: {
      disconnected: '{provider} disconnected',
      disconnectFailed: "Couldn't disconnect {provider}. Try again.",
      refreshStarted: 'Refresh started. Follow it in Refresh history.',
      refreshFailed: "Couldn't start the refresh",
      credentialsRemoved: '{provider} credentials removed',
      removeFailed: "Couldn't remove {provider} credentials",
    },
    pageAction: { connectStore: 'Connect a store' },
    panel: { close: 'Close' },
    meta: {
      shops: '{count, plural, one {# shop} other {# shops}}',
      refreshed: 'Refreshed {time}',
      lastActivity: 'Last activity {time}',
      notDetected: 'Not detected in this browser',
      installExtension: 'Install extension',
      supportManaged: 'Set up by our support team',
      missingField: '{field} missing',
      wixWaiting: 'Waiting for Wix… {elapsed}',
    },
    reason: { authExpired: 'Authorization expired', incomplete: 'Incomplete credentials' },
    blurb: {
      etsy: 'Orders, listings, research',
      ebay: 'Orders, listings, research',
      amazon: 'Orders and finance',
      shopify: 'Orders and products',
      wix: 'Orders, products and messages',
      trendyol: 'Orders, questions and finance',
      hepsiburada: 'Orders',
      veeqo: 'Orders from Veeqo channels',
      shippo: 'Orders and labels',
      fedex: 'International labels and rates',
      ups: 'International labels and rates',
      mng: 'Turkey domestic labels',
      parasut: 'Invoices to Paraşüt',
      chrome: 'Sends tracking to Etsy and fills buyer details',
    },
    etsyPanel: {
      title: 'Etsy shops', shopId: 'Shop ID {id}', connectAnother: 'Connect another shop',
      limitReached: 'Store limit reached', empty: 'No Etsy shops yet',
    },
    amazonPanel: { connect: 'Connect Amazon', save: 'Save marketplaces' },
    shopifyPanel: { storeAddress: 'Store address', connect: 'Connect Shopify', enterAddress: 'Enter your store address first' },
    storeLimit: {
      title: "You've used all {limit} store slots",
      body: '{plan} includes {limit} connected stores. Disconnect a store or move to {nextPlan} for {nextLimit}.',
      neutralTitle: 'Store limit reached',
      neutralBody: 'Disconnect a store to add a new one.',
      notNow: 'Not now',
      ok: 'OK',
    },
  },
  credentials: {
    title: 'Carriers & API keys',
    description: 'Keys for services that don\'t use a "Connect" button. They\'re stored encrypted.',
    configure: 'Configure',
    whereToFind: 'Where do I find these?',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    loading: 'Loading your saved keys…',
    loadFailed: "Couldn't load your saved keys",
    loadFailedReason: "Your saved keys didn't load. Retry first.",
    saved: '{provider} keys saved',
    saveFailed: "Couldn't save. Your keys weren't changed.",
    fixFields: '{count, plural, one {Fix 1 field to continue} other {Fix # fields to continue}}',
    requiredWith: 'Enter the {field} too',
    digitsOnly: 'Use digits only',
    field: {
      apiKey: 'API key', apiSecret: 'API secret', supplierId: 'Supplier ID', token: 'API token',
      accountNumber: 'Account number', mngCustomerNumber: 'Customer number', mngPassword: 'Password',
      clientId: 'Client ID', clientSecret: 'Client secret', username: 'Username', password: 'Password',
      companyId: 'Company ID',
    },
  },
} as const;

export const settingsBTr = {
  connections: {
    title: 'Bağlantılar',
    description: 'Mağazalarınızı, kargo firmalarınızı ve araçlarınızı bağlayın. KolayXport siparişleri bunlar üzerinden okur ve takip numaralarını bunlar üzerinden gönderir.',
    group: { marketplaces: 'Mağazalar', shipping: 'Kargo', accounting: 'Muhasebe', tools: 'Araçlar' },
    storesUsed: 'Mağazalar · {limit} haktan {used} tanesi kullanılıyor',
    comparePlans: 'Planları karşılaştır',
    reauthBanner: {
      one: '{provider} yeniden bağlanmalı. {account} siparişleri {date} tarihinde durdu.',
      oneNoDate: '{provider} yeniden bağlanmalı. {account} siparişleri gelmiyor.',
      many: '{count} bağlantı dikkat gerektiriyor.',
      reconnect: '{provider} hesabını yeniden bağla',
      review: '{count} bağlantıyı incele',
    },
    loadFailed: 'Bağlantılarınız kontrol edilemedi',
    stale: '{time} itibarıyla durum gösteriliyor',
    action: {
      connect: '{provider} bağla', setUp: 'Kur', finishSetup: 'Kurulumu tamamla', reconnect: 'Yeniden bağla',
      manage: 'Yönet', contactSupport: 'Destekle iletişime geç', checkAgain: 'Tekrar kontrol et',
    },
    menu: {
      more: '{provider} için diğer işlemler', refreshAll: 'Tüm siparişleri yenile', guide: 'Kurulum rehberini aç',
      disconnect: '{provider} bağlantısını kes…', removeCredentials: 'Bilgileri kaldır…',
    },
    disconnectConfirm: { title: '{provider} bağlantısı kesilsin mi?', confirm: 'Bağlantıyı kes' },
    refreshConfirm: {
      title: 'Tüm siparişler yenilensin mi?',
      body: 'KolayXport bağlı tüm mağazalarınızdan siparişleri aktarır. Bu birkaç dakika sürebilir.',
    },
    removeConfirm: {
      title: '{provider} bilgileri kaldırılsın mı?',
      body: 'Tekrar ekleyene kadar KolayXport {provider} kullanmaz. Geçmiş verileriniz silinmez.',
      confirm: 'Kaldır',
    },
    toast: {
      disconnected: '{provider} bağlantısı kesildi',
      disconnectFailed: '{provider} bağlantısı kesilemedi. Tekrar deneyin.',
      refreshStarted: 'Yenileme başladı. Yenileme geçmişinden takip edebilirsiniz.',
      refreshFailed: 'Yenileme başlatılamadı',
      credentialsRemoved: '{provider} bilgileri kaldırıldı',
      removeFailed: '{provider} bilgileri kaldırılamadı',
    },
    pageAction: { connectStore: 'Mağaza bağla' },
    panel: { close: 'Kapat' },
    meta: {
      shops: '{count} mağaza',
      refreshed: '{time} yenilendi',
      lastActivity: 'Son etkinlik {time}',
      notDetected: 'Bu tarayıcıda bulunamadı',
      installExtension: 'Eklentiyi yükle',
      supportManaged: 'Destek ekibimiz tarafından kurulur',
      missingField: '{field} eksik',
      wixWaiting: 'Wix bekleniyor… {elapsed}',
    },
    reason: { authExpired: 'Yetki süresi doldu', incomplete: 'Bilgiler eksik' },
    blurb: {
      etsy: 'Siparişler, ilanlar, araştırma',
      ebay: 'Siparişler, ilanlar, araştırma',
      amazon: 'Siparişler ve finans',
      shopify: 'Siparişler ve ürünler',
      wix: 'Siparişler, ürünler ve mesajlar',
      trendyol: 'Siparişler, sorular ve finans',
      hepsiburada: 'Siparişler',
      veeqo: 'Veeqo kanallarından siparişler',
      shippo: 'Siparişler ve etiketler',
      fedex: 'Uluslararası etiketler ve fiyatlar',
      ups: 'Uluslararası etiketler ve fiyatlar',
      mng: 'Yurt içi etiketler',
      parasut: "Paraşüt'e faturalar",
      chrome: "Takip numarasını Etsy'ye gönderir, alıcı bilgilerini tamamlar",
    },
    etsyPanel: {
      title: 'Etsy mağazaları', shopId: 'Mağaza ID {id}', connectAnother: 'Başka bir mağaza bağla',
      limitReached: 'Mağaza sınırına ulaşıldı', empty: 'Henüz Etsy mağazası yok',
    },
    amazonPanel: { connect: 'Amazon bağla', save: 'Pazaryerlerini kaydet' },
    shopifyPanel: { storeAddress: 'Mağaza adresi', connect: 'Shopify bağla', enterAddress: 'Önce mağaza adresinizi girin' },
    storeLimit: {
      title: '{limit} mağaza hakkının tamamını kullandınız',
      body: '{plan} planı {limit} bağlı mağaza içerir. Bir mağazanın bağlantısını kesin ya da {nextLimit} mağaza için {nextPlan} planına geçin.',
      neutralTitle: 'Mağaza sınırına ulaşıldı',
      neutralBody: 'Yeni bir mağaza eklemek için bir mağazanın bağlantısını kesin.',
      notNow: 'Şimdi değil',
      ok: 'Tamam',
    },
  },
  credentials: {
    title: 'Kargo ve API anahtarları',
    description: '"Bağla" düğmesi olmayan servislerin anahtarları. Şifrelenmiş olarak saklanır.',
    configure: 'Düzenle',
    whereToFind: 'Bunları nerede bulurum?',
    save: 'Kaydet',
    saving: 'Kaydediliyor…',
    cancel: 'Vazgeç',
    loading: 'Kayıtlı anahtarlarınız yükleniyor…',
    loadFailed: 'Kayıtlı anahtarlarınız yüklenemedi',
    loadFailedReason: 'Kayıtlı anahtarlarınız yüklenmedi. Önce tekrar deneyin.',
    saved: '{provider} anahtarları kaydedildi',
    saveFailed: 'Kaydedilemedi. Anahtarlarınız değişmedi.',
    fixFields: 'Devam etmek için {count} alanı düzeltin',
    requiredWith: '{field} alanını da girin',
    digitsOnly: 'Yalnızca rakam kullanın',
    field: {
      apiKey: 'API anahtarı', apiSecret: 'API gizli anahtarı', supplierId: 'Satıcı ID', token: 'API token',
      accountNumber: 'Hesap numarası', mngCustomerNumber: 'Müşteri numarası', mngPassword: 'Şifre',
      clientId: 'İstemci ID', clientSecret: 'İstemci gizli anahtarı', username: 'Kullanıcı adı', password: 'Şifre',
      companyId: 'Firma ID',
    },
  },
} as const;

/** Flattened `{ namespace: 'settings', key, en, tr }[]` (the shape the integrator merges). */
export function flattenSettingsB(): { namespace: string; key: string; en: string; tr: string }[] {
  const out: { namespace: string; key: string; en: string; tr: string }[] = [];
  const walk = (en: Record<string, unknown>, tr: Record<string, unknown>, prefix: string) => {
    for (const k of Object.keys(en)) {
      const e = en[k];
      const r = tr[k];
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof e === 'string') out.push({ namespace: 'settings', key, en: e, tr: String(r) });
      else walk(e as Record<string, unknown>, (r ?? {}) as Record<string, unknown>, key);
    }
  };
  walk(settingsBEn as unknown as Record<string, unknown>, settingsBTr as unknown as Record<string, unknown>, '');
  return out;
}
