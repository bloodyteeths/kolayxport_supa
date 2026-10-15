import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Tabs, Tab, Button, TextField, Chip, CircularProgress,
  Typography, Paper, Tooltip,
} from '@mui/material';
import { RefreshCw, Calendar, Store } from 'lucide-react';
import { Page, PageHeader } from '@/components/ds/page';
import withAuth from '@/components/withAuth';
import useFinanceStore from '@/lib/stores/useFinanceStore';
import { useTranslations } from 'next-intl';
import { useConnections } from '@/lib/hooks/useConnections';
import ConnectEmptyState from '@/components/ui/ConnectEmptyState';
import { notify } from '@/lib/notify';
import dynamic from 'next/dynamic';

const FinancialDashboard = dynamic(() => import('@/components/finance/FinancialDashboard'), { ssr: false });

// Local-date YYYY-MM-DD formatter. Critical: do NOT use .toISOString().split('T')[0],
// because the Date constructor for (year, month, day) builds a LOCAL midnight,
// and toISOString converts to UTC — which silently shifts the day for any user
// east of UTC. Istanbul (UTC+3) used to get "Bu Ay" starting on the last day
// of the previous month.
const toLocalDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const DATE_PRESETS = [
  { key: 'thisMonth', tKey: 'thisMonth', getRange: () => {
    const now = new Date();
    return { start: toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), end: toLocalDateStr(now) };
  }},
  { key: 'lastMonth', tKey: 'lastMonth', getRange: () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: toLocalDateStr(start), end: toLocalDateStr(end) };
  }},
  { key: 'last30', tKey: 'last30Days', getRange: () => {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start: toLocalDateStr(start), end: toLocalDateStr(now) };
  }},
  { key: 'last90', tKey: 'last90Days', getRange: () => {
    const now = new Date();
    const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { start: toLocalDateStr(start), end: toLocalDateStr(now) };
  }},
];

const MARKETPLACE_TABS = [
  { key: 'trendyol' as const, label: 'Trendyol', icon: <Store size={16} />, color: '#F59E0B' },
  { key: 'etsy' as const, label: 'Etsy', icon: <Store size={16} />, color: '#F97316' },
  { key: 'ebay' as const, label: 'eBay', icon: <Store size={16} />, color: '#3B82F6' },
  { key: 'amazon' as const, label: 'Amazon', icon: <Store size={16} />, color: '#FF9900' },
];

function FinancialsPage() {
  const t = useTranslations('financials');
  const tNav = useTranslations('nav.items');
  const {
    marketplace, dateRange, syncStatus, syncMessage, syncError,
    setMarketplace, setDateRange, syncSettlements, fetchDashboard,
  } = useFinanceStore();
  const { connections, has, isLoading: connectionsLoading } = useConnections();

  const [activePreset, setActivePreset] = useState('thisMonth');
  const [customStart, setCustomStart] = useState(dateRange.start);
  const [customEnd, setCustomEnd] = useState(dateRange.end);
  // Becomes true once the initial tab has been chosen from the user's connections
  // (or connections failed to load and we fall back to the stored tab).
  const [tabResolved, setTabResolved] = useState(false);

  // undefined = unknown (loading / status endpoint failed), see useConnections.
  const currentConnected = has(marketplace);
  const firstConnected = useMemo(
    () => (connections ? MARKETPLACE_TABS.find(tab => connections[tab.key]?.connected)?.key : undefined),
    [connections],
  );

  // Open on the first connected marketplace instead of always Trendyol. Runs
  // once per visit, so a user who then clicks an unconnected tab to see the
  // connect CTA isn't bounced back.
  useEffect(() => {
    if (tabResolved) return;
    if (connections) {
      if (!connections[marketplace]?.connected && firstConnected) setMarketplace(firstConnected);
      setTabResolved(true);
    } else if (!connectionsLoading) {
      // Status endpoint errored: keep the stored tab and load it.
      setTabResolved(true);
    }
  }, [connections, connectionsLoading, firstConnected, marketplace, setMarketplace, tabResolved]);

  useEffect(() => {
    if (!tabResolved || currentConnected === false) return;
    fetchDashboard();
  }, [marketplace, dateRange, tabResolved, currentConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toast only on a status transition — the store outlives this page, so a
  // finished sync must not re-toast every time the page is reopened.
  const prevSyncStatus = useRef(syncStatus);
  useEffect(() => {
    if (prevSyncStatus.current === syncStatus) return;
    prevSyncStatus.current = syncStatus;
    if (syncStatus === 'done') notify.success(t('syncedCount', { count: Number(syncMessage) || 0 }));
    if (syncStatus === 'error') notify.error(syncError, 'financials.syncError');
  }, [syncStatus, syncMessage, syncError]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTab = MARKETPLACE_TABS.find(mt => mt.key === marketplace) ?? MARKETPLACE_TABS[0];

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
    <Page title={tNav('finance')} width="detail">
      <PageHeader title={tNav('finance')} subtitle={t('subtitle')} />
      <Box>

        {/* Marketplace Tabs */}
        <Paper sx={{ mb: 2, borderRadius: '12px', overflow: 'hidden' }}>
          <Tabs
            value={MARKETPLACE_TABS.findIndex(mt => mt.key === marketplace)}
            onChange={(_, idx) => {
              const tab = MARKETPLACE_TABS[idx];
              if (tab && tab.key !== marketplace) setMarketplace(tab.key);
            }}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              '& .MuiTab-root': { minHeight: 48, textTransform: 'none', fontWeight: 600 },
              '& .Mui-selected': { color: activeTab.color },
            }}
          >
            {MARKETPLACE_TABS.map(tab => {
              // Only mark as unconnected once we definitely know (never on a loading/errored status).
              const notConnected = connections ? !connections[tab.key]?.connected : false;
              return (
                <Tab
                  key={tab.key}
                  sx={notConnected ? { opacity: 0.6 } : undefined}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      {tab.icon}
                      <span>{tab.label}</span>
                      {notConnected && (
                        <Chip label={t('notConnected')} size="small" sx={{ height: 20, fontSize: '0.65rem', ml: 0.5 }} />
                      )}
                    </Box>
                  }
                />
              );
            })}
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

          <Tooltip title={t('syncTooltipMarketplace', { marketplace: activeTab.label })}>
            <span>
            <Button
              size="small" variant="contained"
              onClick={() => syncSettlements()}
              disabled={syncStatus === 'syncing' || currentConnected === false}
              startIcon={syncStatus === 'syncing' ? <CircularProgress size={16} /> : <RefreshCw size={16} />}
              sx={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', borderRadius: '10px', textTransform: 'none', fontWeight: 600 }}
            >
              {syncStatus === 'syncing' ? t('syncing') : t('syncData')}
            </Button>
            </span>
          </Tooltip>
        </Paper>

        {currentConnected === false ? (
          <Paper sx={{ borderRadius: '12px' }}>
            <ConnectEmptyState provider={marketplace} description={t('connectToSeeFinancials', { marketplace: activeTab.label })} />
          </Paper>
        ) : tabResolved ? (
          <FinancialDashboard />
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress size={28} />
          </Box>
        )}
      </Box>
    </Page>
  );
}

export default withAuth(FinancialsPage);
