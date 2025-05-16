import Link from 'next/link'
import * as React from 'react'
import { Home, CreditCard, Bell, LogIn, LogOut, Settings } from 'lucide-react'
import { useAuth } from "@/lib/auth-context"
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/router'
import useSidebar from '../hooks/useSidebar';
import SidebarToggle from './SidebarToggle';

export default function Layout({ children }) {
  const { isOpen, toggleSidebar, closeSidebar } = useSidebar();
  const { user, session, isLoading, signIn: supabaseSignIn, signOut: supabaseSignOut } = useAuth();
  const router = useRouter();

  const publicPaths = [
    '/privacy','/privacy-tr','/auth/error','/404',
    '/blog','/ozellikler','/entegrasyonlar','/kurumsal','/fiyatlandirma','/iletisim','/kariyer','/docs','/','/docs/index'
  ];
  const isGenericPublicPage = publicPaths.includes(router.pathname);
  const isHomePage = router.pathname === '/';

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar toggle button */}
      {!isHomePage && !isGenericPublicPage && session && (
        <div className="absolute top-4 left-4 z-50">
          <SidebarToggle />
        </div>
      )}
      {/* Sidebar - Hide for the new public homepage and generic public pages */}
      {/* Collapsible dark sidebar for dashboard (authenticated views) */}
      {!isHomePage && !isGenericPublicPage && session && (
        <>
          {/* Sidebar Overlay for mobile - click to close */}
          {isOpen && (
            <div
              onClick={closeSidebar}
              className="fixed inset-0 bg-black/30 z-30 md:hidden"
            />
          )}

          {/* Sidebar */}
          {isOpen && (
            <aside className="fixed top-0 left-0 h-full w-64 bg-slate-800 text-slate-100 flex flex-col z-40 shadow-lg">
              <div className="flex items-center justify-between h-14 px-4 border-b border-slate-800">
                <Link href="/app" className="text-xl font-bold text-white flex items-center">
                  KolayXport
                </Link>
                <button 
                  onClick={closeSidebar} 
                  className="text-slate-400 hover:text-slate-200 lg:hidden"
                  aria-label="Kenar çubuğunu kapat"
                >
                  ×
                </button>
              </div>
              <nav className="py-4">
                <ul>
                  <li className="px-3 py-1">
                    <Link href="/app" className="flex items-center p-2 rounded hover:bg-slate-700 text-white">
                      <Home className="w-5 h-5 mr-3" /> Kontrol Paneli
                    </Link>
                  </li>
                  <li className="px-3 py-1">
                    <Link href="/subscribe" className="flex items-center p-2 rounded hover:bg-slate-700 text-white">
                      <CreditCard className="w-5 h-5 mr-3" /> Abonelik
                    </Link>
                  </li>
                  <li className="px-3 py-1">
                    <Link href="/ayarlar" className="flex items-center p-2 rounded hover:bg-slate-700 text-white">
                      <Settings className="w-5 h-5 mr-3" /> Ayarlar
                    </Link>
                  </li>
                </ul>
              </nav>
              <div className="p-4 mt-auto">
                {!user && !isLoading && (
                  <Button onClick={async () => {
                    const { error } = await supabase.auth.signInWithOAuth({ 
                      provider: 'google',
                      options: { redirectTo: window.location.origin + '/app' } 
                    });
                    if (error) console.error('Error signing in with Google:', error);
                  }} className="w-full flex items-center justify-center">
                    <LogIn className="w-4 h-4 mr-2" /> Google ile Giriş Yap
                  </Button>
                )}
                {user && (
                  <div className="flex flex-col items-center space-y-2">
                    <span className="text-sm text-gray-200 truncate" title={user.email}>{user.name || user.email}</span>
                    <Button onClick={async () => await supabaseSignOut()} variant="outline" className="w-full flex items-center justify-center">
                      <LogOut className="w-4 h-4 mr-2" /> Çıkış Yap
                    </Button>
                  </div>
                )}
              </div>
            </aside>
          )}
        </>
      )}
      {/* Main Content */}
      <div className={`flex-1 flex flex-col ${isHomePage || isGenericPublicPage ? 'w-full' : ''}`}>
        {/* Header - Hide for new public homepage and generic public pages, or show a different public nav */}
        {!isHomePage && !isGenericPublicPage && session && (
          <header className="bg-white shadow p-4 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900">
              {session ? 'Kontrol Paneli' : 'Lütfen Giriş Yapın'}
            </h2>
            {session && (
               <button className="p-2 rounded hover:bg-gray-100">
                   <Bell className="w-6 h-6 text-gray-600" />
               </button>
            )}
          </header>
        )}

        {/* Page Content Area */}
        <main className={`flex-1 overflow-auto ${isHomePage || isGenericPublicPage ? '' : 'p-8 bg-gray-100'}`}>
          {isLoading && !isHomePage && !isGenericPublicPage && <p>Yükleniyor...</p>}
          {!isHomePage && !isGenericPublicPage && !user && !isLoading && (
            <div className="text-center">
              <p className="mb-4">Bu sayfayı görüntülemek için giriş yapmanız gerekiyor.</p>
              <Button onClick={async () => {
                  const { error } = await supabase.auth.signInWithOAuth({ 
                    provider: 'google',
                    options: { redirectTo: window.location.origin + '/app' } 
                  });
                  if (error) console.error('Error signing in with Google:', error);
                }} className="w-auto flex items-center justify-center mx-auto">
                  <LogIn className="w-4 h-4 mr-2" /> Google ile Giriş Yap
              </Button>
            </div>
          )}
          {(user || isHomePage || isGenericPublicPage) && children}
        </main>

        {/* Footer - Conditionally render or use the one from pages/index.js for homepage */}
        {!isHomePage && (
          <footer className="bg-white border-t py-4 text-center text-sm text-gray-600">
            <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
            <span className="mx-2">|</span>
            <Link href="/privacy-tr" className="hover:underline">Gizlilik Politikası</Link>
            {user && (
              <>
                <span className="mx-2">|</span>
                <Link href="#" onClick={async (e) => { e.preventDefault(); await supabaseSignOut(); }} className="hover:underline">Logout</Link>
              </>
            )}
            <div className="mt-2">
              &copy; {new Date().getFullYear()} Tamsar Tekstil Dış Tic. Ltd. Şti. All rights reserved.
            </div>
            <div className="mt-1">
              Support: <a href="mailto:destek@kolayxport.com" className="hover:underline">destek@kolayxport.com</a>
            </div>
          </footer>
        )}
      </div>
    </div>
  )
} 