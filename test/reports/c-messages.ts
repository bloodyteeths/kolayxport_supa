// M9 Group C i18n keys (namespace `reports`, finance-analytics §7 + C additions). Returned as newI18nKeys for the
// integrator (BUILD_PLAN §0.2); mirrored here so the render tests run before the merge. Every key here is in the
// Group C newI18nKeys list (shared keys carry the same wording as Groups D/E).
export const C_EN = {
  reports: {
    page: { title: 'Reports' },
    tabs: { sales: 'Sales', profit: 'Profit', payouts: 'Payouts', transactions: 'Transactions' },
    meta: {
      storeCount: '{count, plural, one {# store} other {# stores}}',
      ordersAsOf: 'Orders as of {time}',
      updating: 'Updating…',
      refresh: 'Refresh',
      fxNote: '≈ converted at {source} rates, {date}',
    },
    actions: {
      exportCsv: 'Export CSV',
      nothingToExport: 'Nothing to export for this period',
      exportFailed: "Couldn't export. Try again.",
      exportCap: 'Export the first {count} transactions?',
      openOrders: 'Open Orders for this period',
      showLast90: 'Show last 90 days',
      clearFilters: 'Clear filters',
      clearSearch: 'Clear search',
    },
    toolbar: { store: 'Store', all: 'All', showIn: 'Show in', notConnected: '{name} · not connected' },
    granularity: { label: 'Chart interval', hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly' },
    delta: { vsRange: 'vs {range}', vsPreviousDays: 'vs previous {days} days', noBaseline: 'No data in the previous period' },
    chart: { thisPeriod: 'This period', previousPeriod: 'Previous period ({range})', previousDay: 'Previous day' },
    sales: {
      kpi: {
        revenue: 'Revenue',
        orders: 'Orders',
        aov: 'Average order',
        units: 'Units sold',
        source: 'Orders · {count, plural, one {# store} other {# stores}}',
        excludes: 'Excludes {count, plural, one {# order} other {# orders}}',
      },
      chart: {
        revenueTitle: 'Revenue over time',
        ordersTitle: 'Orders over time',
        hourlyTitle: 'Orders by hour',
        metricRevenue: 'Revenue',
        metricOrders: 'Orders',
      },
      stores: {
        title: 'Sales by store',
        store: 'Store',
        orders: 'Orders',
        units: 'Units',
        revenueOriginal: 'Revenue (original)',
        mobileMeta: '{orders, plural, one {# order} other {# orders}} · {units, plural, one {# unit} other {# units}} · {share}',
        revenueConverted: 'Revenue ({symbol})',
        share: 'Share',
        aov: 'Avg order',
        manual: 'Manual orders',
      },
      products: { title: 'Top products', search: 'Search product or SKU', product: 'Product', units: 'Units', revenue: 'Revenue', unitsMeta: '{count, plural, one {# unit} other {# units}}' },
      status: { title: 'Orders by status' },
    },
    fx: {
      unconverted: '{count, plural, one {# order} other {# orders}} in {currencies} left out of totals: no exchange rate.',
      stale: "Exchange rates couldn't be updated. Using rates from {date}.",
      approx: 'Converted from {currencies} at {source} rates ({date})',
    },
    csv: {
      marketplace: 'Marketplace',
      currency: 'Currency',
      sku: 'SKU',
      bucket: 'Period',
      previousOrders: 'Orders (previous period)',
      previousRevenue: 'Revenue (previous period)',
    },
    empty: {
      connect: {
        title: 'Connect a store to see your sales',
        body: 'Orders from every store you connect show up here together.',
        action: 'Connect a store',
      },
      noOrders: { title: 'No orders in this period', body: 'Try a longer date range.' },
      noMatch: 'No stores match this filter',
      noProducts: 'No products sold in this period',
      noProductMatch: 'No products match "{q}"',
    },
    error: { sales: "Couldn't load your sales", rangeTooLong: 'Choose a range of up to 2 years' },
  },
};

export const C_TR = {
  reports: {
    page: { title: 'Raporlar' },
    tabs: { sales: 'Satışlar', profit: 'Kâr', payouts: 'Ödemeler', transactions: 'İşlemler' },
    meta: {
      storeCount: '{count, plural, one {# mağaza} other {# mağaza}}',
      ordersAsOf: 'Siparişler {time} itibarıyla',
      updating: 'Güncelleniyor…',
      refresh: 'Yenile',
      fxNote: '≈ {source} kurlarıyla çevrildi, {date}',
    },
    actions: {
      exportCsv: 'CSV indir',
      nothingToExport: 'Bu dönem için indirilecek veri yok',
      exportFailed: 'İndirilemedi. Tekrar deneyin.',
      exportCap: 'İlk {count} işlem indirilsin mi?',
      openOrders: 'Bu dönemin siparişlerini aç',
      showLast90: 'Son 90 günü göster',
      clearFilters: 'Filtreleri temizle',
      clearSearch: 'Aramayı temizle',
    },
    toolbar: { store: 'Mağaza', all: 'Tümü', showIn: 'Para birimi', notConnected: '{name} · bağlı değil' },
    granularity: { label: 'Grafik aralığı', hour: 'Saatlik', day: 'Günlük', week: 'Haftalık', month: 'Aylık' },
    delta: { vsRange: '{range} dönemine göre', vsPreviousDays: 'önceki {days} güne göre', noBaseline: 'Önceki dönemde veri yok' },
    chart: { thisPeriod: 'Bu dönem', previousPeriod: 'Önceki dönem ({range})', previousDay: 'Önceki gün' },
    sales: {
      kpi: {
        revenue: 'Ciro',
        orders: 'Siparişler',
        aov: 'Ortalama sipariş',
        units: 'Satılan adet',
        source: 'Siparişler · {count} mağaza',
        excludes: '{count} sipariş hariç',
      },
      chart: {
        revenueTitle: 'Zaman içinde ciro',
        ordersTitle: 'Zaman içinde siparişler',
        hourlyTitle: 'Saate göre siparişler',
        metricRevenue: 'Ciro',
        metricOrders: 'Siparişler',
      },
      stores: {
        title: 'Mağazaya göre satışlar',
        store: 'Mağaza',
        orders: 'Sipariş',
        units: 'Adet',
        revenueOriginal: 'Ciro (orijinal)',
        mobileMeta: '{orders} sipariş · {units} adet · {share}',
        revenueConverted: 'Ciro ({symbol})',
        share: 'Pay',
        aov: 'Ort. sipariş',
        manual: 'Manuel siparişler',
      },
      products: { title: 'En çok satan ürünler', search: 'Ürün veya SKU ara', product: 'Ürün', units: 'Adet', revenue: 'Ciro', unitsMeta: '{count} adet' },
      status: { title: 'Duruma göre siparişler' },
    },
    fx: {
      unconverted: '{currencies} cinsinden {count} sipariş toplamlara dahil edilmedi: döviz kuru yok.',
      stale: 'Döviz kurları güncellenemedi. {date} tarihli kurlar kullanılıyor.',
      approx: '{currencies} tutarları {source} kurlarıyla çevrildi ({date})',
    },
    csv: {
      marketplace: 'Pazaryeri',
      currency: 'Para birimi',
      sku: 'SKU',
      bucket: 'Dönem',
      previousOrders: 'Sipariş (önceki dönem)',
      previousRevenue: 'Ciro (önceki dönem)',
    },
    empty: {
      connect: {
        title: 'Satışlarınızı görmek için bir mağaza bağlayın',
        body: 'Bağladığınız tüm mağazaların siparişleri burada bir arada görünür.',
        action: 'Mağaza bağla',
      },
      noOrders: { title: 'Bu dönemde sipariş yok', body: 'Daha uzun bir tarih aralığı deneyin.' },
      noMatch: 'Bu filtreye uyan mağaza yok',
      noProducts: 'Bu dönemde ürün satılmadı',
      noProductMatch: '"{q}" ile eşleşen ürün yok',
    },
    error: { sales: 'Satışlarınız yüklenemedi', rangeTooLong: 'En fazla 2 yıllık bir aralık seçin' },
  },
};

type Tree = { [k: string]: string | Tree };

/** Flattened rows `{ key, en, tr }` (key without the namespace), for the parity test and newI18nKeys. */
export function flatKeys(): { key: string; en: string; tr: string }[] {
  const out: { key: string; en: string; tr: string }[] = [];
  const walk = (en: Tree, tr: Tree, prefix: string) => {
    for (const [k, v] of Object.entries(en)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') out.push({ key, en: v, tr: String((tr as Tree)?.[k] ?? '') });
      else walk(v, ((tr as Tree)?.[k] as Tree) ?? {}, key);
    }
  };
  walk(C_EN.reports as Tree, C_TR.reports as Tree, '');
  return out;
}
