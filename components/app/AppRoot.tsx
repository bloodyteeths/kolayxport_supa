// components/app/AppRoot.tsx — everything the signed-in app (and MUI-based public pages: pricing, login)
// needs around a page: session, MUI theme, DS providers, confirm dialogs, the persistent app shell, toasts,
// live events and the 402 limit dialog. Loaded by pages/_app.tsx with next/dynamic (still server-rendered),
// so marketing pages don't download any of it (GTM perf budget: LCP < 2 s on mobile).
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Toaster } from 'react-hot-toast';
import { SessionProvider } from 'next-auth/react';
import { AuthProvider } from '@/lib/auth-context';
import theme from '@/lib/theme';
import { ConfirmProvider } from '@/components/ds/overlay/ConfirmDialog';
import LimitReachedDialog from '@/components/billing/LimitReachedDialog';
import CreditsDialog from '@/components/domain/credits/CreditsDialog';
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
import { isPlayClient } from '@/lib/billing/playClient';
import { AcquisitionClaim } from '@/lib/partners/AcquisitionClaim';

// Inter via next/font (self-hosted). latin-ext covers ğ ş ı İ. Exposed as --font-inter at :root below.
// preload: false — marketing pages never use Inter; app pages fetch it on first use (then cached).
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-inter', preload: false });

// Module scope (client only) so the 402 interceptor is active before any page
// effect issues a request. Idempotent.
if (typeof window !== 'undefined') {
  installLimitInterceptor();
}



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
  // The Google Play app never shows an upsell (playClient.ts).
  const stripeUpsell =
    !sub || !sub.billingProvider
      ? null
      : sub.billingProvider === 'stripe' && sub.subscriptionPlan !== 'shopify_free' && !isPlayClient();
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


export function AppRoot({ children, session, shell }: { children: ReactNode; session?: unknown; shell: boolean }) {
  return (
    <SessionProvider session={session as never}>
    <AuthProvider>
      <DsAppProviders>
      <ThemeProvider theme={theme}>
      <ConfirmProvider>
        {/* defines the font var at :root so MUI portals (dialogs, menus) get Inter too */}
        {/* eslint-disable-next-line react/jsx-no-literals -- CSS, not user-facing copy; styled-jsx needs an inline template literal */}
        <style jsx global>{`
          :root { --font-inter: ${inter.style.fontFamily}; }
        `}</style>
        <CssBaseline />
        {shell ? <AppShellMount>{children}</AppShellMount> : children}
        <Toaster
          position="bottom-center"
          gutter={8}
          containerStyle={{ zIndex: dsZ.toast, bottom: 'calc(var(--kx-bottom-nav, 0px) + var(--kx-action-bar, 0px) + 8px)' }}
          toastOptions={TOAST_OPTIONS}
        />
        {/* Live events: SSE stream, new-order chime + toast, live SWR refresh. Signed-in /app/* only. */}
        <LiveAppMount ordersPath="/app/labels" />
        <LimitReachedDialog />
        {/* Referral / first-touch attribution for Google / Apple sign-ups (lib/partners). */}
        <AcquisitionClaim />
        <CreditsDialog />
      </ConfirmProvider>
      </ThemeProvider>
      </DsAppProviders>
    </AuthProvider>
    </SessionProvider>
  );
}

export default AppRoot;
