import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Box, Chip, CircularProgress, InputAdornment, Stack, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import { useTranslations } from 'next-intl';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import ErrorState from '@/components/ui/ErrorState';
import { useLiveRevalidate } from '@/components/live/useLiveEvent';
import StockSettingsCard from '@/components/stock/StockSettingsCard';
import StockSetupWizard from '@/components/stock/StockSetupWizard';
import StockItemCard from '@/components/stock/StockItemCard';
import StockItemTable from '@/components/stock/StockItemTable';
import StockTimeline from '@/components/stock/StockTimeline';
import StockAdjustDialog from '@/components/stock/StockAdjustDialog';
import GoLiveDialog from '@/components/stock/GoLiveDialog';
import { swrStockFetcher, type SettingsResponse, type StockItemView } from '@/components/stock/stockClient';

const FILTERS = ['all', 'active', 'needs_review', 'paused'] as const;

/**
 * /app/stok-senkron — cross-marketplace stock sync (W2).
 * Ships disabled: the seller runs the wizard, reviews the dry run and
 * presses Go Live. Updates live on stock events (no manual refresh).
 */
function StockSyncPage() {
  const t = useTranslations('stockSync');
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const [timelineFor, setTimelineFor] = useState<StockItemView | null>(null);
  const [adjustFor, setAdjustFor] = useState<StockItemView | null>(null);

  const settings = useSWR<SettingsResponse>('/api/stock/settings', swrStockFetcher);
  const itemsKey = `/api/stock/items?limit=1000${filter !== 'all' ? `&status=${filter}` : ''}`;
  const items = useSWR<{ items: StockItemView[]; total: number }>(itemsKey, swrStockFetcher, { keepPreviousData: true });

  // Live: any stock event revalidates both lists (no manual refresh anywhere).
  useLiveRevalidate(['stock.changed', 'stock.alert'], '/api/stock/');

  const refresh = () => {
    void settings.mutate();
    void items.mutate();
  };

  const visible = useMemo(() => {
    const term = q.trim().toLocaleLowerCase();
    const list = items.data?.items || [];
    if (!term) return list;
    return list.filter((i) => i.displaySku.toLocaleLowerCase().includes(term) || (i.title || '').toLocaleLowerCase().includes(term));
  }, [items.data, q]);

  return (
    <AppLayout title={t('pageTitle')}>
      <Box sx={{ p: { xs: 0.5, sm: 1, md: 1.5 }, maxWidth: 1200, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Box sx={{ p: 1.25, borderRadius: '14px', background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', display: 'flex' }}>
            <Inventory2RoundedIcon sx={{ color: '#fff' }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" fontWeight={700} sx={{ fontSize: { xs: '1.2rem', sm: '1.5rem' } }}>
              {t('pageTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('pageSubtitle')}
            </Typography>
          </Box>
        </Box>

        {settings.error && <ErrorState error={settings.error} onRetry={() => settings.mutate()} />}
        {!settings.data && !settings.error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {settings.data && (
          <Stack spacing={2}>
            <StockSettingsCard data={settings.data} onChanged={refresh} onOpenWizard={() => setWizardOpen(true)} onGoLive={() => setGoLiveOpen(true)} />

            <Box>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                {t('items.title')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
                <TextField
                  size="small"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('items.search')}
                  sx={{ flex: '1 1 220px', minWidth: 0 }}
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
                />
                <Box sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', maxWidth: '100%' }}>
                  {FILTERS.map((f) => (
                    <Chip key={f} label={t(`items.filter.${f}`)} color={filter === f ? 'primary' : 'default'} variant={filter === f ? 'filled' : 'outlined'} onClick={() => setFilter(f)} />
                  ))}
                </Box>
              </Box>

              {items.error && <ErrorState error={items.error} onRetry={() => items.mutate()} compact />}
              {!items.data && !items.error && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress size={28} />
                </Box>
              )}
              {items.data && visible.length === 0 && (
                <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                  {t('items.empty')}
                </Typography>
              )}
              {items.data && visible.length > 0 &&
                (isDesktop ? (
                  <StockItemTable items={visible} onAdjust={setAdjustFor} onTimeline={setTimelineFor} onChanged={refresh} />
                ) : (
                  <Stack spacing={1}>
                    {visible.map((it) => (
                      <StockItemCard key={it.id} item={it} onAdjust={setAdjustFor} onTimeline={setTimelineFor} onChanged={refresh} />
                    ))}
                  </Stack>
                ))}
            </Box>
          </Stack>
        )}
      </Box>

      <StockSetupWizard open={wizardOpen} onClose={() => { setWizardOpen(false); refresh(); }} settings={settings.data} onChanged={refresh} />
      <GoLiveDialog open={goLiveOpen} onClose={() => setGoLiveOpen(false)} onDone={refresh} />
      <StockTimeline stockItemId={timelineFor?.id ?? null} open={!!timelineFor} onClose={() => setTimelineFor(null)} onChanged={refresh} />
      <StockAdjustDialog item={adjustFor} open={!!adjustFor} onClose={() => setAdjustFor(null)} onSaved={refresh} />
    </AppLayout>
  );
}

export default withAuth(StockSyncPage);
