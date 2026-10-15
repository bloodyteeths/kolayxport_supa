// M7-A i18n keys (namespaces `ds.grid` and `bulk`). Every key here is returned in the M7-A result
// (`newI18nKeys`); the integrator merges them. Tests merge them on top of the current message files.
export const m7aEn = {
  ds: {
    grid: {
      counter: '{value}/{max}',
      tooLong: 'Use at most {max} characters ({length} now)',
      noOption: '“{value}” isn’t one of the options',
      revert: 'Revert',
      readOnly: 'Read-only: {reason}',
      invalid: 'Can’t be saved: {reason}',
      edited: 'Edited, not sent',
    },
  },
  bulk: {
    invalid: {
      currency: 'Currency doesn’t match this shop ({currency})',
      enterValue: 'Enter a value',
    },
    paste: {
      result: 'Pasted {rows} rows × {cols} columns · {edits} edits{invalid, plural, =0 {} other { · # invalid}}{skipped, plural, =0 {} other { · # skipped}}',
      notRect: 'The copied cells aren’t a rectangle (rows have different lengths). Copy a block of cells and paste again.',
      readOnlyColumn: 'Can’t paste into {column}. Start the paste in an editable column.',
      overflow: '{count, plural, one {# row didn’t fit} other {# rows didn’t fit}} on this page',
      colOverflow: '{count, plural, one {# column didn’t fit and wasn’t pasted} other {# columns didn’t fit and weren’t pasted}}',
      skippedReason: '{count, plural, one {# cell skipped} other {# cells skipped}}: {reason}',
      unchanged: '{count, plural, one {# cell already had this value} other {# cells already had these values}}',
    },
    fill: {
      done: 'Filled {count} cells',
      confirmTags: 'Replace tags on {count} listings with these {tags}?',
    },
    revert: {
      cell: 'Revert cell',
      row: 'Revert row',
      selected: 'Revert selected rows',
    },
    shortcuts: {
      noUndo: 'There’s no undo. Use Revert cell (⌥⌫) to restore the value on {on}.',
    },
  },
};

export const m7aTr: typeof m7aEn = {
  ds: {
    grid: {
      counter: '{value}/{max}',
      tooLong: 'En fazla {max} karakter kullanın (şu an {length})',
      noOption: '“{value}” seçeneklerden biri değil',
      revert: 'Geri al',
      readOnly: 'Salt okunur: {reason}',
      invalid: 'Kaydedilemiyor: {reason}',
      edited: 'Düzenlendi, gönderilmedi',
    },
  },
  bulk: {
    invalid: {
      currency: 'Para birimi bu mağazayla eşleşmiyor ({currency})',
      enterValue: 'Bir değer girin',
    },
    paste: {
      result: '{rows} satır × {cols} sütun yapıştırıldı · {edits} düzenleme{invalid, plural, =0 {} other { · # geçersiz}}{skipped, plural, =0 {} other { · # atlandı}}',
      notRect: 'Kopyalanan hücreler dikdörtgen değil (satır uzunlukları farklı). Bir hücre bloğu kopyalayıp tekrar yapıştırın.',
      readOnlyColumn: '{column} sütununa yapıştırılamaz. Yapıştırmaya düzenlenebilir bir sütundan başlayın.',
      overflow: '{count} satır bu sayfaya sığmadı',
      colOverflow: '{count} sütun sığmadı ve yapıştırılmadı',
      skippedReason: '{count} hücre atlandı: {reason}',
      unchanged: '{count} hücre zaten bu değere sahipti',
    },
    fill: {
      done: '{count} hücre dolduruldu',
      confirmTags: '{count} ilandaki etiketler bu {tags} etiketle değiştirilsin mi?',
    },
    revert: {
      cell: 'Hücreyi geri al',
      row: 'Satırı geri al',
      selected: 'Seçili satırları geri al',
    },
    shortcuts: {
      noUndo: 'Geri alma yok. {on} değerine dönmek için Hücreyi geri al’ı (⌥⌫) kullanın.',
    },
  },
};
