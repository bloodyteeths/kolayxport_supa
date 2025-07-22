import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/router';
import AppLayout from '../../components/AppLayout';
import dynamic from 'next/dynamic';
import { 
  TrendingUp, 
  TrendingDown, 
  Package, 
  ShoppingCart, 
  DollarSign, 
  Users,
  Calendar,
  Filter,
  Download,
  RefreshCw,
  DollarSign as CurrencyIcon
} from 'lucide-react';

// Dynamically import ApexCharts to avoid SSR issues
const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });

interface AnalyticsData {
  totalOrders: number;
  totalRevenue: number;
  totalCustomers: number;
  averageOrderValue: number;
  orderTrend: number;
  revenueTrend: number;
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
}

const StatCard = ({ 
  title, 
  value, 
  trend, 
  trendLabel, 
  icon: Icon, 
  color = 'blue' 
}: {
  title: string;
  value: string | number;
  trend?: number;
  trendLabel?: string;
  icon: React.ComponentType<any>;
  color?: string;
}) => {
  const trendColor = trend && trend > 0 ? 'text-green-600' : 'text-red-600';
  const TrendIcon = trend && trend > 0 ? TrendingUp : TrendingDown;
  
  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between">
        <div className={`p-3 rounded-lg bg-${color}-100`}>
          <Icon className={`h-6 w-6 text-${color}-600`} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center ${trendColor}`}>
            <TrendIcon className="h-4 w-4 mr-1" />
            <span className="text-sm font-medium">{Math.abs(trend)}%</span>
          </div>
        )}
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-900">{typeof value === 'number' ? value.toLocaleString() : value}</h3>
        <p className="text-sm text-gray-600">{title}</p>
        {trendLabel && (
          <p className="text-xs text-gray-500 mt-1">{trendLabel}</p>
        )}
      </div>
    </div>
  );
};

export default function AnalyticsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('7days');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    } else if (user) {
      fetchAnalyticsData();
    }
  }, [authLoading, user, router, dateRange]);

  const fetchAnalyticsData = async () => {
    setLoading(true);
    try {
      // Get the current session for authentication
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('No active session');
      }

      const response = await fetch(`/api/analytics?dateRange=${dateRange}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to fetch analytics data: ${errorData.error || response.statusText}`);
      }
      
      const analyticsData = await response.json();
      setData(analyticsData);
    } catch (error) {
      console.error('Error fetching analytics:', error);
      
      // Fallback to mock data if API fails
      const mockData: AnalyticsData = {
        totalOrders: 0,
        totalRevenue: 0,
        totalCustomers: 0,
        averageOrderValue: 0,
        orderTrend: 0,
        revenueTrend: 0,
        topMarketplaces: [],
        dailyStats: [],
        topProducts: [],
        orderStatusBreakdown: []
      };
      
      setData(mockData);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAnalyticsData();
    setRefreshing(false);
  };

  // Chart configurations
  const revenueChartOptions = {
    chart: {
      type: 'area' as const,
      height: 350,
      toolbar: { show: false },
    },
    colors: ['#4F46E5', '#10B981'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth' as const },
    xaxis: {
      categories: data?.dailyStats.slice(-7).map(stat => 
        new Date(stat.date).toLocaleDateString('tr-TR', { month: 'short', day: 'numeric' })
      ) || [],
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        stops: [0, 100]
      }
    },
    legend: { position: 'top' as const }
  };

  const revenueChartSeries = [
    {
      name: 'Sipariş Sayısı',
      data: data?.dailyStats.slice(-7).map(stat => stat.orders) || []
    },
    {
      name: 'Gelir (₺)',
      data: data?.dailyStats.slice(-7).map(stat => Math.round(stat.revenue / 100)) || []
    }
  ];

  const marketplaceChartOptions = {
    chart: { type: 'donut' as const },
    colors: data?.topMarketplaces.map(m => m.color) || [],
    labels: data?.topMarketplaces.map(m => m.name) || [],
    legend: { position: 'bottom' as const },
    plotOptions: {
      pie: {
        donut: {
          size: '70%'
        }
      }
    }
  };

  const marketplaceChartSeries = data?.topMarketplaces.map(m => m.orders) || [];

  if (authLoading || loading) {
    return (
      <AppLayout title="Analitik - KolayXport Dashboard">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
            <p className="text-gray-600">Analitik verileri yükleniyor...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Analitik - KolayXport Dashboard">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Analitik Dashboard</h1>
            <p className="mt-2 text-gray-600">Pazaryeri satış performansınızı takip edin</p>
          </div>
          <div className="mt-4 sm:mt-0 flex items-center space-x-3">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="7days">Son 7 Gün</option>
              <option value="30days">Son 30 Gün</option>
              <option value="90days">Son 90 Gün</option>
            </select>
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

        {/* Currency Rates Display */}
        {data?.exchangeRates && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
            <div className="flex items-center justify-center space-x-8">
              <div className="flex items-center space-x-2">
                <CurrencyIcon className="h-5 w-5 text-blue-600" />
                <span className="text-sm font-medium text-gray-700">Güncel Kurlar:</span>
              </div>
              <div className="flex items-center space-x-6">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-semibold text-gray-900">1 USD =</span>
                  <span className="text-lg font-bold text-blue-600">₺{data.exchangeRates.USD.toFixed(2)}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-semibold text-gray-900">1 EUR =</span>
                  <span className="text-lg font-bold text-green-600">₺{data.exchangeRates.EUR.toFixed(2)}</span>
                </div>
              </div>
              {data.exchangeRates.lastUpdated && (
                <div className="text-xs text-gray-500">
                  Son güncelleme: {new Date(data.exchangeRates.lastUpdated).toLocaleTimeString('tr-TR')}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Toplam Sipariş"
            value={data?.totalOrders || 0}
            trend={data?.orderTrend}
            trendLabel="Önceki döneme göre"
            icon={ShoppingCart}
            color="blue"
          />
          <StatCard
            title="Toplam Gelir"
            value={`₺${(data?.totalRevenue || 0).toLocaleString()}`}
            trend={data?.revenueTrend}
            trendLabel="Önceki döneme göre"
            icon={DollarSign}
            color="green"
          />
          <StatCard
            title="Müşteri Sayısı"
            value={data?.totalCustomers || 0}
            icon={Users}
            color="purple"
          />
          <StatCard
            title="Ortalama Sipariş"
            value={`₺${(data?.averageOrderValue || 0).toFixed(2)}`}
            icon={Package}
            color="orange"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Revenue Chart */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Günlük Performans</h3>
            <Chart
              options={revenueChartOptions}
              series={revenueChartSeries}
              type="area"
              height={350}
            />
          </div>

          {/* Marketplace Breakdown */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Pazaryeri Dağılımı</h3>
            <Chart
              options={marketplaceChartOptions}
              series={marketplaceChartSeries}
              type="donut"
              height={350}
            />
          </div>
        </div>

        {/* Data Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Products */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">En Çok Satan Ürünler</h3>
            <div className="space-y-3">
              {data?.topProducts.map((product, index) => (
                <div key={index} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{product.name}</p>
                    <p className="text-sm text-gray-500">{product.orders} sipariş</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">₺{product.revenue.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Order Status */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Sipariş Durumları</h3>
            <div className="space-y-3">
              {data?.orderStatusBreakdown.map((status, index) => (
                <div key={index} className="flex items-center justify-between py-3">
                  <div className="flex items-center">
                    <div 
                      className="w-3 h-3 rounded-full mr-3"
                      style={{ backgroundColor: status.color }}
                    />
                    <span className="font-medium text-gray-900">{status.status}</span>
                  </div>
                  <span className="font-semibold text-gray-900">{status.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Marketplace Performance Table */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Pazaryeri Performansı</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Pazaryeri
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sipariş Sayısı
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Toplam Gelir
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ortalama Sipariş
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data?.topMarketplaces.map((marketplace, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div 
                          className="w-3 h-3 rounded-full mr-3"
                          style={{ backgroundColor: marketplace.color }}
                        />
                        <span className="font-medium text-gray-900">{marketplace.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {marketplace.orders.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ₺{marketplace.revenue.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ₺{Math.round(marketplace.revenue / marketplace.orders).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}