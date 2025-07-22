/** @type {import('next-seo').NextSeoProps} */
const defaultSEOConfig = {
  defaultTitle: 'KolayXport | E-ticaret Entegrasyon SaaS - Marketplace Yönetim Platformu',
  description:
    'Trendyol, Hepsiburada, Amazon entegrasyonu. Otomatik kargo etiketi, envanter senkronizasyonu ve sipariş yönetimi. Ücretsiz deneme!',
  additionalMetaTags: [
    {
      name: 'keywords',
      content: 'e-ticaret entegrasyon, marketplace yönetimi, trendyol entegrasyon, hepsiburada entegrasyon, amazon entegrasyon, otomatik kargo, envanter yönetimi, sipariş yönetimi, e-ticaret otomasyon, satış kanalı yönetimi'
    },
    {
      name: 'author',
      content: 'KolayXport'
    },
    {
      name: 'robots',
      content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
    },
    {
      name: 'language',
      content: 'Turkish'
    },
    {
      name: 'geo.region',
      content: 'TR'
    },
    {
      name: 'geo.country',
      content: 'Turkey'
    }
  ],
  languageAlternates: [
    {
      hrefLang: 'tr',
      href: 'https://kolayxport.com',
    },
    {
      hrefLang: 'tr-TR',
      href: 'https://kolayxport.com',
    },
    {
      hrefLang: 'x-default',
      href: 'https://kolayxport.com',
    }
  ],
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    url: 'https://kolayxport.com',
    site_name: 'KolayXport',
    images: [
      {
        url: 'https://kolayxport.com/og-public.png',
        width: 1200,
        height: 630,
        alt: 'KolayXport Dashboard',
      },
    ],
  },
  twitter: {
    handle: '@kolayxport',
    site: '@kolayxport',
    cardType: 'summary_large_image',
  },
};

module.exports = defaultSEOConfig; 