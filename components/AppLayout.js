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
  Link2
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context'; // Changed from next-auth/react
import { supabase } from '@/lib/supabase'; // Added for direct Supabase calls if needed for signout
import useSidebar from '../hooks/useSidebar'; // Import the hook
import SidebarToggle from './SidebarToggle'; // Import the toggle component

const navItems = [
  { href: '/app', icon: LayoutDashboard, label: 'Genel Bakış' },
  { href: '/app/entegrasyonlar-ve-rehberler', icon: Link2, label: 'Entegrasyonlar' },
  { href: '/app/settings', icon: Settings, label: 'Ayarlar' },
  { href: '/app/senkron', icon: ShoppingCart, label: 'Senkron' },
];

const AppLayout = ({ children, title = 'KolayXport Dashboard' }) => {
  const { user, session, supabaseSignOut, isLoading } = useAuth(); // Fixed: use supabaseSignOut
  const router = useRouter();
  const { isOpen, toggleSidebar, openSidebar, closeSidebar } = useSidebar(); // Use the hook

  // Close sidebar on mobile when route changes
  useEffect(() => {
    const handleRouteChange = () => {
      if (window.innerWidth < 1024) {
        closeSidebar();
      }
    };
    router.events.on('routeChangeComplete', handleRouteChange);
    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [router.events, closeSidebar]);

  // Check for active link
  const isActive = (href) => router.pathname === href;

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
        {/* Sidebar Overlay for mobile - Conditionally rendered based on sidebar state */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeSidebar} // Use closeSidebar from the hook
              className="fixed inset-0 bg-black/30 z-30 md:hidden"
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <AnimatePresence>
          {isOpen && (
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed top-0 left-0 h-full w-64 bg-slate-800 text-slate-100 flex flex-col z-40 shadow-lg"
            >
              <div className="flex items-center justify-between h-14 px-4 border-b border-slate-800">

                <button 
                    onClick={closeSidebar} 
                    className="text-slate-400 hover:text-slate-200 lg:hidden"
                    aria-label="Kenar çubuğunu kapat"
                >
                  <X size={24} />
                </button>
              </div>
              <nav className="py-4">
                <ul>
                  {navItems.map((item) => {
                    const IconComponent = item.icon;
                    return (
                      <li key={item.label} className="px-3 py-1">
                        <Link 
  href={item.href} 
  className={`flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-150
    ${
      isActive(item.href)
        ? 'bg-slate-700 text-white shadow-inner'
        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
    }`}
>
  <IconComponent size={18} className="mr-3 flex-shrink-0" />
  {item.label}
</Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main content area */}
        <div className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${isOpen ? 'md:ml-64' : 'md:ml-0'}`}>
          {/* Topbar */}
          <header className="sticky top-0 z-20 bg-white shadow-sm flex items-center justify-between px-4 sm:px-6 lg:px-8 h-16 border-b border-gray-200">
            <div className="flex items-center">
              <div className="md:hidden mr-2">
                <SidebarToggle />
              </div>
              <div className="hidden md:block">
                <SidebarToggle />
              </div>
              <h1 className="text-lg font-semibold text-slate-800 ml-2 hidden sm:block">{title}</h1>
            </div>
            {/* Center: Search */}
            <div className="flex-1 max-w-md mx-auto">
              <div className="relative">
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
            <div className="flex items-center space-x-3 sm:space-x-4">
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
                onClick={() => router.push('/app/settings')}
                className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
              >
                <Settings size={20} />
                <span className="sr-only">Ayarlar</span>
              </button>
              <button
                onClick={handleSignOut}
                className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
              >
                <LogOutIcon size={20} />
                <span className="sr-only">Çıkış Yap</span>
              </button>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-grow p-6 lg:p-8 bg-slate-50">
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