/** @type {import('next-seo').NextSeoProps} */
const defaultSEOConfig = {
  defaultTitle: 'KolayXport | AI Destekli E-Ticaret Komuta Merkezi - Etsy, eBay & Amazon Araçları',
  description:
    'Etsy, eBay, Amazon, Trendyol, Wix ve Shopify entegrasyonu. AI listeleme optimizasyonu, pazar araştırması, otomatik kargo etiketi (UPS, FedEx, MNG) ve sipariş yönetimi. 30 gün ücretsiz deneme!',
  additionalMetaTags: [
    {
      name: 'keywords',
      content: 'e-ticaret entegrasyon, etsy entegrasyon, ebay entegrasyon, amazon entegrasyon, trendyol entegrasyon, etsy araçları, ai listeleme optimizasyonu, pazar araştırması, etsy seo, otomatik kargo etiketi, sipariş yönetimi, e-ticaret otomasyon, arbitraj tarayıcı'
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