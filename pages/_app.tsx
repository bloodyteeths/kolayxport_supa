import { AppProps } from 'next/app';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '../lib/theme';
import "../styles/globals.css";
import { Toaster } from 'react-hot-toast';
import { DefaultSeo, LogoJsonLd } from 'next-seo';
import SEO from '../next-seo.config';
import { SessionProvider } from 'next-auth/react';
import { AuthProvider } from '@/lib/auth-context';
import { ReactElement, ReactNode } from 'react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import Head from 'next/head';
import { NextIntlClientProvider } from 'next-intl';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import trMessages from '@/messages/tr.json';
import enMessages from '@/messages/en.json';
import CookieConsent from '@/components/CookieConsent';
import { captureAttribution, track } from '@/lib/tracking/events';

/** URL-driven funnel events: pricing views and marketplace connections (OAuth callbacks land on /ayarlar?success=<mp>_connected). */
function funnelFromUrl(url: string) {
  const u = new URL(url, 'https://kolayxport.com');
  if (u.pathname === '/fiyatlandirma') track('view_pricing');
  const ok = /^([a-z]+)_connected$/.exec(u.searchParams.get('success') || '');
  if (u.pathname === '/ayarlar' && ok) track('connect_marketplace', { marketplace: ok[1] });
}

// First path segment of Turkish marketing routes (SiteLayout sets <html lang> itself there).
const SITE_TR_ROUTES = new Set(['', 'cozumler', 'entegrasyonlar', 'karsilastirma', 'nasil-kullanirim', 'blog', 'kurumsal', 'iletisim', 'ozellikler', 'kvkk-aydinlatma-metni', 'cerez-politikasi', 'gizlilik-politikasi', 'kullanim-sartlari', 'mesafeli-satis-sozlesmesi', 'on-bilgilendirme-formu']);
import { ConfirmProvider } from '@/components/ds/overlay/ConfirmDialog';
import LimitReachedDialog from '@/components/billing/LimitReachedDialog';
import { installLimitInterceptor } from '@/lib/http/limitInterceptor';
import LiveAppMount from '@/components/live/LiveAppMount';
import { zIndex as dsZ, neutral as dsN, radius as dsRadius } from '@/lib/ds/tokens';
import useSWR from 'swr';
import { FormatProvider } from '@/lib/format';
import { PlanTagProvider } from '@/components/ds/data/PlanTag';
import { AppShell, type AppShellContext } from '@/components/ds/shell/AppShell';
import { MobileTopBarConnected } from '@/components/ds/shell/MobileTopBar';
import { MobileTabBarConnected } from '@/components/ds/shell/MobileTabBar';
import { MoreSheetConnected } from '@/components/ds/shell/MoreSheet';
import { CommandPalette, GoShortcutHint } from '@/components/ds/shell/CommandPalette';
import { useGoShortcuts } from '@/lib/nav/useGoShortcuts';
import { isShellRoute } from '@/lib/nav/shellRoutes';

// Inter via next/font (self-hosted). latin-ext covers ğ ş ı İ. Exposed as --font-inter at :root below.
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-inter' });

// Module scope (client only) so the 402 interceptor is active before any page
// effect issues a request. Idempotent.
if (typeof window !== 'undefined') {
  installLimitInterceptor();
}

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

const messages = { tr: trMessages, en: enMessages } as const;

// Untyped on purpose: stale ambient shims in types/*.d.ts declare toastOptions without the per-type keys
// (error/success) that react-hot-toast 2.6 supports at runtime.
const TOAST_OPTIONS = {
  duration: 4000,
  style: { background: dsN[900], color: dsN[0], fontSize: 13, lineHeight: '18px', borderRadius: dsRadius.md, padding: '10px 12px', maxWidth: 420 },
  // TODO(M1 useToast): switch to `error: { duration: Infinity }` (tokens.md §4, DS §3.14 — errors persist
  // until dismissed) once useToast ships a dismiss control + one-visible queueing. Legacy toast.error()
  // calls have no close button, so M0 keeps them finite (known M0 spec gap).
  error: { duration: 8000 },
};

type SettingsSnapshot = {
  subscription?: { billingProvider?: string | null; subscriptionPlan?: string | null } | null;
  timezone?: string | null;
} | null;

/**
 * DS app-level providers (lib/format FormatProvider, PlanTagProvider), mounted once inside
 * NextIntlClientProvider. Reads `/api/user/settings` from the SWR cache only (fetcher null = no extra
 * request): AppShell and LimitReachedDialog already fetch that key for signed-in users.
 * - timeZone: the settings response has no seller timezone yet (BR-2 / D-T1), so `timezone` is read
 *   if present and FormatProvider otherwise falls back to Europe/Istanbul.
 * - stripeUpsell: true only when billingProvider is 'stripe' (and the plan is not shopify_free); false for
 *   shopify_free; a missing subscription or NULL billingProvider is unknown → null
 *   (PlanTag renders nothing — the Shopify-review-safe default).
 */
function DsAppProviders({ children }: { children: ReactNode }) {
  const { data } = useSWR<SettingsSnapshot>('/api/user/settings', null, {
    revalidateOnMount: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const sub = data?.subscription ?? null;
  // Only an explicit Stripe account gets the upsell. A NULL billingProvider (e.g. the Shopify 1.2.1
  // reviewer-account shape) is unknown → null, never true.
  const stripeUpsell =
    !sub || !sub.billingProvider
      ? null
      : sub.billingProvider === 'stripe' && sub.subscriptionPlan !== 'shopify_free';
  return (
    <FormatProvider timeZone={data?.timezone ?? undefined}>
      <PlanTagProvider stripeUpsell={stripeUpsell}>{children}</PlanTagProvider>
    </FormatProvider>
  );
}

// ── Persistent app shell (shell-nav §0, §12 F) ──────────────────────────────────────────────────────
// Mounted once around app routes (lib/nav/shellRoutes.ts), so the sidebar, polling and palette survive
// client navigation. The mobile and palette slots render the connected components as JSX (each owns its
// hooks; see the wiring contract in components/ds/shell/MobileTopBar.tsx).

/** ⌘K palette + `g` chords (group E). One instance, every viewport, signed in only. */
function ShellPalette({ ctx }: { ctx: AppShellContext }) {
  const { pending } = useGoShortcuts(ctx.model.goShortcuts);
  return (
    <>
      <CommandPalette destinations={ctx.model.destinations} canCreateEtsyListing={ctx.model.known.etsy !== false} />
      <GoShortcutHint visible={pending} />
    </>
  );
}

const renderMobileTopBar = (ctx: AppShellContext) => <MobileTopBarConnected ctx={ctx} />;
const renderMobileTabBar = (ctx: AppShellContext) => <MobileTabBarConnected ctx={ctx} />;
const renderMoreSheet = (ctx: AppShellContext) => <MoreSheetConnected ctx={ctx} />;
const renderPalette = (ctx: AppShellContext) => <ShellPalette ctx={ctx} />;

function AppShellMount({ children }: { children: ReactNode }) {
  return (
    <AppShell
      renderMobileTopBar={renderMobileTopBar}
      renderMobileTabBar={renderMobileTabBar}
      renderMoreSheet={renderMoreSheet}
      renderPalette={renderPalette}
    >
      {children}
    </AppShell>
  );
}

function MyApp({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const locale = useLocaleStore((s) => s.locale);
  const hydrate = useLocaleStore((s) => s.hydrate);

  // Marketing pages (components/site/SiteLayout) lock their own language: / is Turkish, /en is English.
  const isSiteRoute = router.pathname === '/en' || router.pathname.startsWith('/en/') || SITE_TR_ROUTES.has(router.pathname.split('/')[1] ?? '');

  useEffect(() => {
    // _document renders lang per route; the app UI locale is client-side, so keep <html lang> in sync
    // (CSS case mapping and hyphenation follow it — fixes "FAİLED" in the EN UI).
    if (typeof document !== 'undefined' && !isSiteRoute) document.documentElement.lang = locale;
  }, [locale, isSiteRoute]);

  // First-touch UTM / click-id capture and SPA page views for GTM (lib/tracking/events.ts).
  useEffect(() => {
    captureAttribution(window.location.search);
    const onRoute = (url: string) => {
      track('page_view', { page_path: url });
      funnelFromUrl(url);
    };
    funnelFromUrl(window.location.pathname + window.location.search);
    router.events.on('routeChangeComplete', onRoute);
    return () => router.events.off('routeChangeComplete', onRoute);
  }, [router.events]);

  // Hydrate locale from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    hydrate();
  }, []);

  return (
    <SessionProvider session={pageProps.session}>
    <AuthProvider>
      <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Europe/Istanbul">
      <DsAppProviders>
      <ThemeProvider theme={theme}>
      <ConfirmProvider>
        {/* defines the font var at :root so MUI portals (dialogs, menus) get Inter too */}
        {/* eslint-disable-next-line react/jsx-no-literals -- CSS, not user-facing copy; styled-jsx needs an inline template literal */}
        <style jsx global>{`
          :root { --font-inter: ${inter.style.fontFamily}; }
        `}</style>
        <CssBaseline />
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        </Head>
        <DefaultSeo {...SEO} />
        <LogoJsonLd
          logo="https://kolayxport.com/brand/kolayxport-symbol-512.png"
          url="https://kolayxport.com"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "KolayXport",
              "url": "https://kolayxport.com",
              "logo": "https://kolayxport.com/brand/kolayxport-symbol-512.png",
              "email": "destek@kolayxport.com",
              "sameAs": [
                "https://twitter.com/kolayxport",
                "https://linkedin.com/company/kolayxport",
                "https://youtube.com/kolayxport"
              ]
            })
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "KolayXport",
              "applicationCategory": "BusinessApplication",
              "operatingSystem": "Web",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "TRY",
                "description": "14 gün ücretsiz deneme"
              }
            })
          }}
        />
        {isShellRoute(router.pathname) ? (
          <AppShellMount>
            <Component {...pageProps} />
          </AppShellMount>
        ) : (
          <Component {...pageProps} />
        )}
        <Toaster
          position="bottom-center"
          gutter={8}
          containerStyle={{ zIndex: dsZ.toast, bottom: 'calc(var(--kx-bottom-nav, 0px) + var(--kx-action-bar, 0px) + 8px)' }}
          toastOptions={TOAST_OPTIONS}
        />
        {/* Live events: SSE stream, new-order chime + toast, live SWR refresh. Signed-in /app/* only. */}
        <LiveAppMount ordersPath="/app/labels" />
        <LimitReachedDialog />
        <CookieConsent />
      </ConfirmProvider>
      </ThemeProvider>
      </DsAppProviders>
      </NextIntlClientProvider>
    </AuthProvider>
    </SessionProvider>
  );
}

export default MyApp;
