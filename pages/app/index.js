import React, { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout';
import Link from 'next/link';
import {
  Loader2,
  TrendingUp,
  Store,
  ShoppingBag,
  FileText,
  Target,
  ShoppingCart,
  ArrowRight,
  Sparkles,
  Package,
  BarChart3,
  Truck,
  CheckCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';

const QuickActionCard = ({ href, icon: Icon, label, description, color }) => (
  <Link
    href={href}
    className="card-premium p-4 sm:p-5 flex items-start gap-3.5 group cursor-pointer card-premium-interactive"
  >
    <div
      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-110"
      style={{ background: color.bg }}
    >
      <Icon size={18} style={{ color: color.icon }} />
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-slate-800 group-hover:text-slate-900">{label}</h3>
        <ArrowRight size={13} className="text-slate-300 group-hover:text-slate-500 transition-all group-hover:translate-x-0.5" />
      </div>
      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{description}</p>
    </div>
  </Link>
);

const TimelineItem = ({ text, done = true }) => (
  <div className="flex items-start gap-3 py-2.5">
    <div className="relative flex-shrink-0 mt-0.5">
      <CheckCircle size={16} className={done ? 'text-emerald-500' : 'text-slate-300'} />
    </div>
    <span className={`text-sm ${done ? 'text-slate-700' : 'text-slate-400'}`}>{text}</span>
  </div>
);

const DashboardLandingContent = ({ user }) => {
  const t = useTranslations('dashboard');
  const tAuth = useTranslations('auth');
  const { formatDate } = useLocale();

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || t('defaultUser');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('greeting.morning') : hour < 18 ? t('greeting.afternoon') : t('greeting.evening');

  const quickActions = [
    {
      href: '/app/etsy-listings',
      icon: Store,
      label: 'Etsy Listings',
      description: t('features.etsyListings'),
      color: { bg: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)', icon: '#ea580c' },
    },
    {
      href: '/app/ebay-listings',
      icon: ShoppingBag,
      label: 'eBay Listings',
      description: t('features.ebayListings'),
      color: { bg: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', icon: '#2563eb' },
    },
    {
      href: '/app/labels',
      icon: Truck,
      label: t('features.shippingLabel'),
      description: t('features.shippingLabelDesc'),
      color: { bg: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', icon: '#16a34a' },
    },
    {
      href: '/app/analytics',
      icon: BarChart3,
      label: 'Analitik',
      description: t('features.analyticsDesc'),
      color: { bg: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)', icon: '#7c3aed' },
    },
    {
      href: '/app/ebay-research',
      icon: Target,
      label: t('features.marketResearch'),
      description: t('features.marketResearchDesc'),
      color: { bg: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)', icon: '#e11d48' },
    },
    {
      href: '/app/senkron',
      icon: ShoppingCart,
      label: t('features.syncLabel'),
      description: t('features.syncDesc'),
      color: { bg: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)', icon: '#059669' },
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Greeting */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900" style={{ letterSpacing: '-0.025em' }}>
          {greeting}, {firstName}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Announcement banner */}
      <div
        className="relative overflow-hidden rounded-xl p-4 sm:p-6"
        style={{
          background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.04) 0%, rgba(79, 70, 229, 0.06) 100%)',
          border: '1px solid rgba(37, 99, 235, 0.12)',
        }}
      >
        <div className="flex items-start gap-3.5">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)' }}
          >
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t('allFeaturesFree')}</h2>
            <p className="text-sm text-slate-600 mt-1 max-w-lg">
              {t('allFeaturesFreeDesc')}
            </p>
            <Link
              href="/ozellikler"
              className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
            >
              {t('exploreFeatures')} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">{t('quickAccess')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {quickActions.map((action) => (
            <QuickActionCard key={action.href} {...action} />
          ))}
        </div>
      </div>

      {/* Updates timeline */}
      <div className="card-premium p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-3" style={{ letterSpacing: '-0.01em' }}>
          {t('recentUpdates')}
        </h2>
        <div className="divide-y divide-slate-100">
          <TimelineItem text={t('updates.aiListing')} />
          <TimelineItem text={t('updates.marketResearch')} />
          <TimelineItem text={t('updates.fullIntegration')} />
          <TimelineItem text={t('updates.shippingLabels')} />
          <TimelineItem text={t('updates.secureAuth')} />
          <TimelineItem text={t('updates.platformLive')} />
        </div>
      </div>
    </div>
  );
};

function AppIndexPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const t = useTranslations('dashboard');
  const tAuth = useTranslations('auth');
  const tc = useTranslations('common');

  const status = authLoading ? 'loading' : (user ? 'authenticated' : 'unauthenticated');

  if (status === 'loading') {
    return (
      <AppLayout title={tAuth('loading')} simpleHeader>
        <div className="flex flex-col items-center justify-center min-h-[calc(100dvh-200px)]">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-4" />
          <p className="text-slate-500 text-sm">{tAuth('checkingAccount')}</p>
        </div>
      </AppLayout>
    );
  }

  if (status === 'unauthenticated') {
    if (typeof window !== 'undefined') {
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + '/app',
        },
      });
    }
    return (
      <AppLayout title={tAuth('redirecting')} simpleHeader>
        <div className="flex flex-col items-center justify-center min-h-[calc(100dvh-200px)]">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-4" />
          <p className="text-slate-500 text-sm">{tAuth('redirectingToLogin')}</p>
        </div>
      </AppLayout>
    );
  }

  if (status === 'authenticated' && user) {
    return (
      <AppLayout title={t('pageTitle')}>
        <DashboardLandingContent user={user} />
      </AppLayout>
    );
  }

  return (
    <AppLayout title={t('statusUnknown')} simpleHeader>
      <div className="flex flex-col items-center justify-center min-h-[calc(100dvh-200px)]">
        <p className="text-slate-500 text-sm">{tc('errorOccurred')}</p>
      </div>
    </AppLayout>
  );
}

export default AppIndexPage;
