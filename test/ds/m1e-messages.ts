// M1-e i18n keys (returned to the integrator as newI18nKeys; messages/*.json are integrator-owned).
// Tests render with these until the integrator merges them, then they must equal the merged files.
export const m1eMessagesEn = {
  ds: {
    page: {
      documentTitle: '{title} · KolayXport',
      back: 'Back',
      moreActions: 'More actions',
    },
    syncMeta: {
      refreshed: 'Refreshed from {source} {relative}',
      refreshedAll: 'Refreshed {relative}',
      refreshing: 'Refreshing from {source}…',
      refreshingAll: 'Refreshing…',
      progress: '{done, number} / {total, number}',
      failed: "Couldn't refresh from {source}",
      failedAll: "Couldn't refresh",
      retry: 'Retry',
      pull: 'Refresh from {source}',
      pullAll: 'Refresh',
    },
    toolbar: {
      all: 'All',
      filterLabel: '{label}:',
      andMore: '{first} +{count}',
      searchOptions: 'Search options',
      noOptions: 'No matches',
      clearSearch: 'Clear search',
      filters: 'Filters',
      filtersWithCount: 'Filters • {count}',
      close: 'Close',
      clear: 'Clear',
      clearAll: 'Clear all',
      removeFilter: 'Remove filter: {label}',
      chip: '{label}: {value}',
      results: '{count, plural, one {# result} other {# results}}',
      showResults: '{count, plural, one {Show # result} other {Show # results}}',
      done: 'Done',
      min: 'Min',
      max: 'Max',
      yes: 'Yes',
      between: '{a} – {b}',
      atLeast: '≥ {a}',
      atMost: '≤ {a}',
      view: 'View',
      myViews: 'My views',
      saveView: 'Save view…',
      viewName: 'View name',
      save: 'Save',
      deleteView: 'Delete view {label}',
      compactRows: 'Compact rows',
    },
    bulk: {
      selected: '{count, number} selected',
      clear: 'Clear selection',
      clearWithKey: 'Clear (Esc)',
      selectAllInView: 'Select all {count, number} in this view',
      selectOnlyPage: 'Select only these {count, number}',
    },
  },
} as const;

// TR source phrases take the ablative case suffix, which depends on the brand's pronunciation
// (DS §3.19 glossary: "Etsy'den yenile · 12 dk önce yenilendi"), so they select on the logo key.
export const m1eMessagesTr = {
  ds: {
    page: {
      documentTitle: '{title} · KolayXport',
      back: 'Geri',
      moreActions: 'Diğer işlemler',
    },
    syncMeta: {
      refreshed: "{key, select, etsy {Etsy'den} ebay {eBay'den} amazon {Amazon'dan} shopify {Shopify'dan} wix {Wix'ten} trendyol {Trendyol'dan} hepsiburada {Hepsiburada'dan} fedex {FedEx'ten} ups {UPS'ten} dhl {DHL'den} veeqo {Veeqo'dan} shippo {Shippo'dan} parasut {Paraşüt'ten} google {Google'dan} other {{source} kaynağından}} {relative} yenilendi",
      refreshedAll: '{relative} yenilendi',
      refreshing: "{key, select, etsy {Etsy'den} ebay {eBay'den} amazon {Amazon'dan} shopify {Shopify'dan} wix {Wix'ten} trendyol {Trendyol'dan} hepsiburada {Hepsiburada'dan} fedex {FedEx'ten} ups {UPS'ten} dhl {DHL'den} veeqo {Veeqo'dan} shippo {Shippo'dan} parasut {Paraşüt'ten} google {Google'dan} other {{source} kaynağından}} yenileniyor…",
      refreshingAll: 'Yenileniyor…',
      progress: '{done, number} / {total, number}',
      failed: "{key, select, etsy {Etsy'den} ebay {eBay'den} amazon {Amazon'dan} shopify {Shopify'dan} wix {Wix'ten} trendyol {Trendyol'dan} hepsiburada {Hepsiburada'dan} fedex {FedEx'ten} ups {UPS'ten} dhl {DHL'den} veeqo {Veeqo'dan} shippo {Shippo'dan} parasut {Paraşüt'ten} google {Google'dan} other {{source} kaynağından}} yenilenemedi",
      failedAll: 'Yenilenemedi',
      retry: 'Tekrar dene',
      pull: "{key, select, etsy {Etsy'den} ebay {eBay'den} amazon {Amazon'dan} shopify {Shopify'dan} wix {Wix'ten} trendyol {Trendyol'dan} hepsiburada {Hepsiburada'dan} fedex {FedEx'ten} ups {UPS'ten} dhl {DHL'den} veeqo {Veeqo'dan} shippo {Shippo'dan} parasut {Paraşüt'ten} google {Google'dan} other {{source} kaynağından}} yenile",
      pullAll: 'Yenile',
    },
    toolbar: {
      all: 'Tümü',
      filterLabel: '{label}:',
      andMore: '{first} +{count}',
      searchOptions: 'Seçeneklerde ara',
      noOptions: 'Eşleşme yok',
      clearSearch: 'Aramayı temizle',
      filters: 'Filtreler',
      filtersWithCount: 'Filtreler • {count}',
      close: 'Kapat',
      clear: 'Temizle',
      clearAll: 'Tümünü temizle',
      removeFilter: 'Filtreyi kaldır: {label}',
      chip: '{label}: {value}',
      results: '{count, plural, other {# sonuç}}',
      showResults: '{count, plural, other {# sonucu göster}}',
      done: 'Tamam',
      min: 'En az',
      max: 'En çok',
      yes: 'Evet',
      between: '{a} – {b}',
      atLeast: '≥ {a}',
      atMost: '≤ {a}',
      view: 'Görünüm',
      myViews: 'Görünümlerim',
      saveView: 'Görünümü kaydet…',
      viewName: 'Görünüm adı',
      save: 'Kaydet',
      deleteView: '{label} görünümünü sil',
      compactRows: 'Kompakt satırlar',
    },
    bulk: {
      selected: '{count, number} seçili',
      clear: 'Seçimi temizle',
      clearWithKey: 'Temizle (Esc)',
      selectAllInView: 'Bu görünümdeki {count, number} öğenin tümünü seç',
      selectOnlyPage: 'Yalnızca bu {count, number} öğeyi seç',
    },
  },
} as const;

type Leaf = string;
type Tree = { [k: string]: Tree | Leaf };
/** Flatten to `{ namespace: 'ds.page', key, en, tr }` rows (used to emit newI18nKeys + parity test). */
export function flattenM1eKeys(): { namespace: string; key: string; en: string; tr: string }[] {
  const out: { namespace: string; key: string; en: string; tr: string }[] = [];
  const walk = (en: Tree, tr: Tree, path: string[]) => {
    for (const [k, v] of Object.entries(en)) {
      if (typeof v === 'string') out.push({ namespace: path.join('.'), key: k, en: v, tr: tr[k] as string });
      else walk(v, tr[k] as Tree, [...path, k]);
    }
  };
  walk(m1eMessagesEn as unknown as Tree, m1eMessagesTr as unknown as Tree, []);
  return out;
}
