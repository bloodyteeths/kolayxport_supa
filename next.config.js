const MARKETING_REDIRECTS = [
  ['/kariyer', '/kurumsal'],
  ['/support', '/iletisim'],
  ['/docs', '/nasil-kullanirim'],
  ['/docs/terms', '/en/kullanim-sartlari'],
  ['/docs/terms-tr', '/kullanim-sartlari'],
  ['/docs/:path*', '/nasil-kullanirim'],
  ['/privacy', '/en/gizlilik-politikasi'],
  ['/privacy-tr', '/gizlilik-politikasi'],
  ['/terms', '/en/kullanim-sartlari'],
  ['/terms-tr', '/kullanim-sartlari'],
  // Old blog posts (unsourced, invented authors) were removed; send readers to the closest real page.
  ['/blog/trendyol-entegrasyonu-adim-adim', '/entegrasyonlar/trendyol'],
  ['/blog/fedex-ups-kargo-karsilastirmasi', '/cozumler/mikro-ihracat-kargo-etgb'],
  ['/blog/kargo-maliyet-optimizasyonu', '/cozumler/mikro-ihracat-kargo-etgb'],
  ['/blog/api-entegrasyon-hatalari-cozumleri', '/blog'],
  ['/blog/black-friday-hazirlik-rehberi', '/blog'],
  ['/blog/e-ticaret-otomasyon-rehberi-2025', '/blog'],
  ['/blog/envanter-yonetimi-en-iyi-uygulamalar', '/blog'],
  ['/blog/hepsiburada-amazon-siparis-optimizasyonu', '/blog'],
];

// Marketing/analytics tags loaded through Google Tag Manager (only after cookie consent).
const TAG_HOSTS = {
  script: 'https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net https://static.ads-twitter.com https://analytics.tiktok.com https://snap.licdn.com https://googleads.g.doubleclick.net https://www.googleadservices.com',
  connect: 'https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.facebook.com https://connect.facebook.net https://analytics.twitter.com https://static.ads-twitter.com https://analytics.tiktok.com https://px.ads.linkedin.com https://googleads.g.doubleclick.net',
  frame: 'https://www.googletagmanager.com https://td.doubleclick.net',
};

const withPWA = require('@ducanh2912/next-pwa').default({

  dest: 'public',
  // Also allow disabling in production via DISABLE_PWA=1 — the next-pwa
  // precache generation hangs indefinitely on this codebase during builds
  // on the Hetzner VPS (100% CPU, zero file writes for 20+ min at the
  // "Custom runtimeCaching" step). Every deploy of the last few hours died
  // at this exact spot. Kill switch until we replace next-pwa or upgrade
  // it past the bug. Live PWA behavior falls back to no-service-worker
  // for the user, which is acceptable — the site works without it.
  disable: process.env.NODE_ENV === 'development' || process.env.DISABLE_PWA === '1',
  register: true,
  skipWaiting: true,
  fallbacks: {
    document: '/offline',
  },
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts',
          expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /\.(?:js|css)$/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'static-resources',
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
          networkTimeoutSeconds: 3,
        },
      },
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico)$/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'images',
          expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      {
        // Never cache auth routes — stale CSRF tokens break login
        urlPattern: /\/api\/auth\/.*/i,
        handler: 'NetworkOnly',
      },
      {
        // Live SSE stream never ends: caching it would buffer an endless body
        // and could replay stale events offline.
        urlPattern: /\/api\/live\/.*/i,
        handler: 'NetworkOnly',
      },
      {
        urlPattern: /\/api\/.*/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-cache',
          expiration: { maxEntries: 50, maxAgeSeconds: 5 * 60 },
          networkTimeoutSeconds: 10,
        },
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // distDir overridable via env so the Hetzner deploy can build into a staging dir
  // (`.next-new`) and atomically swap it with the live `.next` on success. The live
  // service never sets NEXT_DIST_DIR so it defaults to `.next` at runtime.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  generateEtags: false,
  compress: true,

  // Keep Node-only SDKs (googleapis + its transitive deps used for GCP KMS) out of
  // the webpack bundle so they aren't traced into the edge/instrumentation compile,
  // where Node builtins like `fs`/`stream` can't resolve. They are require()'d at
  // runtime in the Node server instead.
  serverExternalPackages: ['googleapis', 'google-auth-library', 'gcp-metadata', 'gaxios', 'googleapis-common'],

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'kolayxport.com',
      },
      {
        protocol: 'https',
        hostname: 'via.placeholder.com',
      },
    ],
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 31536000, // 1 year
  },

  // Performance optimizations
  experimental: {
    scrollRestoration: true,
    proxyClientMaxBodySize: '200mb',
  },

  // The analytics dashboard is the app's home: login, the Stripe return and
  // every "/app" link land there. Temporary so the target can change later.
  // Exception (M8 integrator): `/app?ui=…` is NOT redirected, so the founder can open the Overview
  // (pages/app/index.js) at `/app?ui=overview`. Plain `/app` (and `/app?session_id=…`) lands on /app/analytics.
  async redirects() {
    return [
      {
        source: '/app',
        missing: [{ type: 'query', key: 'ui' }],
        destination: '/app/analytics',
        permanent: false,
      },
      // GTM overhaul (2026-10): retired marketing URLs → their replacements (301).
      ...MARKETING_REDIRECTS.map(([source, destination]) => ({ source, destination, permanent: true })),
    ];
  },

  // Security headers
  async headers() {
    return [
      {
        // Prevent caching of auth endpoints
        source: '/api/auth/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'Content-Security-Policy',
            // Tag hosts are allowed here but only fire after consent (Consent Mode v2, docs/gtm/tracking/README.md).
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com ${TAG_HOSTS.script}`,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' https://fonts.gstatic.com",
              `connect-src 'self' https://api.stripe.com https://*.etsy.com https://*.ebay.com https://*.trendyol.com ${TAG_HOSTS.connect}`,
              `frame-src https://js.stripe.com https://hooks.stripe.com https://www.youtube-nocookie.com ${TAG_HOSTS.frame}`,
              "media-src 'self' blob:",
            ].join('; ') + ';',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

module.exports = withPWA(nextConfig);
