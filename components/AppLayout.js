import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu,
  Globe,
  UserCircle,
  X,
  Home,
  Box,
  Layers,
  Truck,
  BarChart3,
  Settings,
  ChevronDown,
  LogOut as LogOutIcon,
  LayoutDashboard,
  ShoppingCart,
  FileText,
  LifeBuoy,
  Info,
  BookOpen,
  Link2,
  TrendingUp,
  Store,
  ShoppingBag,
  Target,
  Package,
  Wallet,
  Mail,
  Receipt,
  Globe2,
  Pin,
  PinOff,
  Plus,
} from 'lucide-react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/lib/auth-context';
import useSidebar from '../hooks/useSidebar';
import useScreenSize from '../hooks/useScreenSize';
import { useTranslations } from 'next-intl';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import useMessageCountStore from '@/lib/stores/useMessageCountStore';
import TrialNotification from './TrialNotification';
import { useConnections } from '@/lib/hooks/useConnections';

/**
 * AppLayout: For authenticated application routes (e.g., /app/*)
 * Provides sidebar, topbar, and dashboard navigation for logged-in users.
 */

// Store-type providers a user can connect from Settings → Connections. Used to
// decide whether the "+ Connect a store" nav item is still worth showing.
// (Veeqo/Shippo are aggregators, carriers are not stores.)
const STORE_PROVIDERS = ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada'];

// Last known connection flags, so a full page reload renders the same nav the
// user saw last time instead of "everything" and then dropping items.
const NAV_CONN_CACHE_KEY = 'kx.nav.connections.v1';
const SIDEBAR_PIN_KEY = 'kx.sidebar.pinned';

// Read browser-only state before paint on the client, without the SSR warning.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// The cache is tagged with the user id so a different account signing in on
// the same browser never renders with the previous account's nav.
function readNavConnCache(uid) {
  if (!uid) return null;
  try {
    const raw = window.localStorage.getItem(NAV_CONN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.uid !== uid) return null;
    const flags = parsed.flags;
    return flags && typeof flags === 'object' && !Array.isArray(flags) ? flags : null;
  } catch {
    return null;
  }
}

function writeNavConnCache(uid, flags) {
  if (!uid) return;
  try {
    window.localStorage.setItem(NAV_CONN_CACHE_KEY, JSON.stringify({ uid, flags }));
  } catch {
    // storage blocked — nav simply falls back to "show all while loading"
  }
}

function clearNavConnCache() {
  try {
    window.localStorage.removeItem(NAV_CONN_CACHE_KEY);
  } catch {
    // ignore
  }
}

// Pinned state survives AppLayout remounts (every page renders its own
// AppLayout), so later mounts render the right width on their first frame.
// null = not read from storage yet (first client mount; SSR always unpinned).
let pinnedMemo = null;

/**
 * Nav items may carry `requires`: a provider (or list of providers, any of
 * which unlocks the item). Items without `requires` are always shown.
 */
function getNavGroups(t) {
  return [
    {
      id: 'main',
      label: null,
      items: [
        { href: '/app', icon: LayoutDashboard, label: t('overview') },
        { href: '/app/labels', icon: FileText, label: t('labelsNav') },
        { href: '/app/analytics', icon: TrendingUp, label: t('analytics') },
        { href: '/app/financials', icon: Wallet, label: t('financials') },
      ],
    },
    {
      id: 'marketplaces',
      label: t('marketplaces'),
      items: [
        { href: '/app/etsy-listings', icon: Store, label: t('etsyListings'), requires: 'etsy' },
        { href: '/app/ebay-listings', icon: ShoppingBag, label: t('ebayListings'), requires: 'ebay' },
        { href: '/app/trendyol-urunler', icon: Package, label: t('trendyolProducts'), requires: 'trendyol' },
        { href: '/app/wix-urunler', icon: Package, label: t('wixProducts'), requires: 'wix' },
        { href: '/app/shopify-urunler', icon: ShoppingBag, label: t('shopifyProducts'), requires: 'shopify' },
        { href: '/ayarlar?tab=connections', icon: Plus, label: t('connectStore'), connectCta: true },
      ],
    },
    {
      id: 'research',
      label: t('research'),
      items: [
        { href: '/app/etsy-research', icon: Target, label: t('etsyResearch') },
        { href: '/app/ebay-research', icon: Target, label: t('ebayResearch') },
        { href: '/app/trendyol-arastirma', icon: Target, label: t('trendyolResearch') },
        // Product search/niche tools use the platform Creators API, not the
        // user's seller token, so this works without an Amazon connection.
        { href: '/app/amazon-research', icon: Globe2, label: t('amazonResearch') },
      ],
    },
    {
      id: 'operations',
      label: t('operations'),
      items: [
        { href: '/app/senkron', icon: ShoppingCart, label: t('sync') },
      ],
    },
    {
      id: 'management',
      label: t('management'),
      items: [
        { href: '/app/entegrasyonlar-ve-rehberler', icon: Link2, label: t('integrations') },
        { href: '/ayarlar', icon: Settings, label: t('settings'), reauthDot: true },
        { href: '/faturalar', icon: Receipt, label: t('invoices') },
      ],
    },
  ];
}

const AppLayout = ({ children, title = 'KolayXport Dashboard' }) => {
  const { user, session, supabaseSignOut, isLoading } = useAuth();
  const router = useRouter();
  const { isOpen, openSidebar, closeSidebar } = useSidebar();
  const { isMobile, isDesktop } = useScreenSize();
  const t = useTranslations('nav');
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const messageCount = useMessageCountStore((s) => s.counts.total);
  const fetchMessageCounts = useMessageCountStore((s) => s.fetch);

  // Fetch user subscription data for TrialNotification
  const { data: settingsData } = useSWR(
    session ? '/api/user/settings' : null,
    (url) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 300_000 }
  );
  const userSubscription = settingsData?.subscription ?? null;

  // ─── Connection-aware nav ──────────────────────────────────────────
  // has() is undefined until the first /api/integrations/status response. In
  // that window we use the flags cached from the last visit; with no cache we
  // show everything (never hide features from a connected user on a slow load).
  const { connections, needsReauth } = useConnections();
  const uid = user?.id || null;
  const [cachedConn, setCachedConn] = useState(null);
  useIsomorphicLayoutEffect(() => {
    setCachedConn(readNavConnCache(uid));
  }, [uid]);
  // Stable string key so the write effect does not re-run on every render.
  const connKey = connections
    ? Object.keys(connections).sort().map((p) => `${p}:${connections[p]?.connected ? 1 : 0}`).join(',')
    : '';
  useEffect(() => {
    if (!connections) return;
    const flags = {};
    Object.keys(connections).forEach((p) => { flags[p] = Boolean(connections[p]?.connected); });
    writeNavConnCache(uid, flags);
    setCachedConn(flags);
  }, [connKey, uid]);

  /** true / false when known (live or cached), undefined when unknown. */
  const knownConnected = (provider) => {
    if (connections) return Boolean(connections[provider]?.connected);
    if (cachedConn && typeof cachedConn[provider] === 'boolean') return cachedConn[provider];
    return undefined;
  };
  const isUnlocked = (requires) => {
    if (!requires) return true;
    const list = Array.isArray(requires) ? requires : [requires];
    const states = list.map(knownConnected);
    if (states.some((v) => v === true)) return true;
    if (states.every((v) => v === false)) return false;
    return true; // unknown → show
  };
  const storeStates = STORE_PROVIDERS.map(knownConnected);
  const showConnectCta = storeStates.every((v) => v !== undefined) && storeStates.some((v) => v === false);
  const hasReauth = needsReauth.length > 0;

  // Free Shopify-tier accounts never see Stripe billing surfaces, including
  // the invoices page (App Store rule 1.2.1).
  const isShopifyFree = userSubscription?.billingProvider === 'shopify_free';
  const navGroups = getNavGroups(t)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (isShopifyFree && item.href === '/faturalar') return false;
        if (item.connectCta) return showConnectCta;
        return isUnlocked(item.requires);
      }),
    }))
    .filter((group) => group.items.length > 0);

  // Messages (Wix + Trendyol inbox): only poll when one of them is connected.
  const messagesAvailable = isUnlocked(['wix', 'trendyol']);
  const messagesEnabled = knownConnected('wix') === true || knownConnected('trendyol') === true;

  // Poll message counts every 3 minutes
  useEffect(() => {
    if (!messagesEnabled) return undefined;
    fetchMessageCounts();
    const interval = setInterval(fetchMessageCounts, 180_000);
    return () => clearInterval(interval);
  }, [fetchMessageCounts, messagesEnabled]);

  // ─── Desktop sidebar: hover expands as an overlay, pin pushes content ──
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(() => pinnedMemo ?? false);
  // On the very first client mount the stored pin is applied after hydration;
  // that one change must snap, not animate 4rem → 16rem.
  const instantRef = useRef(pinnedMemo === null);
  const [pinReady, setPinReady] = useState(pinnedMemo !== null);
  useIsomorphicLayoutEffect(() => {
    if (pinnedMemo !== null) return;
    let stored = false;
    try {
      stored = window.localStorage.getItem(SIDEBAR_PIN_KEY) === '1';
    } catch {
      // storage unavailable — default unpinned
    }
    pinnedMemo = stored;
    setPinned(stored);
    setPinReady(true);
  }, []);
  useEffect(() => {
    // Runs after the commit that applied the stored pin; animate from now on.
    if (pinReady) instantRef.current = false;
  }, [pinReady]);
  const instant = instantRef.current;
  const togglePinned = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      pinnedMemo = next;
      try {
        window.localStorage.setItem(SIDEBAR_PIN_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
  // Keyboard users: focusing into the sidebar expands it like hover does.
  const handleAsideFocus = () => { if (isDesktop) setHoverOpen(true); };
  const handleAsideBlur = (e) => {
    if (!isDesktop) return;
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    setHoverOpen(false);
  };
  // `expanded` drives labels/width; on mobile it is the drawer state.
  const expanded = isMobile ? isOpen : (pinned || hoverOpen);
  const overlayExpanded = isDesktop && hoverOpen && !pinned;

  const isActive = (href) => router.pathname === href;

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isMobile && isOpen) {
      document.body.classList.add('sidebar-open');
    } else {
      document.body.classList.remove('sidebar-open');
    }
    return () => {
      document.body.classList.remove('sidebar-open');
    };
  }, [isMobile, isOpen]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && isOpen && isMobile) {
        closeSidebar();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isMobile, closeSidebar]);

  // Pull-to-refresh (mobile only). The page scrolls inside <main>, not the
  // window, so the gesture is bound to <main> and gated on its scrollTop.
  // Refresh is soft (re-run route data + revalidate SWR + notify pages) —
  // a hard reload here used to wipe unsaved edits on an accidental drag.
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const mainRef = useRef(null);
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const isPulling = useRef(false);
  const isRefreshingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const PULL_THRESHOLD = 80;
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const main = mainRef.current;
    if (!isMobile || !main) return;

    const resetPull = () => {
      isPulling.current = false;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    // True if the touch target sits in a nested scroller that is not at its
    // top — scrolling that list up must never count as a pull.
    const inScrolledChild = (target) => {
      let el = target instanceof Element ? target : null;
      while (el && el !== main) {
        if (el.scrollTop > 0) return true;
        el = el.parentElement;
      }
      return false;
    };

    const handleTouchStart = (e) => {
      isPulling.current = false;
      if (isRefreshingRef.current || e.touches.length !== 1) return;
      if (main.scrollTop > 0 || inScrolledChild(e.target)) return;
      touchStartY.current = e.touches[0].clientY;
      touchStartX.current = e.touches[0].clientX;
      isPulling.current = true;
    };

    const handleTouchMove = (e) => {
      if (!isPulling.current || isRefreshingRef.current) return;
      const dy = e.touches[0].clientY - touchStartY.current;
      const dx = e.touches[0].clientX - touchStartX.current;
      // Abort on upward / sideways movement or once main has scrolled at all
      if (dy < 0 || main.scrollTop > 0 || (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10)) {
        resetPull();
        return;
      }
      if (dy > 10) {
        const dampened = Math.min((dy - 10) * 0.4, 120);
        pullDistanceRef.current = dampened;
        setPullDistance(dampened);
      }
    };

    const handleTouchEnd = async () => {
      if (!isPulling.current) return;
      isPulling.current = false;
      if (pullDistanceRef.current < PULL_THRESHOLD) {
        resetPull();
        return;
      }
      isRefreshingRef.current = true;
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD * 0.5);
      try {
        window.dispatchEvent(new CustomEvent('kx:pull-refresh'));
        await Promise.all([
          routerRef.current.replace(routerRef.current.asPath, undefined, { scroll: false }),
          mutate(() => true),
        ]);
      } catch {
        // best-effort refresh
      } finally {
        isRefreshingRef.current = false;
        setIsRefreshing(false);
        resetPull();
      }
    };

    main.addEventListener('touchstart', handleTouchStart, { passive: true });
    main.addEventListener('touchmove', handleTouchMove, { passive: true });
    main.addEventListener('touchend', handleTouchEnd, { passive: true });
    main.addEventListener('touchcancel', resetPull, { passive: true });

    return () => {
      main.removeEventListener('touchstart', handleTouchStart);
      main.removeEventListener('touchmove', handleTouchMove);
      main.removeEventListener('touchend', handleTouchEnd);
      main.removeEventListener('touchcancel', resetPull);
    };
  }, [isMobile]);

  const handleSignOut = async () => {
    clearNavConnCache();
    await supabaseSignOut();
  };

  // User initials for avatar
  const userInitials = user?.email ? user.email.charAt(0).toUpperCase() : 'K';

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>

      {/* Pull-to-refresh indicator */}
      {isMobile && pullDistance > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: `${pullDistance}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            background: 'linear-gradient(to bottom, rgba(248,250,252,0.95), transparent)',
            transition: isPulling.current ? 'none' : 'height 0.2s ease-out',
            overflow: 'hidden',
          }}
        >
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            opacity: Math.min(pullDistance / PULL_THRESHOLD, 1),
          }}>
            {isRefreshing ? (
              <svg width="24" height="24" viewBox="0 0 24 24" style={{ animation: 'spin 0.8s linear infinite' }}>
                <circle cx="12" cy="12" r="10" stroke="#2563eb" strokeWidth="2.5" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
            ) : (
              <svg
                width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{
                  transform: pullDistance >= PULL_THRESHOLD ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease',
                }}
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
            )}
            <span style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px', fontWeight: 500 }}>
              {isRefreshing ? t('refreshing') : pullDistance >= PULL_THRESHOLD ? t('release') : t('pullToRefresh')}
            </span>
          </div>
        </div>
      )}

      <div className="h-screen flex overflow-hidden" style={{ backgroundColor: '#f8fafc' }}>

        {/* ─── Sidebar ─────────────────────────────────────── */}
        <motion.aside
          initial={false}
          animate={{
            x: isMobile ? (isOpen ? 0 : '-100%') : 0,
            width: isMobile ? '75vw' : (expanded ? '16rem' : '4rem')
          }}
          transition={{ duration: instant ? 0 : 0.25, ease: [0.4, 0, 0.2, 1] }}
          onMouseEnter={() => { if (isDesktop) setHoverOpen(true); }}
          onMouseLeave={() => { if (isDesktop) setHoverOpen(false); }}
          onFocus={handleAsideFocus}
          onBlur={handleAsideBlur}
          className={`fixed top-0 left-0 h-full bg-white flex flex-col overflow-hidden ${
            isMobile ? 'z-50' : 'z-40'
          }`}
          style={{
            width: isMobile ? 'min(75vw, 280px)' : (expanded ? '16rem' : '4rem'),
            paddingTop: 'env(safe-area-inset-top, 0px)',
            borderRight: '1px solid rgba(226, 232, 240, 0.8)',
            // Hover-expanded (unpinned) sidebar floats over the content.
            boxShadow: overlayExpanded ? '0 10px 30px -8px rgba(15, 23, 42, 0.18)' : 'none',
          }}
        >
          {/* Brand header */}
          <div className="flex items-center justify-between h-16 px-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Brand icon */}
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)' }}>
                <Package size={16} className="text-white" />
              </div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: (isMobile || expanded) ? 1 : 0 }}
                transition={{ duration: 0.15 }}
                className="whitespace-nowrap overflow-hidden"
              >
                <span className="font-bold text-base" style={{ color: '#0f172a', letterSpacing: '-0.02em' }}>KolayXport</span>
              </motion.div>
            </div>
            {isMobile && (
              <button
                onClick={closeSidebar}
                className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label={t('closeMenu')}
              >
                <X size={18} />
              </button>
            )}
            {isDesktop && expanded && (
              <button
                type="button"
                onClick={togglePinned}
                className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                  pinned ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                }`}
                aria-label={pinned ? t('unpinSidebar') : t('pinSidebar')}
                aria-pressed={pinned}
                title={pinned ? t('unpinSidebar') : t('pinSidebar')}
              >
                {pinned ? <PinOff size={16} /> : <Pin size={16} />}
              </button>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-3 px-2">
            {navGroups.map((group, gi) => (
              <div key={group.id} className={gi > 0 ? 'mt-5' : ''}>
                {/* Section label */}
                {group.label && (isMobile || expanded) && (
                  <div className="px-3 mb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{group.label}</span>
                  </div>
                )}
                {!group.label && gi > 0 && (
                  <div className="mx-3 mb-2 border-t border-slate-100" />
                )}
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const IconComponent = item.icon;
                    const active = isActive(item.href);
                    const showDot = item.reauthDot && hasReauth;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => { if (isMobile) closeSidebar(); }}
                          className={`flex items-center rounded-lg text-[13px] font-medium transition-all duration-150 group relative ${
                            isMobile ? 'px-4 py-3.5 mobile-nav-item' : 'px-3 py-2.5'
                          } ${
                            active
                              ? 'text-blue-700'
                              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                          }`}
                          style={active ? {
                            backgroundColor: '#eff6ff',
                            borderLeft: expanded || isMobile ? '3px solid #2563eb' : 'none',
                            paddingLeft: expanded || isMobile ? (isMobile ? '13px' : '9px') : undefined,
                          } : (item.connectCta ? { color: '#2563eb' } : {})}
                          aria-label={showDot ? `${item.label} — ${t('reauthNeeded')}` : undefined}
                        >
                          <span className="relative flex-shrink-0 inline-flex">
                            <IconComponent
                              size={19}
                              className="flex-shrink-0"
                              style={{ color: active ? '#2563eb' : undefined }}
                            />
                            {showDot && (
                              <span
                                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white"
                                aria-hidden="true"
                              />
                            )}
                          </span>
                          <motion.span
                            initial={{ opacity: 0, width: 0 }}
                            animate={{
                              opacity: (isMobile || expanded) ? 1 : 0,
                              width: (isMobile || expanded) ? 'auto' : 0,
                              marginLeft: (isMobile || expanded) ? '0.625rem' : 0
                            }}
                            transition={{ duration: 0.15 }}
                            className="whitespace-nowrap overflow-hidden"
                          >
                            {item.label}
                          </motion.span>

                          {/* Tooltip for collapsed state */}
                          {!expanded && isDesktop && (
                            <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                              {item.label}
                              {showDot && ` — ${t('reauthNeeded')}`}
                            </div>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {/* User section at bottom */}
          <div className="p-3" style={{ borderTop: '1px solid #f1f5f9' }}>
            <button
              onClick={handleSignOut}
              className="flex items-center w-full px-3 py-2.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors group relative"
            >
              <LogOutIcon size={18} className="flex-shrink-0" />
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{
                  opacity: (isMobile || expanded) ? 1 : 0,
                  width: (isMobile || expanded) ? 'auto' : 0,
                  marginLeft: (isMobile || expanded) ? '0.625rem' : 0
                }}
                transition={{ duration: 0.15 }}
                className="text-[13px] font-medium whitespace-nowrap overflow-hidden"
              >
                {t('signOut')}
              </motion.span>

              {!expanded && isDesktop && (
                <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                  {t('signOut')}
                </div>
              )}
            </button>
          </div>
        </motion.aside>

        {/* ─── Main Content ─────────────────────────────────── */}
        <div className={`flex-1 flex flex-col h-screen overflow-hidden ${instant ? '' : 'transition-all duration-300 ease-in-out'} ${
          // Content only makes room for the sidebar when it is pinned open; a
          // hover-expanded sidebar overlays the page instead of reflowing it.
          isDesktop ? (pinned ? 'ml-64' : 'ml-16') : 'ml-0'
        }`} style={{ minWidth: 0 }}>

          {/* Mobile overlay */}
          <AnimatePresence>
            {isOpen && isMobile && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40"
                style={{ backgroundColor: 'rgba(15, 23, 42, 0.3)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
                onClick={() => closeSidebar()}
              />
            )}
          </AnimatePresence>

          {/* ─── Topbar ─────────────────────────────────── */}
          <header
            className="flex-shrink-0 z-30 bg-white flex items-center justify-between px-4 sm:px-6 lg:px-8"
            style={{
              minHeight: '4rem',
              paddingTop: 'env(safe-area-inset-top, 0px)',
              borderBottom: '1px solid rgba(226, 232, 240, 0.8)',
            }}
          >
            <div className="flex items-center gap-3">
              {isMobile && (
                <button
                  className="w-11 h-11 -ml-2 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  onClick={() => isOpen ? closeSidebar() : openSidebar()}
                  aria-label={hasReauth ? `${t('toggleMenu')} — ${t('reauthNeeded')}` : t('toggleMenu')}
                  aria-expanded={isOpen}
                  style={{ position: 'relative' }}
                >
                  {hasReauth && !isOpen && (
                    <span
                      className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white"
                      aria-hidden="true"
                    />
                  )}
                  <div className="w-5 h-5 flex flex-col justify-center items-center gap-[5px]">
                    <span className={`block w-4.5 h-[1.5px] bg-current rounded-full transition-all duration-300 ${isOpen ? 'rotate-45 translate-y-[3.5px] w-4' : ''}`}></span>
                    <span className={`block w-4.5 h-[1.5px] bg-current rounded-full transition-all duration-300 ${isOpen ? 'opacity-0 w-0' : 'w-3.5'}`}></span>
                    <span className={`block w-4.5 h-[1.5px] bg-current rounded-full transition-all duration-300 ${isOpen ? '-rotate-45 -translate-y-[3.5px] w-4' : 'w-4'}`}></span>
                  </div>
                </button>
              )}
              <h1 className="text-lg font-bold text-slate-900 truncate" style={{ letterSpacing: '-0.02em' }}>{title}</h1>
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setLocale(locale === 'tr' ? 'en' : 'tr')}
                className="px-2 py-1 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-300 transition-colors"
              >
                {locale === 'tr' ? 'EN' : 'TR'}
              </button>

              {messagesAvailable && (
                <button
                  onClick={() => router.push('/app/mesajlar')}
                  className="relative w-11 h-11 sm:w-auto sm:h-auto sm:p-2 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                  title={t('messages')}
                  aria-label={messagesEnabled && messageCount > 0 ? `${t('messages')} (${messageCount})` : t('messages')}
                >
                  <Mail size={19} />
                  {messagesEnabled && messageCount > 0 && (
                    <span className="absolute top-0.5 right-0.5 sm:-top-0.5 sm:-right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full ring-2 ring-white px-1">
                      {messageCount > 99 ? '99+' : messageCount}
                    </span>
                  )}
                </button>
              )}

              {/* User avatar */}
              <button
                onClick={() => router.push('/ayarlar')}
                className="ml-1 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold text-white transition-transform hover:scale-105"
                style={{ background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)' }}
                title={t('settings')}
              >
                {userInitials}
              </button>
            </div>
          </header>

          {/* ─── Page Content ─────────────────────────────── */}
          <main ref={mainRef} className={`flex-1 overflow-y-auto ${
            isMobile ? 'p-1.5' : 'p-2 sm:p-3 lg:p-4'
          }`} style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', backgroundColor: '#f8fafc' }}>
            <TrialNotification userSubscription={userSubscription} />
            {children}
          </main>
        </div>
      </div>
    </>
  );
};

export default AppLayout;
