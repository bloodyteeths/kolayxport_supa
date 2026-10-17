/** @type {import('next-seo').NextSeoProps} */
const defaultSEOConfig = {
  defaultTitle: 'KolayXport | AI Destekli E-Ticaret Komuta Merkezi - Etsy, eBay & Amazon Araçları',
  description:
    'Etsy, eBay, Amazon, Trendyol, Wix ve Shopify entegrasyonu. AI listeleme optimizasyonu, pazar araştırması, otomatik kargo etiketi (UPS, FedEx, MNG) ve sipariş yönetimi. 14 gün ücretsiz deneme, kredi kartı gerekmez.',
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
  // hreflang is set per page (PublicLayout `seo.languageAlternates`); a site-wide default would point every page at the home page.
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    url: 'https://kolayxport.com',
    site_name: 'KolayXport',
    images: [
      {
        url: 'https://kolayxport.com/og/default.png',
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