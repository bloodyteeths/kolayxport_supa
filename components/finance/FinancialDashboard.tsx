import React, { useState, lazy, Suspense } from 'react';
import { useTranslations } from 'next-intl';
import {
  Box, Typography, Paper, Skeleton, Grid, Chip, Button,
  CircularProgress, Collapse, IconButton,
} from '@mui/material';
import {
  Banknote, TrendingUp, TrendingDown, Truck, RotateCcw,
  Package, PieChart, ChevronDown, ChevronUp, List, BarChart3,
  Percent, Edit3,
} from 'lucide-react';
import useFinanceStore, { DashboardData, DashboardSummary } from '@/lib/stores/useFinanceStore';
import dynamic from 'next/dynamic';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });
const ProductPnLTable = lazy(() => import('./ProductPnLTable'));
const CostEntryDrawer = lazy(() => import('./CostEntryDrawer'));
const TransactionLog = lazy(() => import('./TransactionLog'));

// ---- Summary Cards ----

interface CardDef {
  key: keyof DashboardSummary;
  tKey: string;
  icon: React.ReactNode;
  color: string;
  gradient: string;
  format: 'currency' | 'percent' | 'number';
  invertColor?: boolean;
}

const CARDS: CardDef[] = [
  { key: 'grossRevenue', tKey: 'grossRevenue', icon: <Banknote size={20} />, color: '#10b981', gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', format: 'currency' },
  { key: 'commissions', tKey: 'commissions', icon: <Percent size={20} />, color: '#f59e0b', gradient: 'linear-gradient(135deg, #fffbeb, #fef3c7)', format: 'currency' },
  { key: 'shipping', tKey: 'shippingCosts', icon: <Truck size={20} />, color: '#3b82f6', gradient: 'linear-gradient(135deg, #eff6ff, #dbeafe)', format: 'currency' },
  { key: 'returns', tKey: 'returns', icon: <RotateCcw size={20} />, color: '#ef4444', gradient: 'linear-gradient(135deg, #fef2f2, #fecaca)', format: 'currency' },
  { key: 'cogs', tKey: 'productCost', icon: <Package size={20} />, color: '#8b5cf6', gradient: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', format: 'currency' },
  { key: 'netProfit', tKey: 'netProfit', icon: <TrendingUp size={20} />, color: '#10b981', gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', format: 'currency', invertColor: true },
];

function formatCurrency(val: number, currency = '₺'): string {
  const abs = Math.abs(val);
  const formatted = abs >= 1000
    ? `${(abs / 1000).toFixed(1)}K`
    : abs.toFixed(2);
  return `${val < 0 ? '-' : ''}${currency}${formatted}`;
}

function SummaryCards({ summary }: { summary: DashboardSummary }) {
  const t = useTranslations('financials');
  return (
    <Grid container spacing={1.5} sx={{ mb: 2 }}>
      {CARDS.map(card => {
        const value = (summary[card.key] as number) ?? 0;
        const isNegative = card.invertColor && value < 0;
        const cardColor = isNegative ? '#ef4444' : card.color;
        const cardGradient = isNegative ? 'linear-gradient(135deg, #fef2f2, #fecaca)' : card.gradient;

        return (
          <Grid item xs={6} sm={4} md={2} key={card.key}>
            <Paper sx={{
              p: 1.5, borderRadius: '12px', border: '1px solid',
              borderColor: 'rgba(0,0,0,0.04)', transition: 'all 0.2s',
              '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' },
            }}>
              <Box sx={{ p: 1, borderRadius: '10px', background: cardGradient, width: 'fit-content', mb: 1 }}>
                <Box sx={{ color: cardColor }}>{card.icon}</Box>
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.1rem', color: cardColor }}>
                {formatCurrency(value)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                {t(card.tKey)}
              </Typography>
              {card.key === 'netProfit' && (
                <Chip
                  label={`%${(summary.margin ?? 0).toFixed(1)}`}
                  size="small"
                  sx={{
                    ml: 0.5, height: 18, fontSize: '0.65rem', fontWeight: 700,
                    bgcolor: value >= 0 ? '#dcfce7' : '#fecaca',
                    color: value >= 0 ? '#15803d' : '#dc2626',
                  }}
                />
              )}
            </Paper>
          </Grid>
        );
      })}
    </Grid>
  );
}

// ---- Charts ----

function ProfitCharts({ data }: { data: DashboardData }) {
  const t = useTranslations('financials');
  const { timeSeries, summary, transactionTypeSummary } = data;

  const barOptions: ApexCharts.ApexOptions = {
    chart: { type: 'bar', height: 300, toolbar: { show: false }, fontFamily: 'Inter, sans-serif', stacked: true },
    colors: ['#10b981', '#f59e0b', '#ef4444'],
    plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: timeSeries.map(p => p.period), labels: { style: { fontSize: '10px' }, rotate: -45 } },
    yaxis: { labels: { formatter: (v: number) => `₺${Math.round(v)}` } },
    legend: { position: 'top' },
    tooltip: { y: { formatter: (v: number) => `₺${v.toFixed(2)}` } },
    grid: { borderColor: '#f1f5f9' },
  };

  const barSeries = [
    { name: t('revenue'), data: timeSeries.map(p => p.revenue) },
    { name: t('expenses'), data: timeSeries.map(p => p.commissions + p.shipping + p.returns + p.cogs) },
    { name: t('profit'), data: timeSeries.map(p => p.netProfit) },
  ];

  // Donut for cost breakdown
  const txSummaryArr = Array.isArray(transactionTypeSummary) ? transactionTypeSummary : [];
  const donutLabels = txSummaryArr.filter(tx => tx.total < 0 || ['Commission', 'Return', 'Cargo'].some(k => tx.type.includes(k))).map(tx => tx.type);
  const donutValues = txSummaryArr.filter(tx => tx.total < 0 || ['Commission', 'Return', 'Cargo'].some(k => tx.type.includes(k))).map(tx => Math.abs(tx.total));

  const donutOptions: ApexCharts.ApexOptions = {
    chart: { type: 'donut', height: 300, fontFamily: 'Inter, sans-serif' },
    labels: donutLabels.length > 0 ? donutLabels : [t('commission'), t('shipping'), t('return')],
    colors: ['#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899'],
    legend: { position: 'bottom', fontSize: '12px' },
    dataLabels: { enabled: true, formatter: (val: number) => `%${val.toFixed(0)}` },
    plotOptions: { pie: { donut: { size: '60%', labels: { show: true, total: { show: true, label: t('totalExpense'), formatter: () => formatCurrency(Math.abs(summary.commissions + summary.shipping + summary.returns + summary.discounts)) } } } } },
  };

  return (
    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={12} md={8}>
        <Paper sx={{ p: 2, borderRadius: '12px' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            <BarChart3 size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('revenueAndCostTrend')}
          </Typography>
          {timeSeries.length > 0 ? (
            <Chart options={barOptions} series={barSeries} type="bar" height={280} />
          ) : (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">{t('noChartData')}</Typography>
            </Box>
          )}
        </Paper>
      </Grid>
      <Grid item xs={12} md={4}>
        <Paper sx={{ p: 2, borderRadius: '12px' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            <PieChart size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('costBreakdown')}
          </Typography>
          {donutValues.length > 0 ? (
            <Chart options={donutOptions} series={donutValues} type="donut" height={280} />
          ) : (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">{t('noExpenseData')}</Typography>
            </Box>
          )}
        </Paper>
      </Grid>
    </Grid>
  );
}

// ---- Main Dashboard ----

export default function FinancialDashboard() {
  const t = useTranslations('financials');
  const { dashboardData, dashboardLoading, marketplace } = useFinanceStore();
  const [costDrawerOpen, setCostDrawerOpen] = useState(false);
  const [txLogOpen, setTxLogOpen] = useState(false);

  if (dashboardLoading && !dashboardData) {
    return (
      <Box>
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Grid item xs={6} sm={4} md={2} key={i}>
              <Skeleton variant="rounded" height={100} sx={{ borderRadius: '12px' }} />
            </Grid>
          ))}
        </Grid>
        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <Skeleton variant="rounded" height={320} sx={{ borderRadius: '12px' }} />
          </Grid>
          <Grid item xs={12} md={4}>
            <Skeleton variant="rounded" height={320} sx={{ borderRadius: '12px' }} />
          </Grid>
        </Grid>
      </Box>
    );
  }

  if (!dashboardData) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center', borderRadius: '12px' }}>
        <Box sx={{
          width: 64, height: 64, borderRadius: '50%', mx: 'auto', mb: 2,
          background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Banknote size={28} color="#10b981" />
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          {t('syncPrompt')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('syncDescription')}
        </Typography>
      </Paper>
    );
  }

  const { summary } = dashboardData;

  return (
    <Box>
      {/* Summary Cards */}
      <SummaryCards summary={summary} />

      {/* Charts */}
      <ProfitCharts data={dashboardData} />

      {/* Product P&L Section */}
      <Paper sx={{ borderRadius: '12px', overflow: 'hidden', mb: 2 }}>
        <Box sx={{
          p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid #f1f5f9',
        }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            <Package size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('productPnL')}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Edit3 size={14} />}
            onClick={() => setCostDrawerOpen(true)}
            sx={{ textTransform: 'none', borderRadius: '8px' }}
          >
            {t('enterCost')}
          </Button>
        </Box>
        <Suspense fallback={<Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>}>
          <ProductPnLTable products={dashboardData.productBreakdown} />
        </Suspense>
      </Paper>

      {/* Transaction Log (collapsible) */}
      <Paper sx={{ borderRadius: '12px', overflow: 'hidden' }}>
        <Box
          sx={{
            p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', '&:hover': { bgcolor: '#f8fafc' },
          }}
          onClick={() => setTxLogOpen(!txLogOpen)}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            <List size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('transactionLog')}
          </Typography>
          <IconButton size="small">
            {txLogOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </IconButton>
        </Box>
        <Collapse in={txLogOpen}>
          <Suspense fallback={<Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>}>
            <TransactionLog />
          </Suspense>
        </Collapse>
      </Paper>

      {/* Cost Entry Drawer */}
      <Suspense fallback={null}>
        <CostEntryDrawer open={costDrawerOpen} onClose={() => setCostDrawerOpen(false)} />
      </Suspense>
    </Box>
  );
}
