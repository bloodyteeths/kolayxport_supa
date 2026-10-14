import React, { useCallback } from 'react';
import useSWR from 'swr';
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  List, ListItem, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import { useLocale, useTranslations } from 'next-intl';
import ErrorState from '@/components/ui/ErrorState';
import { notify } from '@/lib/notify';
import { useLiveRevalidate } from '@/components/live/useLiveEvent';
import { stockErrorKey, stockFetch, swrStockFetcher, type StockItemView, type TimelineEntryView } from './stockClient';
import { channelLabel, fmtTime } from './labels';

export type StockTimelineProps = {
  stockItemId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

const TONE_ICON = {
  success: <CheckCircleRoundedIcon fontSize="small" color="success" />,
  error: <ErrorRoundedIcon fontSize="small" color="error" />,
  warning: <WarningAmberRoundedIcon fontSize="small" color="warning" />,
  neutral: <RadioButtonUncheckedRoundedIcon fontSize="small" sx={{ color: 'text.disabled' }} />,
};

/** "Bu sayı neden?" — plain-language history of one product's stock. */
export default function StockTimeline({ stockItemId, open, onClose, onChanged }: StockTimelineProps) {
  const t = useTranslations('stockSync');
  const locale = useLocale();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const key = open && stockItemId ? `/api/stock/items/${encodeURIComponent(stockItemId)}/timeline?limit=100` : null;
  const { data, error, isLoading, mutate } = useSWR<{ item: StockItemView; entries: TimelineEntryView[] }>(key, swrStockFetcher);
  useLiveRevalidate(['stock.changed', 'stock.alert'], key ? () => mutate() : null);

  const adopt = useCallback(
    async (observationId: string) => {
      try {
        await stockFetch('/api/stock/links', { method: 'POST', body: { action: 'adopt_remote', observationId } });
        notify.success(t('timeline.adopted'));
        await mutate();
        onChanged?.();
      } catch (err) {
        notify.error(err, t(stockErrorKey(err)));
      }
    },
    [mutate, onChanged, t],
  );

  const text = (e: TimelineEntryView) => {
    const params: Record<string, string | number> = { ...e.params };
    if (typeof params.channel === 'string') params.channel = channelLabel(t as any, params.channel);
    const k = `timeline.entries.${e.kind}`;
    return (t as any).has && !(t as any).has(k) ? e.kind : t(k, params);
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" sx={{ zIndex: 1500 }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="div" noWrap>
            {t('timeline.title')}
          </Typography>
          {data?.item && (
            <Typography variant="body2" color="text.secondary" noWrap>
              {data.item.displaySku} · {t('items.onHand')}: {data.item.onHand}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label={t('common.close')}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 1, sm: 2 } }}>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {error && <ErrorState error={error} onRetry={() => mutate()} compact />}
        {data && data.entries.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            {t('timeline.empty')}
          </Typography>
        )}
        {data && data.entries.length > 0 && (
          <List dense disablePadding>
            {data.entries.map((e) => (
              <ListItem key={e.id} disableGutters sx={{ alignItems: 'flex-start', gap: 1, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ pt: '2px' }}>{TONE_ICON[e.tone] ?? TONE_ICON.neutral}</Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                    {text(e)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {fmtTime(e.at, locale)}
                  </Typography>
                  {e.adoptObservationId && (
                    <Box sx={{ mt: 0.5 }}>
                      <Button size="small" variant="outlined" onClick={() => adopt(e.adoptObservationId!)}>
                        {t('timeline.adopt')}
                      </Button>
                    </Box>
                  )}
                </Box>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
