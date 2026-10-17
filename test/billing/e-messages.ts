// Settings Group E (public pricing page) i18n keys, EN + TR — returned to the integrator as newI18nKeys
// (messages/*.json are integrator-owned). Namespace `marketing.pricingV2`: settings §15.4 content under a
// new sub-namespace, because the legacy page behind the `pricing` flag still reads `marketing.pricing.*`
// (`faq` is an array there and `seo.description` has no {price}), so the §15.4 rewrite cannot share keys
// with it until the legacy page is deleted. Tests merge these onto the real catalogs.
//
// `reviewerSummary.*` is English in BOTH locales on purpose (settings §14 P5 exception, `lang="en"`).

export interface I18nKey {
  namespace: string;
  key: string;
  en: string;
  tr: string;
}

const P = 'pricingV2';
const k = (key: string, en: string, tr: string): I18nKey => ({ namespace: 'marketing', key: `${P}.${key}`, en, tr });

export const E_KEYS: readonly I18nKey[] = [
  k('seo.title', 'Pricing · KolayXport', 'Fiyatlandırma · KolayXport'),
  k('seo.description', 'From {price} a month. 14 days free, no card needed.', 'Aylık {price} fiyatından başlayan planlar. 14 gün ücretsiz, kart gerekmez.'),
  k('seo.descriptionNeutral', 'Plans for orders, labels, listings and research. 14 days free, no card needed.', 'Siparişler, etiketler, ilanlar ve araştırma için planlar. 14 gün ücretsiz, kart gerekmez.'),
  k('accountError.title', "Couldn't check your account", 'Hesabınız kontrol edilemedi'),
  k('accountError.cause', 'Reload the page to see plans for your account.', 'Hesabınıza uygun planları görmek için sayfayı yenileyin.'),
  k('accountError.reload', 'Reload', 'Yenile'),
  k('seo.ogAlt', 'KolayXport pricing plans', 'KolayXport fiyat planları'),
  k('title', 'Pricing', 'Fiyatlandırma'),
  k('subtitle', 'Orders, labels, listings and research for Etsy, eBay, Amazon, Trendyol and more.', 'Etsy, eBay, Amazon, Trendyol ve daha fazlası için siparişler, etiketler, ilanlar ve araştırma.'),
  k('trialLine', '14 days free. No card needed.', '14 gün ücretsiz. Kart gerekmez.'),
  k('interval.label', 'Billing period', 'Ödeme dönemi'),
  k('interval.monthly', 'Monthly', 'Aylık'),
  k('interval.yearly', 'Yearly · 2 months free', 'Yıllık · 2 ay bedava'),
  k('currency.label', 'Currency', 'Para birimi'),
  k('currency.try', '₺ TRY', '₺ TL'),
  k('currency.usd', '$ USD', '$ USD'),
  k('currency.locked', 'Your account is billed in {currency}.', 'Hesabınız {currency} ile faturalandırılıyor.'),
  k('founding.offer', 'Founding member offer: {percent}% off for life for our first {total} subscribers', 'Kurucu üye fırsatı: İlk {total} aboneye ömür boyu %{percent} indirim'),
  k('founding.count', '{remaining} of {total} spots left', '{total} yerden {remaining} tanesi kaldı'),
  k('founding.few', 'Only {remaining, plural, one {# spot} other {# spots}} left', 'Yalnızca {remaining} yer kaldı'),
  k('founding.priceNote', 'Founding price, for life', 'Kurucu üye fiyatı, ömür boyu'),
  k('founding.priceNoteYearly', 'Founding price, for life · {price} a month', 'Kurucu üye fiyatı, ömür boyu · Aylık {price} karşılığı'),
  k('founding.fullTitle', 'The founding spots just ran out', 'Kurucu üye kontenjanı az önce doldu'),
  k('founding.fullBody', '{plan} is {price}. Continue to checkout?', '{plan} planı {price}. Ödemeye devam edilsin mi?'),
  k('founding.fullPriceMonth', '{price} a month', 'aylık {price}'),
  k('founding.fullPriceYear', '{price} a year', 'yıllık {price}'),
  k('founding.continue', 'Continue', 'Devam et'),
  k('founding.notNow', 'Not now', 'Şimdi değil'),
  k('mostPopular', 'Most popular', 'En çok tercih edilen'),
  k('perMonth', '/ month', '/ ay'),
  k('perYear', '/ year', '/ yıl'),
  k('listPrice', 'Regular price {price}', 'Normal fiyat {price}'),
  k('monthlyEquivalent', '{price} a month · 2 months free', 'Aylık {price} karşılığı · 2 ay bedava'),
  k('customPrice', 'Custom pricing', 'Size özel fiyat'),
  k('plansRegion', 'Plans and prices', 'Planlar ve fiyatlar'),
  k('plans.starter.name', 'Starter', 'Starter'),
  k('plans.growth.name', 'Growth', 'Growth'),
  k('plans.pro.name', 'Pro', 'Pro'),
  k('plans.enterprise.name', 'Enterprise', 'Enterprise'),
  k('plans.starter.tagline', 'For one or two stores', 'Bir veya iki mağaza için'),
  k('plans.growth.tagline', 'For growing shops on every marketplace', 'Her pazaryerinde büyüyen mağazalar için'),
  k('plans.pro.tagline', 'For multi-store teams that need finance and arbitrage', 'Finans ve arbitraj ihtiyacı olan çok mağazalı ekipler için'),
  k('plans.enterprise.tagline', 'For high volume and custom setups', 'Yüksek hacim ve özel kurulumlar için'),
  k('limit.orders', '{count} orders a month', 'Ayda {count} sipariş'),
  k('limit.labels', '{count} labels a month', 'Ayda {count} etiket'),
  k('limit.stores', '{n, plural, one {{count} connected store} other {{count} connected stores}}', '{count} bağlı mağaza'),
  k('limit.ai', '{count} AI credits a month', 'Ayda {count} AI kredisi'),
  k('limit.unlimitedOrders', 'Unlimited orders', 'Sınırsız sipariş'),
  k('limit.unlimitedLabels', 'Unlimited labels', 'Sınırsız etiket'),
  k('limit.unlimitedStores', 'Unlimited stores', 'Sınırsız mağaza'),
  k('limit.unlimitedAi', 'Unlimited AI', 'Sınırsız AI'),
  k('feature.listing', 'Listing and bulk editing', 'İlan ve toplu düzenleme'),
  k('feature.labels', 'Shipping labels', 'Kargo etiketleri'),
  k('feature.research', 'Research tools', 'Araştırma araçları'),
  k('feature.everythingIn', 'Everything in {plan}', '{plan} planındaki her şey'),
  k('feature.arbitrage', 'Arbitrage scanner', 'Arbitraj tarayıcı'),
  k('feature.financials', 'Financials', 'Finans'),
  k('feature.bulkPhotoStudio', 'Bulk photo studio', 'Toplu fotoğraf stüdyosu'),
  k('feature.prioritySupport', 'Priority support', 'Öncelikli destek'),
  k('feature.dedicatedContact', 'Dedicated contact', 'Size özel iletişim kişisi'),
  k('cta.startTrial', 'Start free trial', 'Ücretsiz denemeyi başlat'),
  k('cta.choose', 'Choose {plan}', '{plan} planını seç'),
  k('cta.switch', 'Switch to {plan}', '{plan} planına geç'),
  k('cta.current', 'Current plan', 'Mevcut plan'),
  k('cta.currentReason', "You're on this plan", 'Bu plandasınız'),
  k('cta.talk', 'Talk to us', 'Bize ulaşın'),
  k('cta.opening', 'Opening checkout…', 'Ödeme sayfası açılıyor…'),
  k('cta.openingPortal', 'Opening Stripe…', "Stripe açılıyor…"),
  k('cta.busyReason', 'Another plan is opening. Wait a moment.', 'Başka bir plan açılıyor. Biraz bekleyin.'),
  k('cta.updatePaymentFirst', 'Update payment first', 'Önce ödemeyi güncelleyin'),
  k('cta.updatePaymentReason', 'Your last payment failed. Update your payment method first.', 'Son ödemeniz başarısız oldu. Önce ödeme yönteminizi güncelleyin.'),
  k('cta.unknown', 'Choose a plan', 'Plan seçin'),
  k('cta.unknownReason', "Couldn't check your account. Reload to continue.", 'Hesabınız kontrol edilemedi. Devam etmek için sayfayı yenileyin.'),
  k('cta.trialCarry', "You won't be charged until {date}.", '{date} tarihine kadar ücret alınmaz.'),
  k('pastDueBanner', 'Your last payment failed.', 'Son ödemeniz başarısız oldu.'),
  k('updatePayment', 'Update payment method', 'Ödeme yöntemini güncelle'),
  k('taxIncluded', 'Prices include KDV.', 'Fiyatlara KDV dahildir.'),
  k('taxExcluded', 'Prices exclude KDV.', 'Fiyatlara KDV dahil değildir.'),
  k('compare.title', 'Compare plans', 'Planları karşılaştır'),
  k('compare.feature', 'Feature', 'Özellik'),
  k('compare.orders', 'Orders a month', 'Aylık sipariş'),
  k('compare.labels', 'Labels a month', 'Aylık etiket'),
  k('compare.stores', 'Connected stores', 'Bağlı mağaza'),
  k('compare.ai', 'AI credits a month', 'Aylık AI kredisi'),
  k('compare.marketplaces', 'Marketplaces', 'Pazaryerleri'),
  k('compare.all', 'All', 'Tümü'),
  k('compare.carriers', 'Carriers: FedEx, UPS, DHL eCommerce', 'Kargo: FedEx, UPS, DHL eCommerce'),
  k('compare.listing', 'Listing editor, bulk editor', 'İlan düzenleyici, toplu düzenleyici'),
  k('compare.support', 'Support', 'Destek'),
  k('compare.supportEmail', 'Email', 'E-posta'),
  k('compare.supportPriority', 'Priority', 'Öncelikli'),
  k('compare.supportDedicated', 'Dedicated', 'Özel'),
  k('compare.unlimited', 'Unlimited', 'Sınırsız'),
  k('compare.included', 'Included', 'Dahil'),
  k('compare.notIncluded', 'Not included', 'Dahil değil'),
  k('compare.pickPlan', 'Show plan', 'Planı göster'),
  k('hint.orders', "An order counts once, when it's imported.", 'Bir sipariş, aktarıldığında bir kez sayılır.'),
  k('hint.stores', "Each Etsy shop, eBay account, Amazon account, Trendyol account, Wix site or Shopify store counts as one. Carriers don't count.", 'Her Etsy mağazası, eBay hesabı, Amazon hesabı, Trendyol hesabı, Wix sitesi veya Shopify mağazası bir mağaza sayılır. Kargo firmaları sayılmaz.'),
  k('hint.ai', 'A text action uses 1 credit, an image uses 10.', 'Bir metin işlemi 1, bir görsel 10 kredi kullanır.'),
  k('faq.title', 'Questions', 'Sık sorulan sorular'),
  k('faq.trial.q', 'How does the free trial work?', 'Ücretsiz deneme nasıl işler?'),
  k('faq.trial.a', 'You get 14 days with Pro features and no card. When it ends you have 3 more days to choose a plan. After that, importing orders and creating new labels pause, and your data stays.', 'Kart girmeden 14 gün boyunca Pro özelliklerini kullanırsınız. Deneme bitince plan seçmek için 3 gününüz daha olur. Sonrasında sipariş aktarımı ve yeni etiketler durur; verileriniz silinmez.'),
  k('faq.limits.q', 'What happens if I go over a limit?', 'Bir sınırı aşarsam ne olur?'),
  k('faq.limits.a', 'We tell you at 80%. When you reach a limit, manual order imports and new labels pause until the next period or until you change plan. The order limit counts new orders imported into KolayXport; updates to orders you already have don\'t count.', "%80'e geldiğinizde size haber veririz. Sınıra ulaştığınızda elle başlattığınız sipariş aktarımları ve yeni etiketler, bir sonraki döneme ya da plan değiştirene kadar durur. Sipariş sınırı, panele aktarılan yeni siparişleri sayar; zaten aktarılmış siparişlerin güncellenmesi saymaz."),
  k('faq.founding.q', 'What is the founding member offer?', 'Kurucu üye fırsatı nedir?'),
  k('faq.founding.a', 'Our first {total} subscribers pay {percent}% less for as long as they stay subscribed, on any plan and either billing period.', 'İlk {total} abonemiz, abonelikleri devam ettiği sürece her planda ve her ödeme döneminde %{percent} daha az öder.'),
  k('faq.change.q', 'Can I change or cancel my plan?', 'Planımı değiştirebilir veya iptal edebilir miyim?'),
  k('faq.change.a', 'Yes, any time from Settings. Upgrades apply right away. If you cancel, you keep your plan until the end of the period you paid for.', "Evet, Ayarlar'dan istediğiniz zaman. Yükseltmeler hemen geçerli olur. İptal ederseniz ödediğiniz dönemin sonuna kadar planınız devam eder."),
  k('faq.currency.q', 'Can I pay in lira or dollars?', 'Lira veya dolar ile ödeyebilir miyim?'),
  k('faq.currency.a', 'Yes. Pick ₺ or $ before checkout. Your account stays in that currency afterwards.', 'Evet. Ödemeden önce ₺ veya $ seçin. Hesabınız sonrasında bu para biriminde kalır.'),
  k('faq.data.q', 'How is my data protected?', 'Verilerim nasıl korunuyor?'),
  k('faq.data.a', 'Marketplace keys are encrypted, and your data stays on our servers in the EU. We never sell it.', "Pazaryeri anahtarları şifrelenir ve verileriniz AB'deki sunucularımızda kalır. Verilerinizi asla satmayız."),
  k('enterprise.title', 'Need more than Pro?', 'Pro yetmiyor mu?'),
  k('enterprise.body', 'Talk to us about Enterprise: unlimited usage and a dedicated contact.', 'Enterprise için bize ulaşın: sınırsız kullanım ve size özel bir iletişim kişisi.'),
  k('checkout.failed', "Couldn't open checkout. Try again.", 'Ödeme sayfası açılamadı. Tekrar deneyin.'),
  k('checkout.forbidden', "This account can't buy a plan here.", 'Bu hesap buradan plan satın alamaz.'),
  k('checkout.portalFailed', "Couldn't open Stripe. Try again.", 'Stripe açılamadı. Tekrar deneyin.'),
  k('reviewerSummary.title', 'Pricing summary (English)', 'Pricing summary (English)'),
  k('reviewerSummary.plan', '{plan}: {monthTry}/month ({yearTry}/year) or {monthUsd}/month ({yearUsd}/year). {orders} orders, {labels} labels, {stores} connected stores and {ai} AI credits a month.', '{plan}: {monthTry}/month ({yearTry}/year) or {monthUsd}/month ({yearUsd}/year). {orders} orders, {labels} labels, {stores} connected stores and {ai} AI credits a month.'),
  k('reviewerSummary.enterprise', 'Enterprise: custom quote with unlimited usage, through our contact form.', 'Enterprise: custom quote with unlimited usage, through our contact form.'),
  k('reviewerSummary.footer', 'Every plan starts with a 14-day free trial without a card. Every marketplace and carrier integration is included. No other fees.', 'Every plan starts with a 14-day free trial without a card. Every marketplace and carrier integration is included. No other fees.'),
];

type Tree = { [key: string]: string | Tree };

function build(locale: 'en' | 'tr'): Tree {
  const root: Tree = {};
  for (const item of E_KEYS) {
    const path = [item.namespace, ...item.key.split('.')];
    let node = root;
    for (let i = 0; i < path.length - 1; i += 1) {
      const next = node[path[i]];
      if (typeof next !== 'object') node[path[i]] = {};
      node = node[path[i]] as Tree;
    }
    node[path[path.length - 1]] = item[locale];
  }
  return root;
}

export const E_EN = build('en');
export const E_TR = build('tr');
