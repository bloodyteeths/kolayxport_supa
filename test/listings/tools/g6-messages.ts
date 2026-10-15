// test/listings/tools/g6-messages.ts — listings §12 keys used by the G6 tools (merged into messages/*.json by the integrator).
export const G6_EN = {
  "listings": {
    "tools": {
      "menu": "Tools",
      "findReplace": "Find & replace",
      "duplicates": "Find duplicates",
      "import": "Import CSV",
      "export": "Export CSV",
      "scheduled": "Scheduled sends",
      "activity": "Activity",
      "loadFailed": "Couldn't load this",
      "staged": "{count, plural, one {# change staged} other {# changes staged}} · send when you're ready",
      "stageFailed": "{count, plural, one {# change couldn't be saved} other {# changes couldn't be saved}}. Try again.",
      "findReplaceUnavailable": "Only price and stock can be staged here, so there is no text to find and replace"
    },
    "mp": {
      "to": "{marketplace, select, etsy {Etsy} ebay {eBay} trendyol {Trendyol} wix {Wix} shopify {Shopify} other {the store}}",
      "on": "{marketplace, select, etsy {Etsy} ebay {eBay} trendyol {Trendyol} wix {Wix} shopify {Shopify} other {the store}}"
    },
    "send": {
      "toastResult": "{sent} sent to {to}{failed, plural, =0 {} other { · # failed}}"
    },
    "action": {
      "openEditor": "Open editor",
      "deactivate": "Deactivate",
      "hideInStore": "Hide from store",
      "archiveConfirm": "Archive…",
      "delete": "Delete listing…"
    },
    "col": {
      "listing": "Listing",
      "price": "Price",
      "qty": "Qty",
      "status": "Status",
      "changes": "Changes",
      "health": "Health"
    },
    "cell": {
      "variationsReadOnly": "Edit prices per variation in the editor",
      "notTracked": "Not tracked",
      "stockManaged": "Stock sync sets this quantity",
      "willDelete": "Will be deleted on send",
      "sending": "Sending to {to}…",
      "stageFailed": "Couldn't save this change"
    },
    "validate": {
      "priceMin": "{marketplace}'s minimum price is {min}",
      "priceInvalid": "Enter a price above 0",
      "qtyInvalid": "Enter a whole number from {min} to {max}"
    },
    "error": {
      "serverNoResponse": "KolayXport's server didn't respond"
    },
    "panel": {
      "conflict": "This listing changed on {on} after your draft started."
    },
    "fr": {
      "field": "Field",
      "find": "Find",
      "replace": "Replace with",
      "matchCase": "Match case",
      "scopeView": "Current view ({count})",
      "scopeSelected": "Selected ({count})",
      "andMore": "and {count} more",
      "overLimit": "Over {max} characters",
      "stage": "Stage {count} changes",
      "scope": "Apply to",
      "noneSelected": "Select listings in the table first",
      "fields": {
        "title": "Title",
        "tags": "Tags",
        "description": "Description"
      },
      "noMatches": "No listings contain this text",
      "summary": "{count, plural, one {# listing will change} other {# listings will change}}{flagged, plural, =0 {} other { · # skipped}}",
      "nothingToStage": "Nothing to change yet",
      "tagTooLong": "A tag would be over {max} characters",
      "emptyResult": "The title would be empty",
      "tagSeparator": "A tag can't contain , | or ;",
      "unsentChange": "Has an unsent change to this field. Send or discard it first.",
      "sending": "Being sent right now. Try again when it finishes."
    },
    "dup": {
      "sameSku": "Same SKU {sku}",
      "similarTitle": "Titles {pct} similar",
      "none": "No duplicates found",
      "summary": "{groups, plural, one {# group of possible duplicates} other {# groups of possible duplicates}}",
      "truncated": "Showing the first {max} groups",
      "deleteTitle": "Stage deletion of \"{title}\"?",
      "deleteBody": "Nothing is deleted on {on} until you send the deletion and type your shop name to confirm.",
      "deleteConfirm": "Stage deletion",
      "deleteStaged": "Deletion staged. It waits for your review.",
      "deactivateStaged": "Deactivation staged",
      "hideStaged": "Hiding from the store is staged",
      "archiveTitle": "Stage archiving of \"{title}\"?",
      "archiveBody": "Nothing is archived on {on} until you send it and type your shop name to confirm.",
      "archiveConfirm": "Stage archiving",
      "archiveStaged": "Archiving staged. It waits for your review."
    },
    "csv": {
      "drop": "Drop a CSV file or choose one",
      "mapping": "Match your columns",
      "template": "Download template",
      "summary": "{rows} rows · {change} listings will change · {missing} not found · {invalid} invalid",
      "notFound": "Not found",
      "invalid": "Invalid",
      "staging": "Staging {done} / {total}…",
      "stage": "Stage {count} changes",
      "tooLarge": "File is larger than 5 MB",
      "stepFile": "File",
      "limit": "CSV, up to 5 MB",
      "choose": "Choose file",
      "chooseAnother": "Choose another file",
      "notCsv": "Choose a .csv file",
      "empty": "This file has no rows",
      "unreadable": "Couldn't read this file",
      "ignore": "Don't import",
      "mapColumn": "Field for column {column}",
      "fields": {
        "title": "Title",
        "price": "Price",
        "quantity": "Quantity",
        "tags": "Tags",
        "description": "Description"
      },
      "idRequired": "Match one column to {column} so each row can be found",
      "preview": "Preview",
      "line": "Line",
      "result": "Result",
      "rowStaged": "Staged",
      "noChanges": "Nothing in this file changes your listings",
      "nothingToStage": "No changes left to stage",
      "stagePartial": "{done} staged · {failed} couldn't be saved. Stage again to retry.",
      "duplicateRow": "This listing is in the file more than once",
      "tagsTooMany": "More than {max} tags",
      "tagTooLong": "Tag \"{tag}\" is over {max} characters",
      "editableUnknown": "Couldn't check whether price and quantity can be edited here. Edit this listing in the grid.",
      "sending": "This listing is being sent right now. Import it again when it finishes.",
      "replacesUnsent": "Replaces an unsent change ({field})"
    },
    "export": {
      "scopeAll": "All listings ({count})",
      "includeDescription": "Include description",
      "download": "Download CSV",
      "preparing": "Preparing CSV…",
      "failed": "Couldn't download the CSV. Try again.",
      "selectedTooMany": "Too many listings selected to export at once. Use Current view or All listings."
    },
    "sched": {
      "title": "Schedule send",
      "date": "Date",
      "cta": "Schedule {count, plural, one {# change} other {# changes}}",
      "sendNow": "Send now",
      "changeTime": "Change time…",
      "unschedule": "Unschedule",
      "none": "Nothing scheduled",
      "when": "Scheduled for",
      "timezone": "Times in {zone}",
      "sendFailed": "Couldn't send this change. It stays in your drafts.",
      "rescheduled": "Send time changed",
      "unscheduled": "Schedule removed. The change stays staged.",
      "deleteNeedsReview": "Deletions are sent from the listing's ⋯ menu after you confirm",
      "pickFuture": "Pick a time in the future",
      "moreEdits": "{count, plural, one {# other edit} other {# other edits}}"
    }
  }
} as const;

export const G6_TR = {
  "listings": {
    "tools": {
      "menu": "Araçlar",
      "findReplace": "Bul ve değiştir",
      "duplicates": "Kopyaları bul",
      "import": "CSV içe aktar",
      "export": "CSV dışa aktar",
      "scheduled": "Zamanlanmış gönderimler",
      "activity": "Etkinlik",
      "loadFailed": "Bu yüklenemedi",
      "staged": "{count} değişiklik hazırlandı · hazır olduğunuzda gönderin",
      "stageFailed": "{count} değişiklik kaydedilemedi. Tekrar deneyin.",
      "findReplaceUnavailable": "Burada yalnızca fiyat ve stok hazırlanabiliyor, bulup değiştirilecek metin yok"
    },
    "mp": {
      "to": "{marketplace, select, etsy {Etsy'ye} ebay {eBay'e} trendyol {Trendyol'a} wix {Wix'e} shopify {Shopify'a} other {mağazaya}}",
      "on": "{marketplace, select, etsy {Etsy'de} ebay {eBay'de} trendyol {Trendyol'da} wix {Wix'te} shopify {Shopify'da} other {mağazada}}"
    },
    "send": {
      "toastResult": "{sent} değişiklik {to} gönderildi{failed, plural, =0 {} other { · # tanesi gönderilemedi}}"
    },
    "action": {
      "openEditor": "Düzenleyiciyi aç",
      "deactivate": "Pasife al",
      "hideInStore": "Mağazada gizle",
      "archiveConfirm": "Arşivle…",
      "delete": "İlanı sil…"
    },
    "col": {
      "listing": "İlan",
      "price": "Fiyat",
      "qty": "Adet",
      "status": "Durum",
      "changes": "Değişiklik",
      "health": "Sağlık"
    },
    "cell": {
      "variationsReadOnly": "Fiyatları düzenleyicide varyasyon bazında değiştirin",
      "notTracked": "Takip edilmiyor",
      "stockManaged": "Bu adedi stok senkronu belirliyor",
      "willDelete": "Gönderildiğinde silinecek",
      "sending": "{to} gönderiliyor…",
      "stageFailed": "Bu değişiklik kaydedilemedi"
    },
    "validate": {
      "priceMin": "{marketplace} için en düşük fiyat {min}",
      "priceInvalid": "0'dan büyük bir fiyat girin",
      "qtyInvalid": "{min} ile {max} arasında tam sayı girin"
    },
    "error": {
      "serverNoResponse": "KolayXport sunucusu yanıt vermedi"
    },
    "panel": {
      "conflict": "Taslağınız başladıktan sonra bu ilan {on} değişti."
    },
    "fr": {
      "field": "Alan",
      "find": "Bul",
      "replace": "Şununla değiştir",
      "matchCase": "Büyük/küçük harf duyarlı",
      "scopeView": "Geçerli görünüm ({count})",
      "scopeSelected": "Seçilenler ({count})",
      "andMore": "ve {count} tane daha",
      "overLimit": "{max} karakteri aşıyor",
      "stage": "{count} değişikliği hazırla",
      "scope": "Uygulanacak ilanlar",
      "noneSelected": "Önce tablodan ilan seçin",
      "fields": {
        "title": "Başlık",
        "tags": "Etiketler",
        "description": "Açıklama"
      },
      "noMatches": "Bu metni içeren ilan yok",
      "summary": "{count} ilan değişecek{flagged, plural, =0 {} other { · # tanesi atlandı}}",
      "nothingToStage": "Henüz değişecek bir şey yok",
      "tagTooLong": "Bir etiket {max} karakteri aşar",
      "emptyResult": "Başlık boş kalır",
      "tagSeparator": "Etiket , | veya ; içeremez",
      "unsentChange": "Bu alanda gönderilmemiş bir değişiklik var. Önce gönderin veya vazgeçin.",
      "sending": "Şu anda gönderiliyor. Bitince tekrar deneyin."
    },
    "dup": {
      "sameSku": "Aynı SKU {sku}",
      "similarTitle": "Başlıklar {pct} benzer",
      "none": "Kopya bulunamadı",
      "summary": "{groups} olası kopya grubu",
      "truncated": "İlk {max} grup gösteriliyor",
      "deleteTitle": "\"{title}\" silinmek üzere hazırlansın mı?",
      "deleteBody": "Silme işlemini gönderip mağaza adınızı yazarak onaylayana kadar {on} hiçbir şey silinmez.",
      "deleteConfirm": "Silmeyi hazırla",
      "deleteStaged": "Silme hazırlandı. İncelemeniz için bekliyor.",
      "deactivateStaged": "Pasife alma hazırlandı",
      "hideStaged": "Mağazada gizleme hazırlandı",
      "archiveTitle": "\"{title}\" arşivlenmek üzere hazırlansın mı?",
      "archiveBody": "Gönderip mağaza adınızı yazarak onaylayana kadar {on} hiçbir şey arşivlenmez.",
      "archiveConfirm": "Arşivlemeyi hazırla",
      "archiveStaged": "Arşivleme hazırlandı. İncelemeniz için bekliyor."
    },
    "csv": {
      "drop": "CSV dosyasını bırakın veya seçin",
      "mapping": "Sütunlarınızı eşleştirin",
      "template": "Şablonu indir",
      "summary": "{rows} satır · {change} ilan değişecek · {missing} bulunamadı · {invalid} geçersiz",
      "notFound": "Bulunamadı",
      "invalid": "Geçersiz",
      "staging": "Hazırlanıyor {done} / {total}…",
      "stage": "{count} değişikliği hazırla",
      "tooLarge": "Dosya 5 MB'tan büyük",
      "stepFile": "Dosya",
      "limit": "CSV, en fazla 5 MB",
      "choose": "Dosya seç",
      "chooseAnother": "Başka dosya seç",
      "notCsv": "Uzantısı .csv olan bir dosya seçin",
      "empty": "Bu dosyada satır yok",
      "unreadable": "Bu dosya okunamadı",
      "ignore": "İçe aktarma",
      "mapColumn": "{column} sütunu için alan",
      "fields": {
        "title": "Başlık",
        "price": "Fiyat",
        "quantity": "Adet",
        "tags": "Etiketler",
        "description": "Açıklama"
      },
      "idRequired": "Her satırın bulunabilmesi için bir sütunu {column} ile eşleştirin",
      "preview": "Önizleme",
      "line": "Satır",
      "result": "Sonuç",
      "rowStaged": "Hazırlandı",
      "noChanges": "Bu dosya ilanlarınızda bir şey değiştirmiyor",
      "nothingToStage": "Hazırlanacak değişiklik kalmadı",
      "stagePartial": "{done} hazırlandı · {failed} kaydedilemedi. Yeniden denemek için tekrar hazırlayın.",
      "duplicateRow": "Bu ilan dosyada birden fazla kez var",
      "tagsTooMany": "{max} etiketten fazla",
      "tagTooLong": "\"{tag}\" etiketi {max} karakteri aşıyor",
      "editableUnknown": "Fiyat ve adedin burada düzenlenip düzenlenemeyeceği kontrol edilemedi. Bu ilanı tabloda düzenleyin.",
      "sending": "Bu ilan şu anda gönderiliyor. Bitince tekrar içe aktarın.",
      "replacesUnsent": "Gönderilmemiş bir değişikliğin yerine geçer ({field})"
    },
    "export": {
      "scopeAll": "Tüm ilanlar ({count})",
      "includeDescription": "Açıklamayı ekle",
      "download": "CSV indir",
      "preparing": "CSV hazırlanıyor…",
      "failed": "CSV indirilemedi. Tekrar deneyin.",
      "selectedTooMany": "Tek seferde dışa aktarmak için çok fazla ilan seçili. Geçerli görünümü veya tüm ilanları kullanın."
    },
    "sched": {
      "title": "Gönderimi zamanla",
      "date": "Tarih",
      "cta": "{count} değişikliği zamanla",
      "sendNow": "Şimdi gönder",
      "changeTime": "Saati değiştir…",
      "unschedule": "Zamanlamayı kaldır",
      "none": "Zamanlanmış gönderim yok",
      "when": "Gönderim zamanı",
      "timezone": "Saatler {zone} saat dilimine göre",
      "sendFailed": "Bu değişiklik gönderilemedi. Taslaklarınızda duruyor.",
      "rescheduled": "Gönderim zamanı değiştirildi",
      "unscheduled": "Zamanlama kaldırıldı. Değişiklik hazır bekliyor.",
      "deleteNeedsReview": "Silme işlemleri, onayınızdan sonra ilanın ⋯ menüsünden gönderilir",
      "pickFuture": "İleri bir zaman seçin",
      "moreEdits": "{count} diğer düzenleme"
    }
  }
} as const;
