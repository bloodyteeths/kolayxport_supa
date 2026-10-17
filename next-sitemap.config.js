// Sitemap + robots.txt, generated after `next build`. Only public marketing pages belong here:
// the app, auth and account screens sit behind a login and must not be indexed.
const PRIVATE = [
  '/app', '/app/*',
  '/admin', '/admin/*',
  '/auth/*',
  '/ayarlar', '/dashboard', '/envanter', '/faturalar', '/urunler',
  '/login', '/logout', '/offline', '/subscribe', '/plan',
  '/404', '/500', '/_error',
];

const SITE = 'https://kolayxport.com';
// Pages without an English twin (no hreflang pair).
const TR_ONLY = new Set([]);

module.exports = {
  siteUrl: SITE,
  generateRobotsTxt: true,
  exclude: PRIVATE,
  // hreflang pairs: every marketing page has a Turkish URL and an /en twin with the same slug.
  transform: async (config, loc) => {
    const tr = loc === '/en' ? '/' : loc.startsWith('/en/') ? loc.slice(3) : loc;
    const en = tr === '/' ? '/en' : `/en${tr}`;
    const pair = !TR_ONLY.has(tr);
    return {
      loc,
      changefreq: loc.includes('/blog/') ? 'monthly' : 'weekly',
      priority: loc === '/' || loc === '/en' ? 1.0 : loc.split('/').length <= 2 ? 0.8 : 0.6,
      lastmod: new Date().toISOString(),
      alternateRefs: pair ? [
        { href: `${SITE}${tr === '/' ? '' : tr}`, hreflang: 'tr', hrefIsAbsolute: true },
        { href: `${SITE}${en}`, hreflang: 'en', hrefIsAbsolute: true },
        { href: `${SITE}${tr === '/' ? '' : tr}`, hreflang: 'x-default', hrefIsAbsolute: true },
      ] : [],
    };
  },
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/app', '/plan', '/admin', '/auth/', '/api/', '/ayarlar', '/dashboard', '/envanter', '/faturalar', '/urunler', '/login', '/logout', '/offline', '/subscribe'],
      },
    ],
  },
};
