import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';
import {
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  DollarSign,
  Users,
  Package,
  RefreshCw,
  DollarSign as CurrencyIcon,
  Truck,
  Clock,
  Activity,
  ChevronLeft,
  ChevronRight,
  Calendar,
} from 'lucide-react';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MonthlyStatItem {
  month: string;
  orders: number;
  revenue: number;
  customers: number;
}

interface MarketplaceBreakdownItem {
  marketplace: string;
  orders: number;
  revenue: number;
  customers: number;
  avgOrderValue: number;
  percentage: number;
}

interface ShippingStats {
  totalLabels: number;
  pendingLabels: number;
  byCarrier: { carrier: string; count: number }[];
}

interface RecentActivityItem {
  orderNumber: string;
  customerName: string;
  totalPrice: number;
  currency: string;
  marketplace: string;
  externalStatus: string;
  uiOrderDate: string;
  labelStatus: string;
}

interface AnalyticsData {
  totalOrders: number;
  totalRevenue: number;
  totalCustomers: number;
  averageOrderValue: number;
  orderTrend: number;
  revenueTrend: number;
  previousPeriod?: {
    orders: number;
    revenue: number;
  };
  exchangeRates?: {
    USD: number;
    EUR: number;
    lastUpdated?: string;
  };
  topMarketplaces: {
    name: string;
    orders: number;
    revenue: number;
    color: string;
  }[];
  dailyStats: {
    date: string;
    orders: number;
    revenue: number;
  }[];
  topProducts: {
    name: string;
    orders: number;
    revenue: number;
  }[];
  orderStatusBreakdown: {
    status: string;
    count: number;
    color: string;
  }[];
  monthlyStats?: MonthlyStatItem[];
  marketplaceBreakdown?: MarketplaceBreakdownItem[];
  shippingStats?: ShippingStats;
  recentActivity?: RecentActivityItem[];
  hourlyBreakdown?: {
    hour: number;
    orders: number;
    revenue: number;
    prevOrders: number;
    prevRevenue: number;
  }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MARKETPLACE_PALETTE = [
  '#F59E0B', '#3B82F6', '#10B981', '#EF4444', '#F97316',
  '#8B5CF6', '#EC4899', '#14B8A6', '#6366F1', '#84CC16',
  '#06B6D4', '#D946EF', '#F43F5E', '#0EA5E9', '#A855F7',
];
const MARKETPLACE_COLORS_FIXED: Record<string, string> = {
  trendyol: '#F59E0B',
  amazon: '#3B82F6',
  'amazon fba': '#6366F1',
  etsy: '#F97316',
  veeqo: '#14B8A6',
  shippo: '#10B981',
  hepsiburada: '#EF4444',
  bellecouturegifts: '#EC4899',
  decorsweetart: '#8B5CF6',
  mybabybymerry: '#06B6D4',
  outletemporiumus: '#84CC16',
  manual: '#9CA3AF',
};
const getMarketplaceColor = (name: string | null | undefined, index: number): string => {
  if (!name) return MARKETPLACE_PALETTE[index % MARKETPLACE_PALETTE.length];
  return MARKETPLACE_COLORS_FIXED[name.toLowerCase()] || MARKETPLACE_PALETTE[index % MARKETPLACE_PALETTE.length];
};
const MARKETPLACE_COLORS: Record<string, string> = MARKETPLACE_COLORS_FIXED;

const MARKETPLACE_BG: Record<string, string> = {
  trendyol: 'bg-amber-100 text-amber-800',
  amazon: 'bg-blue-100 text-blue-800',
  'amazon fba': 'bg-indigo-100 text-indigo-800',
  etsy: 'bg-orange-100 text-orange-800',
  veeqo: 'bg-teal-100 text-teal-800',
  shippo: 'bg-green-100 text-green-800',
  hepsiburada: 'bg-red-100 text-red-800',
  bellecouturegifts: 'bg-pink-100 text-pink-800',
  decorsweetart: 'bg-purple-100 text-purple-800',
  mybabybymerry: 'bg-cyan-100 text-cyan-800',
  outletemporiumus: 'bg-lime-100 text-lime-800',
  manual: 'bg-gray-100 text-gray-800',
};

// formatCurrency and formatNumber are now provided by useLocale() inside the component

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

const SectionCard = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`card-premium p-3 sm:p-4 lg:p-6 overflow-hidden min-w-0 ${className}`}>{children}</div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-base font-semibold text-slate-900 mb-4" style={{ letterSpacing: '-0.01em' }}>{children}</h3>
);

const EmptyState = ({ message }: { message?: string }) => (
  <div className="flex items-center justify-center py-10 text-slate-400 text-sm">{message || '-'}</div>
);

const MarketplaceBadge = ({ name }: { name: string | null | undefined }) => {
  const safeName = name || 'Unknown';
  const key = safeName.toLowerCase();
  const color = MARKETPLACE_COLORS_FIXED[key] || '#94a3b8';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: `${color}15`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      {safeName}
    </span>
  );
};

const StatusBadge = ({ status }: { status: string | null | undefined }) => {
  const s = (status || '').toLowerCase();
  let color = '#64748b';
  let bg = '#f8fafc';
  if (s.includes('deliver') || s.includes('teslim')) { color = '#16a34a'; bg = '#f0fdf4'; }
  else if (s.includes('ship') || s.includes('kargo')) { color = '#2563eb'; bg = '#eff6ff'; }
  else if (s.includes('pending') || s.includes('bekle')) { color = '#d97706'; bg = '#fffbeb'; }
  else if (s.includes('cancel') || s.includes('iptal')) { color = '#dc2626'; bg = '#fef2f2'; }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: bg, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      {status || '-'}
    </span>
  );
};

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

const StatCard = ({
  title,
  value,
  trend,
  trendLabel,
  icon: Icon,
  color = 'blue',
  fmtNumber,
}: {
  title: string;
  value: string | number;
  trend?: number;
  trendLabel?: string;
  icon: React.ComponentType<any>;
  color?: string;
  fmtNumber?: (v: number) => string;
}) => {
  const trendPositive = trend !== undefined && trend >= 0;

  const colorMap: Record<string, { bg: string; icon: string; trendBg: string; trendColor: string }> = {
    blue: { bg: 'linear-gradient(135deg, #eff6ff, #dbeafe)', icon: '#2563eb', trendBg: trendPositive ? '#f0fdf4' : '#fef2f2', trendColor: trendPositive ? '#059669' : '#dc2626' },
    green: { bg: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', icon: '#16a34a', trendBg: trendPositive ? '#f0fdf4' : '#fef2f2', trendColor: trendPositive ? '#059669' : '#dc2626' },
    purple: { bg: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', icon: '#7c3aed', trendBg: trendPositive ? '#f0fdf4' : '#fef2f2', trendColor: trendPositive ? '#059669' : '#dc2626' },
    orange: { bg: 'linear-gradient(135deg, #fff7ed, #ffedd5)', icon: '#ea580c', trendBg: trendPositive ? '#f0fdf4' : '#fef2f2', trendColor: trendPositive ? '#059669' : '#dc2626' },
  };

  const c = colorMap[color] || colorMap.blue;

  return (
    <div className="card-premium p-3 sm:p-5 overflow-hidden min-w-0 group">
      <div className="flex items-start justify-between">
        <div
          className="p-2 sm:p-2.5 rounded-xl transition-transform duration-200 group-hover:scale-105"
          style={{ background: c.bg }}
        >
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" style={{ color: c.icon }} />
        </div>
        {trend !== undefined && (
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold"
            style={{ backgroundColor: c.trendBg, color: c.trendColor }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="hidden sm:block">
              {trendPositive ? <path d="M5 2L8 6H2L5 2Z" /> : <path d="M5 8L2 4H8L5 8Z" />}
            </svg>
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-2.5 sm:mt-4 min-w-0">
        <h3 className="text-sm sm:text-xl font-bold text-slate-900 truncate" style={{ letterSpacing: '-0.025em' }}>
          {typeof value === 'number' ? (fmtNumber ? fmtNumber(value) : String(value)) : value}
        </h3>
        <p className="text-[10px] sm:text-[13px] font-medium text-slate-500 truncate mt-0.5">{title}</p>
        {trendLabel && <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 truncate">{trendLabel}</p>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

const SkeletonBlock = ({ className = '' }: { className?: string }) => (
  <div className={`animate-shimmer rounded-xl ${className}`} />
);

const LoadingSkeleton = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <SkeletonBlock key={i} className="h-32" />
      ))}
    </div>
    <SkeletonBlock className="h-12" />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SkeletonBlock className="h-80" />
      <SkeletonBlock className="h-80" />
    </div>
    <SkeletonBlock className="h-64" />
    <SkeletonBlock className="h-80" />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SkeletonBlock className="h-64" />
      <SkeletonBlock className="h-64" />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SkeletonBlock className="h-48" />
      <SkeletonBlock className="h-64" />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const t = useTranslations('analytics');
  const tc = useTranslations('common');
  const { config, formatCurrency, formatDate, formatDateTime, formatNumber } = useLocale();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('day');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Initialize selectedMonth and selectedDay on client only to avoid hydration mismatch
  useEffect(() => {
    const now = new Date();
    if (!selectedMonth) {
      setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    }
    if (!selectedDay) {
      setSelectedDay(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    }
  }, []);

  // Navigate months
  const navigateMonth = (direction: -1 | 1) => {
    if (!selectedMonth) return;
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + direction, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // Navigate days
  const navigateDay = (direction: -1 | 1) => {
    if (!selectedDay) return;
    const d = new Date(selectedDay + 'T00:00:00');
    d.setDate(d.getDate() + direction);
    setSelectedDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  };

  const selectedMonthLabel = useMemo(() => {
    if (!selectedMonth) return '';
    const [y, m] = selectedMonth.split('-').map(Number);
    return `${config.monthsFull[m - 1]} ${y}`;
  }, [selectedMonth, config.monthsFull]);

  const dayNamesArr: string[] = t.raw('dayNames');
  const selectedDayLabel = useMemo(() => {
    if (!selectedDay) return '';
    const d = new Date(selectedDay + 'T00:00:00');
    return `${d.getDate()} ${config.monthsFull[d.getMonth()]} ${d.getFullYear()}, ${dayNamesArr[d.getDay()]}`;
  }, [selectedDay, config.monthsFull, dayNamesArr]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/app');
    } else if (user) {
      if (dateRange === 'day' && selectedDay) fetchAnalyticsData();
      else if (dateRange === 'month' && selectedMonth) fetchAnalyticsData();
      else if (dateRange !== 'day' && dateRange !== 'month') fetchAnalyticsData();
    }
  }, [authLoading, user, router, dateRange, selectedMonth, selectedDay]);

  const fetchAnalyticsData = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      const params = new URLSearchParams({ dateRange });
      if (dateRange === 'month') params.set('month', selectedMonth);
      if (dateRange === 'day') params.set('day', selectedDay);

      const response = await fetch(`/api/analytics?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to fetch analytics data: ${errorData.error || response.statusText}`);
      }

      const analyticsData = await response.json();
      setData(analyticsData);
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setData({
        totalOrders: 0,
        totalRevenue: 0,
        totalCustomers: 0,
        averageOrderValue: 0,
        orderTrend: 0,
        revenueTrend: 0,
        topMarketplaces: [],
        dailyStats: [],
        topProducts: [],
        orderStatusBreakdown: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAnalyticsData();
    setRefreshing(false);
  };

  // -----------------------------------------------------------------------
  // Chart configs (built from data)
  // -----------------------------------------------------------------------

  const dailyLabels =
    data?.dailyStats.map((s) =>
      formatDate(new Date(s.date), { month: 'short', day: 'numeric' })
    ) || [];

  const revenueChartOptions: ApexCharts.ApexOptions = {
    chart: { type: 'area', height: 280, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
    colors: ['#2563eb', '#10b981'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: [0, 3] },
    xaxis: { categories: dailyLabels },
    yaxis: [
      { title: { text: t('orders') }, labels: { formatter: (v: number) => Math.round(v).toString() } },
      { opposite: true, title: { text: t('revenueLabel') }, labels: { formatter: (v: number) => formatNumber(Math.round(v)) } },
    ],
    fill: { type: ['solid', 'gradient'], opacity: [0.35, 1], gradient: { shadeIntensity: 1, stops: [0, 100] } },
    legend: { position: 'top' },
    tooltip: {
      y: {
        formatter: (v: number, { seriesIndex }: { seriesIndex: number }) =>
          seriesIndex === 1 ? formatCurrency(v) : `${v} ${t('orders').toLowerCase()}`,
      },
    },
  };

  const revenueChartSeries = [
    { name: t('orders'), type: 'column', data: data?.dailyStats.map((s) => s.orders) || [] },
    { name: t('revenue'), type: 'line', data: data?.dailyStats.map((s) => Math.round(s.revenue)) || [] },
  ];

  // Marketplace donut — prefer marketplaceBreakdown, fallback to topMarketplaces
  const mpData = data?.marketplaceBreakdown ?? data?.topMarketplaces?.map((m) => ({
    marketplace: m.name || 'Unknown',
    orders: m.orders,
    revenue: m.revenue,
    customers: 0,
    avgOrderValue: m.orders > 0 ? m.revenue / m.orders : 0,
    percentage: 0,
  })) ?? [];

  const donutColors = mpData.map((m, i) => getMarketplaceColor(m.marketplace || 'Unknown', i));

  const donutOptions: ApexCharts.ApexOptions = {
    chart: { type: 'donut' },
    colors: donutColors,
    labels: mpData.map((m) => m.marketplace || 'Unknown'),
    legend: { position: 'bottom' },
    plotOptions: { pie: { donut: { size: '70%' } } },
    tooltip: { y: { formatter: (v: number) => formatCurrency(v) } },
  };

  const donutSeries = mpData.map((m) => Math.round(m.revenue));

  // Monthly chart
  const monthlyStats = data?.monthlyStats ?? [];
  const monthlyLabels = monthlyStats.map((m) => {
    const d = new Date(m.month + '-01');
    return isNaN(d.getTime()) ? m.month : config.monthsShort[d.getMonth()];
  });

  const monthlyChartOptions: ApexCharts.ApexOptions = {
    chart: { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
    colors: ['#2563eb', '#10b981'],
    plotOptions: { bar: { borderRadius: 6, columnWidth: '50%' } },
    dataLabels: { enabled: false },
    stroke: { width: [0, 3], curve: 'smooth' },
    xaxis: { categories: monthlyLabels },
    yaxis: [
      { title: { text: t('orders') }, labels: { formatter: (v: number) => Math.round(v).toString() } },
      { opposite: true, title: { text: t('revenueLabel') }, labels: { formatter: (v: number) => formatNumber(Math.round(v)) } },
    ],
    legend: { position: 'top' },
    tooltip: {
      y: {
        formatter: (v: number, { seriesIndex }: { seriesIndex: number }) =>
          seriesIndex === 1 ? formatCurrency(v) : `${formatNumber(v)} ${t('orders').toLowerCase()}`,
      },
    },
  };

  const monthlyChartSeries = [
    { name: t('orders'), type: 'column', data: monthlyStats.map((m) => m.orders) },
    { name: t('revenue'), type: 'line', data: monthlyStats.map((m) => Math.round(m.revenue)) },
  ];

  // Hourly chart for day mode
  const hourlyData = data?.hourlyBreakdown ?? [];
  const hourlyLabels = hourlyData.map((h) => `${String(h.hour).padStart(2, '0')}:00`);

  const hourlyChartOptions: ApexCharts.ApexOptions = {
    chart: { type: 'bar', height: 300, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
    colors: ['#2563eb', '#cbd5e1'],
    plotOptions: { bar: { borderRadius: 5, columnWidth: '60%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: hourlyLabels, labels: { style: { fontSize: '10px' } } },
    yaxis: { title: { text: t('orders') }, labels: { formatter: (v: number) => Math.round(v).toString() } },
    legend: { position: 'top' },
    tooltip: {
      y: { formatter: (v: number) => `${v} ${t('orders').toLowerCase()}` },
    },
  };

  const hourlyChartSeries = [
    { name: t('selectedDay'), data: hourlyData.map((h) => h.orders) },
    { name: t('previousDayChart'), data: hourlyData.map((h) => h.prevOrders) },
  ];

  const hourlyRevenueChartOptions: ApexCharts.ApexOptions = {
    chart: { type: 'area', height: 300, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
    colors: ['#10b981', '#cbd5e1'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    fill: { type: 'gradient', opacity: [0.4, 0.1], gradient: { shadeIntensity: 1, stops: [0, 100] } },
    xaxis: { categories: hourlyLabels, labels: { style: { fontSize: '10px' } } },
    yaxis: { title: { text: t('revenueLabel') }, labels: { formatter: (v: number) => formatNumber(Math.round(v)) } },
    legend: { position: 'top' },
    tooltip: {
      y: { formatter: (v: number) => formatCurrency(v) },
    },
  };

  const hourlyRevenueChartSeries = [
    { name: t('selectedDay'), data: hourlyData.map((h) => h.revenue) },
    { name: t('previousDayChart'), data: hourlyData.map((h) => h.prevRevenue) },
  ];

  // Order status helpers
  const totalStatusCount = data?.orderStatusBreakdown.reduce((a, b) => a + b.count, 0) || 1;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (authLoading || loading) {
    return (
      <AppLayout title={t('pageTitle')}>
        <LoadingSkeleton />
      </AppLayout>
    );
  }

  return (
    <AppLayout title={t('pageTitle')}>
      <div className="space-y-6 overflow-x-hidden max-w-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold text-slate-900 truncate" style={{ letterSpacing: '-0.025em' }}>
              {dateRange === 'day' ? t('dayAnalysis') : t('dashboardTitle')}
            </h1>
            <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-slate-500 truncate">
              {dateRange === 'day' ? selectedDayLabel : t('trackPerformance')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn-primary text-xs sm:text-sm !py-2 !px-3 sm:!px-4 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {t('refresh')}
            </button>
          </div>
        </div>

        {/* ============================================================= */}
        {/* ROW 1: KPI Cards                                              */}
        {/* ============================================================= */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 lg:gap-6 overflow-hidden">
          <StatCard
            title={dateRange === 'day' ? t('orders') : t('totalOrders')}
            value={data?.totalOrders ?? 0}
            trend={data?.orderTrend}
            trendLabel={
              dateRange === 'day' ? `${t('previousDay')}: ${formatNumber(data?.previousPeriod?.orders ?? 0)}`
              : dateRange === 'month' ? `${t('previousMonth')}: ${formatNumber(data?.previousPeriod?.orders ?? 0)}`
              : t('previousPeriod')
            }
            icon={ShoppingCart}
            color="blue"
            fmtNumber={formatNumber}
          />
          <StatCard
            title={dateRange === 'day' ? t('revenue') : t('totalRevenue')}
            value={formatCurrency(data?.totalRevenue ?? 0)}
            trend={data?.revenueTrend}
            trendLabel={
              dateRange === 'day' ? `${t('previousDay')}: ${formatCurrency(data?.previousPeriod?.revenue ?? 0)}`
              : dateRange === 'month' ? `${t('previousMonth')}: ${formatCurrency(data?.previousPeriod?.revenue ?? 0)}`
              : t('previousPeriod')
            }
            icon={DollarSign}
            color="green"
            fmtNumber={formatNumber}
          />
          <StatCard
            title={t('customerCount')}
            value={data?.totalCustomers ?? 0}
            icon={Users}
            color="purple"
            fmtNumber={formatNumber}
          />
          <StatCard
            title={t('averageOrder')}
            value={formatCurrency(data?.averageOrderValue ?? 0)}
            icon={Package}
            color="orange"
            fmtNumber={formatNumber}
          />
        </div>

        {/* ============================================================= */}
        {/* ROW 2: Date Range + Exchange Rates                            */}
        {/* ============================================================= */}
        <div className="flex flex-col gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="px-2 py-1.5 sm:px-3 sm:py-2 border border-slate-200 rounded-xl text-xs sm:text-sm bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all appearance-none cursor-pointer"
            >
              <option value="day">{t('dateRanges.day')}</option>
              <option value="month">{t('dateRanges.month')}</option>
              <option value="7days">{t('dateRanges.7days')}</option>
              <option value="30days">{t('dateRanges.30days')}</option>
              <option value="90days">{t('dateRanges.90days')}</option>
              <option value="6months">{t('dateRanges.6months')}</option>
              <option value="12months">{t('dateRanges.12months')}</option>
              <option value="all">{t('dateRanges.all')}</option>
            </select>
            {dateRange === 'day' && (
              <div className="flex items-center bg-white border border-slate-200 rounded-xl">
                <button
                  onClick={() => navigateDay(-1)}
                  className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-l-md transition-colors"
                >
                  <ChevronLeft className="h-4 w-4 text-gray-600" />
                </button>
                <div className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 justify-center">
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-600 flex-shrink-0" />
                  <span className="text-xs sm:text-sm font-medium text-gray-900 whitespace-nowrap">{selectedDayLabel}</span>
                </div>
                <button
                  onClick={() => navigateDay(1)}
                  className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-r-md transition-colors"
                >
                  <ChevronRight className="h-4 w-4 text-gray-600" />
                </button>
              </div>
            )}
            {dateRange === 'month' && (
              <div className="flex items-center bg-white border border-slate-200 rounded-xl">
                <button
                  onClick={() => navigateMonth(-1)}
                  className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-l-md transition-colors"
                >
                  <ChevronLeft className="h-4 w-4 text-gray-600" />
                </button>
                <div className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 justify-center">
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-600 flex-shrink-0" />
                  <span className="text-xs sm:text-sm font-medium text-gray-900 whitespace-nowrap">{selectedMonthLabel}</span>
                </div>
                <button
                  onClick={() => navigateMonth(1)}
                  className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-r-md transition-colors"
                >
                  <ChevronRight className="h-4 w-4 text-gray-600" />
                </button>
              </div>
            )}
          </div>

          {data?.exchangeRates && (
            <div className="flex-1 p-3 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(79,70,229,0.06))', border: '1px solid rgba(37,99,235,0.12)' }}>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-6">
                <div className="flex items-center gap-2">
                  <CurrencyIcon className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-gray-700">{t('currentRates')}:</span>
                </div>
                <div className="flex items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold text-gray-900">1 USD =</span>
                    <span className="text-base font-bold text-blue-600">
                      {formatCurrency(data.exchangeRates.USD)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold text-gray-900">1 EUR =</span>
                    <span className="text-base font-bold text-green-600">
                      {formatCurrency(data.exchangeRates.EUR)}
                    </span>
                  </div>
                </div>
                {data.exchangeRates.lastUpdated && (
                  <span className="text-xs text-gray-500">
                    {formatDateTime(new Date(data.exchangeRates.lastUpdated), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ============================================================= */}
        {/* DAY MODE: Hourly Breakdown Charts                             */}
        {/* ============================================================= */}
        {dateRange === 'day' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <SectionCard>
              <SectionTitle>{t('hourlyOrderBreakdown')}</SectionTitle>
              {hourlyData.some((h) => h.orders > 0 || h.prevOrders > 0) ? (
                <Chart options={hourlyChartOptions} series={hourlyChartSeries} type="bar" height={300} />
              ) : (
                <EmptyState message={t('noOrderDataToday')} />
              )}
            </SectionCard>
            <SectionCard>
              <SectionTitle>{t('hourlyRevenueComparison')}</SectionTitle>
              {hourlyData.some((h) => h.revenue > 0 || h.prevRevenue > 0) ? (
                <Chart options={hourlyRevenueChartOptions} series={hourlyRevenueChartSeries} type="area" height={300} />
              ) : (
                <EmptyState message={t('noRevenueDataToday')} />
              )}
            </SectionCard>
          </div>
        )}

        {/* ============================================================= */}
        {/* ROW 3: Revenue/Orders Trend + Marketplace Donut               */}
        {/* ============================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <SectionCard>
            <SectionTitle>{t('revenueAndOrderTrend')}</SectionTitle>
            {data?.dailyStats && data.dailyStats.length > 0 ? (
              <Chart options={revenueChartOptions} series={revenueChartSeries} type="line" height={280} />
            ) : (
              <EmptyState message={t('noDataInRange')} />
            )}
          </SectionCard>

          <SectionCard>
            <SectionTitle>{t('marketplaceDistribution')}</SectionTitle>
            {donutSeries.length > 0 && donutSeries.some((v) => v > 0) ? (
              <Chart options={donutOptions} series={donutSeries} type="donut" height={280} />
            ) : (
              <EmptyState message={t('noMarketplaceData')} />
            )}
          </SectionCard>
        </div>

        {/* ============================================================= */}
        {/* ROW 4: Marketplace Breakdown Table                            */}
        {/* ============================================================= */}
        <SectionCard>
          <SectionTitle>{t('marketplacePerformance')}</SectionTitle>
          {mpData.length > 0 ? (
            <>
              {/* Mobile cards */}
              <div className="block md:hidden space-y-3">
                {[...mpData]
                  .sort((a, b) => b.orders - a.orders)
                  .map((mp, idx) => {
                    const totalOrders = mpData.reduce((s, m) => s + m.orders, 0) || 1;
                    const pct = mp.percentage || (mp.orders / totalOrders) * 100;
                    return (
                      <div key={idx} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
                        <div className="flex items-center justify-between mb-3">
                          <MarketplaceBadge name={mp.marketplace} />
                          <span className="text-xs text-gray-500">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-gray-500">{t('orders')}</p>
                            <p className="text-sm font-semibold text-gray-900">{formatNumber(mp.orders)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500">{t('revenue')}</p>
                            <p className="text-sm font-semibold text-gray-900">{formatCurrency(mp.revenue)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('marketplace')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('orders')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('revenueLabel')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('customers')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('avgOrder')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        % {t('percentage')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {[...mpData]
                      .sort((a, b) => b.orders - a.orders)
                      .map((mp, idx) => {
                        const totalOrders = mpData.reduce((s, m) => s + m.orders, 0) || 1;
                        const pct = mp.percentage || (mp.orders / totalOrders) * 100;
                        const avg = mp.avgOrderValue || (mp.orders > 0 ? mp.revenue / mp.orders : 0);
                        return (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <MarketplaceBadge name={mp.marketplace} />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                              {formatNumber(mp.orders)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                              {formatCurrency(mp.revenue)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                              {formatNumber(mp.customers)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                              {formatCurrency(avg)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                              {pct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <EmptyState />
          )}
        </SectionCard>

        {/* ============================================================= */}
        {/* ROW 5: Monthly Trends Chart                                   */}
        {/* ============================================================= */}
        {monthlyStats.length > 0 && (
          <SectionCard>
            <SectionTitle>{t('monthlyTrends')}</SectionTitle>
            <Chart options={monthlyChartOptions} series={monthlyChartSeries} type="line" height={280} />
          </SectionCard>
        )}

        {/* ============================================================= */}
        {/* ROW 6: Top Products + Order Status                            */}
        {/* ============================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Top Products */}
          <SectionCard>
            <SectionTitle>{t('topSellingProducts')}</SectionTitle>
            {data?.topProducts && data.topProducts.length > 0 ? (
              <>
                {/* Mobile cards */}
                <div className="block md:hidden space-y-3">
                  {data.topProducts.slice(0, 5).map((product, index) => (
                    <div key={index} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-xs font-medium text-gray-400">#{index + 1}</span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 mb-3 line-clamp-2">{product.name}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-gray-500">{t('orders')}</p>
                          <p className="text-sm font-semibold text-gray-900">{formatNumber(product.orders)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">{t('revenue')}</p>
                          <p className="text-sm font-semibold text-gray-900">{formatCurrency(product.revenue)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('product')}</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('orders')}</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('revenueLabel')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.topProducts.slice(0, 5).map((product, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-sm font-medium text-gray-500">{index + 1}</td>
                          <td className="px-3 py-2 text-sm text-gray-900 max-w-[200px] truncate">{product.name}</td>
                          <td className="px-3 py-2 text-sm text-gray-900 text-right">{formatNumber(product.orders)}</td>
                          <td className="px-3 py-2 text-sm text-gray-900 text-right">{formatCurrency(product.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState message={t('noProductData')} />
            )}
          </SectionCard>

          {/* Order Status Breakdown */}
          <SectionCard>
            <SectionTitle>{t('orderStatuses')}</SectionTitle>
            {data?.orderStatusBreakdown && data.orderStatusBreakdown.length > 0 ? (
              <div className="space-y-3">
                {data.orderStatusBreakdown.map((status, index) => {
                  const pct = (status.count / totalStatusCount) * 100;
                  return (
                    <div key={index}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: status.color }} />
                          <span className="text-sm font-medium text-gray-900">{status.status}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">{formatNumber(status.count)}</span>
                          <span className="text-xs text-gray-400">({pct.toFixed(1)}%)</span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all duration-300"
                          style={{ width: `${pct}%`, backgroundColor: status.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState message={t('noStatusData')} />
            )}
          </SectionCard>
        </div>

        {/* ============================================================= */}
        {/* ROW 7: Shipping Stats + Recent Activity                       */}
        {/* ============================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Shipping Stats */}
          <SectionCard>
            <SectionTitle>{t('shippingStatistics')}</SectionTitle>
            {data?.shippingStats ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <Truck className="h-6 w-6 text-blue-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(data.shippingStats.totalLabels)}</p>
                    <p className="text-xs text-gray-600">{t('totalLabels')}</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-4 text-center">
                    <Clock className="h-6 w-6 text-amber-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(data.shippingStats.pendingLabels)}</p>
                    <p className="text-xs text-gray-600">{t('pendingLabels')}</p>
                  </div>
                </div>

                {data.shippingStats.byCarrier && data.shippingStats.byCarrier.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">{t('byCarrier')}</p>
                    <div className="space-y-2">
                      {data.shippingStats.byCarrier.map((c, i) => {
                        const maxCount = Math.max(...data.shippingStats!.byCarrier.map((x) => x.count), 1);
                        const barPct = (c.count / maxCount) * 100;
                        return (
                          <div key={i} className="flex items-center gap-3">
                            <span className="text-sm text-gray-700 w-16 flex-shrink-0">{c.carrier}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-2">
                              <div
                                className="h-2 rounded-full bg-blue-500 transition-all duration-300"
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium text-gray-900 w-10 text-right">{formatNumber(c.count)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState message={t('noShippingData')} />
            )}
          </SectionCard>

          {/* Recent Activity */}
          <SectionCard>
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-5 w-5 text-gray-600" />
              <SectionTitle>{t('recentActivity')}</SectionTitle>
            </div>
            {data?.recentActivity && data.recentActivity.length > 0 ? (
              <div className="space-y-2 max-h-[380px] overflow-y-auto">
                {data.recentActivity.slice(0, 10).map((item, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-2 py-2 border-b border-gray-100 last:border-b-0"
                  >
                    <span className="text-sm font-medium text-gray-900 min-w-[80px]">#{item.orderNumber}</span>
                    <span className="text-sm text-gray-600 truncate max-w-[120px]">{item.customerName}</span>
                    <span className="text-sm font-semibold text-gray-900 ml-auto">
                      {formatCurrency(item.totalPrice)}
                    </span>
                    <MarketplaceBadge name={item.marketplace} />
                    <StatusBadge status={item.externalStatus} />
                    <span className="text-xs text-gray-400">
                      {item.uiOrderDate
                        ? formatDate(new Date(item.uiOrderDate), {
                            day: 'numeric',
                            month: 'short',
                          })
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message={t('noActivityYet')} />
            )}
          </SectionCard>
        </div>
      </div>
    </AppLayout>
  );
}
