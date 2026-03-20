import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout';
import dynamic from 'next/dynamic';
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

const TR_MONTHS = ['Oca', 'Sub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Agu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const TR_MONTHS_FULL = ['Ocak', 'Subat', 'Mart', 'Nisan', 'Mayis', 'Haziran', 'Temmuz', 'Agustos', 'Eylul', 'Ekim', 'Kasim', 'Aralik'];

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value);

const formatNumber = (value: number): string => value.toLocaleString('tr-TR');

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

const SectionCard = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 ${className}`}>{children}</div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-lg font-semibold text-gray-900 mb-4">{children}</h3>
);

const EmptyState = ({ message = 'Veri yok' }: { message?: string }) => (
  <div className="flex items-center justify-center py-8 text-gray-400 text-sm">{message}</div>
);

const MarketplaceBadge = ({ name }: { name: string | null | undefined }) => {
  const safeName = name || 'Unknown';
  const key = safeName.toLowerCase();
  const cls = MARKETPLACE_BG[key] || 'bg-gray-100 text-gray-800';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{safeName}</span>;
};

const StatusBadge = ({ status }: { status: string | null | undefined }) => {
  const s = (status || '').toLowerCase();
  let cls = 'bg-gray-100 text-gray-800';
  if (s.includes('deliver') || s.includes('teslim')) cls = 'bg-green-100 text-green-800';
  else if (s.includes('ship') || s.includes('kargo')) cls = 'bg-blue-100 text-blue-800';
  else if (s.includes('pending') || s.includes('bekle')) cls = 'bg-yellow-100 text-yellow-800';
  else if (s.includes('cancel') || s.includes('iptal')) cls = 'bg-red-100 text-red-800';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{status || '-'}</span>;
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
}: {
  title: string;
  value: string | number;
  trend?: number;
  trendLabel?: string;
  icon: React.ComponentType<any>;
  color?: string;
}) => {
  const trendPositive = trend !== undefined && trend >= 0;
  const trendColor = trendPositive ? 'text-green-600' : 'text-red-600';
  const TrendIcon = trendPositive ? TrendingUp : TrendingDown;

  const colorMap: Record<string, { bg: string; text: string }> = {
    blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
    green: { bg: 'bg-green-100', text: 'text-green-600' },
    purple: { bg: 'bg-purple-100', text: 'text-purple-600' },
    orange: { bg: 'bg-orange-100', text: 'text-orange-600' },
  };

  return (
    <div className="bg-white p-4 sm:p-6 rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between">
        <div className={`p-3 rounded-lg ${colorMap[color]?.bg ?? 'bg-blue-100'}`}>
          <Icon className={`h-6 w-6 ${colorMap[color]?.text ?? 'text-blue-600'}`} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center ${trendColor}`}>
            <TrendIcon className="h-4 w-4 mr-1" />
            <span className="text-sm font-medium">{Math.abs(trend).toFixed(1)}%</span>
          </div>
        )}
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-900">
          {typeof value === 'number' ? formatNumber(value) : value}
        </h3>
        <p className="text-sm text-gray-600">{title}</p>
        {trendLabel && <p className="text-xs text-gray-500 mt-1">{trendLabel}</p>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

const SkeletonBlock = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse bg-gray-200 rounded ${className}`} />
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
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Initialize selectedMonth on client only to avoid hydration mismatch
  useEffect(() => {
    if (!selectedMonth) {
      const now = new Date();
      setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    }
  }, []);

  // Navigate months
  const navigateMonth = (direction: -1 | 1) => {
    if (!selectedMonth) return;
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + direction, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const selectedMonthLabel = useMemo(() => {
    if (!selectedMonth) return '';
    const [y, m] = selectedMonth.split('-').map(Number);
    return `${TR_MONTHS_FULL[m - 1]} ${y}`;
  }, [selectedMonth]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/app');
    } else if (user && (dateRange !== 'month' || selectedMonth)) {
      fetchAnalyticsData();
    }
  }, [authLoading, user, router, dateRange, selectedMonth]);

  const fetchAnalyticsData = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      const params = new URLSearchParams({ dateRange });
      if (dateRange === 'month') params.set('month', selectedMonth);

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
      new Date(s.date).toLocaleDateString('tr-TR', { month: 'short', day: 'numeric' })
    ) || [];

  const revenueChartOptions: ApexCharts.ApexOptions = {
    chart: { type: 'area', height: 280, toolbar: { show: false } },
    colors: ['#3B82F6', '#10B981'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: [0, 3] },
    xaxis: { categories: dailyLabels },
    yaxis: [
      { title: { text: 'Siparis' }, labels: { formatter: (v: number) => Math.round(v).toString() } },
      { opposite: true, title: { text: 'Gelir (TL)' }, labels: { formatter: (v: number) => formatNumber(Math.round(v)) } },
    ],
    fill: { type: ['solid', 'gradient'], opacity: [0.35, 1], gradient: { shadeIntensity: 1, stops: [0, 100] } },
    legend: { position: 'top' },
    tooltip: {
      y: {
        formatter: (v: number, { seriesIndex }: { seriesIndex: number }) =>
          seriesIndex === 1 ? formatCurrency(v) : `${v} siparis`,
      },
    },
  };

  const revenueChartSeries = [
    { name: 'Siparis', type: 'column', data: data?.dailyStats.map((s) => s.orders) || [] },
    { name: 'Gelir', type: 'line', data: data?.dailyStats.map((s) => Math.round(s.revenue)) || [] },
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
    tooltip: { y: { formatter: (v: number) => `${formatNumber(v)} siparis` } },
  };

  const donutSeries = mpData.map((m) => m.orders);

  // Monthly chart
  const monthlyStats = data?.monthlyStats ?? [];
  const monthlyLabels = monthlyStats.map((m) => {
    const d = new Date(m.month + '-01');
    return isNaN(d.getTime()) ? m.month : TR_MONTHS[d.getMonth()];
  });

  const monthlyChartOptions: ApexCharts.ApexOptions = {
    chart: { type: 'bar', height: 280, toolbar: { show: false } },
    colors: ['#3B82F6', '#10B981'],
    plotOptions: { bar: { borderRadius: 4, columnWidth: '50%' } },
    dataLabels: { enabled: false },
    stroke: { width: [0, 3], curve: 'smooth' },
    xaxis: { categories: monthlyLabels },
    yaxis: [
      { title: { text: 'Siparis' }, labels: { formatter: (v: number) => Math.round(v).toString() } },
      { opposite: true, title: { text: 'Gelir (TL)' }, labels: { formatter: (v: number) => formatNumber(Math.round(v)) } },
    ],
    legend: { position: 'top' },
    tooltip: {
      y: {
        formatter: (v: number, { seriesIndex }: { seriesIndex: number }) =>
          seriesIndex === 1 ? formatCurrency(v) : `${formatNumber(v)} siparis`,
      },
    },
  };

  const monthlyChartSeries = [
    { name: 'Siparis', type: 'column', data: monthlyStats.map((m) => m.orders) },
    { name: 'Gelir', type: 'line', data: monthlyStats.map((m) => Math.round(m.revenue)) },
  ];

  // Order status helpers
  const totalStatusCount = data?.orderStatusBreakdown.reduce((a, b) => a + b.count, 0) || 1;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (authLoading || loading) {
    return (
      <AppLayout title="Analitik - KolayXport Dashboard">
        <LoadingSkeleton />
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Analitik - KolayXport Dashboard">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900">Analitik Dashboard</h1>
            <p className="mt-1 text-gray-600">Pazaryeri satis performansinizi takip edin</p>
          </div>
          <div className="mt-4 sm:mt-0 flex items-center space-x-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Yenile
            </button>
          </div>
        </div>

        {/* ============================================================= */}
        {/* ROW 1: KPI Cards                                              */}
        {/* ============================================================= */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <StatCard
            title="Toplam Siparis"
            value={data?.totalOrders ?? 0}
            trend={data?.orderTrend}
            trendLabel={dateRange === 'month' ? `Onceki ay: ${formatNumber(data?.previousPeriod?.orders ?? 0)}` : 'Onceki doneme gore'}
            icon={ShoppingCart}
            color="blue"
          />
          <StatCard
            title="Toplam Gelir"
            value={formatCurrency(data?.totalRevenue ?? 0)}
            trend={data?.revenueTrend}
            trendLabel={dateRange === 'month' ? `Onceki ay: ${formatCurrency(data?.previousPeriod?.revenue ?? 0)}` : 'Onceki doneme gore'}
            icon={DollarSign}
            color="green"
          />
          <StatCard
            title="Musteri Sayisi"
            value={data?.totalCustomers ?? 0}
            icon={Users}
            color="purple"
          />
          <StatCard
            title="Ortalama Siparis"
            value={formatCurrency(data?.averageOrderValue ?? 0)}
            icon={Package}
            color="orange"
          />
        </div>

        {/* ============================================================= */}
        {/* ROW 2: Date Range + Exchange Rates                            */}
        {/* ============================================================= */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="month">Aya Gore</option>
              <option value="7days">Son 7 Gun</option>
              <option value="30days">Son 30 Gun</option>
              <option value="90days">Son 90 Gun</option>
              <option value="6months">Son 6 Ay</option>
              <option value="12months">Son 12 Ay</option>
              <option value="all">Tum Zamanlar</option>
            </select>
            {dateRange === 'month' && (
              <div className="flex items-center gap-1 bg-white border border-gray-300 rounded-md">
                <button
                  onClick={() => navigateMonth(-1)}
                  className="p-2 hover:bg-gray-100 rounded-l-md transition-colors"
                >
                  <ChevronLeft className="h-4 w-4 text-gray-600" />
                </button>
                <div className="flex items-center gap-1.5 px-3 py-1.5 min-w-[140px] justify-center">
                  <Calendar className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-gray-900">{selectedMonthLabel}</span>
                </div>
                <button
                  onClick={() => navigateMonth(1)}
                  className="p-2 hover:bg-gray-100 rounded-r-md transition-colors"
                >
                  <ChevronRight className="h-4 w-4 text-gray-600" />
                </button>
              </div>
            )}
          </div>

          {data?.exchangeRates && (
            <div className="flex-1 bg-gradient-to-r from-blue-50 to-indigo-50 p-3 rounded-lg border border-blue-200">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-6">
                <div className="flex items-center gap-2">
                  <CurrencyIcon className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-gray-700">Guncel Kurlar:</span>
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
                    {new Date(data.exchangeRates.lastUpdated).toLocaleTimeString('tr-TR')}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ============================================================= */}
        {/* ROW 3: Revenue/Orders Trend + Marketplace Donut               */}
        {/* ============================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <SectionCard>
            <SectionTitle>Gelir ve Siparis Trendi</SectionTitle>
            {data?.dailyStats && data.dailyStats.length > 0 ? (
              <Chart options={revenueChartOptions} series={revenueChartSeries} type="line" height={280} />
            ) : (
              <EmptyState message="Secilen tarih araliginda veri yok" />
            )}
          </SectionCard>

          <SectionCard>
            <SectionTitle>Pazaryeri Dagilimi</SectionTitle>
            {donutSeries.length > 0 && donutSeries.some((v) => v > 0) ? (
              <Chart options={donutOptions} series={donutSeries} type="donut" height={280} />
            ) : (
              <EmptyState message="Pazaryeri verisi yok" />
            )}
          </SectionCard>
        </div>

        {/* ============================================================= */}
        {/* ROW 4: Marketplace Breakdown Table                            */}
        {/* ============================================================= */}
        <SectionCard>
          <SectionTitle>Pazaryeri Performansi</SectionTitle>
          {mpData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Pazaryeri
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Siparis
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Gelir (TL)
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Musteri
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Ort. Siparis (TL)
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      % Oran
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
          ) : (
            <EmptyState />
          )}
        </SectionCard>

        {/* ============================================================= */}
        {/* ROW 5: Monthly Trends Chart                                   */}
        {/* ============================================================= */}
        {monthlyStats.length > 0 && (
          <SectionCard>
            <SectionTitle>Aylik Trendler (Son 12 Ay)</SectionTitle>
            <Chart options={monthlyChartOptions} series={monthlyChartSeries} type="line" height={280} />
          </SectionCard>
        )}

        {/* ============================================================= */}
        {/* ROW 6: Top Products + Order Status                            */}
        {/* ============================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Top Products */}
          <SectionCard>
            <SectionTitle>En Cok Satan Urunler</SectionTitle>
            {data?.topProducts && data.topProducts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Urun</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Siparis</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Gelir (TL)</th>
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
            ) : (
              <EmptyState message="Urun verisi yok" />
            )}
          </SectionCard>

          {/* Order Status Breakdown */}
          <SectionCard>
            <SectionTitle>Siparis Durumlari</SectionTitle>
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
              <EmptyState message="Durum verisi yok" />
            )}
          </SectionCard>
        </div>

        {/* ============================================================= */}
        {/* ROW 7: Shipping Stats + Recent Activity                       */}
        {/* ============================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Shipping Stats */}
          <SectionCard>
            <SectionTitle>Kargo Istatistikleri</SectionTitle>
            {data?.shippingStats ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <Truck className="h-6 w-6 text-blue-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(data.shippingStats.totalLabels)}</p>
                    <p className="text-xs text-gray-600">Toplam Etiket</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-4 text-center">
                    <Clock className="h-6 w-6 text-amber-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(data.shippingStats.pendingLabels)}</p>
                    <p className="text-xs text-gray-600">Bekleyen Etiket</p>
                  </div>
                </div>

                {data.shippingStats.byCarrier && data.shippingStats.byCarrier.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Tasiyiciya Gore</p>
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
              <EmptyState message="Kargo verisi yok" />
            )}
          </SectionCard>

          {/* Recent Activity */}
          <SectionCard>
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-5 w-5 text-gray-600" />
              <SectionTitle>Son Aktivite</SectionTitle>
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
                        ? new Date(item.uiOrderDate).toLocaleDateString('tr-TR', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="Henuz aktivite yok" />
            )}
          </SectionCard>
        </div>
      </div>
    </AppLayout>
  );
}
