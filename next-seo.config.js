/** @type {import('next-seo').NextSeoProps} */
const defaultSEOConfig = {
  defaultTitle: 'KolayXport | E-ticaret Entegrasyon SaaS',
  description:
    'Tek panelden marketplace yönetimi, otomatik kargo ve finans analitiği. Diğer Entegratörler kapatana kadar Ücretsiz!',
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