// Sitemap + robots.txt, generated after `next build`. Only public marketing pages belong here:
// the app, auth and account screens sit behind a login and must not be indexed.
const PRIVATE = [
  '/app', '/app/*',
  '/admin', '/admin/*',
  '/auth/*',
  '/ayarlar', '/dashboard', '/envanter', '/faturalar', '/urunler',
  '/login', '/logout', '/offline', '/subscribe',
  '/404', '/500', '/_error',
];

module.exports = {
  siteUrl: 'https://kolayxport.com',
  generateRobotsTxt: true,
  exclude: PRIVATE,
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/app', '/admin', '/auth/', '/api/', '/ayarlar', '/dashboard', '/envanter', '/faturalar', '/urunler', '/login', '/logout', '/offline', '/subscribe'],
      },
    ],
  },
};
