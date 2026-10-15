// M1-a i18n keys (returned to the integrator as newI18nKeys; messages/*.json are integrator-owned).
// Tests build their NextIntlClientProvider messages from this list, so the components are checked against
// exactly the keys the integrator will merge.

export interface M1aKey {
  namespace: 'status' | 'ds';
  key: string;
  en: string;
  tr: string;
}

export const M1A_KEYS: M1aKey[] = [
  // status.order (DS §3.9)
  { namespace: 'status', key: 'order.to_ship', en: 'To ship', tr: 'Gönderilecek' },
  { namespace: 'status', key: 'order.overdue', en: 'Overdue', tr: 'Gecikti' },
  { namespace: 'status', key: 'order.label_created', en: 'Label created', tr: 'Etiket hazır' },
  { namespace: 'status', key: 'order.shipped', en: 'Shipped', tr: 'Kargoda' },
  { namespace: 'status', key: 'order.delivered', en: 'Delivered', tr: 'Teslim edildi' },
  { namespace: 'status', key: 'order.on_hold', en: 'On hold', tr: 'Beklemede' },
  { namespace: 'status', key: 'order.problem', en: 'Problem', tr: 'Sorun' },
  { namespace: 'status', key: 'order.cancelled', en: 'Cancelled', tr: 'İptal' },
  { namespace: 'status', key: 'order.refunded', en: 'Refunded', tr: 'İade edildi' },
  // status.label
  { namespace: 'status', key: 'label.label_failed', en: 'Label failed', tr: 'Etiket hatası' },
  // status.listing (+ listings-grid §1.2)
  { namespace: 'status', key: 'listing.active', en: 'Active', tr: 'Yayında' },
  { namespace: 'status', key: 'listing.draft', en: 'Draft', tr: 'Taslak' },
  { namespace: 'status', key: 'listing.inactive', en: 'Inactive', tr: 'Pasif' },
  { namespace: 'status', key: 'listing.sold_out', en: 'Sold out', tr: 'Tükendi' },
  { namespace: 'status', key: 'listing.expired', en: 'Expired', tr: 'Süresi doldu' },
  { namespace: 'status', key: 'listing.in_review', en: 'In review', tr: 'Onay bekliyor' },
  { namespace: 'status', key: 'listing.rejected', en: 'Rejected', tr: 'Reddedildi' },
  // status.sync (+ overview §6 refresh_failed)
  { namespace: 'status', key: 'sync.pending', en: 'Not sent yet', tr: 'Henüz gönderilmedi' },
  { namespace: 'status', key: 'sync.syncing', en: 'Sending…', tr: 'Gönderiliyor…' },
  { namespace: 'status', key: 'sync.sync_failed', en: 'Send failed', tr: 'Gönderilemedi' },
  { namespace: 'status', key: 'sync.conflict', en: 'Changed on Etsy', tr: "Etsy'de değişti" },
  { namespace: 'status', key: 'sync.synced', en: 'Sent', tr: 'Gönderildi' },
  { namespace: 'status', key: 'sync.refresh_failed', en: 'Refresh failed', tr: 'Yenilenemedi' },
  // status.connection
  { namespace: 'status', key: 'connection.connected', en: 'Connected', tr: 'Bağlı' },
  { namespace: 'status', key: 'connection.needs_reconnect', en: 'Reconnect needed', tr: 'Yeniden bağlan' },
  { namespace: 'status', key: 'connection.incomplete', en: 'Setup incomplete', tr: 'Kurulum eksik' },
  { namespace: 'status', key: 'connection.not_connected', en: 'Not connected', tr: 'Bağlı değil' },
  { namespace: 'status', key: 'connection.check_failed', en: "Couldn't check", tr: 'Kontrol edilemedi' },
  // status.message (+ messages §11)
  { namespace: 'status', key: 'message.unread', en: 'Unread', tr: 'Okunmadı' },
  { namespace: 'status', key: 'message.needs_reply', en: 'Needs reply', tr: 'Yanıt bekliyor' },
  { namespace: 'status', key: 'message.in_review', en: 'Answer in review', tr: 'Yanıt onayda' },
  { namespace: 'status', key: 'message.answer_rejected', en: 'Answer rejected', tr: 'Yanıt reddedildi' },
  // status.subscription (settings §14, overview §6)
  { namespace: 'status', key: 'subscription.trial', en: 'Trial', tr: 'Deneme' },
  { namespace: 'status', key: 'subscription.grace', en: 'Grace period', tr: 'Ek süre' },
  { namespace: 'status', key: 'subscription.active', en: 'Active', tr: 'Aktif' },
  { namespace: 'status', key: 'subscription.canceling', en: 'Cancels soon', tr: 'İptal edilecek' },
  { namespace: 'status', key: 'subscription.past_due', en: 'Payment failed', tr: 'Ödeme başarısız' },
  { namespace: 'status', key: 'subscription.expired', en: 'Paused', tr: 'Durduruldu' },
  { namespace: 'status', key: 'subscription.near_limit', en: 'Near limit', tr: 'Limite yakın' },
  { namespace: 'status', key: 'subscription.trial_ending', en: 'Trial ending', tr: 'Deneme bitiyor' },
  // status.invoice
  { namespace: 'status', key: 'invoice.paid', en: 'Paid', tr: 'Ödendi' },
  { namespace: 'status', key: 'invoice.open', en: 'Unpaid', tr: 'Ödenmedi' },
  { namespace: 'status', key: 'invoice.void', en: 'Voided', tr: 'İptal edildi' },
  { namespace: 'status', key: 'invoice.uncollectible', en: 'Not collected', tr: 'Tahsil edilemedi' },
  // status.run
  { namespace: 'status', key: 'run.completed', en: 'Done', tr: 'Tamamlandı' },
  { namespace: 'status', key: 'run.running', en: 'Running', tr: 'Çalışıyor' },
  { namespace: 'status', key: 'run.failed', en: 'Failed', tr: 'Başarısız' },
  // status.tracking (overview §6)
  { namespace: 'status', key: 'tracking.not_sent', en: 'Tracking not sent', tr: 'Takip gönderilmedi' },
  { namespace: 'status', key: 'tracking.send_failed', en: 'Tracking failed', tr: 'Takip gönderilemedi' },

  // ds.format
  { namespace: 'ds', key: 'format.approx', en: 'Converted amount', tr: 'Dönüştürülmüş tutar' },
  // ds.shipBy (one phrase; no Turkish suffix after a variable, CRITIQUE C11)
  { namespace: 'ds', key: 'shipBy.today', en: 'Ship by today {time}', tr: 'Son gönderim: bugün {time}' },
  { namespace: 'ds', key: 'shipBy.tomorrow', en: 'Ship by tomorrow {time}', tr: 'Son gönderim: yarın {time}' },
  { namespace: 'ds', key: 'shipBy.date', en: 'Ship by {date}', tr: 'Son gönderim: {date}' },
  {
    namespace: 'ds',
    key: 'shipBy.overdueHours',
    en: 'Overdue {count, plural, one {# hour} other {# hours}}',
    tr: '{count} saat gecikti',
  },
  {
    namespace: 'ds',
    key: 'shipBy.overdueDays',
    en: 'Overdue {count, plural, one {# day} other {# days}}',
    tr: '{count} gün gecikti',
  },
  { namespace: 'ds', key: 'shipBy.shipped', en: 'Shipped {date}', tr: 'Kargoya verildi: {date}' },
  { namespace: 'ds', key: 'shipBy.unknown', en: 'No ship-by date', tr: 'Son gönderim tarihi yok' },
  // ds.copy
  { namespace: 'ds', key: 'copy.action', en: 'Copy', tr: 'Kopyala' },
  { namespace: 'ds', key: 'copy.label', en: 'Copy {value}', tr: 'Kopyala: {value}' },
  { namespace: 'ds', key: 'copy.copied', en: 'Copied', tr: 'Kopyalandı' },
  { namespace: 'ds', key: 'copy.failed', en: "Couldn't copy", tr: 'Kopyalanamadı' },
  // ds.terms (orders §11.9 + DS P5 list)
  {
    namespace: 'ds',
    key: 'terms.etgb',
    en: 'Electronic customs declaration for e-commerce exports from Turkey.',
    tr: "Türkiye'den e-ihracat gönderileri için elektronik gümrük beyannamesi.",
  },
  { namespace: 'ds', key: 'terms.hs', en: 'Harmonized System code: the customs product category.', tr: 'GTİP: ürünün gümrük tarife kodu.' },
  {
    namespace: 'ds',
    key: 'terms.ioss',
    en: 'EU VAT number for low-value imports. Lets the buyer avoid VAT on delivery.',
    tr: 'Düşük değerli AB ithalatı için KDV numarası. Alıcının teslimatta KDV ödemesini önler.',
  },
  { namespace: 'ds', key: 'terms.sku', en: 'Stock keeping unit: your own code for this product.', tr: 'Stok kodu: bu ürün için kendi kodunuz.' },
  {
    namespace: 'ds',
    key: 'terms.gtin',
    en: 'Global Trade Item Number: the barcode number (UPC, EAN or ISBN).',
    tr: 'Küresel Ticari Ürün Numarası: barkod numarası (UPC, EAN veya ISBN).',
  },
  { namespace: 'ds', key: 'termNames.etgb', en: 'ETGB', tr: 'ETGB' },
  { namespace: 'ds', key: 'termNames.hs', en: 'HS code', tr: 'GTİP' },
  { namespace: 'ds', key: 'termNames.ioss', en: 'IOSS', tr: 'IOSS' },
  { namespace: 'ds', key: 'termNames.sku', en: 'SKU', tr: 'SKU' },
  { namespace: 'ds', key: 'termNames.gtin', en: 'GTIN', tr: 'GTIN' },
  { namespace: 'ds', key: 'termHint.label', en: 'What is {term}?', tr: '{term} nedir?' },
  // ds.kbd: word-labelled keys (symbol glyphs stay constants)
  { namespace: 'ds', key: 'kbd.ctrl', en: 'Ctrl', tr: 'Ctrl' },
  { namespace: 'ds', key: 'kbd.win', en: 'Win', tr: 'Win' },
  { namespace: 'ds', key: 'kbd.shift', en: 'Shift', tr: 'Shift' },
  { namespace: 'ds', key: 'kbd.alt', en: 'Alt', tr: 'Alt' },
  { namespace: 'ds', key: 'kbd.esc', en: 'Esc', tr: 'Esc' },
  { namespace: 'ds', key: 'kbd.tab', en: 'Tab', tr: 'Tab' },
  { namespace: 'ds', key: 'kbd.space', en: 'Space', tr: 'Boşluk' },
  { namespace: 'ds', key: 'kbd.delete', en: 'Del', tr: 'Sil' },
];

type Tree = { [k: string]: string | Tree };

/** Nested messages for one locale, as the integrator will merge them into messages/<locale>.json. */
export function m1aMessages(locale: 'en' | 'tr'): Tree {
  const root: Tree = {};
  for (const k of M1A_KEYS) {
    const path = [k.namespace, ...k.key.split('.')];
    let node = root;
    for (let i = 0; i < path.length - 1; i++) {
      const next = node[path[i]];
      if (typeof next === 'string') throw new Error(`key clash at ${path.slice(0, i + 1).join('.')}`);
      node = (node[path[i]] = next ?? {}) as Tree;
    }
    node[path[path.length - 1]] = k[locale];
  }
  return root;
}
