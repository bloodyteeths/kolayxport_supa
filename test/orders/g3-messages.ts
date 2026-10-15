// M3 orders-G3 (OrderPanel) i18n keys, EN + TR. Spec keys are orders.md §11 verbatim; the rest are new
// (returned to the integrator as newI18nKeys). Tests merge these into messages/*.json until the integrator does.

const MP_EN =
  "{mp, select, etsy {Etsy} ebay {eBay} amazon {Amazon} trendyol {Trendyol} wix {Wix} shopify {Shopify} hepsiburada {Hepsiburada} other {the marketplace}}";
const MP_DAT_TR =
  "{mp, select, etsy {Etsy'ye} ebay {eBay'e} amazon {Amazon'a} trendyol {Trendyol'a} wix {Wix'e} shopify {Shopify'a} hepsiburada {Hepsiburada'ya} other {pazaryerine}}";
const MP_NOM_TR =
  "{mp, select, etsy {Etsy} ebay {eBay} amazon {Amazon} trendyol {Trendyol} wix {Wix} shopify {Shopify} hepsiburada {Hepsiburada} other {pazaryeri}}";
const MP_SUBMIT_EN =
  '{mp, select, etsy {Etsy} ebay {eBay} amazon {Amazon} trendyol {Trendyol} wix {Wix} shopify {Shopify} hepsiburada {Hepsiburada} other {marketplace}}';

/** [namespace, key, en, tr] — `isNew` false = orders.md §11 key. */
export const G3_KEYS: ReadonlyArray<{ namespace: string; key: string; en: string; tr: string; isNew: boolean }> = [
  // §11.1 actions (spec)
  { namespace: 'orders', key: 'actions.createLabel', en: 'Create label', tr: 'Etiket oluştur', isNew: false },
  { namespace: 'orders', key: 'actions.printLabel', en: 'Print label', tr: 'Etiketi yazdır', isNew: false },
  { namespace: 'orders', key: 'actions.printPackingSlip', en: 'Print packing slip', tr: 'Paket fişini yazdır', isNew: false },
  { namespace: 'orders', key: 'actions.addTracking', en: 'Add tracking number', tr: 'Takip numarası ekle', isNew: false },
  { namespace: 'orders', key: 'actions.openOn', en: 'Open on {marketplace}', tr: '{marketplace} üzerinde aç', isNew: false },
  { namespace: 'orders', key: 'actions.copyAddressIntl', en: 'Copy address (international)', tr: 'Adresi kopyala (uluslararası)', isNew: false },
  { namespace: 'orders', key: 'actions.copyAddressTr', en: 'Copy address (Turkish format)', tr: 'Adresi kopyala (Türkiye formatı)', isNew: false },
  { namespace: 'orders', key: 'actions.copyAddress', en: 'Copy', tr: 'Kopyala', isNew: false },
  { namespace: 'orders', key: 'actions.messageBuyer', en: 'Message buyer', tr: 'Alıcıya mesaj gönder', isNew: false },
  { namespace: 'orders', key: 'actions.fixAddress', en: 'Fix address', tr: 'Adresi düzelt', isNew: false },
  { namespace: 'orders', key: 'actions.deleteLabel', en: 'Delete label…', tr: 'Etiketi sil…', isNew: false },
  { namespace: 'orders', key: 'actions.deleteOrder', en: 'Delete order…', tr: 'Siparişi sil…', isNew: false },
  // §11.2 (spec)
  { namespace: 'orders', key: 'columns.order', en: 'Order', tr: 'Sipariş', isNew: false },
  { namespace: 'orders', key: 'row.buyerHidden', en: 'Name hidden by Amazon', tr: 'İsim Amazon tarafından gizlendi', isNew: false },
  { namespace: 'orders', key: 'row.buyerHiddenHint', en: 'Amazon shares buyer names only with the PII role on your SP-API app.', tr: 'Amazon alıcı isimlerini yalnızca SP-API uygulamanızda kişisel veri yetkisi varsa paylaşır.', isNew: false },
  { namespace: 'orders', key: 'row.manualStore', en: 'Manual order', tr: 'Manuel sipariş', isNew: false },
  { namespace: 'orders', key: 'row.fba', en: 'Fulfilled by Amazon', tr: 'Amazon tarafından gönderilir', isNew: false },
  { namespace: 'orders', key: 'row.mcf', en: 'Multi-Channel Fulfillment', tr: 'Çok Kanallı Gönderim (MCF)', isNew: false },
  { namespace: 'orders', key: 'row.fbaNoLabel', en: 'Amazon ships this order. No label needed.', tr: 'Bu siparişi Amazon gönderir. Etiket gerekmez.', isNew: false },
  { namespace: 'orders', key: 'row.upgradePaid', en: 'Buyer paid for {upgrade} shipping', tr: 'Alıcı {upgrade} kargo için ödeme yaptı', isNew: false },
  { namespace: 'orders', key: 'row.trackingFailed', en: "Couldn't send tracking", tr: 'Takip gönderilemedi', isNew: false },
  { namespace: 'orders', key: 'row.trendyolCargo', en: 'Trendyol cargo number', tr: 'Trendyol kargo numarası', isNew: false },
  { namespace: 'orders', key: 'problem.addressIncomplete', en: 'Address incomplete: {fields} missing', tr: 'Adres eksik: {fields} yok', isNew: false },
  { namespace: 'orders', key: 'problem.field.name', en: 'name', tr: 'ad', isNew: false },
  { namespace: 'orders', key: 'problem.field.street1', en: 'street address', tr: 'sokak adresi', isNew: false },
  { namespace: 'orders', key: 'problem.field.city', en: 'city', tr: 'şehir', isNew: false },
  { namespace: 'orders', key: 'problem.field.postal', en: 'postal code', tr: 'posta kodu', isNew: false },
  { namespace: 'orders', key: 'problem.field.country', en: 'country', tr: 'ülke', isNew: false },
  { namespace: 'orders', key: 'problem.etsyAddressHidden', en: "Etsy doesn't share buyer addresses through its API. Open the order on Etsy with the Chrome extension to import it.", tr: "Etsy alıcı adreslerini API üzerinden paylaşmıyor. Adresi almak için siparişi Chrome eklentisi açıkken Etsy'de açın.", isNew: false },
  { namespace: 'orders', key: 'problem.labelFailed', en: 'Label failed: {reason}', tr: 'Etiket oluşturulamadı: {reason}', isNew: false },
  { namespace: 'orders', key: 'status.rawTooltip', en: '{marketplace}: {raw}', tr: '{marketplace}: {raw}', isNew: false },
  // §11.4 (spec)
  { namespace: 'orders', key: 'error.orderTitle', en: "Couldn't load this order", tr: 'Bu sipariş yüklenemedi', isNew: false },
  { namespace: 'orders', key: 'error.orderGone', en: 'This order no longer exists', tr: 'Bu sipariş artık yok', isNew: false },
  { namespace: 'orders', key: 'error.backToOrders', en: 'Back to orders', tr: 'Siparişlere dön', isNew: false },
  // §11.5 panel (spec)
  { namespace: 'orders', key: 'panel.title', en: 'Order {number}', tr: 'Sipariş {number}', isNew: false },
  { namespace: 'orders', key: 'panel.ordered', en: 'Ordered {date}', tr: 'Sipariş tarihi: {date}', isNew: false },
  { namespace: 'orders', key: 'panel.items', en: 'Items ({count})', tr: 'Ürünler ({count})', isNew: false },
  { namespace: 'orders', key: 'panel.qtyPrice', en: '{price} × {qty}', tr: '{price} × {qty}', isNew: false },
  { namespace: 'orders', key: 'panel.personalization', en: 'Personalization', tr: 'Kişiselleştirme', isNew: false },
  { namespace: 'orders', key: 'panel.itemsSubtotal', en: 'Items {amount}', tr: 'Ürünler {amount}', isNew: false },
  { namespace: 'orders', key: 'panel.orderTotal', en: 'Total {amount}', tr: 'Toplam {amount}', isNew: false },
  { namespace: 'orders', key: 'panel.giftMessage', en: 'Gift message', tr: 'Hediye notu', isNew: false },
  { namespace: 'orders', key: 'panel.buyerNote', en: 'Note from buyer', tr: 'Alıcı notu', isNew: false },
  { namespace: 'orders', key: 'panel.shipTo', en: 'Ship to', tr: 'Teslimat adresi', isNew: false },
  { namespace: 'orders', key: 'panel.edit', en: 'Edit', tr: 'Düzenle', isNew: false },
  { namespace: 'orders', key: 'panel.save', en: 'Save', tr: 'Kaydet', isNew: false },
  { namespace: 'orders', key: 'panel.addressSaved', en: "Address saved in KolayXport. {marketplace} isn't changed.", tr: "Adres KolayXport'ta kaydedildi. {marketplace} tarafı değişmedi.", isNew: false },
  { namespace: 'orders', key: 'panel.labelTracking', en: 'Label & tracking', tr: 'Etiket ve takip', isNew: false },
  { namespace: 'orders', key: 'panel.noLabel', en: 'No label yet', tr: 'Henüz etiket yok', isNew: false },
  { namespace: 'orders', key: 'panel.labelCreatedOn', en: 'Created {date}', tr: '{date} tarihinde oluşturuldu', isNew: false },
  { namespace: 'orders', key: 'panel.trackingSentTo', en: `Tracking sent to ${MP_EN}`, tr: `Takip numarası ${MP_DAT_TR} gönderildi`, isNew: false },
  { namespace: 'orders', key: 'panel.trackingQueued', en: 'Queued for the Chrome extension', tr: 'Chrome eklentisi için sıraya alındı', isNew: false },
  { namespace: 'orders', key: 'panel.trackingNotSent', en: 'Tracking not sent yet', tr: 'Takip numarası henüz gönderilmedi', isNew: false },
  { namespace: 'orders', key: 'panel.note', en: 'Private note', tr: 'Özel not', isNew: false },
  { namespace: 'orders', key: 'panel.notePlaceholder', en: 'Add a note for packing or production…', tr: 'Paketleme veya üretim için not ekleyin…', isNew: false },
  { namespace: 'orders', key: 'panel.noteHint', en: 'Only you see this. Never sent to a marketplace.', tr: 'Bunu yalnızca siz görürsünüz. Pazaryerine asla gönderilmez.', isNew: false },
  { namespace: 'orders', key: 'panel.noteSaveFailed', en: "Couldn't save the note", tr: 'Not kaydedilemedi', isNew: false },
  { namespace: 'orders', key: 'panel.costs', en: 'Costs', tr: 'Maliyetler', isNew: false },
  { namespace: 'orders', key: 'panel.carrierCost', en: 'Carrier cost', tr: 'Kargo maliyeti', isNew: false },
  { namespace: 'orders', key: 'panel.carrierCostHint', en: 'From the carrier invoice. Used in Finance.', tr: 'Kargo faturasından girin. Finans raporunda kullanılır.', isNew: false },
  { namespace: 'orders', key: 'panel.carrierCostSaved', en: 'Carrier cost saved', tr: 'Kargo maliyeti kaydedildi', isNew: false },
  { namespace: 'orders', key: 'panel.carrierCostInvalid', en: 'Enter an amount of 0 or more', tr: '0 veya daha büyük bir tutar girin', isNew: false },
  { namespace: 'orders', key: 'panel.history', en: 'History', tr: 'Geçmiş', isNew: false },
  { namespace: 'orders', key: 'history.ordered', en: 'Ordered on {marketplace}', tr: '{marketplace} üzerinden sipariş verildi', isNew: false },
  { namespace: 'orders', key: 'history.imported', en: 'Imported into KolayXport', tr: "KolayXport'a aktarıldı", isNew: false },
  { namespace: 'orders', key: 'history.labelCreated', en: 'Label created · {carrier}', tr: 'Etiket oluşturuldu · {carrier}', isNew: false },
  { namespace: 'orders', key: 'history.labelFailed', en: 'Label failed · {carrier}', tr: 'Etiket oluşturulamadı · {carrier}', isNew: false },
  { namespace: 'orders', key: 'history.trackingSent', en: `Tracking sent to ${MP_EN}`, tr: `Takip numarası ${MP_DAT_TR} gönderildi`, isNew: false },
  { namespace: 'orders', key: 'history.shipped', en: 'Shipped', tr: 'Kargoya verildi', isNew: false },
  { namespace: 'orders', key: 'tracking.title', en: 'Add tracking number', tr: 'Takip numarası ekle', isNew: false },
  { namespace: 'orders', key: 'tracking.number', en: 'Tracking number', tr: 'Takip numarası', isNew: false },
  { namespace: 'orders', key: 'tracking.carrier', en: 'Carrier', tr: 'Kargo firması', isNew: false },
  { namespace: 'orders', key: 'tracking.carrierOther', en: 'Other', tr: 'Diğer', isNew: false },
  { namespace: 'orders', key: 'tracking.notifyBuyer', en: 'Notify the buyer', tr: 'Alıcıyı bilgilendir', isNew: false },
  { namespace: 'orders', key: 'tracking.submit', en: `Send to ${MP_SUBMIT_EN}`, tr: `${MP_DAT_TR} gönder`, isNew: false },
  { namespace: 'orders', key: 'tracking.sending', en: 'Sending…', tr: 'Gönderiliyor…', isNew: false },
  { namespace: 'orders', key: 'tracking.sent', en: `Tracking sent to ${MP_EN}`, tr: `Takip numarası ${MP_DAT_TR} gönderildi`, isNew: false },
  { namespace: 'orders', key: 'tracking.queued', en: 'Queued. The Chrome extension sends it the next time Etsy is open.', tr: 'Sıraya alındı. Chrome eklentisi Etsy bir sonraki açıldığında gönderecek.', isNew: false },
  { namespace: 'orders', key: 'tracking.failed', en: "Couldn't send tracking", tr: 'Takip numarası gönderilemedi', isNew: false },
  { namespace: 'orders', key: 'confirm.deleteOrder.title', en: 'Delete order {number}?', tr: '{number} numaralı sipariş silinsin mi?', isNew: false },
  { namespace: 'orders', key: 'confirm.deleteOrder.body', en: "It's removed from KolayXport only. Nothing changes on {marketplace}.", tr: 'Sipariş yalnızca KolayXport\'tan silinir. {marketplace} tarafında hiçbir şey değişmez.', isNew: false },
  { namespace: 'orders', key: 'confirm.deleteOrder.confirm', en: 'Delete order', tr: 'Siparişi sil', isNew: false },
  { namespace: 'orders', key: 'confirm.deleteOrder.done', en: 'Order {number} deleted', tr: '{number} numaralı sipariş silindi', isNew: false },
  { namespace: 'orders', key: 'confirm.deleteLabel.title', en: 'Delete the label for order {number}?', tr: '{number} numaralı siparişin etiketi silinsin mi?', isNew: false },
  { namespace: 'orders', key: 'confirm.deleteLabel.body', en: "It's removed from KolayXport. It isn't voided with the carrier.", tr: "Etiket KolayXport'tan kaldırılır, kargo firmasında iptal edilmez.", isNew: false },
  { namespace: 'orders', key: 'confirm.deleteLabel.confirm', en: 'Delete label', tr: 'Etiketi sil', isNew: false },
  { namespace: 'orders', key: 'confirm.deleteLabel.done', en: 'Label deleted', tr: 'Etiket silindi', isNew: false },

  // ── new keys (G3) ─────────────────────────────────────────────────────────────────────────────
  { namespace: 'orders', key: 'panel.cancel', en: 'Cancel', tr: 'Vazgeç', isNew: true },
  { namespace: 'orders', key: 'panel.saving', en: 'Saving…', tr: 'Kaydediliyor…', isNew: true },
  { namespace: 'orders', key: 'panel.retry', en: 'Retry', tr: 'Tekrar dene', isNew: true },
  { namespace: 'orders', key: 'panel.noteSaving', en: 'Saving…', tr: 'Kaydediliyor…', isNew: true },
  { namespace: 'orders', key: 'panel.noteSaved', en: 'Saved', tr: 'Kaydedildi', isNew: true },
  { namespace: 'orders', key: 'panel.addressLocalOnly', en: "Saved in KolayXport only. The marketplace order doesn't change.", tr: 'Yalnızca KolayXport\'ta kaydedilir. Pazaryerindeki sipariş değişmez.', isNew: true },
  { namespace: 'orders', key: 'panel.addressSaveFailed', en: "Couldn't save the address", tr: 'Adres kaydedilemedi', isNew: true },
  { namespace: 'orders', key: 'panel.addressCopied', en: 'Address copied', tr: 'Adres kopyalandı', isNew: true },
  { namespace: 'orders', key: 'panel.copyFailed', en: "Couldn't copy", tr: 'Kopyalanamadı', isNew: true },
  { namespace: 'orders', key: 'panel.carrierCostSaveFailed', en: "Couldn't save the carrier cost", tr: 'Kargo maliyeti kaydedilemedi', isNew: true },
  { namespace: 'orders', key: 'panel.carrierCostCurrency', en: 'Carrier cost currency', tr: 'Kargo maliyeti para birimi', isNew: true },
  { namespace: 'orders', key: 'panel.trackingPending', en: `Sent, waiting for ${MP_EN} to confirm`, tr: `${MP_DAT_TR} gönderildi, onay bekleniyor`, isNew: true },
  { namespace: 'orders', key: 'panel.labelFailedNoReason', en: 'The last label attempt failed', tr: 'Son etiket denemesi başarısız oldu', isNew: true },
  { namespace: 'orders', key: 'panel.labelFileMissing', en: 'No label file is stored for this label. Only the tracking number is available.', tr: 'Bu etiketin dosyası kayıtlı değil. Yalnızca takip numarası var.', isNew: true },
  { namespace: 'orders', key: 'panel.lifecycle', en: 'Marketplace updates', tr: 'Pazaryeri güncellemeleri', isNew: true },
  { namespace: 'orders', key: 'history.orderedManual', en: 'Added as a manual order', tr: 'Manuel sipariş olarak eklendi', isNew: true },
  { namespace: 'orders', key: 'history.trackingQueued', en: 'Tracking queued for the Chrome extension', tr: 'Takip numarası Chrome eklentisi için sıraya alındı', isNew: true },
  { namespace: 'orders', key: 'history.trackingFailed', en: "Tracking couldn't be sent", tr: 'Takip numarası gönderilemedi', isNew: true },
  { namespace: 'orders', key: 'tracking.invalid', en: 'Use 8 to 40 letters and digits', tr: '8 ile 40 arasında harf ve rakam girin', isNew: true },
  { namespace: 'orders', key: 'tracking.required', en: 'Enter the tracking number', tr: 'Takip numarasını girin', isNew: true },
  { namespace: 'orders', key: 'tracking.savedNotSent', en: `Saved in KolayXport, but ${MP_EN} didn't accept it`, tr: `KolayXport'ta kaydedildi, ancak ${MP_DAT_TR} gönderilemedi`, isNew: true },
  { namespace: 'orders', key: 'tracking.notConnected', en: `Connect ${MP_SUBMIT_EN} in Settings first`, tr: `Önce Ayarlar'dan ${MP_NOM_TR} hesabını bağlayın`, isNew: true },
  { namespace: 'orders', key: 'tracking.network', en: 'Check your connection and try again', tr: 'Bağlantınızı kontrol edip tekrar deneyin', isNew: true },
  { namespace: 'orders', key: 'confirm.deleteOrder.bodyManual', en: "It's removed from KolayXport.", tr: "Sipariş KolayXport'tan silinir.", isNew: true },
  { namespace: 'orders', key: 'confirm.deleteOrder.failed', en: "Couldn't delete the order", tr: 'Sipariş silinemedi', isNew: true },
  { namespace: 'orders', key: 'confirm.deleteLabel.failed', en: "Couldn't delete the label", tr: 'Etiket silinemedi', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.title', en: 'Message the Amazon buyer', tr: 'Amazon alıcısına mesaj gönder', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.order', en: 'Order {number}', tr: 'Sipariş {number}', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.outboundOnly', en: "Amazon only lets sellers send template messages. Buyer replies don't come back here.", tr: 'Amazon satıcıların yalnızca şablon mesaj göndermesine izin verir. Alıcının yanıtları buraya gelmez.', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.mcf', en: "This is a Multi-Channel Fulfillment order. Amazon doesn't allow messages for it.", tr: 'Bu bir Çok Kanallı Gönderim (MCF) siparişi. Amazon bu sipariş için mesaja izin vermez.', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.typeLabel', en: 'Message type', tr: 'Mesaj türü', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.type.unexpectedProblem', en: 'Unexpected problem', tr: 'Beklenmeyen sorun', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.type.confirmDeliveryDetails', en: 'Confirm delivery details', tr: 'Teslimat bilgilerini doğrula', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.type.confirmOrderDetails', en: 'Confirm order details', tr: 'Sipariş bilgilerini doğrula', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.type.confirmCustomizationDetails', en: 'Confirm personalization details', tr: 'Kişiselleştirme bilgilerini doğrula', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.type.confirmServiceDetails', en: 'Confirm service details', tr: 'Hizmet bilgilerini doğrula', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.type.reviewRequest', en: 'Request a review', tr: 'Değerlendirme iste', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.reviewHint', en: 'Amazon sends the buyer its own review request. No text needed.', tr: 'Amazon alıcıya kendi değerlendirme isteğini gönderir. Metin gerekmez.', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.notAllowed', en: "Amazon doesn't allow this message for the order right now", tr: 'Amazon bu sipariş için şu anda bu mesaja izin vermiyor', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.checking', en: 'Checking which messages Amazon allows…', tr: "Amazon'un izin verdiği mesajlar kontrol ediliyor…", isNew: true },
  { namespace: 'orders', key: 'messageBuyer.text', en: 'Message', tr: 'Mesaj', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.textRequired', en: 'Write the message', tr: 'Mesajı yazın', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.send', en: 'Send to Amazon', tr: "Amazon'a gönder", isNew: true },
  { namespace: 'orders', key: 'messageBuyer.requestReview', en: 'Request review', tr: 'Değerlendirme iste', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.sending', en: 'Sending…', tr: 'Gönderiliyor…', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.sent', en: 'Message sent to the buyer', tr: 'Mesaj alıcıya gönderildi', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.reviewSent', en: 'Review request sent', tr: 'Değerlendirme isteği gönderildi', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.failed', en: "Couldn't send the message", tr: 'Mesaj gönderilemedi', isNew: true },
  { namespace: 'orders', key: 'panel.addressSavedManual', en: 'Address saved.', tr: 'Adres kaydedildi.', isNew: true },
  { namespace: 'orders', key: 'messageBuyer.failedCause', en: 'Amazon refused it. The message type may not be allowed for this order yet.', tr: 'Amazon kabul etmedi. Bu mesaj türüne sipariş için henüz izin verilmiyor olabilir.', isNew: true },

  // createLabel (spec §11.6; G3's ShipToForm uses them)
  { namespace: 'createLabel', key: 'field.name', en: 'Recipient name', tr: 'Alıcı adı', isNew: false },
  { namespace: 'createLabel', key: 'field.phone', en: 'Phone', tr: 'Telefon', isNew: false },
  { namespace: 'createLabel', key: 'field.email', en: 'Email', tr: 'E-posta', isNew: false },
  { namespace: 'createLabel', key: 'field.country', en: 'Country', tr: 'Ülke', isNew: false },
  { namespace: 'createLabel', key: 'field.street1', en: 'Address line 1', tr: 'Adres satırı 1', isNew: false },
  { namespace: 'createLabel', key: 'field.street2', en: 'Address line 2', tr: 'Adres satırı 2', isNew: false },
  { namespace: 'createLabel', key: 'field.city', en: 'City', tr: 'Şehir', isNew: false },
  { namespace: 'createLabel', key: 'field.postal', en: 'Postal code', tr: 'Posta kodu', isNew: false },
  { namespace: 'createLabel', key: 'field.state', en: 'State / province', tr: 'Eyalet / bölge', isNew: false },
  { namespace: 'createLabel', key: 'field.district', en: 'District', tr: 'İlçe', isNew: false },
  { namespace: 'createLabel', key: 'field.neighbourhood', en: 'Neighbourhood', tr: 'Mahalle', isNew: false },
  { namespace: 'createLabel', key: 'validation.required', en: 'Required', tr: 'Zorunlu', isNew: false },
  { namespace: 'createLabel', key: 'validation.stateRequired', en: 'Required for {country}', tr: '{country} için zorunlu', isNew: false },
];

type Obj = Record<string, unknown>;

function build(locale: 'en' | 'tr'): Obj {
  const out: Obj = {};
  for (const k of G3_KEYS) {
    const path = [k.namespace, ...k.key.split('.')];
    let o = out;
    for (let i = 0; i < path.length - 1; i++) {
      o[path[i]] = (o[path[i]] as Obj) ?? {};
      o = o[path[i]] as Obj;
    }
    o[path[path.length - 1]] = locale === 'en' ? k.en : k.tr;
  }
  return out;
}

export const G3_EN = build('en');
export const G3_TR = build('tr');
