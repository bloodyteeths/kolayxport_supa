import React, { useState, useEffect } from 'react';
import Head from 'next/head'; // Using Head for simple title, can be NextSeo if more complex SEO needed per dashboard page
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
  Target
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context'; // Changed from next-auth/react
import { supabase } from '@/lib/supabase'; // Added for direct Supabase calls if needed for signout
import useSidebar from '../hooks/useSidebar'; // Import the hook
import useScreenSize from '../hooks/useScreenSize'; // Import screen size hook

/**
 * AppLayout: For authenticated application routes (e.g., /app/*)
 * Provides sidebar, topbar, and dashboard navigation for logged-in users.
 */

const navItems = [
  { href: '/app', icon: LayoutDashboard, label: 'Genel Bakış' },
  { href: '/app/analytics', icon: TrendingUp, label: 'Analitik' },
  { href: '/app/labels', icon: FileText, label: 'Label' },
  { href: '/app/etsy-listings', icon: Store, label: 'Etsy Listings' },
  { href: '/app/ebay-listings', icon: ShoppingBag, label: 'eBay Listings' },
  { href: '/app/ebay-research', icon: Target, label: 'eBay Research' },
  { href: '/app/entegrasyonlar-ve-rehberler', icon: Link2, label: 'Entegrasyonlar' },
  { href: '/ayarlar', icon: Settings, label: 'Ayarlar' },
  { href: '/app/senkron', icon: ShoppingCart, label: 'Senkron' },
];

const AppLayout = ({ children, title = 'KolayXport Dashboard' }) => {
  const { user, session, supabaseSignOut, isLoading } = useAuth(); // Fixed: use supabaseSignOut
  const router = useRouter();
  const { isOpen, openSidebar, closeSidebar } = useSidebar(); // Use the hook
  const { isMobile, isDesktop } = useScreenSize(); // Use screen size hook

  // Check for active link
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

  const handleSignOut = async () => {
    await supabaseSignOut();
    // router.push('/') is already handled in supabaseSignOut
  };


  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="min-h-screen bg-slate-100 flex text-slate-800">

        {/* Sidebar - Mobile: overlay drawer, Desktop: persistent sidebar */}
        <motion.aside
          initial={false}
          animate={{ 
            x: isMobile ? (isOpen ? 0 : '-100%') : 0,
            width: isMobile ? '75vw' : (isOpen ? '16rem' : '4rem')
          }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          onMouseEnter={() => {
            if (isDesktop) {
              openSidebar();
            }
          }}
          onMouseLeave={() => {
            if (isDesktop) {
              closeSidebar();
            }
          }}
          className={`fixed top-0 left-0 h-full bg-slate-800 text-slate-100 flex flex-col shadow-lg overflow-hidden ${
            isMobile ? 'z-50' : 'z-40'
          }`}
          style={{
            width: isMobile ? 'min(75vw, 280px)' : (isOpen ? '16rem' : '4rem')
          }}
        >
          <div className="flex items-center justify-between h-16 px-4 border-b border-slate-700">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: (isMobile || isOpen) ? 1 : 0 }}
              transition={{ duration: 0.2 }}
              className="font-semibold text-lg whitespace-nowrap"
            >
              KolayXport
            </motion.div>
            {/* Close button for mobile */}
            {isMobile && (
              <button
                onClick={closeSidebar}
                className="p-2 rounded-md text-slate-300 hover:text-white hover:bg-slate-700"
              >
                <X size={20} />
              </button>
            )}
          </div>
          <nav className="py-4 flex-1">
            <ul>
              {navItems.map((item) => {
                const IconComponent = item.icon;
                return (
                  <li key={item.label} className="relative">
                    <Link 
                      href={item.href} 
                      onClick={() => {
                        if (isMobile) {
                          closeSidebar();
                        }
                      }}
                      className={`flex items-center text-sm font-medium transition-all duration-150 group relative ${
                        isMobile ? 'px-6 py-4 mobile-nav-item' : 'px-4 py-3'
                      } ${
                        isActive(item.href)
                          ? 'bg-slate-700 text-white shadow-inner'
                          : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      <IconComponent size={20} className="flex-shrink-0" />
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ 
                          opacity: (isMobile || isOpen) ? 1 : 0,
                          width: (isMobile || isOpen) ? 'auto' : 0,
                          marginLeft: (isMobile || isOpen) ? '0.75rem' : 0
                        }}
                        transition={{ duration: 0.2 }}
                        className="whitespace-nowrap overflow-hidden"
                      >
                        {item.label}
                      </motion.span>
                      
                      {/* Tooltip for collapsed state - Desktop only */}
                      {!isOpen && isDesktop && (
                        <div className="absolute left-full ml-2 px-2 py-1 bg-slate-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                          {item.label}
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          
          {/* User section at bottom */}
          <div className="border-t border-slate-700 p-4">
            <button
              onClick={handleSignOut}
              className="flex items-center w-full text-slate-300 hover:text-white transition-colors group relative"
            >
              <LogOutIcon size={20} className="flex-shrink-0" />
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ 
                  opacity: (isMobile || isOpen) ? 1 : 0,
                  width: (isMobile || isOpen) ? 'auto' : 0,
                  marginLeft: (isMobile || isOpen) ? '0.75rem' : 0
                }}
                transition={{ duration: 0.2 }}
                className="text-sm whitespace-nowrap overflow-hidden"
              >
                Çıkış Yap
              </motion.span>
              
              {/* Tooltip for collapsed state - Desktop only */}
              {!isOpen && isDesktop && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-slate-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  Çıkış Yap
                </div>
              )}
            </button>
          </div>
        </motion.aside>

        {/* Main content area */}
        <div className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${
          isDesktop ? (isOpen ? 'ml-64' : 'ml-16') : 'ml-0'
        }`}>
          {/* Mobile overlay when sidebar is open */}
          {isOpen && isMobile && (
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 z-40"
              onClick={() => closeSidebar()}
            />
          )}
          {/* Topbar */}
          <header className="sticky top-0 z-30 bg-white shadow-sm flex items-center justify-between px-4 sm:px-6 lg:px-8 h-16 border-b border-gray-200">
            <div className="flex items-center">
              {/* Mobile hamburger menu - 3 lines */}
              {isMobile && (
                <button
                  className="p-2 rounded-md text-slate-600 hover:bg-slate-100 mr-3 transition-colors"
                  onClick={() => isOpen ? closeSidebar() : openSidebar()}
                  aria-label="Toggle navigation menu"
                >
                  <div className="w-5 h-5 flex flex-col justify-center items-center">
                    <span className={`block w-5 h-0.5 bg-current transition-all duration-300 ${isOpen ? 'rotate-45 translate-y-1' : '-translate-y-1'}`}></span>
                    <span className={`block w-5 h-0.5 bg-current transition-all duration-300 ${isOpen ? 'opacity-0' : 'opacity-100'}`}></span>
                    <span className={`block w-5 h-0.5 bg-current transition-all duration-300 ${isOpen ? '-rotate-45 -translate-y-1' : 'translate-y-1'}`}></span>
                  </div>
                </button>
              )}
              <h1 className="text-lg font-semibold text-slate-800 truncate">{title}</h1>
            </div>
            {/* Center: Search - Hidden on mobile */}
            <div className="hidden sm:flex flex-1 max-w-md mx-auto">
              <div className="relative w-full">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-5 w-5 text-slate-400" />
                </div>
                <input 
                  type="search" 
                  name="app-search"
                  id="app-search"
                  className="block w-full pl-10 pr-3 py-2 text-sm text-slate-700 bg-white/50 border border-slate-300 rounded-lg shadow-sm placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 transition-colors"
                  placeholder="Sipariş, ürün, kullanıcı…"
                />
              </div>
            </div>
            {/* Right: Actions */}
            <div className={`flex items-center ${
              isMobile ? 'space-x-1 mobile-action-buttons' : 'space-x-2 sm:space-x-3 md:space-x-4'
            }`}>
              <div className="relative">
                <button 
                  onClick={() => alert('Yeni bildiriminiz yok.')} 
                  className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <Bell size={20} />
                  <span className="sr-only">Bildirimler</span>
                </button>
              </div>
              <button
                onClick={() => router.push('/ayarlar')}
                className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
              >
                <Settings size={18} />
                <span className="sr-only">Ayarlar</span>
              </button>
              <button
                onClick={handleSignOut}
                className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
              >
                <LogOutIcon size={18} />
                <span className="sr-only">Çıkış Yap</span>
              </button>
            </div>
          </header>

          {/* Page content */}
          <main className={`flex-grow bg-slate-50 ${
            isMobile ? 'p-3' : 'p-4 sm:p-6 lg:p-8'
          }`}>
            {/* Optional: Page header can go here if not in topbar */}
            {/* <h1 className="text-2xl font-semibold text-slate-800 mb-6">{title.replace('KolayXport Dashboard - ','')}</h1> */}
            {children}
          </main>
        </div>
      </div>
    </>
  );
};

export default AppLayout; 