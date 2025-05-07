import Link from 'next/link'
import * as React from 'react'
import { Home, CreditCard, Bell, LogIn, LogOut } from 'lucide-react'
import { useSession, signIn, signOut } from "next-auth/react"
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/router'

export default function Layout({ children }) {
  const { data: session, status } = useSession();
  const loading = status === "loading";
  const router = useRouter();

  const publicPaths = [
    '/privacy','/privacy-tr','/auth/error','/404',
    '/blog','/ozellikler','/entegrasyonlar','/kurumsal','/fiyatlandirma','/iletisim','/kariyer','/docs','/','/docs/index'
  ];
  const isGenericPublicPage = publicPaths.includes(router.pathname);
  const isHomePage = router.pathname === '/';

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar - Hide for the new public homepage and generic public pages */}
      {!isHomePage && !isGenericPublicPage && session && (
        <aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-200">
          <div className="p-6">
            <Link href="/app">
              <h1 className="text-2xl font-bold text-blue-600 cursor-pointer">KolayXport</h1>
            </Link>
          </div>
          {session && (
            <nav className="flex-1 px-4 space-y-2">
              <Link href="/app" className="flex items-center p-2 rounded hover:bg-gray-100 text-gray-700">
                <Home className="w-5 h-5 mr-3" />
                Kontrol Paneli
              </Link>
              <Link href="/subscribe" className="flex items-center p-2 rounded hover:bg-gray-100 text-gray-700">
                <CreditCard className="w-5 h-5 mr-3" />
                Abonelik
              </Link>
            </nav>
          )}
          <div className="p-4 mt-auto">
             {!session && (
                <Button onClick={() => signIn('google', { callbackUrl: '/app' })} className="w-full flex items-center justify-center">
                    <LogIn className="w-4 h-4 mr-2" /> Google ile Giriş Yap
                </Button>
             )}
             {session?.user && (
                <div className="flex flex-col items-center space-y-2">
                    <span className="text-sm text-gray-600 truncate" title={session.user.email}>{session.user.name || session.user.email}</span>
                    <Button onClick={() => signOut({ callbackUrl: '/' })} variant="outline" className="w-full flex items-center justify-center">
                       <LogOut className="w-4 h-4 mr-2" /> Çıkış Yap
                    </Button>
                </div>
             )}
          </div>
        </aside>
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
          {loading && !isHomePage && !isGenericPublicPage && <p>Loading session...</p>}
          {!isHomePage && !isGenericPublicPage && !session && !loading && (
            <div className="text-center">
              <p className="mb-4">Bu sayfayı görüntülemek için giriş yapmanız gerekiyor.</p>
              <Button onClick={() => signIn('google', { callbackUrl: '/app' })} className="w-auto flex items-center justify-center mx-auto">
                  <LogIn className="w-4 h-4 mr-2" /> Google ile Giriş Yap
              </Button>
            </div>
          )}
          {(session || isHomePage || isGenericPublicPage) && children}
        </main>

        {/* Footer - Conditionally render or use the one from pages/index.js for homepage */}
        {!isHomePage && (
          <footer className="bg-white border-t py-4 text-center text-sm text-gray-600">
            <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
            <span className="mx-2">|</span>
            <Link href="/privacy-tr" className="hover:underline">Gizlilik Politikası</Link>
            {session && (
              <>
                <span className="mx-2">|</span>
                <Link href="/logout" className="hover:underline">Logout</Link>
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