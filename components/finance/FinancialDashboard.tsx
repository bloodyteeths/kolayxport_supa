import React, { useState, lazy, Suspense } from 'react';
import { useTranslations } from 'next-intl';
import {
  Box, Typography, Paper, Skeleton, Grid, Chip, Button,
  CircularProgress, Collapse, IconButton, LinearProgress,
} from '@mui/material';
import {
  Banknote, TrendingUp, TrendingDown, Truck, RotateCcw,
  Package, PieChart, ChevronDown, ChevronUp, List, BarChart3,
  Percent, Edit3, Megaphone, ReceiptText, RefreshCw,
} from 'lucide-react';
import useFinanceStore, { DashboardData, DashboardSummary } from '@/lib/stores/useFinanceStore';
import dynamic from 'next/dynamic';
import BankedPanel from './BankedPanel';
import ErrorState from '@/components/ui/ErrorState';
import { resolveFinanceSymbol } from './currency';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });
const ProductPnLTable = lazy(() => import('./ProductPnLTable'));
const CostEntryDrawer = lazy(() => import('./CostEntryDrawer'));
const TransactionLog = lazy(() => import('./TransactionLog'));

// ---- Summary Cards ----

interface CardDef {
  key: keyof DashboardSummary | '_netRevenue';
  tKey: string;
  subtKey?: string;
  icon: React.ReactNode;
  color: string;
  gradient: string;
  format: 'currency' | 'percent' | 'number';
  invertColor?: boolean;
  getValue?: (s: DashboardSummary) => number;
}

const CARDS: CardDef[] = [
  { key: 'grossRevenue', tKey: 'grossRevenue', subtKey: 'beforeReturns', icon: <Banknote size={20} />, color: '#6b7280', gradient: 'linear-gradient(135deg, #f9fafb, #f3f4f6)', format: 'currency' },
  { key: 'returns', tKey: 'returns', icon: <RotateCcw size={20} />, color: '#ef4444', gradient: 'linear-gradient(135deg, #fef2f2, #fecaca)', format: 'currency' },
  { key: '_netRevenue', tKey: 'netRevenue', getValue: (s) => s.grossRevenue - s.returns, icon: <TrendingUp size={20} />, color: '#10b981', gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', format: 'currency' },
  { key: 'commissions', tKey: 'commissions', icon: <Percent size={20} />, color: '#f59e0b', gradient: 'linear-gradient(135deg, #fffbeb, #fef3c7)', format: 'currency' },
  { key: 'adSpend', tKey: 'adSpend', icon: <Megaphone size={20} />, color: '#ec4899', gradient: 'linear-gradient(135deg, #fdf2f8, #fce7f3)', format: 'currency' },
  { key: 'shipping', tKey: 'shippingCosts', icon: <Truck size={20} />, color: '#3b82f6', gradient: 'linear-gradient(135deg, #eff6ff, #dbeafe)', format: 'currency' },
  { key: 'otherFees', tKey: 'otherFees', icon: <ReceiptText size={20} />, color: '#64748b', gradient: 'linear-gradient(135deg, #f8fafc, #e2e8f0)', format: 'currency' },
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

function SummaryCards({ summary, currencySymbol }: { summary: DashboardSummary; currencySymbol: string }) {
  const t = useTranslations('financials');
  return (
    <Grid container spacing={1.5} sx={{ mb: 2 }}>
      {CARDS.map(card => {
        const value = card.getValue ? card.getValue(summary) : ((summary[card.key as keyof DashboardSummary] as number) ?? 0);
        const isNegative = card.invertColor && value < 0;
        const cardColor = isNegative ? '#ef4444' : card.color;
        const cardGradient = isNegative ? 'linear-gradient(135deg, #fef2f2, #fecaca)' : card.gradient;

        return (
          <Grid item xs={6} sm={4} md key={card.key}>
            <Paper sx={{
              p: 1.5, borderRadius: '12px', border: '1px solid',
              borderColor: 'rgba(0,0,0,0.04)', transition: 'all 0.2s',
              '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' },
            }}>
              <Box sx={{ p: 1, borderRadius: '10px', background: cardGradient, width: 'fit-content', mb: 1 }}>
                <Box sx={{ color: cardColor }}>{card.icon}</Box>
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.1rem', color: cardColor }}>
                {formatCurrency(value, currencySymbol)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                {t(card.tKey)}
              </Typography>
              {card.subtKey && (
                <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem', display: 'block' }}>
                  {t(card.subtKey)}
                </Typography>
              )}
              {card.key === 'grossRevenue' && (summary.orderCount > 0 || (summary.totalOrderCount ?? 0) > 0) && (() => {
                // Prefer Order-table count over FinancialTransaction count — it
                // matches the labels page exactly. When the marketplace hasn't
                // settled some receipts yet, show "X (+Y bekliyor)" so the
                // delta is obvious instead of looking like a sync bug.
                const displayCount = summary.totalOrderCount ?? summary.orderCount;
                const pending = summary.pendingSettlementCount ?? 0;
                return (
                  <Chip
                    label={pending > 0
                      ? t('ordersWithPending', { count: displayCount, pending })
                      : `${displayCount} ${t('orders')}`}
                    size="small"
                    title={pending > 0
                      ? t('pendingSettlementTooltip', { settled: summary.orderCount, pending })
                      : undefined}
                    sx={{ mt: 0.5, height: 18, fontSize: '0.65rem', fontWeight: 700, bgcolor: pending > 0 ? '#fef3c7' : '#f3f4f6', color: pending > 0 ? '#92400e' : '#6b7280' }}
                  />
                );
              })()}
              {card.key === '_netRevenue' && summary.orderCount > 0 && (
                <Chip
                  label={`${Math.max(0, summary.orderCount - summary.returnCount)} ${t('orders')}`}
                  size="small"
                  sx={{ mt: 0.5, height: 18, fontSize: '0.65rem', fontWeight: 700, bgcolor: '#dcfce7', color: '#15803d' }}
                />
              )}
              {card.key === 'returns' && (summary.returnCount > 0 || (summary.pendingCancellationCount ?? 0) > 0) && (
                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                  {summary.returnCount > 0 && (
                    <Chip
                      label={`${summary.returnCount} ${t('refunds')}`}
                      size="small"
                      title={t('refundsSettledTooltip')}
                      sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, bgcolor: '#fecaca', color: '#dc2626' }}
                    />
                  )}
                  {(summary.pendingCancellationCount ?? 0) > 0 && (
                    <Chip
                      label={`+${summary.pendingCancellationCount} ${t('pendingSettlement')}`}
                      size="small"
                      title={t('cancellationsPendingTooltip')}
                      sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, bgcolor: '#fef3c7', color: '#92400e' }}
                    />
                  )}
                </Box>
              )}
              {card.key === 'netProfit' && (
                <Chip
                  label={`%${(summary.margin ?? 0).toFixed(1)}`}
                  size="small"
                  sx={{
                    mt: 0.5, height: 18, fontSize: '0.65rem', fontWeight: 700,
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

function ProfitCharts({ data, currencySymbol: cs }: { data: DashboardData; currencySymbol: string }) {
  const t = useTranslations('financials');
  const { timeSeries, summary } = data;

  const barOptions: ApexCharts.ApexOptions = {
    chart: { type: 'bar', height: 300, toolbar: { show: false }, fontFamily: 'Inter, sans-serif', stacked: true },
    colors: ['#10b981', '#f59e0b', '#ef4444'],
    plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: timeSeries.map(p => p.period), labels: { style: { fontSize: '10px' }, rotate: -45 } },
    yaxis: { labels: { formatter: (v: number) => `${cs}${Math.round(v)}` } },
    legend: { position: 'top' },
    tooltip: { y: { formatter: (v: number) => `${cs}${v.toFixed(2)}` } },
    grid: { borderColor: '#f1f5f9' },
  };

  const barSeries = [
    { name: t('revenue'), data: timeSeries.map(p => p.revenue) },
    { name: t('expenses'), data: timeSeries.map(p => p.commissions + p.shipping + p.returns + p.cogs) },
    { name: t('profit'), data: timeSeries.map(p => p.netProfit) },
  ];

  // Donut for cost breakdown — use summary values (works across all marketplaces)
  const costItems = [
    { label: t('commissions'), value: summary.commissions, color: '#f59e0b' },
    { label: t('adSpend'), value: summary.adSpend || 0, color: '#ec4899' },
    { label: t('otherFees'), value: summary.otherFees || 0, color: '#64748b' },
    { label: t('shippingCosts'), value: summary.shipping, color: '#3b82f6' },
    { label: t('returns'), value: summary.returns, color: '#ef4444' },
    { label: t('productCost'), value: summary.cogs, color: '#8b5cf6' },
  ].filter(item => item.value > 0);

  const donutLabels = costItems.map(item => item.label);
  const donutValues = costItems.map(item => item.value);
  const donutColors = costItems.map(item => item.color);
  const totalExpense = costItems.reduce((sum, item) => sum + item.value, 0);

  const donutOptions: ApexCharts.ApexOptions = {
    chart: { type: 'donut', height: 300, fontFamily: 'Inter, sans-serif' },
    labels: donutLabels.length > 0 ? donutLabels : [t('commissions')],
    colors: donutColors.length > 0 ? donutColors : ['#f59e0b'],
    legend: { position: 'bottom', fontSize: '12px' },
    dataLabels: { enabled: true, formatter: (val: number) => `%${val.toFixed(0)}` },
    plotOptions: { pie: { donut: { size: '60%', labels: { show: true, total: { show: true, label: t('totalExpense'), formatter: () => formatCurrency(totalExpense, cs) } } } } },
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

/** True when the period has no synced financial data at all (not just a quiet month with orders). */
function isEmptyPeriod(data: DashboardData): boolean {
  const { summary } = data;
  return (
    data.transactionTypeSummary.length === 0 &&
    data.timeSeries.length === 0 &&
    data.productBreakdown.length === 0 &&
    !summary.grossRevenue &&
    !(summary.totalOrderCount && summary.totalOrderCount > 0) &&
    !summary.banked &&
    summary.currentBalance == null
  );
}

function SyncPrompt() {
  const t = useTranslations('financials');
  const { syncSettlements, syncStatus } = useFinanceStore();
  const syncing = syncStatus === 'syncing';
  return (
    <Paper sx={{ p: { xs: 3, sm: 4 }, textAlign: 'center', borderRadius: '12px' }}>
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
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, maxWidth: 420, mx: 'auto' }}>
        {t('syncEmptyDescription')}
      </Typography>
      <Button
        variant="contained"
        disableElevation
        onClick={() => { void syncSettlements(); }}
        disabled={syncing}
        startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <RefreshCw size={16} />}
        sx={{
          minHeight: 44, px: 3, textTransform: 'none', fontWeight: 600, borderRadius: '10px',
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        }}
      >
        {syncing ? t('syncing') : t('syncData')}
      </Button>
    </Paper>
  );
}

export default function FinancialDashboard() {
  const t = useTranslations('financials');
  const { dashboardData, dashboardLoading, dashboardError, marketplace, fetchDashboard } = useFinanceStore();
  const [costDrawerOpen, setCostDrawerOpen] = useState(false);
  const [txLogOpen, setTxLogOpen] = useState(false);

  if (dashboardError && !dashboardData) {
    return (
      <Paper sx={{ borderRadius: '12px' }}>
        <ErrorState
          error={dashboardError}
          onRetry={() => fetchDashboard()}
          retrying={dashboardLoading}
        />
      </Paper>
    );
  }

  if (dashboardLoading && !dashboardData) {
    return (
      <Box>
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
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

  if (!dashboardData || isEmptyPeriod(dashboardData)) {
    return (
      <Box>
        <Box sx={{ height: 3, mb: 1 }}>
          {dashboardLoading && <LinearProgress sx={{ height: 3, borderRadius: 2 }} />}
        </Box>
        {/* A failed refresh must not masquerade as an empty period. */}
        {dashboardError != null && (
          <ErrorState
            compact
            title={t('refreshFailed')}
            error={dashboardError}
            onRetry={() => fetchDashboard()}
            retrying={dashboardLoading}
            className="mb-2"
          />
        )}
        <SyncPrompt />
      </Box>
    );
  }

  const { summary } = dashboardData;
  const currencySymbol = resolveFinanceSymbol(marketplace, dashboardData);

  return (
    <Box>
      {/* Thin progress bar while a new range loads; previous numbers stay visible (dimmed). */}
      <Box sx={{ height: 3, mb: 1 }}>
        {dashboardLoading && <LinearProgress sx={{ height: 3, borderRadius: 2 }} />}
      </Box>

      {dashboardError != null && (
        <ErrorState
          compact
          title={t('refreshFailed')}
          error={dashboardError}
          onRetry={() => fetchDashboard()}
          retrying={dashboardLoading}
          className="mb-2"
        />
      )}

      <Box
        aria-busy={dashboardLoading}
        sx={{ opacity: dashboardLoading || dashboardError != null ? 0.55 : 1, transition: 'opacity 0.2s' }}
      >
      {/* Summary Cards */}
      <SummaryCards summary={summary} currencySymbol={currencySymbol} />

      {/* Banked / payouts (Etsy) */}
      <BankedPanel data={dashboardData} marketplace={marketplace} />

      {/* Charts */}
      <ProfitCharts data={dashboardData} currencySymbol={currencySymbol} />

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
      </Box>

      {/* Cost Entry Drawer */}
      <Suspense fallback={null}>
        <CostEntryDrawer open={costDrawerOpen} onClose={() => setCostDrawerOpen(false)} />
      </Suspense>
    </Box>
  );
}
