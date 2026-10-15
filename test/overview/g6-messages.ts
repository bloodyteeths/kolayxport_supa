// overview G6 i18n keys (overview §5 + G6 additions). Returned as newI18nKeys for the integrator (BUILD_PLAN §0.2);
// mirrored here so the render tests run before the merge. Every key here is in the G6 newI18nKeys list.
export const G6_EN = {
  "overview": {
    "actions": {
      "addManualOrder": "Add manual order",
      "connectStore": "Connect a store",
      "goToOrders": "Go to orders",
      "goToOrdersCount": "Go to orders ({count})",
      "newListing": "New listing",
      "refreshOrders": "Refresh orders",
      "reports": "Reports",
      "research": "Research"
    },
    "attention": {
      "checkFailed": "Couldn't check {sections}",
      "count": "{count, plural, one {# item needs attention} other {# items need attention}}",
      "conflict": {
        "cta": "Review",
        "detail": "Changed on {marketplace} since your draft",
        "title": "{count, plural, one {# listing changed on {marketplace} since your draft} other {# listings changed on {marketplace} since your draft}}"
      },
      "doneBody": "Nothing needs your attention right now.",
      "doneTitle": "All caught up",
      "doneWithErrors": "Nothing else needs attention · {count, plural, one {# check} other {# checks}} failed",
      "health": {
        "cta": "Open Listing doctor",
        "ctaLegacy": "Show listings",
        "title": "{count, plural, one {# listing under 50} other {# listings under 50}}"
      },
      "labelsFailed": {
        "cta": "Review",
        "title": "{count, plural, one {# label failed} other {# labels failed}}"
      },
      "loadFailed": "Couldn't load your overview",
      "more": "+{count} more",
      "noOrdersBody": "Bring in your orders from your connected stores.",
      "noOrdersTitle": "No orders yet",
      "notConnectedTitle": "Connect a store to see what needs your attention",
      "notSent": {
        "cta": "Review & send",
        "title": "{count, plural, one {# listing with changes not sent to {marketplace}} other {# listings with changes not sent to {marketplace}}}"
      },
      "overdue": {
        "cta": "Create label",
        "title": "{count, plural, one {# order overdue} other {# orders overdue}}"
      },
      "paused": {
        "cta": "See plans",
        "reason": "{reason, select, trial {Your trial has ended} noSubscription {No active plan} planLimit {Plan limit reached} invalidPlan {Your plan needs attention} other {Plan issue}}",
        "supportCta": "Contact support",
        "limitReason": "{reason, select, trial {Trial limits reached} other {Plan limits reached}}",
        "title": "Order syncs and labels are paused",
        "titleLabels": "Labels are paused",
        "titleOrderSync": "Order syncs are paused"
      },
      "reconnect": {
        "cta": "Reconnect {provider}"
      },
      "refreshOrders": "Refresh orders",
      "sendFailed": {
        "cta": "Open",
        "title": "{count, plural, one {# listing couldn't be sent to {marketplace}} other {# listings couldn't be sent to {marketplace}}}"
      },
      "showLess": "Show less",
      "showMore": "Show {count} more",
      "syncFailing": {
        "cta": "View"
      },
      "title": "Needs your attention",
      "tracking": {
        "cta": "Review",
        "detail": "Labels created, tracking not sent to Etsy",
        "setupCta": "Set up extension",
        "title": "{count, plural, one {# Etsy order} other {# Etsy orders}}"
      },
      "trialEnds": "Trial ends in {days, plural, one {# day} other {# days}}",
      "usage": {
        "cta": "See plans",
        "detail": "{kind, select, orderSync {Order syncs} other {Labels}}: {used} of {limit} used"
      }
    },
    "best": {
      "colProduct": "Product",
      "colUnits": "Units",
      "empty": "No sales in the last 7 days",
      "loadFailed": "Couldn't load best sellers",
      "source": "Orders · grouped by SKU · units in orders, not listing sales",
      "title": "Best sellers (7 days)",
      "units": "{count, plural, one {# unit} other {# units}}"
    },
    "chart": {
      "empty": "No orders in the last 14 days",
      "loadFailed": "Couldn't load the orders chart",
      "source": "Orders · by order date · {tz}",
      "title": "Orders, last 14 days",
      "total": "{count, plural, one {# order} other {# orders}}",
      "vsPrev14": "vs previous 14 days"
    },
    "greeting": {
      "afternoon": "Good afternoon, {name}",
      "afternoonNoName": "Good afternoon",
      "evening": "Good evening, {name}",
      "eveningNoName": "Good evening",
      "morning": "Good morning, {name}",
      "morningNoName": "Good morning"
    },
    "kpi": {
      "dueToday": "{count} due today",
      "fxExcluded": "Not included: {list}",
      "fxExcludedItem": "{currency} ({count, plural, one {# order} other {# orders}})",
      "fxNote": "Converted at exchangerate-api.com rates, {date}",
      "fxStale": "Rates may be out of date",
      "loadFailed": "Couldn't load · Retry",
      "messagesFailed": "Couldn't check messages",
      "needsReply": "Needs reply",
      "new": "New",
      "noneOverdue": "None",
      "orders7d": "Orders (7 days)",
      "overdue": "Overdue",
      "revenue7d": "Revenue (7 days)",
      "sourceMessages": "Messages",
      "sourceOrders": "Orders",
      "sourceOrdersFx": "Orders · FX",
      "toShip": "To ship",
      "vsPrev7": "vs previous 7 days",
      "withoutShipBy": "{count} without a ship-by date"
    },
    "meta": {
      "ordersNeverRefreshed": "Orders not refreshed yet",
      "ordersRefreshed": "Orders refreshed {time}",
      "refreshPaused": "Order syncs are paused: see plans",
      "refreshPausedSupport": "Order syncs are paused: contact support",
      "refreshQuota": "Uses 1 of your {limit} order syncs ({used} used)",
      "refreshing": "Refreshing orders…",
      "updated": "Updated {time}"
    },
    "pageTitle": "Overview",
    "reason": {
      "incomplete_credentials": "Credentials incomplete",
      "missing_refresh_token": "Authorization incomplete",
      "reauth_required": "Access was revoked",
      "refresh_token_expired": "Authorization expired",
      "token_expired_no_refresh": "Access expired"
    },
    "section": {
      "sources": {
        "drafts": "listing drafts",
        "labels": "label failures",
        "listingHealth": "listing health",
        "toShip": "orders to ship",
        "tracking": "tracking",
        "usage": "plan usage"
      }
    },
    "setup": {
      "connect": {
        "desc": "Link Etsy, eBay, Amazon, Shopify, Wix or Trendyol to bring in orders and listings.",
        "doneDesc": "{name} connected",
        "title": "Connect a store"
      },
      "hide": "Hide setup",
      "label": {
        "ctaCarrier": "Connect a carrier",
        "ctaCreate": "Create label",
        "descNoCarrier": "Connect FedEx, UPS or DHL eCommerce first.",
        "descNoOrders": "Bring in your orders first.",
        "descReady": "Pick an order and create its label.",
        "title": "Create your first label"
      },
      "progress": "{done} of {total} done",
      "quota": "Uses 1 of your {limit} order syncs.",
      "sender": {
        "cta": "Add address",
        "desc": "Printed as the return address on every label.",
        "title": "Set your sender address"
      },
      "title": "Get started"
    },
    "stores": {
      "connect": "Connect a store",
      "manage": "Manage stores",
      "refreshed": "Refreshed {time}",
      "title": "Stores"
    },
    "subscriptionActivated": "Your subscription is active",
    "subtitle": {
      "allStores": "All stores"
    },
    "toast": {
      "refreshFailed": "Couldn't refresh orders"
    }
  }
} as const;

export const G6_TR = {
  "overview": {
    "actions": {
      "addManualOrder": "Manuel sipariş ekle",
      "connectStore": "Mağaza bağla",
      "goToOrders": "Siparişlere git",
      "goToOrdersCount": "Siparişlere git ({count})",
      "newListing": "Yeni ilan",
      "refreshOrders": "Siparişleri yenile",
      "reports": "Raporlar",
      "research": "Pazar araştırması"
    },
    "attention": {
      "checkFailed": "{sections} kontrol edilemedi",
      "count": "{count} öğe ilgi bekliyor",
      "conflict": {
        "cta": "İncele",
        "detail": "Taslağınızdan sonra {marketplace}'de değişti",
        "title": "{count} ilan taslağınızdan sonra {marketplace}'de değişti"
      },
      "doneBody": "Şu anda ilgilenmeniz gereken bir şey yok.",
      "doneTitle": "Her şey yolunda",
      "doneWithErrors": "Başka bir şey yok · {count} kontrol başarısız oldu",
      "health": {
        "cta": "İlan doktorunu aç",
        "ctaLegacy": "İlanları göster",
        "title": "50'nin altında {count} ilan"
      },
      "labelsFailed": {
        "cta": "İncele",
        "title": "{count} etiket oluşturulamadı"
      },
      "loadFailed": "Genel bakış yüklenemedi",
      "more": "+{count} tane daha",
      "noOrdersBody": "Bağlı mağazalarınızdaki siparişleri getirin.",
      "noOrdersTitle": "Henüz sipariş yok",
      "notConnectedTitle": "Neyle ilgilenmeniz gerektiğini görmek için bir mağaza bağlayın",
      "notSent": {
        "cta": "İncele ve gönder",
        "title": "{count} ilanda {marketplace}'e gönderilmemiş değişiklik var"
      },
      "overdue": {
        "cta": "Etiket oluştur",
        "title": "{count} sipariş gecikti"
      },
      "paused": {
        "cta": "Planları gör",
        "reason": "{reason, select, trial {Deneme süreniz bitti} noSubscription {Aktif plan yok} planLimit {Plan limitine ulaşıldı} invalidPlan {Planınızla ilgili bir sorun var} other {Plan sorunu}}",
        "supportCta": "Destekle iletişime geç",
        "limitReason": "{reason, select, trial {Deneme limitlerine ulaşıldı} other {Plan limitlerine ulaşıldı}}",
        "title": "Sipariş senkronu ve etiketler durduruldu",
        "titleLabels": "Etiket oluşturma durduruldu",
        "titleOrderSync": "Sipariş senkronu durduruldu"
      },
      "reconnect": {
        "cta": "{provider} bağlantısını yenile"
      },
      "refreshOrders": "Siparişleri yenile",
      "sendFailed": {
        "cta": "Aç",
        "title": "{count} ilan {marketplace}'e gönderilemedi"
      },
      "showLess": "Daha az göster",
      "showMore": "{count} tane daha göster",
      "syncFailing": {
        "cta": "Görüntüle"
      },
      "title": "İlgilenmeniz gerekenler",
      "tracking": {
        "cta": "İncele",
        "detail": "Etiket oluşturuldu, takip numarası Etsy'ye gönderilmedi",
        "setupCta": "Eklentiyi kur",
        "title": "{count} Etsy siparişi"
      },
      "trialEnds": "Deneme süresi {days} gün içinde bitiyor",
      "usage": {
        "cta": "Planları gör",
        "detail": "{kind, select, orderSync {Sipariş senkronu} other {Etiket}}: {limit} hakkın {used} tanesi kullanıldı"
      }
    },
    "best": {
      "colProduct": "Ürün",
      "colUnits": "Adet",
      "empty": "Son 7 günde satış yok",
      "loadFailed": "En çok satanlar yüklenemedi",
      "source": "Siparişler · SKU'ya göre · siparişteki adet, ilan satışı değil",
      "title": "En çok satanlar (7 gün)",
      "units": "{count} adet"
    },
    "chart": {
      "empty": "Son 14 günde sipariş yok",
      "loadFailed": "Sipariş grafiği yüklenemedi",
      "source": "Siparişler · sipariş tarihine göre · {tz}",
      "title": "Siparişler, son 14 gün",
      "total": "{count} sipariş",
      "vsPrev14": "önceki 14 güne göre"
    },
    "greeting": {
      "afternoon": "İyi günler, {name}",
      "afternoonNoName": "İyi günler",
      "evening": "İyi akşamlar, {name}",
      "eveningNoName": "İyi akşamlar",
      "morning": "Günaydın, {name}",
      "morningNoName": "Günaydın"
    },
    "kpi": {
      "dueToday": "{count} tanesi bugün gönderilmeli",
      "fxExcluded": "Dahil edilmedi: {list}",
      "fxExcludedItem": "{currency} ({count} sipariş)",
      "fxNote": "exchangerate-api.com kurlarıyla çevrildi, {date}",
      "fxStale": "Kurlar güncel olmayabilir",
      "loadFailed": "Yüklenemedi · Tekrar dene",
      "messagesFailed": "Mesajlar kontrol edilemedi",
      "needsReply": "Yanıt bekleyen",
      "new": "Yeni",
      "noneOverdue": "Yok",
      "orders7d": "Siparişler (7 gün)",
      "overdue": "Geciken",
      "revenue7d": "Ciro (7 gün)",
      "sourceMessages": "Mesajlar",
      "sourceOrders": "Siparişler",
      "sourceOrdersFx": "Siparişler · Kur",
      "toShip": "Gönderilecek",
      "vsPrev7": "önceki 7 güne göre",
      "withoutShipBy": "{count} tanesinin son gönderim tarihi yok"
    },
    "meta": {
      "ordersNeverRefreshed": "Siparişler henüz yenilenmedi",
      "ordersRefreshed": "Siparişler {time} yenilendi",
      "refreshPaused": "Sipariş senkronu durduruldu: planlara göz atın",
      "refreshPausedSupport": "Sipariş senkronu durduruldu: destekle iletişime geçin",
      "refreshQuota": "{limit} sipariş senkronu hakkınızdan 1 tanesini kullanır ({used} kullanıldı)",
      "refreshing": "Siparişler yenileniyor…",
      "updated": "{time} güncellendi"
    },
    "pageTitle": "Genel bakış",
    "reason": {
      "incomplete_credentials": "Bilgiler eksik",
      "missing_refresh_token": "Yetkilendirme eksik",
      "reauth_required": "Erişim iptal edildi",
      "refresh_token_expired": "Yetki süresi doldu",
      "token_expired_no_refresh": "Erişim süresi doldu"
    },
    "section": {
      "sources": {
        "drafts": "ilan taslakları",
        "labels": "etiket hataları",
        "listingHealth": "ilan sağlığı",
        "toShip": "gönderilecek siparişler",
        "tracking": "takip numaraları",
        "usage": "plan kullanımı"
      }
    },
    "setup": {
      "connect": {
        "desc": "Siparişleri ve ilanları getirmek için Etsy, eBay, Amazon, Shopify, Wix veya Trendyol bağlayın.",
        "doneDesc": "{name} bağlandı",
        "title": "Mağaza bağlayın"
      },
      "hide": "Kurulumu gizle",
      "label": {
        "ctaCarrier": "Kargo firması bağla",
        "ctaCreate": "Etiket oluştur",
        "descNoCarrier": "Önce FedEx, UPS veya DHL eCommerce bağlayın.",
        "descNoOrders": "Önce siparişlerinizi getirin.",
        "descReady": "Bir sipariş seçin ve etiketini oluşturun.",
        "title": "İlk etiketinizi oluşturun"
      },
      "progress": "{total} adımdan {done} tamamlandı",
      "quota": "{limit} sipariş senkronu hakkınızdan 1 tanesini kullanır.",
      "sender": {
        "cta": "Adres ekle",
        "desc": "Her etikette iade adresi olarak basılır.",
        "title": "Gönderici adresinizi girin"
      },
      "title": "Başlayın"
    },
    "stores": {
      "connect": "Mağaza bağla",
      "manage": "Mağazaları yönet",
      "refreshed": "{time} yenilendi",
      "title": "Mağazalar"
    },
    "subscriptionActivated": "Aboneliğiniz aktif",
    "subtitle": {
      "allStores": "Tüm mağazalar"
    },
    "toast": {
      "refreshFailed": "Siparişler yenilenemedi"
    }
  }
} as const;
