// messages §7 keys used by G5 (list + page), returned as newI18nKeys for the integrator; mirrored here so
// the tests run before the merge. `platformBanners.*` replaces §7's `platformErrors.*` so the legacy page's
// copy (same key names, different text) stays untouched during the flag period.
export const G5_EN = {
  messages: {
    title: 'Messages',
    overflow: { manageSaved: 'Manage saved replies' },
    cmd: { nextNeedsReply: 'Go to next message needing reply' },
    views: { needsReply: 'Needs reply', unread: 'Unread', all: 'All' },
    filters: { store: 'Store', storeAll: 'All' },
    search: {
      placeholder: 'Search name, message or product',
      loadedOnly: 'Searching {count} loaded conversations · Load more to search older',
    },
    list: {
      count: '{count, plural, one {# conversation} other {# conversations}}',
      loadMore: 'Load more',
      customerFallback: 'Customer',
      youPrefix: 'You:',
      noText: 'No message text',
      timeUnknown: 'Time unknown',
      unreadLabel: 'Unread',
      regionLabel: 'Conversations',
    },
    thread: { prev: 'Previous conversation', next: 'Next conversation' },
    empty: {
      connect: {
        title: 'Answer Wix and Trendyol customers in one place',
        body: 'Connect a store to see messages and product questions here.',
        action: 'Connect a store',
      },
      done: { title: 'Every message has a reply', body: 'New messages show up here within 2 minutes.' },
      none: { title: 'No messages yet' },
      noResults: { title: 'No conversations match', action: 'Clear filters' },
    },
    error: { list: { title: "Couldn't load messages" } },
    platformBanners: {
      permission: 'Wix inbox access is missing. Reconnect Wix to allow messages.',
      auth: '{name} connection expired.',
      credentials: '{name} setup is incomplete.',
      rateLimited: '{name} is busy right now. Showing earlier messages.',
      unavailable: "Couldn't load {name} messages.",
      reconnect: 'Reconnect {name}',
      finishSetup: 'Finish setup',
      retry: 'Try again',
    },
  },
};

export const G5_TR = {
  messages: {
    title: 'Mesajlar',
    overflow: { manageSaved: 'Hazır yanıtları yönet' },
    cmd: { nextNeedsReply: 'Yanıt bekleyen sonraki mesaja git' },
    views: { needsReply: 'Yanıt bekleyenler', unread: 'Okunmamış', all: 'Tümü' },
    filters: { store: 'Mağaza', storeAll: 'Tümü' },
    search: {
      placeholder: 'İsim, mesaj veya ürün ara',
      loadedOnly: 'Yüklenen {count} konuşmada aranıyor · Eskileri aramak için daha fazla yükleyin',
    },
    list: {
      count: '{count} konuşma',
      loadMore: 'Daha fazla yükle',
      customerFallback: 'Müşteri',
      youPrefix: 'Siz:',
      noText: 'Mesaj metni yok',
      timeUnknown: 'Zaman bilinmiyor',
      unreadLabel: 'Okunmadı',
      regionLabel: 'Konuşmalar',
    },
    thread: { prev: 'Önceki konuşma', next: 'Sonraki konuşma' },
    empty: {
      connect: {
        title: 'Wix ve Trendyol müşterilerinizi tek yerden yanıtlayın',
        body: 'Mesajları ve ürün sorularını burada görmek için bir mağaza bağlayın.',
        action: 'Mağaza bağla',
      },
      done: { title: 'Tüm mesajlar yanıtlandı', body: 'Yeni mesajlar 2 dakika içinde burada görünür.' },
      none: { title: 'Henüz mesaj yok' },
      noResults: { title: 'Eşleşen konuşma yok', action: 'Filtreleri temizle' },
    },
    error: { list: { title: 'Mesajlar yüklenemedi' } },
    platformBanners: {
      permission: "Wix gelen kutusu erişimi eksik. Mesajlara izin vermek için Wix'i yeniden bağlayın.",
      auth: '{name} bağlantısının süresi doldu.',
      credentials: '{name} kurulumu eksik.',
      rateLimited: '{name} şu an yoğun. Önceki mesajlar gösteriliyor.',
      unavailable: '{name} mesajları yüklenemedi.',
      reconnect: '{name} hesabını yeniden bağla',
      finishSetup: 'Kurulumu tamamla',
      retry: 'Tekrar dene',
    },
  },
};
