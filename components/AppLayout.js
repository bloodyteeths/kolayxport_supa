import React, { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu,
  Search,
  Bell,
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
  Package
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import useSidebar from '../hooks/useSidebar';
import useScreenSize from '../hooks/useScreenSize';

/**
 * AppLayout: For authenticated application routes (e.g., /app/*)
 * Provides sidebar, topbar, and dashboard navigation for logged-in users.
 */

const navGroups = [
  {
    label: null,
    items: [
      { href: '/app', icon: LayoutDashboard, label: 'Genel Bakış' },
      { href: '/app/analytics', icon: TrendingUp, label: 'Analitik' },
    ],
  },
  {
    label: 'Pazaryerleri',
    items: [
      { href: '/app/etsy-listings', icon: Store, label: 'Etsy Listings' },
      { href: '/app/etsy-research', icon: Target, label: 'Etsy Araştırma' },
      { href: '/app/ebay-listings', icon: ShoppingBag, label: 'eBay Listings' },
      { href: '/app/ebay-research', icon: Target, label: 'eBay Research' },
    ],
  },
  {
    label: 'Operasyonlar',
    items: [
      { href: '/app/labels', icon: FileText, label: 'Label' },
      { href: '/app/senkron', icon: ShoppingCart, label: 'Senkron' },
    ],
  },
  {
    label: 'Yönetim',
    items: [
      { href: '/app/entegrasyonlar-ve-rehberler', icon: Link2, label: 'Entegrasyonlar' },
      { href: '/ayarlar', icon: Settings, label: 'Ayarlar' },
    ],
  },
];

// Flat list for backward compat
const navItems = navGroups.flatMap(g => g.items);

const AppLayout = ({ children, title = 'KolayXport Dashboard' }) => {
  const { user, session, supabaseSignOut, isLoading } = useAuth();
  const router = useRouter();
  const { isOpen, openSidebar, closeSidebar } = useSidebar();
  const { isMobile, isDesktop } = useScreenSize();

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

  // Pull-to-refresh (mobile only)
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const pullDistanceRef = useRef(0);
  const PULL_THRESHOLD = 80;

  useEffect(() => { pullDistanceRef.current = pullDistance; }, [pullDistance]);

  useEffect(() => {
    if (!isMobile) return;

    const getScrollTop = () => {
      return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    };

    const handleTouchStart = (e) => {
      if (getScrollTop() <= 1 && !isRefreshing) {
        touchStartY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    };

    const handleTouchMove = (e) => {
      if (!isPulling.current || isRefreshing) return;
      const currentY = e.touches[0].clientY;
      const diff = currentY - touchStartY.current;
      if (diff > 10 && getScrollTop() <= 1) {
        const dampened = Math.min((diff - 10) * 0.4, 120);
        setPullDistance(dampened);
        pullDistanceRef.current = dampened;
      } else if (diff < 0) {
        isPulling.current = false;
        setPullDistance(0);
        pullDistanceRef.current = 0;
      }
    };

    const handleTouchEnd = () => {
      if (!isPulling.current) return;
      isPulling.current = false;
      if (pullDistanceRef.current >= PULL_THRESHOLD) {
        setIsRefreshing(true);
        setPullDistance(PULL_THRESHOLD * 0.5);
        setTimeout(() => {
          window.location.reload();
        }, 300);
      } else {
        setPullDistance(0);
        pullDistanceRef.current = 0;
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isMobile, isRefreshing]);

  const handleSignOut = async () => {
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
              {isRefreshing ? 'Yenileniyor...' : pullDistance >= PULL_THRESHOLD ? 'Bırak' : 'Yenilemek icin cek'}
            </span>
          </div>
        </div>
      )}

      <div className="min-h-screen flex" style={{ overflowX: 'hidden', maxWidth: '100%', backgroundColor: '#f8fafc' }}>

        {/* ─── Sidebar ─────────────────────────────────────── */}
        <motion.aside
          initial={false}
          animate={{
            x: isMobile ? (isOpen ? 0 : '-100%') : 0,
            width: isMobile ? '75vw' : (isOpen ? '16rem' : '4rem')
          }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          onMouseEnter={() => { if (isDesktop) openSidebar(); }}
          onMouseLeave={() => { if (isDesktop) closeSidebar(); }}
          className={`fixed top-0 left-0 h-full bg-white flex flex-col overflow-hidden ${
            isMobile ? 'z-50' : 'z-40'
          }`}
          style={{
            width: isMobile ? 'min(75vw, 280px)' : (isOpen ? '16rem' : '4rem'),
            paddingTop: 'env(safe-area-inset-top, 0px)',
            borderRight: '1px solid rgba(226, 232, 240, 0.8)',
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
                animate={{ opacity: (isMobile || isOpen) ? 1 : 0 }}
                transition={{ duration: 0.15 }}
                className="whitespace-nowrap overflow-hidden"
              >
                <span className="font-bold text-base" style={{ color: '#0f172a', letterSpacing: '-0.02em' }}>KolayXport</span>
              </motion.div>
            </div>
            {isMobile && (
              <button
                onClick={closeSidebar}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-3 px-2">
            {navGroups.map((group, gi) => (
              <div key={gi} className={gi > 0 ? 'mt-5' : ''}>
                {/* Section label */}
                {group.label && (isMobile || isOpen) && (
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
                            borderLeft: isOpen || isMobile ? '3px solid #2563eb' : 'none',
                            paddingLeft: isOpen || isMobile ? (isMobile ? '13px' : '9px') : undefined,
                          } : {}}
                        >
                          <IconComponent
                            size={19}
                            className="flex-shrink-0"
                            style={{ color: active ? '#2563eb' : undefined }}
                          />
                          <motion.span
                            initial={{ opacity: 0, width: 0 }}
                            animate={{
                              opacity: (isMobile || isOpen) ? 1 : 0,
                              width: (isMobile || isOpen) ? 'auto' : 0,
                              marginLeft: (isMobile || isOpen) ? '0.625rem' : 0
                            }}
                            transition={{ duration: 0.15 }}
                            className="whitespace-nowrap overflow-hidden"
                          >
                            {item.label}
                          </motion.span>

                          {/* Tooltip for collapsed state */}
                          {!isOpen && isDesktop && (
                            <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                              {item.label}
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
                  opacity: (isMobile || isOpen) ? 1 : 0,
                  width: (isMobile || isOpen) ? 'auto' : 0,
                  marginLeft: (isMobile || isOpen) ? '0.625rem' : 0
                }}
                transition={{ duration: 0.15 }}
                className="text-[13px] font-medium whitespace-nowrap overflow-hidden"
              >
                Çıkış Yap
              </motion.span>

              {!isOpen && isDesktop && (
                <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                  Çıkış Yap
                </div>
              )}
            </button>
          </div>
        </motion.aside>

        {/* ─── Main Content ─────────────────────────────────── */}
        <div className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${
          isDesktop ? (isOpen ? 'ml-64' : 'ml-16') : 'ml-0'
        }`} style={{ overflowX: 'hidden', maxWidth: '100%', width: '100%' }}>

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
            className="sticky top-0 z-30 bg-white flex items-center justify-between px-4 sm:px-6 lg:px-8"
            style={{
              minHeight: '4rem',
              paddingTop: 'env(safe-area-inset-top, 0px)',
              overflow: 'hidden',
              borderBottom: '1px solid rgba(226, 232, 240, 0.8)',
            }}
          >
            <div className="flex items-center gap-3">
              {isMobile && (
                <button
                  className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  onClick={() => isOpen ? closeSidebar() : openSidebar()}
                  aria-label="Toggle navigation menu"
                >
                  <div className="w-5 h-5 flex flex-col justify-center items-center gap-[5px]">
                    <span className={`block w-4.5 h-[1.5px] bg-current rounded-full transition-all duration-300 ${isOpen ? 'rotate-45 translate-y-[3.5px] w-4' : ''}`}></span>
                    <span className={`block w-4.5 h-[1.5px] bg-current rounded-full transition-all duration-300 ${isOpen ? 'opacity-0 w-0' : 'w-3.5'}`}></span>
                    <span className={`block w-4.5 h-[1.5px] bg-current rounded-full transition-all duration-300 ${isOpen ? '-rotate-45 -translate-y-[3.5px] w-4' : 'w-4'}`}></span>
                  </div>
                </button>
              )}
              <h1 className="text-lg font-bold text-slate-900 truncate" style={{ letterSpacing: '-0.02em' }}>{title}</h1>
            </div>

            {/* Search */}
            <div className="hidden sm:flex flex-1 max-w-sm mx-auto px-4">
              <div className="relative w-full">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  type="search"
                  name="app-search"
                  id="app-search"
                  className="block w-full pl-9 pr-3 py-2 text-sm text-slate-700 border-0 rounded-xl placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                  style={{ backgroundColor: 'rgba(241, 245, 249, 0.8)' }}
                  placeholder="Sipariş, ürün, kullanıcı…"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <kbd className="hidden lg:inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                    ⌘K
                  </kbd>
                </div>
              </div>
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => alert('Yeni bildiriminiz yok.')}
                className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
              >
                <Bell size={19} />
                {/* Notification dot */}
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full ring-2 ring-white" />
                <span className="sr-only">Bildirimler</span>
              </button>

              {/* User avatar */}
              <button
                onClick={() => router.push('/ayarlar')}
                className="ml-1 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold text-white transition-transform hover:scale-105"
                style={{ background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)' }}
                title="Ayarlar"
              >
                {userInitials}
              </button>
            </div>
          </header>

          {/* ─── Page Content ─────────────────────────────── */}
          <main className={`flex-grow ${
            isMobile ? 'p-3' : 'p-4 sm:p-6 lg:p-8'
          }`} style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', overflowX: 'hidden', maxWidth: '100%', backgroundColor: '#f8fafc' }}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
};

export default AppLayout;
