import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
// supabase browser client removed — auth now handled by NextAuth cookies
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
  ChevronLeft,
  ChevronRight,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarketplaceBreakdownItem {
  marketplace: string;
  orders: number;
  revenue: number;
  customers: number;
  avgOrderValue: number;
  percentage: number;
  byCurrency?: Record<string, number>;
}

interface AnalyticsData {
  totalOrders: number;
  totalRevenue: number;
  totalCustomers: number;
  averageOrderValue: number;
  orderTrend: number;
  revenueTrend: number;
  previousPeriod?: { orders: number; revenue: number };
  exchangeRates?: { USD: number; EUR: number; lastUpdated?: string };
  topMarketplaces: {
    name: string;
    orders: number;
    revenue: number;
    color: string;
    byCurrency?: Record<string, number>;
  }[];
  dailyStats: { date: string; orders: number; revenue: number }[];
  topProducts: { name: string; orders: number; revenue: number }[];
  orderStatusBreakdown: { status: string; count: number; color: string }[];
  monthlyStats?: { month: string; orders: number; revenue: number; customers: number }[];
  marketplaceBreakdown?: MarketplaceBreakdownItem[];
  shippingStats?: { totalLabels: number; pendingLabels: number; byCarrier: { carrier: string; count: number }[] };
  recentActivity?: {
    orderNumber: string;
    customerName: string;
    totalPrice: number;
    currency: string;
    marketplace: string;
    externalStatus: string;
    uiOrderDate: string;
    labelStatus: string;
  }[];
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

const MARKETPLACE_COLORS: Record<string, string> = {
  trendyol: '#F59E0B',
  amazon: '#3B82F6',
  'amazon fba': '#6366F1',
  etsy: '#F97316',
  ebay: '#0064D2',
  veeqo: '#14B8A6',
  shippo: '#10B981',
  hepsiburada: '#EF4444',
  bellecouturegifts: '#EC4899',
  decorsweetart: '#8B5CF6',
  mybabybymerry: '#06B6D4',
  outletemporiumus: '#84CC16',
  manual: '#9CA3AF',
};

const PALETTE = [
  '#F59E0B', '#3B82F6', '#10B981', '#EF4444', '#F97316',
  '#8B5CF6', '#EC4899', '#14B8A6', '#6366F1', '#84CC16',
];

const mpColor = (name: string | null | undefined, i: number) =>
  MARKETPLACE_COLORS[(name || '').toLowerCase()] || PALETTE[i % PALETTE.length];

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', TRY: '₺', TL: '₺', CAD: 'C$', AUD: 'A$',
};

const fmtNative = (byCurrency: Record<string, number> | undefined): string => {
  if (!byCurrency) return '-';
  return Object.entries(byCurrency)
    .filter(([, v]) => v > 0)
    .map(([cur, val]) => `${CURRENCY_SYMBOLS[cur] || cur}${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`)
    .join(' + ');
};

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm ${className}`}>{children}</div>
);

const EmptyState = ({ message }: { message?: string }) => (
  <div className="flex items-center justify-center py-12 text-slate-400 text-sm">{message || '-'}</div>
);

const MarketplaceDot = ({ name, size = 8 }: { name: string; size?: number }) => (
  <span
    className="inline-block rounded-full flex-shrink-0"
    style={{ width: size, height: size, backgroundColor: MARKETPLACE_COLORS[name.toLowerCase()] || '#94a3b8' }}
  />
);

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

const KPICard = ({
  title,
  value,
  trend,
  trendLabel,
  icon: Icon,
  iconColor,
  iconBg,
}: {
  title: string;
  value: string;
  trend?: number;
  trendLabel?: string;
  icon: React.ComponentType<any>;
  iconColor: string;
  iconBg: string;
}) => {
  const positive = (trend ?? 0) >= 0;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 rounded-xl" style={{ backgroundColor: iconBg }}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" style={{ color: iconColor }} />
        </div>
        <span className="text-xs sm:text-sm font-medium text-slate-500">{title}</span>
      </div>
      <div className="text-lg sm:text-2xl font-bold text-slate-900" style={{ letterSpacing: '-0.025em' }}>
        {value}
      </div>
      {trend !== undefined && (
        <div className="mt-2 flex items-center gap-1.5">
          {positive ? (
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5 text-red-500" />
          )}
          <span className={`text-xs font-semibold ${positive ? 'text-emerald-600' : 'text-red-500'}`}>
            {Math.abs(trend).toFixed(1)}%
          </span>
          {trendLabel && <span className="text-xs text-slate-400 ml-1">{trendLabel}</span>}
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

const Skeleton = () => (
  <div className="space-y-6 animate-pulse">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-slate-100 rounded-2xl h-28" />
      ))}
    </div>
    <div className="bg-slate-100 rounded-2xl h-10" />
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-slate-100 rounded-2xl h-72" />
      <div className="bg-slate-100 rounded-2xl h-72" />
    </div>
    <div className="bg-slate-100 rounded-2xl h-64" />
  </div>
);

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const t = useTranslations('analytics');
  const { config, formatCurrency: _formatCurrency, formatDate, formatDateTime, formatNumber } = useLocale();
  // All analytics values are converted to TRY — always show ₺
  const formatCurrency = (value: number) => _formatCurrency(value, 'TRY');

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30days');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Init dates client-side
  useEffect(() => {
    const now = new Date();
    if (!selectedMonth) setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    if (!selectedDay) setSelectedDay(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  }, []);

  const navigateMonth = (dir: -1 | 1) => {
    if (!selectedMonth) return;
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const navigateDay = (dir: -1 | 1) => {
    if (!selectedDay) return;
    const d = new Date(selectedDay + 'T00:00:00');
    d.setDate(d.getDate() + dir);
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

  // Fetch
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/app');
    } else if (user) {
      if (dateRange === 'day' && selectedDay) fetchData();
      else if (dateRange === 'month' && selectedMonth) fetchData();
      else if (dateRange !== 'day' && dateRange !== 'month') fetchData();
    }
  }, [authLoading, user, router, dateRange, selectedMonth, selectedDay]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dateRange });
      if (dateRange === 'month') params.set('month', selectedMonth);
      if (dateRange === 'day') params.set('day', selectedDay);
      const res = await fetch(`/api/analytics?${params}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Fetch failed');
      setData(await res.json());
    } catch (e) {
      console.error('Dashboard fetch error:', e);
      setData({
        totalOrders: 0, totalRevenue: 0, totalCustomers: 0, averageOrderValue: 0,
        orderTrend: 0, revenueTrend: 0, topMarketplaces: [], dailyStats: [],
        topProducts: [], orderStatusBreakdown: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // ---------------------------------------------------------------------------
  // Chart configs
  // ---------------------------------------------------------------------------

  const dailyLabels = data?.dailyStats.map((s) =>
    formatDate(new Date(s.date), { month: 'short', day: 'numeric' })
  ) || [];

  const revenueChartOpts: ApexCharts.ApexOptions = {
    chart: { type: 'area', height: 300, toolbar: { show: false }, fontFamily: 'Inter, sans-serif', background: 'transparent' },
    colors: ['#3b82f6', '#10b981'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: [0, 2.5] },
    xaxis: { categories: dailyLabels, labels: { style: { fontSize: '11px', colors: '#94a3b8' } } },
    yaxis: [
      { title: { text: t('orders'), style: { color: '#94a3b8', fontSize: '12px' } }, labels: { formatter: (v: number) => Math.round(v).toString(), style: { colors: '#94a3b8' } } },
      { opposite: true, title: { text: t('revenueLabel'), style: { color: '#94a3b8', fontSize: '12px' } }, labels: { formatter: (v: number) => formatNumber(Math.round(v)), style: { colors: '#94a3b8' } } },
    ],
    fill: { type: ['solid', 'gradient'], opacity: [0.15, 1], gradient: { shadeIntensity: 1, stops: [0, 100] } },
    legend: { position: 'top', labels: { colors: '#64748b' } },
    grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
    tooltip: { y: { formatter: (v: number, { seriesIndex }: { seriesIndex: number }) => seriesIndex === 1 ? formatCurrency(v) : `${v}` } },
  };

  const revenueChartSeries = [
    { name: t('orders'), type: 'column', data: data?.dailyStats.map((s) => s.orders) || [] },
    { name: t('revenue'), type: 'line', data: data?.dailyStats.map((s) => Math.round(s.revenue)) || [] },
  ];

  // Marketplace donut
  const mpData = data?.marketplaceBreakdown ?? data?.topMarketplaces?.map((m) => ({
    marketplace: m.name || 'Unknown', orders: m.orders, revenue: m.revenue,
    customers: 0, avgOrderValue: m.orders > 0 ? m.revenue / m.orders : 0, percentage: 0,
    byCurrency: m.byCurrency,
  })) ?? [];

  const donutColors = mpData.map((m, i) => mpColor(m.marketplace, i));

  const donutOpts: ApexCharts.ApexOptions = {
    chart: { type: 'donut' },
    colors: donutColors,
    labels: mpData.map((m) => m.marketplace),
    legend: { position: 'bottom', labels: { colors: '#64748b' } },
    plotOptions: { pie: { donut: { size: '72%', labels: { show: true, total: { show: true, label: t('totalRevenue'), formatter: () => formatCurrency(data?.totalRevenue ?? 0) } } } } },
    tooltip: { y: { formatter: (v: number) => formatCurrency(v) } },
    dataLabels: { enabled: false },
  };

  const donutSeries = mpData.map((m) => Math.round(m.revenue));

  // Hourly charts
  const hourlyData = data?.hourlyBreakdown ?? [];
  const hourlyLabels = hourlyData.map((h) => `${String(h.hour).padStart(2, '0')}:00`);

  const hourlyOpts: ApexCharts.ApexOptions = {
    chart: { type: 'bar', height: 260, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
    colors: ['#3b82f6', '#e2e8f0'],
    plotOptions: { bar: { borderRadius: 4, columnWidth: '55%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: hourlyLabels, labels: { style: { fontSize: '10px', colors: '#94a3b8' } } },
    yaxis: { labels: { formatter: (v: number) => Math.round(v).toString(), style: { colors: '#94a3b8' } } },
    legend: { position: 'top', labels: { colors: '#64748b' } },
    grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
    tooltip: { y: { formatter: (v: number) => `${v} ${t('orders').toLowerCase()}` } },
  };

  const hourlySeries = [
    { name: t('selectedDay'), data: hourlyData.map((h) => h.orders) },
    { name: t('previousDayChart'), data: hourlyData.map((h) => h.prevOrders) },
  ];

  // Monthly chart
  const monthlyStats = data?.monthlyStats ?? [];
  const monthlyLabels = monthlyStats.map((m) => {
    const d = new Date(m.month + '-01');
    return isNaN(d.getTime()) ? m.month : config.monthsShort[d.getMonth()];
  });

  const monthlyOpts: ApexCharts.ApexOptions = {
    chart: { type: 'bar', height: 280, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
    colors: ['#3b82f6', '#10b981'],
    plotOptions: { bar: { borderRadius: 6, columnWidth: '50%' } },
    dataLabels: { enabled: false },
    stroke: { width: [0, 2.5], curve: 'smooth' },
    xaxis: { categories: monthlyLabels, labels: { style: { colors: '#94a3b8' } } },
    yaxis: [
      { title: { text: t('orders'), style: { color: '#94a3b8' } }, labels: { formatter: (v: number) => Math.round(v).toString(), style: { colors: '#94a3b8' } } },
      { opposite: true, title: { text: t('revenueLabel'), style: { color: '#94a3b8' } }, labels: { formatter: (v: number) => formatNumber(Math.round(v)), style: { colors: '#94a3b8' } } },
    ],
    legend: { position: 'top', labels: { colors: '#64748b' } },
    grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
    tooltip: { y: { formatter: (v: number, { seriesIndex }: { seriesIndex: number }) => seriesIndex === 1 ? formatCurrency(v) : `${v}` } },
  };

  const monthlySeries = [
    { name: t('orders'), type: 'column', data: monthlyStats.map((m) => m.orders) },
    { name: t('revenue'), type: 'line', data: monthlyStats.map((m) => Math.round(m.revenue)) },
  ];

  // Status
  const totalStatusCount = data?.orderStatusBreakdown.reduce((a, b) => a + b.count, 0) || 1;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (authLoading || loading) {
    return <AppLayout title={t('pageTitle')}><Skeleton /></AppLayout>;
  }

  return (
    <AppLayout title={t('pageTitle')}>
      <div className="space-y-5 max-w-full">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-2xl font-bold text-slate-900" style={{ letterSpacing: '-0.025em' }}>
              {dateRange === 'day' ? t('dayAnalysis') : t('dashboardTitle')}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              {dateRange === 'day' ? selectedDayLabel : t('trackPerformance')}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-primary text-xs sm:text-sm !py-2 !px-4 disabled:opacity-50 self-start sm:self-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {t('refresh')}
          </button>
        </div>

        {/* ── Date Range Bar ─────────────────────────────────────── */}
        <Card className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-xl text-xs sm:text-sm bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all appearance-none cursor-pointer"
            >
              <option value="day">{t('dateRanges.day')}</option>
              <option value="yesterday">{t('dateRanges.yesterday')}</option>
              <option value="7days">{t('dateRanges.7days')}</option>
              <option value="30days">{t('dateRanges.30days')}</option>
              <option value="month">{t('dateRanges.month')}</option>
              <option value="3months">{t('dateRanges.3months')}</option>
              <option value="6months">{t('dateRanges.6months')}</option>
              <option value="9months">{t('dateRanges.9months')}</option>
              <option value="thisYear">{t('dateRanges.thisYear')}</option>
              <option value="lastYear">{t('dateRanges.lastYear')}</option>
              <option value="12months">{t('dateRanges.12months')}</option>
              <option value="all">{t('dateRanges.all')}</option>
            </select>

            {dateRange === 'day' && (
              <div className="flex items-center bg-white border border-slate-200 rounded-xl">
                <button onClick={() => navigateDay(-1)} className="p-2 hover:bg-slate-50 rounded-l-xl transition-colors">
                  <ChevronLeft className="h-4 w-4 text-slate-500" />
                </button>
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                  <Calendar className="h-4 w-4 text-blue-600 flex-shrink-0" />
                  <span className="text-xs sm:text-sm font-medium text-slate-800 whitespace-nowrap">{selectedDayLabel}</span>
                </div>
                <button onClick={() => navigateDay(1)} className="p-2 hover:bg-slate-50 rounded-r-xl transition-colors">
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                </button>
              </div>
            )}

            {dateRange === 'month' && (
              <div className="flex items-center bg-white border border-slate-200 rounded-xl">
                <button onClick={() => navigateMonth(-1)} className="p-2 hover:bg-slate-50 rounded-l-xl transition-colors">
                  <ChevronLeft className="h-4 w-4 text-slate-500" />
                </button>
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                  <Calendar className="h-4 w-4 text-blue-600 flex-shrink-0" />
                  <span className="text-xs sm:text-sm font-medium text-slate-800 whitespace-nowrap">{selectedMonthLabel}</span>
                </div>
                <button onClick={() => navigateMonth(1)} className="p-2 hover:bg-slate-50 rounded-r-xl transition-colors">
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                </button>
              </div>
            )}

            {/* Exchange rates inline */}
            {data?.exchangeRates && (
              <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
                <span>1 USD = <strong className="text-blue-600">₺{data.exchangeRates.USD.toFixed(2)}</strong></span>
                <span>1 EUR = <strong className="text-emerald-600">₺{data.exchangeRates.EUR.toFixed(2)}</strong></span>
              </div>
            )}
          </div>
        </Card>

        {/* ── KPI Cards ──��───────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <KPICard
            title={dateRange === 'day' ? t('orders') : t('totalOrders')}
            value={formatNumber(data?.totalOrders ?? 0)}
            trend={data?.orderTrend}
            trendLabel={dateRange === 'day' ? t('previousDay') : dateRange === 'month' ? t('previousMonth') : undefined}
            icon={ShoppingCart}
            iconColor="#2563eb"
            iconBg="#eff6ff"
          />
          <KPICard
            title={dateRange === 'day' ? t('revenue') : t('totalRevenue')}
            value={formatCurrency(data?.totalRevenue ?? 0)}
            trend={data?.revenueTrend}
            trendLabel={dateRange === 'day' ? t('previousDay') : dateRange === 'month' ? t('previousMonth') : undefined}
            icon={DollarSign}
            iconColor="#059669"
            iconBg="#ecfdf5"
          />
          <KPICard
            title={t('customerCount')}
            value={formatNumber(data?.totalCustomers ?? 0)}
            icon={Users}
            iconColor="#7c3aed"
            iconBg="#f5f3ff"
          />
          <KPICard
            title={t('averageOrder')}
            value={formatCurrency(data?.averageOrderValue ?? 0)}
            icon={Package}
            iconColor="#ea580c"
            iconBg="#fff7ed"
          />
        </div>

        {/* ── Currency notice ────────────────────────────────────── */}
        {data?.exchangeRates && (
          <p className="text-[11px] text-slate-400 -mt-2 px-1">{t('allCurrenciesConverted')}</p>
        )}

        {/* ── Day mode: Hourly chart ─────────────────────────────── */}
        {dateRange === 'day' && hourlyData.length > 0 && hourlyData.some((h) => h.orders > 0 || h.prevOrders > 0) && (
          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">{t('hourlyOrderBreakdown')}</h3>
            <Chart options={hourlyOpts} series={hourlySeries} type="bar" height={260} />
          </Card>
        )}

        {/* ── Main chart + Donut ─────────────────���───────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">{t('revenueAndOrderTrend')}</h3>
            {data?.dailyStats && data.dailyStats.length > 0 ? (
              <Chart options={revenueChartOpts} series={revenueChartSeries} type="line" height={300} />
            ) : (
              <EmptyState message={t('noDataInRange')} />
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">{t('marketplaceDistribution')}</h3>
            {donutSeries.length > 0 && donutSeries.some((v) => v > 0) ? (
              <Chart options={donutOpts} series={donutSeries} type="donut" height={300} />
            ) : (
              <EmptyState message={t('noMarketplaceData')} />
            )}
          </Card>
        </div>

        {/* ── Marketplace Breakdown Table ─────────────────────────── */}
        {mpData.length > 0 && (
          <Card className="overflow-hidden">
            <div className="p-4 sm:p-5 pb-0">
              <h3 className="text-sm font-semibold text-slate-800 mb-4">{t('marketplacePerformance')}</h3>
            </div>

            {/* Mobile cards */}
            <div className="block md:hidden px-4 pb-4 space-y-3">
              {[...mpData].sort((a, b) => b.revenue - a.revenue).map((mp, i) => {
                const pct = mp.percentage || ((mp.orders / (data?.totalOrders || 1)) * 100);
                return (
                  <div key={i} className="rounded-xl border border-slate-100 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <MarketplaceDot name={mp.marketplace} />
                        <span className="text-sm font-semibold text-slate-800">{mp.marketplace}</span>
                      </div>
                      <span className="text-xs text-slate-400">{pct.toFixed(1)}%</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-500">{t('orders')}</span>
                        <p className="font-semibold text-slate-800">{formatNumber(mp.orders)}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">{t('nativeCurrency')}</span>
                        <p className="font-semibold text-slate-800">{fmtNative(mp.byCurrency)}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">{t('convertedTRY')}</span>
                        <p className="font-semibold text-emerald-700">{formatCurrency(mp.revenue)}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">{t('avgOrder')}</span>
                        <p className="font-semibold text-slate-800">{formatCurrency(mp.avgOrderValue || (mp.orders > 0 ? mp.revenue / mp.orders : 0))}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-t border-b border-slate-100 bg-slate-50/60">
                    <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('marketplace')}</th>
                    <th className="px-5 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{t('orders')}</th>
                    <th className="px-5 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{t('nativeCurrency')}</th>
                    <th className="px-5 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{t('revenueTRY')}</th>
                    <th className="px-5 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{t('avgOrder')}</th>
                    <th className="px-5 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">%</th>
                  </tr>
                </thead>
                <tbody>
                  {[...mpData].sort((a, b) => b.revenue - a.revenue).map((mp, i) => {
                    const pct = mp.percentage || ((mp.orders / (data?.totalOrders || 1)) * 100);
                    const avg = mp.avgOrderValue || (mp.orders > 0 ? mp.revenue / mp.orders : 0);
                    return (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <MarketplaceDot name={mp.marketplace} size={10} />
                            <span className="text-sm font-medium text-slate-800">{mp.marketplace}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-700 text-right font-medium">{formatNumber(mp.orders)}</td>
                        <td className="px-5 py-3.5 text-sm text-slate-600 text-right font-mono">{fmtNative(mp.byCurrency)}</td>
                        <td className="px-5 py-3.5 text-sm text-emerald-700 text-right font-semibold">{formatCurrency(mp.revenue)}</td>
                        <td className="px-5 py-3.5 text-sm text-slate-700 text-right">{formatCurrency(avg)}</td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="inline-flex items-center gap-2">
                            <div className="w-16 bg-slate-100 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: mpColor(mp.marketplace, i) }} />
                            </div>
                            <span className="text-xs text-slate-500 w-10 text-right">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── Monthly Trends ─────────────────────────────���───────── */}
        {monthlyStats.length > 0 && (
          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">{t('monthlyTrends')}</h3>
            <Chart options={monthlyOpts} series={monthlySeries} type="line" height={280} />
          </Card>
        )}

        {/* ── Bottom row: Top Products + Order Status ────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Top Products */}
          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">{t('topSellingProducts')}</h3>
            {data?.topProducts && data.topProducts.length > 0 ? (
              <div className="space-y-3">
                {data.topProducts.slice(0, 5).map((p, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-300 w-5 text-center">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 truncate">{p.name}</p>
                      <p className="text-xs text-slate-400">{formatNumber(p.orders)} {t('orders').toLowerCase()}</p>
                    </div>
                    <span className="text-sm font-semibold text-slate-700 flex-shrink-0">{formatCurrency(p.revenue)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message={t('noProductData')} />
            )}
          </Card>

          {/* Order Status */}
          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">{t('orderStatuses')}</h3>
            {data?.orderStatusBreakdown && data.orderStatusBreakdown.length > 0 ? (
              <div className="space-y-3">
                {data.orderStatusBreakdown.map((s, i) => {
                  const pct = (s.count / totalStatusCount) * 100;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                          <span className="text-sm text-slate-700">{s.status}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800">{formatNumber(s.count)}</span>
                          <span className="text-xs text-slate-400">({pct.toFixed(1)}%)</span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState message={t('noStatusData')} />
            )}
          </Card>
        </div>

        {/* ── Recent Activity ─────���──────────────────────────────── */}
        {data?.recentActivity && data.recentActivity.length > 0 && (
          <Card className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">{t('recentActivity')}</h3>
            {/* Mobile */}
            <div className="block md:hidden space-y-2">
              {data.recentActivity.slice(0, 8).map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <MarketplaceDot name={item.marketplace} />
                      <span className="text-sm font-medium text-slate-800">#{item.orderNumber}</span>
                    </div>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{item.customerName}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {CURRENCY_SYMBOLS[(item.currency || 'TRY').toUpperCase()] || ''}{item.totalPrice?.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {item.uiOrderDate ? formatDate(new Date(item.uiOrderDate), { day: 'numeric', month: 'short' }) : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="pb-2 text-left text-xs font-medium text-slate-400">#</th>
                    <th className="pb-2 text-left text-xs font-medium text-slate-400">{t('marketplace')}</th>
                    <th className="pb-2 text-left text-xs font-medium text-slate-400">{t('customers')}</th>
                    <th className="pb-2 text-right text-xs font-medium text-slate-400">{t('revenue')}</th>
                    <th className="pb-2 text-right text-xs font-medium text-slate-400">{t('orderStatuses')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentActivity.slice(0, 8).map((item, i) => (
                    <tr key={i} className="border-b border-slate-50 last:border-0">
                      <td className="py-2.5 text-sm text-slate-700">{item.orderNumber}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <MarketplaceDot name={item.marketplace} />
                          <span className="text-sm text-slate-600">{item.marketplace}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-sm text-slate-600 max-w-[150px] truncate">{item.customerName}</td>
                      <td className="py-2.5 text-sm font-semibold text-slate-800 text-right">
                        {CURRENCY_SYMBOLS[(item.currency || 'TRY').toUpperCase()] || ''}{item.totalPrice?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right">
                        <span className="text-xs text-slate-500">{item.externalStatus || '-'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

      </div>
    </AppLayout>
  );
}
