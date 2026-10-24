// test/bulk/d-messages.ts — M7-D i18n fragment (bulk.ai.*), EN + TR. The single source for the keys returned as
// `newI18nKeys`; tests merge it over messages/{en,tr}.json until the integrator merges it.
type Tree = { [k: string]: string | Tree };

export const D_EN: Tree = {
  bulk: {
    ai: {
      action: 'Improve with AI',
      suggestion: 'AI suggestion · Revert to keep yours',
      progress: 'Improving {done} / {total}…',
      unusable: "{count, plural, one {# listing} other {# listings}} didn't get a usable suggestion",
      cost: '{count, plural, =0 {No credits used} one {# credit} other {# credits}}',
      cancel: 'Stop',
      cancelled: 'Stopped · {count, plural, one {# listing} other {# listings}} improved',
      done: '{count, plural, one {# listing} other {# listings}} improved · not sent yet',
      nothingNew: 'AI had nothing new to suggest',
      failed: "AI couldn't improve these listings. Try again.",
      failedCount: "{count, plural, one {# listing} other {# listings}} couldn't be improved",
      limitReached: "You've used all AI credits on your plan",
    },
  },
};

export const D_TR: Tree = {
  bulk: {
    ai: {
      action: 'AI ile iyileştir',
      suggestion: 'AI önerisi · Sizinkini korumak için geri alın',
      progress: 'İyileştiriliyor {done} / {total}…',
      unusable: '{count} ilan için kullanılabilir öneri gelmedi',
      cost: '{count, plural, =0 {Kredi harcamaz} other {# kredi}}',
      cancel: 'Durdur',
      cancelled: 'Durduruldu · {count} ilan iyileştirildi',
      done: '{count} ilan iyileştirildi · henüz gönderilmedi',
      nothingNew: 'AI yeni bir öneri bulamadı',
      failed: 'AI bu ilanları iyileştiremedi. Tekrar deneyin.',
      failedCount: '{count} ilan iyileştirilemedi',
      limitReached: 'Planınızdaki tüm AI kredilerini kullandınız',
    },
  },
};

function isTree(v: unknown): v is Tree {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function mergeMessages<T>(base: T, add: Tree): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(add)) {
    const cur = out[k];
    out[k] = isTree(v) && isTree(cur) ? mergeMessages(cur, v) : v;
  }
  return out as T;
}

/** Flat `{ namespace, key, en, tr }` rows (namespace = first segment). */
export function flatKeys(): Array<{ namespace: string; key: string; en: string; tr: string }> {
  const rows: Array<{ namespace: string; key: string; en: string; tr: string }> = [];
  const walk = (en: Tree, tr: Tree, path: string[]) => {
    for (const [k, v] of Object.entries(en)) {
      const t = tr[k];
      if (isTree(v)) walk(v, isTree(t) ? t : {}, [...path, k]);
      else rows.push({ namespace: path[0], key: [...path.slice(1), k].join('.'), en: v, tr: typeof t === 'string' ? t : '' });
    }
  };
  walk(D_EN, D_TR, []);
  return rows;
}
