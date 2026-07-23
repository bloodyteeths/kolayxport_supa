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
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.stripe.com https://*.etsy.com https://*.ebay.com https://*.trendyol.com; frame-src https://js.stripe.com https://hooks.stripe.com;",
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },

  transpilePackages: [
    '@mui/x-data-grid',
  ],
};

module.exports = withPWA(nextConfig);
