import React, { useEffect, useState } from 'react';
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
  CheckCircle2,
  Circle,
  Link2,
  MapPin,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';
import { useConnections } from '@/lib/hooks/useConnections';

// Same SWR key AppLayout uses, so this is served from the shared cache.
const SETTINGS_KEY = '/api/user/settings';
const settingsFetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : null));
// One-row order probe: `total` tells us whether any order was ever synced
// (the monthly orderSyncCount usage counter is reset by cron and checkout).
const ORDERS_PROBE_KEY = '/api/orders?limit=1&page=1';
const SETUP_DISMISS_KEY = 'kx.home.setupDismissed';

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

const SetupStep = ({ index, icon: Icon, title, description, href, cta, done, doneLabel }) => (
  <li className="flex items-start gap-3 py-3">
    <div className="flex-shrink-0 mt-0.5">
      {done ? (
        <CheckCircle2 size={22} className="text-emerald-500" aria-hidden="true" />
      ) : (
        <div className="relative w-[22px] h-[22px]">
          <Circle size={22} className="text-slate-300" aria-hidden="true" />
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-slate-500">
            {index}
          </span>
        </div>
      )}
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <Icon size={14} className={done ? 'text-slate-400' : 'text-slate-500'} aria-hidden="true" />
        <h3 className={`text-sm font-semibold ${done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{title}</h3>
      </div>
      <p className="text-xs text-slate-500 mt-0.5">{description}</p>
    </div>
    {done ? (
      <span className="flex-shrink-0 self-center text-xs font-medium text-emerald-600">{doneLabel}</span>
    ) : (
      <Link
        href={href}
        className="flex-shrink-0 self-center inline-flex items-center justify-center gap-1 min-h-[44px] px-3 rounded-lg text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
      >
        {cta} <ArrowRight size={14} aria-hidden="true" />
      </Link>
    )}
  </li>
);

const SetupChecklist = ({ steps, onDismiss }) => {
  const t = useTranslations('dashboard');
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <div className="card-premium p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900" style={{ letterSpacing: '-0.01em' }}>
            {t('setup.title')}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">{t('setup.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">
            {t('setup.progress', { done: doneCount, total: steps.length })}
          </span>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label={t('setup.dismiss')}
              title={t('setup.dismiss')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }}
        />
      </div>
      <ol className="mt-1 divide-y divide-slate-100">
        {steps.map((step, i) => (
          <SetupStep key={step.id} index={i + 1} doneLabel={t('setup.done')} {...step} />
        ))}
      </ol>
    </div>
  );
};

const DashboardLandingContent = ({ user }) => {
  const t = useTranslations('dashboard');
  const { formatDate } = useLocale();
  const { anyMarketplace, has } = useConnections();
  const { data: settingsData } = useSWR(SETTINGS_KEY, settingsFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  });

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || t('defaultUser');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('greeting.morning') : hour < 18 ? t('greeting.afternoon') : t('greeting.evening');

  const allQuickActions = [
    {
      requires: 'etsy',
      href: '/app/etsy-listings',
      icon: Store,
      label: t('features.etsyListingsLabel'),
      description: t('features.etsyListings'),
      color: { bg: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)', icon: '#ea580c' },
    },
    {
      requires: 'ebay',
      href: '/app/ebay-listings',
      icon: ShoppingBag,
      label: t('features.ebayListingsLabel'),
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
      label: t('features.analyticsLabel'),
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
  // Hide store-specific shortcuts only once we know the store is not connected.
  const quickActions = allQuickActions
    .filter((a) => !a.requires || has(a.requires) !== false)
    .map(({ requires, ...rest }) => rest);

  // Setup checklist: stays until every step is done (or the user dismisses it).
  const uid = user?.id || user?.email || 'anon';
  const [dismissed, setDismissed] = useState(true); // assume dismissed until storage is read (no flash)
  useEffect(() => {
    let value = false;
    try {
      value = window.localStorage.getItem(`${SETUP_DISMISS_KEY}:${uid}`) === '1';
    } catch {
      // storage unavailable — show the checklist
    }
    setDismissed(value);
  }, [uid]);
  const dismissSetup = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(`${SETUP_DISMISS_KEY}:${uid}`, '1');
    } catch {
      // ignore
    }
  };

  const shipper = settingsData?.shipperProfile;
  const senderDone = Boolean(shipper?.shipperStreet1 && shipper?.shipperCity);
  const usageSynced = Number(settingsData?.subscription?.orderSyncCount || 0) > 0;
  // Only probe orders when the cheap counter does not already answer it.
  const needOrdersProbe = !dismissed && anyMarketplace === true && Boolean(settingsData) && !usageSynced;
  const { data: ordersProbe, error: ordersProbeError } = useSWR(
    needOrdersProbe ? ORDERS_PROBE_KEY : null,
    settingsFetcher,
    { revalidateOnFocus: false, dedupingInterval: 300_000 }
  );
  const ordersKnown = !needOrdersProbe || ordersProbe !== undefined || Boolean(ordersProbeError);
  const syncDone = usageSynced || Number(ordersProbe?.total || 0) > 0;
  const allDone = anyMarketplace === true && syncDone && senderDone;
  // Wait for connections + settings (+ the order probe) so it never flashes in and out.
  const showSetup = !dismissed
    && anyMarketplace !== undefined
    && Boolean(settingsData)
    && ordersKnown
    && !allDone;
  const setupSteps = [
    {
      id: 'connect',
      icon: Link2,
      title: t('setup.connect.title'),
      description: t('setup.connect.desc'),
      cta: t('setup.connect.cta'),
      href: '/ayarlar?tab=connections',
      done: anyMarketplace === true,
    },
    {
      id: 'sync',
      icon: ShoppingCart,
      title: t('setup.sync.title'),
      description: t('setup.sync.desc'),
      cta: t('setup.sync.cta'),
      href: '/app/labels',
      done: syncDone,
    },
    {
      id: 'sender',
      icon: MapPin,
      title: t('setup.sender.title'),
      description: t('setup.sender.desc'),
      cta: t('setup.sender.cta'),
      href: '/ayarlar?tab=senderProfile',
      done: senderDone,
    },
  ];

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Greeting */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900" style={{ letterSpacing: '-0.025em' }}>
          {greeting}, {firstName}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {showSetup && <SetupChecklist steps={setupSteps} onDismiss={dismissSetup} />}

      {/* Announcement banner */}
      {!showSetup && (
      <div
        className="relative overflow-hidden rounded-xl p-3 sm:p-4"
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
      )}

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">{t('quickAccess')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {quickActions.map((action) => (
            <QuickActionCard key={action.href} {...action} />
          ))}
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

  // Stripe checkout return. _app clears ?session_id (router.replace('/app')),
  // so this only shows the confirmation toast; the id dedupes double renders.
  useEffect(() => {
    if (router.query.session_id) {
      toast.success(t('subscriptionActivated'), { id: 'stripe-session-activated' });
    }
  }, [router.query.session_id]);

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
      router.push('/login');
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
