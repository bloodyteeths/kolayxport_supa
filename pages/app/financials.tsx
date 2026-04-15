import React, { useEffect, useState } from 'react';
import {
  Box, Tabs, Tab, Button, TextField, Chip, CircularProgress,
  Typography, Paper, Tooltip,
} from '@mui/material';
import { RefreshCw, Calendar, Wallet, Store } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import useFinanceStore from '@/lib/stores/useFinanceStore';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';

const FinancialDashboard = dynamic(() => import('@/components/finance/FinancialDashboard'), { ssr: false });

const DATE_PRESETS = [
  { key: 'thisMonth', tKey: 'thisMonth', getRange: () => {
    const now = new Date();
    return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
  }},
  { key: 'lastMonth', tKey: 'lastMonth', getRange: () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  }},
  { key: 'last30', tKey: 'last30Days', getRange: () => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start: start.toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
  }},
  { key: 'last90', tKey: 'last90Days', getRange: () => {
    const now = new Date();
    const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { start: start.toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
  }},
];

const MARKETPLACE_TABS = [
  { key: 'trendyol' as const, label: 'Trendyol', icon: <Store size={16} />, color: '#F59E0B', enabled: true },
  { key: 'etsy' as const, label: 'Etsy', icon: <Store size={16} />, color: '#F97316', enabled: true },
  { key: 'ebay' as const, label: 'eBay', icon: <Store size={16} />, color: '#3B82F6', enabled: true },
  { key: 'amazon' as const, label: 'Amazon', icon: <Store size={16} />, color: '#FF9900', enabled: true },
];

function FinancialsPage() {
  const t = useTranslations('financials');
  const {
    marketplace, dateRange, syncStatus, syncMessage,
    setMarketplace, setDateRange, syncSettlements, fetchDashboard,
  } = useFinanceStore();

  const [activePreset, setActivePreset] = useState('thisMonth');
  const [customStart, setCustomStart] = useState(dateRange.start);
  const [customEnd, setCustomEnd] = useState(dateRange.end);

  useEffect(() => {
    fetchDashboard();
  }, [marketplace, dateRange]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (syncStatus === 'done' && syncMessage) toast.success(`${syncMessage} ${t('synchronized')}`);
    if (syncStatus === 'error' && syncMessage) toast.error(`${t('syncError')}: ${syncMessage}`);
  }, [syncStatus, syncMessage]);

  const handlePreset = (key: string) => {
    const preset = DATE_PRESETS.find(p => p.key === key);
    if (preset) {
      const range = preset.getRange();
      setActivePreset(key);
      setCustomStart(range.start);
      setCustomEnd(range.end);
      setDateRange(range);
    }
  };

  const handleCustomRange = () => {
    setActivePreset('custom');
    setDateRange({ start: customStart, end: customEnd });
  };

  return (
    <AppLayout title={t('pageTitle')}>
      <Toaster position="top-right" />
      <Box sx={{ p: { xs: 0.5, sm: 1, md: 1.5 }, maxWidth: 1400, mx: 'auto' }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Box sx={{
            p: 1.5, borderRadius: '14px',
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Wallet size={24} color="#fff" />
          </Box>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
              {t('pageTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('subtitle')}
            </Typography>
          </Box>
        </Box>

        {/* Marketplace Tabs */}
        <Paper sx={{ mb: 2, borderRadius: '12px', overflow: 'hidden' }}>
          <Tabs
            value={MARKETPLACE_TABS.findIndex(mt => mt.key === marketplace)}
            onChange={(_, idx) => {
              const tab = MARKETPLACE_TABS[idx];
              if (tab.enabled) setMarketplace(tab.key);
            }}
            sx={{
              '& .MuiTab-root': { minHeight: 48, textTransform: 'none', fontWeight: 600 },
              '& .Mui-selected': { color: MARKETPLACE_TABS.find(mt => mt.key === marketplace)?.color },
            }}
          >
            {MARKETPLACE_TABS.map(tab => (
              <Tab
                key={tab.key}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    {tab.icon}
                    <span>{tab.label}</span>
                    {!tab.enabled && (
                      <Chip label={t('comingSoon')} size="small" sx={{ height: 20, fontSize: '0.65rem', ml: 0.5 }} />
                    )}
                  </Box>
                }
                disabled={!tab.enabled}
              />
            ))}
          </Tabs>
        </Paper>

        {/* Date Range Bar */}
        <Paper sx={{ p: 1.5, mb: 2, borderRadius: '12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          <Calendar size={18} color="#6b7280" />

          {DATE_PRESETS.map(preset => (
            <Chip
              key={preset.key}
              label={t(preset.tKey)}
              size="small"
              variant={activePreset === preset.key ? 'filled' : 'outlined'}
              color={activePreset === preset.key ? 'primary' : 'default'}
              onClick={() => handlePreset(preset.key)}
              sx={{ fontWeight: activePreset === preset.key ? 700 : 500 }}
            />
          ))}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto' }}>
            <TextField type="date" size="small" value={customStart} onChange={e => setCustomStart(e.target.value)} sx={{ width: 140, '& input': { fontSize: '0.8rem' } }} />
            <Typography variant="body2" color="text.secondary">—</Typography>
            <TextField type="date" size="small" value={customEnd} onChange={e => setCustomEnd(e.target.value)} sx={{ width: 140, '& input': { fontSize: '0.8rem' } }} />
            <Button size="small" variant="outlined" onClick={handleCustomRange} sx={{ minWidth: 'auto', px: 1.5 }}>
              {t('apply')}
            </Button>
          </Box>

          <Tooltip title={t('syncTooltip')}>
            <Button
              size="small" variant="contained"
              onClick={() => syncSettlements()}
              disabled={syncStatus === 'syncing'}
              startIcon={syncStatus === 'syncing' ? <CircularProgress size={16} /> : <RefreshCw size={16} />}
              sx={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', borderRadius: '10px', textTransform: 'none', fontWeight: 600 }}
            >
              {syncStatus === 'syncing' ? t('syncing') : t('syncData')}
            </Button>
          </Tooltip>
        </Paper>

        <FinancialDashboard />
      </Box>
    </AppLayout>
  );
}

export default withAuth(FinancialsPage);
