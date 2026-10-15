// test/settings/a-messages.ts — settings group A strings (shell, nav, unsaved guard, save bar).
// Source of the group's newI18nKeys (the integrator merges them into messages/{en,tr}.json). `withGroupA`
// layers them over the real message files for the render tests; once merged it is a no-op merge.
// `billing.planName.*` is group D's (settings §15.2), included only so the tests render.
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

type Tree = { [k: string]: string | Tree };

export const groupA: { en: { settings: Tree; billing: Tree }; tr: { settings: Tree; billing: Tree } } = {
  en: {
    settings: {
      pageSubtitle: 'Connections, carriers, sender address and your plan',
      nav: {
        group: { workspace: 'Workspace', shipping: 'Shipping', account: 'Account', system: 'System' },
        connections: 'Connections',
        apiKeys: 'Carriers & API keys',
        senderProfile: 'Sender profile',
        billing: 'Plan & billing',
        billingShopify: 'Plan',
        preferences: 'Preferences',
        syncAdvanced: 'Refresh history',
        summary: {
          connections: '{connected} connected{attention, plural, =0 {} other { · # needs attention}}',
          apiKeys: '{done} of {total} set up',
          billing: '{plan} · {percent}% of orders used',
          billingShopify: 'Included with Shopify',
        },
        dot: {
          needsAttention: 'A connection needs attention',
          unsaved: 'Unsaved changes',
          billing: 'Your plan needs attention',
          runFailed: 'The last refresh failed',
        },
      },
      unsaved: { title: 'Discard unsaved changes?', keep: 'Keep editing', discard: 'Discard' },
      saveBar: { status: 'Unsaved changes', discard: 'Discard', save: 'Save changes', saving: 'Saving…' },
      sender: { saved: 'Sender profile saved' },
      saveFailed: "Couldn't save. Your changes are still here.",
    },
    billing: {
      planName: { trial: 'Free trial', starter: 'Starter', growth: 'Growth', pro: 'Pro', enterprise: 'Enterprise', shopify_free: 'Shopify plan', none: 'No plan' },
    },
  },
  tr: {
    settings: {
      pageSubtitle: 'Bağlantılar, kargo firmaları, gönderici adresi ve planınız',
      nav: {
        group: { workspace: 'Çalışma alanı', shipping: 'Gönderim', account: 'Hesap', system: 'Sistem' },
        connections: 'Bağlantılar',
        apiKeys: 'Kargo ve API anahtarları',
        senderProfile: 'Gönderici profili',
        billing: 'Plan ve faturalandırma',
        billingShopify: 'Plan',
        preferences: 'Tercihler',
        syncAdvanced: 'Yenileme geçmişi',
        summary: {
          connections: '{connected} bağlı{attention, plural, =0 {} other { · # dikkat gerektiriyor}}',
          apiKeys: '{total} servisten {done} tanesi kurulu',
          billing: '{plan} · siparişlerin %{percent} kullanıldı',
          billingShopify: 'Shopify ile dahil',
        },
        dot: {
          needsAttention: 'Bir bağlantı dikkat gerektiriyor',
          unsaved: 'Kaydedilmemiş değişiklikler',
          billing: 'Planınız dikkat gerektiriyor',
          runFailed: 'Son yenileme başarısız oldu',
        },
      },
      unsaved: { title: 'Kaydedilmemiş değişiklikler silinsin mi?', keep: 'Düzenlemeye devam et', discard: 'Sil' },
      saveBar: { status: 'Kaydedilmemiş değişiklikler', discard: 'Vazgeç', save: 'Değişiklikleri kaydet', saving: 'Kaydediliyor…' },
      sender: { saved: 'Gönderici profili kaydedildi' },
      saveFailed: 'Kaydedilemedi. Değişiklikleriniz duruyor.',
    },
    billing: {
      planName: { trial: 'Ücretsiz deneme', starter: 'Starter', growth: 'Growth', pro: 'Pro', enterprise: 'Enterprise', shopify_free: 'Shopify planı', none: 'Plan yok' },
    },
  },
};

function merge(base: Tree, add: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(add)) {
    const cur = out[k];
    out[k] = typeof v === 'object' && cur && typeof cur === 'object' ? merge(cur, v) : v;
  }
  return out;
}

/** Real messages + group A strings. */
export function withGroupA(locale: 'en' | 'tr'): Tree {
  const real = (locale === 'en' ? en : tr) as unknown as Tree;
  return merge(real, groupA[locale] as unknown as Tree);
}

/** Flatten to `namespace.key` paths (for the parity test and the newI18nKeys list). */
export function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[path] = v;
    else Object.assign(out, flatten(v, path));
  }
  return out;
}
