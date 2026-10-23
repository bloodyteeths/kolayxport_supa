// Sitemap + robots.txt, generated after `next build` (npm `postbuild`, and scripts/deploy/hetzner-deploy.sh right
// after its `next build` into NEXT_DIST_DIR, since the VPS build calls next directly and skips postbuild). Only public marketing pages belong here:
// the app, auth and account screens sit behind a login and must not be indexed.
const PRIVATE = [
  '/app', '/app/*',
  '/admin', '/admin/*',
  '/auth/*',
  '/ayarlar', '/dashboard', '/envanter', '/faturalar', '/urunler',
  '/login', '/logout', '/offline', '/subscribe', '/plan',
  '/oauth', '/oauth/*', // MCP connector sign-in (lib/mcp)
  '/404', '/500', '/_error',
];

const fs = require('fs');
const path = require('path');

const SITE = 'https://kolayxport.com';
// Pages without an English twin (no hreflang pair).
const TR_ONLY = new Set([]);
// Content pages (content/<locale>/<type>/<slug>.md) have a twin only when the same slug exists in the other locale,
// the same rule the pages use (lib/site/content.ts hasTwin). Today most how-to guides are Turkish only.
const CONTENT_BASES = { '/nasil-kullanirim': 'guides', '/blog': 'blog', '/entegrasyonlar': 'integrations', '/karsilastirma': 'compare', '/cozumler': 'cases' };
function contentTwinExists(trPath, locale) {
  const m = trPath.match(/^(\/[^/]+)\/([^/]+)$/);
  if (!m || !CONTENT_BASES[m[1]]) return true;
  const other = locale === 'en' ? 'tr' : 'en';
  return fs.existsSync(path.join(__dirname, 'content', other, CONTENT_BASES[m[1]], `${m[2]}.md`));
}

module.exports = {
  siteUrl: SITE,
  // The VPS builds into NEXT_DIST_DIR (.next-new) before swapping it in.
  sourceDir: process.env.NEXT_DIST_DIR || '.next',
  generateRobotsTxt: true,
  exclude: PRIVATE,
  // hreflang pairs: every marketing page has a Turkish URL and an /en twin with the same slug.
  transform: async (config, loc) => {
    const tr = loc === '/en' ? '/' : loc.startsWith('/en/') ? loc.slice(3) : loc;
    const en = tr === '/' ? '/en' : `/en${tr}`;
    const locale = loc === '/en' || loc.startsWith('/en/') ? 'en' : 'tr';
    const pair = !TR_ONLY.has(tr) && contentTwinExists(tr, locale);
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
        disallow: ['/app', '/plan', '/admin', '/auth/', '/api/', '/oauth/', '/ayarlar', '/dashboard', '/envanter', '/faturalar', '/urunler', '/login', '/logout', '/offline', '/subscribe'],
      },
    ],
  },
};
