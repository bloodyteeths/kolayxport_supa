// test/ds/m1b-messages.ts — the M1-b `ds.inputs.*` strings (returned to the integrator as newI18nKeys) and a
// helper that merges them into messages/{en,tr}.json for the render tests. Once the integrator merges the keys,
// `withM1b` becomes a no-op merge.
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

type Tree = { [k: string]: string | Tree };

export const m1bInputs: { en: Tree; tr: Tree } = {
  en: {
    charCount: '{value} / {max}',
    formField: { optional: '(optional)', changed: 'Changed', revert: 'Revert', revertLabel: 'Revert {label}' },
    textArea: { modeLabel: 'Edit or preview', edit: 'Edit', preview: 'Preview' },
    splitButton: { more: 'More options for {label}' },
    tagInput: {
      placeholder: 'Type a tag and press Enter',
      tooLong: '“{tag}” is {length} / {max} characters',
      duplicate: 'Already added: “{tag}”',
      invalid: '“{tag}” can’t be used as a tag',
      overLimit: '{max} tags is the limit. Remove one to add another',
      summary: 'Added {added}. Not added: {details}',
      reason: {
        too_long: '{count} too long',
        duplicate: '{count, plural, one {# duplicate} other {# duplicates}}',
        invalid: '{count} invalid',
        over_limit: '{count} over the limit',
      },
      show: 'Show',
      hide: 'Hide',
      remove: 'Remove tag {tag}',
      overlap: 'Repeats “{words}” from the title. Tags work better with new words',
      singleWord: 'Two- or three-word tags match more searches',
      chipCounter: '{value}/{max}',
      suggestions: 'Suggestions',
      addSuggestion: 'Add tag {tag}',
      addAll: 'Add all that fit',
    },
    dateRange: {
      any: 'Any date',
      labelValue: '{label}: {value}',
      presets: 'Date presets',
      pickEnd: 'Pick the end date',
      dialogLabel: 'Choose dates',
      preset: {
        today: 'Today', yesterday: 'Yesterday', last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days',
        thisMonth: 'This month', lastMonth: 'Last month', thisYear: 'This year', lastYear: 'Last year', custom: 'Custom',
      },
    },
    dateTime: {
      zone: '{zone} ({offset})',
      time: 'Time',
      timePlaceholder: 'Pick a time',
      placeholder: 'Pick a date and time',
      dialogLabel: 'Choose date and time',
      clear: 'Clear',
      done: 'Done',
    },
    suggestion: {
      label: 'Suggestion',
      writing: 'Writing…',
      error: 'The suggestion didn’t come out right',
      dismiss: 'Dismiss',
      retry: 'Try again',
      retryCost: 'Try again · {count, plural, one {# credit} other {# credits}}',
      use: 'Use',
    },
    combobox: {
      create: 'Create “{value}”',
      loading: 'Loading…',
      loadFailed: 'Couldn’t load options',
      noResults: 'No results',
      clear: 'Clear',
      open: 'Open',
      close: 'Close',
      remove: 'Remove {value}',
    },
    phone: { country: 'Country code', number: 'Phone number' },
    rates: {
      label: 'Carrier and service',
      loading: 'Loading rates',
      error: 'Couldn’t get rates',
      retry: 'Try again',
      empty: 'No rates for this package',
      recommended: 'Recommended',
      transit: '{count, plural, one {# day} other {# days}}',
      transitRange: '{min}–{max} days',
    },
    images: {
      label: 'Photos',
      hint: 'Drag to reorder. The first photo is the main photo.',
      count: '{value} / {max}',
      tile: 'Photo {position} of {total}: {alt}',
      noAlt: 'no alt text',
      lifted: 'Photo {position} of {total} picked up. Use the arrow keys to move it and Space to drop it.',
      moved: 'Moved to position {position} of {total}',
      dropped: 'Dropped at position {position} of {total}',
      cancelled: 'Reorder cancelled',
      new: 'New',
      missingAlt: 'Missing alt text',
      willBeRemoved: 'Will be removed',
      undo: 'Undo',
      remove: 'Remove photo {position}',
      upload: 'Upload photos',
      add: 'Add photos',
    },
  },
  tr: {
    charCount: '{value} / {max}',
    formField: { optional: '(isteğe bağlı)', changed: 'Değiştirildi', revert: 'Geri al', revertLabel: '{label} alanını geri al' },
    textArea: { modeLabel: 'Düzenle veya önizle', edit: 'Düzenle', preview: 'Önizleme' },
    splitButton: { more: '{label} için diğer seçenekler' },
    tagInput: {
      placeholder: 'Bir etiket yazıp Enter’a basın',
      tooLong: '“{tag}” {length} / {max} karakter',
      duplicate: 'Zaten eklendi: “{tag}”',
      invalid: '“{tag}” etiket olarak kullanılamaz',
      overLimit: 'En fazla {max} etiket eklenebilir. Yenisini eklemek için birini kaldırın',
      summary: '{added} eklendi. Eklenmeyen: {details}',
      reason: {
        too_long: '{count} çok uzun',
        duplicate: '{count} tekrar',
        invalid: '{count} geçersiz',
        over_limit: '{count} sınırı aşıyor',
      },
      show: 'Göster',
      hide: 'Gizle',
      remove: '{tag} etiketini kaldır',
      overlap: 'Başlıktaki “{words}” kelimesini tekrarlıyor. Etiketler yeni kelimelerle daha iyi çalışır',
      singleWord: 'İki veya üç kelimelik etiketler daha çok aramayla eşleşir',
      chipCounter: '{value}/{max}',
      suggestions: 'Öneriler',
      addSuggestion: '{tag} etiketini ekle',
      addAll: 'Sığanların hepsini ekle',
    },
    dateRange: {
      any: 'Tüm tarihler',
      labelValue: '{label}: {value}',
      presets: 'Hazır tarih aralıkları',
      pickEnd: 'Bitiş tarihini seçin',
      dialogLabel: 'Tarih seçin',
      preset: {
        today: 'Bugün', yesterday: 'Dün', last7: 'Son 7 gün', last30: 'Son 30 gün', last90: 'Son 90 gün',
        thisMonth: 'Bu ay', lastMonth: 'Geçen ay', thisYear: 'Bu yıl', lastYear: 'Geçen yıl', custom: 'Özel',
      },
    },
    dateTime: {
      zone: '{zone} ({offset})',
      time: 'Saat',
      timePlaceholder: 'Saat seçin',
      placeholder: 'Tarih ve saat seçin',
      dialogLabel: 'Tarih ve saat seçin',
      clear: 'Temizle',
      done: 'Tamam',
    },
    suggestion: {
      label: 'Öneri',
      writing: 'Yazılıyor…',
      error: 'Öneri düzgün oluşmadı',
      dismiss: 'Kapat',
      retry: 'Tekrar dene',
      retryCost: 'Tekrar dene · {count} kredi',
      use: 'Kullan',
    },
    combobox: {
      create: '“{value}” oluştur',
      loading: 'Yükleniyor…',
      loadFailed: 'Seçenekler yüklenemedi',
      noResults: 'Sonuç yok',
      clear: 'Temizle',
      open: 'Aç',
      close: 'Kapat',
      remove: '{value} kaldır',
    },
    phone: { country: 'Ülke kodu', number: 'Telefon numarası' },
    rates: {
      label: 'Kargo firması ve hizmet',
      loading: 'Fiyatlar yükleniyor',
      error: 'Fiyatlar alınamadı',
      retry: 'Tekrar dene',
      empty: 'Bu paket için fiyat yok',
      recommended: 'Önerilen',
      transit: '{count} gün',
      transitRange: '{min}–{max} gün',
    },
    images: {
      label: 'Fotoğraflar',
      hint: 'Sıralamak için sürükleyin. İlk fotoğraf ana fotoğraftır.',
      count: '{value} / {max}',
      tile: 'Fotoğraf {position} / {total}: {alt}',
      noAlt: 'alternatif metin yok',
      lifted: 'Fotoğraf {position} / {total} seçildi. Taşımak için ok tuşlarını, bırakmak için Boşluk tuşunu kullanın.',
      moved: '{total} içinde {position}. sıraya taşındı',
      dropped: '{total} içinde {position}. sıraya bırakıldı',
      cancelled: 'Sıralama iptal edildi',
      new: 'Yeni',
      missingAlt: 'Alternatif metin eksik',
      willBeRemoved: 'Kaldırılacak',
      undo: 'Geri al',
      remove: '{position}. fotoğrafı kaldır',
      upload: 'Fotoğraf yükle',
      add: 'Fotoğraf ekle',
    },
  },
};

function deepMerge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = typeof v === 'object' && typeof cur === 'object' ? deepMerge(cur, v) : v;
  }
  return out;
}

export type Locale = 'en' | 'tr';

/** App messages for `locale` with `ds.inputs` added (keys in the JSON win once the integrator merged them). */
export function withM1b(locale: Locale): Tree {
  const base = (locale === 'en' ? en : tr) as unknown as Tree;
  return deepMerge({ ds: { inputs: m1bInputs[locale] } }, base);
}

/** Flatten to `{ namespace: 'ds', key: 'inputs.x.y', en, tr }` rows for the integrator. */
export function flattenM1b(): { namespace: string; key: string; en: string; tr: string }[] {
  const rows: { namespace: string; key: string; en: string; tr: string }[] = [];
  const walk = (node: Tree, trNode: Tree, path: string[]) => {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') rows.push({ namespace: 'ds', key: ['inputs', ...path, k].join('.'), en: v, tr: String(trNode?.[k] ?? '') });
      else walk(v, (trNode?.[k] as Tree) ?? {}, [...path, k]);
    }
  };
  walk(m1bInputs.en, m1bInputs.tr, []);
  return rows;
}
