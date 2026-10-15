// M1-c i18n keys (returned to the integrator as newI18nKeys; messages/*.json are integrator-owned).
// Tests merge these onto the real catalogs so they pass before and after the integrator merge.

export const M1C_EN = {
  ds: {
    overlay: {
      close: 'Close',
      prev: 'Previous',
      next: 'Next',
      more: 'More actions',
      cancel: 'Cancel',
      sections: 'Sections',
      actionBar: 'Actions',
      saveState: { dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', error: "Couldn't save" },
      dirtyGuard: {
        title: 'Discard your changes?',
        body: "Changes you haven't saved in this panel will be lost.",
        keep: 'Keep editing',
        discard: 'Discard',
      },
      confirm: {
        confirm: 'Confirm',
        delete: 'Delete',
        typeToConfirm: 'Type <b>{text}</b> to confirm',
        typeToConfirmAria: 'Confirmation text',
        mismatch: "The text doesn't match",
        andMore: 'and {count} more',
      },
    },
    feedback: {
      banner: { dismiss: 'Dismiss' },
      toast: { dismiss: 'Dismiss', undo: 'Undo', retry: 'Retry' },
    },
    state: {
      loading: 'Loading…',
      slow: 'Still loading…',
      error: {
        retry: 'Try again',
        retryShort: 'Retry',
        copyId: 'Copy error ID',
        copied: 'Copied',
        staleSince: 'Showing data from {time}',
        staleUnknown: 'Showing older data',
      },
      connect: { cta: 'Connect {name}' },
    },
  },
  pro: { preview: { caption: 'Example with sample data' } },
} as const;

export const M1C_TR = {
  ds: {
    overlay: {
      close: 'Kapat',
      prev: 'Önceki',
      next: 'Sonraki',
      more: 'Diğer işlemler',
      cancel: 'Vazgeç',
      sections: 'Bölümler',
      actionBar: 'İşlemler',
      saveState: { dirty: 'Kaydedilmemiş değişiklikler', saving: 'Kaydediliyor…', saved: 'Kaydedildi', error: 'Kaydedilemedi' },
      dirtyGuard: {
        title: 'Değişiklikleriniz silinsin mi?',
        body: 'Bu panelde kaydetmediğiniz değişiklikler kaybolacak.',
        keep: 'Düzenlemeye devam et',
        discard: 'Değişiklikleri sil',
      },
      confirm: {
        confirm: 'Onayla',
        delete: 'Sil',
        typeToConfirm: 'Onaylamak için <b>{text}</b> yazın',
        typeToConfirmAria: 'Onay metni',
        mismatch: 'Yazdığınız metin eşleşmiyor',
        andMore: 've {count} tane daha',
      },
    },
    feedback: {
      banner: { dismiss: 'Kapat' },
      toast: { dismiss: 'Kapat', undo: 'Geri al', retry: 'Tekrar dene' },
    },
    state: {
      loading: 'Yükleniyor…',
      slow: 'Hâlâ yükleniyor…',
      error: {
        retry: 'Tekrar dene',
        retryShort: 'Yeniden dene',
        copyId: 'Hata kimliğini kopyala',
        copied: 'Kopyalandı',
        staleSince: '{time} itibarıyla veriler gösteriliyor',
        staleUnknown: 'Eski veriler gösteriliyor',
      },
      connect: { cta: '{name} hesabını bağla' },
    },
  },
  pro: { preview: { caption: 'Örnek verilerle gösterim' } },
} as const;

type Tree = { readonly [k: string]: string | Tree };

/** Flattens to `{ namespace, key, en, tr }` rows (namespace = first segment). */
export function m1cKeyRows(): { namespace: string; key: string; en: string; tr: string }[] {
  const rows: { namespace: string; key: string; en: string; tr: string }[] = [];
  const walk = (en: Tree, tr: Tree, path: string[]) => {
    for (const k of Object.keys(en)) {
      const e = en[k];
      const t = tr[k];
      if (typeof e === 'string') rows.push({ namespace: path[0] ?? k, key: [...path, k].slice(1).join('.'), en: e, tr: t as string });
      else walk(e, t as Tree, [...path, k]);
    }
  };
  walk(M1C_EN as Tree, M1C_TR as Tree, []);
  return rows;
}
