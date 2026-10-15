// test/bulk/c-messages.ts — M7-C i18n keys (namespace `bulk`), EN + TR. Every key here is returned in the M7-C
// result (`newI18nKeys`); the integrator merges them. Keys shared with M7-A (`bulk.paste.result`,
// `bulk.paste.overflow`, `bulk.revert.selected`) and M7-D (`bulk.ai.suggestion`) carry the same text as theirs.
type Tree = { [k: string]: string | Tree };

export const C_EN: Tree = {
  bulk: {
    title: 'Bulk edit',
    back: '{marketplace} listings',
    meta: {
      counts: '{listings, plural, one {# listing} other {# listings}} · {edits, plural, one {# edit not sent} other {# edits not sent}}',
      saving: 'Saving {done} / {total}…',
      saved: 'Saved {time}',
      allSent: 'Everything has been sent to {to}',
    },
    discardAll: {
      cta: 'Discard all edits',
      confirm: 'Discard {edits} edits on {listings} listings? Edits made outside the bulk editor stay.',
      done: '{count, plural, one {# edit discarded} other {# edits discarded}}',
      kept: '{count, plural, one {# edit was kept} other {# edits were kept}}: the field already had an unsent change from before. Revert the cell to remove it.',
    },
    section: {
      set: 'Set section…',
      title: 'Set section',
      pick: 'Choose a section',
      stage: '{count, plural, one {Stage # change} other {Stage # changes}}',
    },
    tools: {
      exportRows: 'Export these rows (CSV)',
      findReplaceIds: 'Find & replace works on a filtered view. Open the bulk editor from a view to use it.',
    },
    filter: { placeholder: 'Filter rows in this grid' },
    show: { label: 'Show', all: 'All', edited: 'Edited', invalid: "Can't be saved" },
    rows: '{count, plural, one {# row} other {# rows}} · page {page} of {pages}',
    col: {
      title: 'Title',
      price: 'Price',
      qty: 'Qty',
      section: 'Section',
      health: 'Health',
      photos: 'Photos',
      status: 'Status',
      changes: 'Changes',
    },
    readOnly: {
      variations: 'Has variations: use Change price, or edit per variation in the editor',
      stockManaged: 'Stock sync manages this quantity ({qty})',
      notEditable: 'Not editable for {marketplace} yet',
      sending: 'Sending to {to}…',
    },
    invalid: {
      banner: "{count, plural, one {# edit can't be saved} other {# edits can't be saved}}: {reason}",
      show: 'Show them',
    },
    paste: {
      result: 'Pasted {rows} rows × {cols} columns · {edits} edits{invalid, plural, =0 {} other { · # invalid}}{skipped, plural, =0 {} other { · # skipped}}',
      overflow: '{count, plural, one {# row didn’t fit} other {# rows didn’t fit}} on this page',
      saved: 'Saved · {listings, plural, one {# listing} other {# listings}}, {edits, plural, one {# edit not sent} other {# edits not sent}}',
    },
    stageFailed: { banner: "{count, plural, one {# listing couldn't be saved} other {# listings couldn't be saved}}" },
    conflict: {
      banner: '{count, plural, one {# listing changed on {on} since your draft} other {# listings changed on {on} since your drafts}}. Sending skips them until you review the differences.',
    },
    revert: {
      selected: 'Revert selected rows',
      failed: "{count, plural, one {# listing couldn't be reverted} other {# listings couldn't be reverted}}",
    },
    send: {
      confirm: 'Send {count, plural, one {# change} other {# changes}} to {to}? The live listings are updated.',
    },
    shortcuts: { save: 'Save edits now' },
    photos: { edit: 'Edit photos…', editPro: 'Edit photos… (Pro)' },
    delete: {
      cta: '{count, plural, one {Delete # listing…} other {Delete # listings…}}',
      skippedEdited: '{count, plural, one {# listing with unsent edits was skipped} other {# listings with unsent edits were skipped}}. Send or discard those edits first.',
    },
    leaveSaving: 'Some edits are still saving. Leave anyway?',
    mobile: {
      title: 'The bulk editor works on a larger screen',
      body: 'On your phone, use Change price and Add tags from the listings selection bar.',
    },
    error: { load: "Couldn't load these listings" },
    empty: { title: 'No listings to edit' },
    ai: { suggestion: 'AI suggestion · Revert to keep yours' },
  },
  // Stock-managed qty cell link (wiring-grid-stock; shared with the listings grid).
  listings: { cell: { stockManagedLink: 'Managed by stock sync · Open Stock Sync' } },
};

export const C_TR: Tree = {
  bulk: {
    title: 'Toplu düzenleme',
    back: '{marketplace} ilanları',
    meta: {
      counts: '{listings} ilan · {edits} düzenleme gönderilmedi',
      saving: 'Kaydediliyor {done} / {total}…',
      saved: '{time} kaydedildi',
      allSent: 'Her şey {to} gönderildi',
    },
    discardAll: {
      cta: 'Tüm düzenlemeleri at',
      confirm: '{listings} ilandaki {edits} düzenleme atılsın mı? Toplu düzenleyici dışında yapılan düzenlemeler kalır.',
      done: '{count} düzenleme atıldı',
      kept: '{count} düzenleme korundu: alanda daha önceden gönderilmemiş bir değişiklik vardı. Kaldırmak için hücreyi geri alın.',
    },
    section: {
      set: 'Bölüm ata…',
      title: 'Bölüm ata',
      pick: 'Bir bölüm seçin',
      stage: '{count} değişikliği hazırla',
    },
    tools: {
      exportRows: 'Bu satırları dışa aktar (CSV)',
      findReplaceIds: 'Bul ve değiştir filtrelenmiş bir görünümde çalışır. Kullanmak için toplu düzenleyiciyi bir görünümden açın.',
    },
    filter: { placeholder: 'Bu tablodaki satırları filtrele' },
    show: { label: 'Göster', all: 'Tümü', edited: 'Düzenlenen', invalid: 'Kaydedilemeyen' },
    rows: '{count} satır · sayfa {page} / {pages}',
    col: {
      title: 'Başlık',
      price: 'Fiyat',
      qty: 'Adet',
      section: 'Bölüm',
      health: 'Sağlık',
      photos: 'Fotoğraflar',
      status: 'Durum',
      changes: 'Değişiklik',
    },
    readOnly: {
      variations: "Varyasyonlu: Fiyatı değiştir'i kullanın veya düzenleyicide varyasyon bazında düzenleyin",
      stockManaged: 'Bu adedi stok senkronu yönetiyor ({qty})',
      notEditable: '{marketplace} için henüz düzenlenemiyor',
      sending: '{to} gönderiliyor…',
    },
    invalid: {
      banner: '{count} düzenleme kaydedilemiyor: {reason}',
      show: 'Göster',
    },
    paste: {
      result: '{rows} satır × {cols} sütun yapıştırıldı · {edits} düzenleme{invalid, plural, =0 {} other { · # geçersiz}}{skipped, plural, =0 {} other { · # atlandı}}',
      overflow: '{count} satır bu sayfaya sığmadı',
      saved: 'Kaydedildi · {listings} ilan, {edits} düzenleme gönderilmedi',
    },
    stageFailed: { banner: '{count} ilan kaydedilemedi' },
    conflict: {
      banner: '{count} ilan, taslağınızdan sonra {on} üzerinde değişti. Farkları inceleyene kadar gönderimde atlanır.',
    },
    revert: {
      selected: 'Seçili satırları geri al',
      failed: '{count} ilan geri alınamadı',
    },
    send: {
      confirm: '{count} değişiklik {to} gönderilsin mi? Canlı ilanlar güncellenir.',
    },
    shortcuts: { save: 'Düzenlemeleri şimdi kaydet' },
    photos: { edit: 'Fotoğrafları düzenle…', editPro: 'Fotoğrafları düzenle… (Pro)' },
    delete: {
      cta: '{count} ilanı sil…',
      skippedEdited: 'Gönderilmemiş düzenlemesi olan {count} ilan atlandı. Önce bu düzenlemeleri gönderin veya atın.',
    },
    leaveSaving: 'Bazı düzenlemeler hâlâ kaydediliyor. Yine de çıkılsın mı?',
    mobile: {
      title: 'Toplu düzenleyici daha büyük bir ekranda çalışır',
      body: "Telefonunuzda ilan seçim çubuğundaki Fiyatı değiştir ve Etiket ekle'yi kullanın.",
    },
    error: { load: 'Bu ilanlar yüklenemedi' },
    empty: { title: 'Düzenlenecek ilan yok' },
    ai: { suggestion: 'AI önerisi · Sizinkini korumak için geri alın' },
  },
  listings: { cell: { stockManagedLink: 'Stok senkronu yönetiyor · Stok Senkronu’nu aç' } },
};

/**
 * Flattened `{ namespace, key, en, tr }` rows (the newI18nKeys list) for EVERY top-level namespace of the fragment
 * (`bulk` plus the shared `listings.cell.stockManagedLink`), so parity / ICU / collision checks cover all of them.
 */
export function flatKeys(): Array<{ namespace: string; key: string; en: string; tr: string }> {
  const out: Array<{ namespace: string; key: string; en: string; tr: string }> = [];
  const walk = (ns: string, en: Tree, tr: Tree, path: string[]) => {
    for (const [k, v] of Object.entries(en)) {
      const t = tr[k];
      if (typeof v === 'string') out.push({ namespace: ns, key: [...path, k].join('.'), en: v, tr: typeof t === 'string' ? t : '' });
      else walk(ns, v, (t as Tree) ?? {}, [...path, k]);
    }
  };
  for (const ns of Object.keys(C_EN)) walk(ns, C_EN[ns] as Tree, (C_TR[ns] as Tree) ?? {}, []);
  return out;
}
