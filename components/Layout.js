import Link from 'next/link'
import * as React from 'react'
import { Home, CreditCard, Bell, LogIn, LogOut } from 'lucide-react'
import { useSession, signIn, signOut } from "next-auth/react"
import { Button } from '@/components/ui/button'

export default function Layout({ children }) {
  const { data: session, status } = useSession();
  const loading = status === "loading";

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-200">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-blue-600">MyBabySync</h1>
        </div>
        {session && (
          <nav className="flex-1 px-4 space-y-2">
            <Link href="/" className="flex items-center p-2 rounded hover:bg-gray-100 text-gray-700">
              <Home className="w-5 h-5 mr-3" />
              Dashboard
            </Link>
            <Link href="/subscribe" className="flex items-center p-2 rounded hover:bg-gray-100 text-gray-700">
              <CreditCard className="w-5 h-5 mr-3" />
              Abonelik
            </Link>
          </nav>
        )}
        <div className="p-4 mt-auto">
           {/* Login/Logout Button */} 
           {!session && (
              <Button onClick={() => signIn('google')} className="w-full flex items-center justify-center">
                  <LogIn className="w-4 h-4 mr-2" /> Google ile Giriş Yap
              </Button>
           )}
           {session?.user && (
              <div className="flex flex-col items-center space-y-2">
                  <span className="text-sm text-gray-600 truncate" title={session.user.email}>{session.user.name || session.user.email}</span>
                  <Button onClick={() => signOut()} variant="outline" className="w-full flex items-center justify-center">
                     <LogOut className="w-4 h-4 mr-2" /> Çıkış Yap
                  </Button>
              </div>
           )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white shadow p-4 flex justify-between items-center">
           {/* Update header content based on session? */}
          <h2 className="text-xl font-semibold text-gray-900">{session ? 'Dashboard' : 'Lütfen Giriş Yapın'}</h2>
          {session && (
             <button className="p-2 rounded hover:bg-gray-100">
                 <Bell className="w-6 h-6 text-gray-600" />
             </button>
          )}
        </header>

        {/* Page Content Area */}
        <main className="flex-1 overflow-auto p-8 bg-gray-100">
          {/* Conditionally render children based on auth status */}
          {loading && <p>Loading session...</p>}
          {!session && !loading && (
            <div>
              <p>Giriş yapmanız gerekiyor.</p>
              {/* Show login button on small screens (sidebar hidden) */}
              <div className="block md:hidden mt-4">
                <Button onClick={() => signIn('google')} className="w-full flex items-center justify-center">
                  <LogIn className="w-4 h-4 mr-2" /> Google ile Giriş Yap
                </Button>
              </div>
            </div>
          )}
          {session && children}
        </main>
      </div>
    </div>
  )
} 