import React from 'react';
import { Alert, Box, Chip, Paper, Stack, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import type { PreviewResponse } from './stockClient';
import { channelLabel, CHANNEL_COLORS } from './labels';

export type StockPreviewPanelProps = {
  preview: PreviewResponse;
  /** show only links that change (default true) */
  changesOnly?: boolean;
  maxRows?: number;
};

/** What Go Live would send, per product and channel, plus the risk totals. */
export default function StockPreviewPanel({ preview, changesOnly = true, maxRows = 200 }: StockPreviewPanelProps) {
  const t = useTranslations('stockSync');
  const { totals } = preview;
  const rows = preview.items.flatMap((it) =>
    it.links.filter((l) => !changesOnly || l.effect !== 'none').map((l) => ({ it, l })),
  );

  const chips: Array<{ key: string; label: string; color: 'default' | 'warning' | 'error' | 'info' }> = [
    { key: 'pushes', label: t('preview.totals.pushes', { count: totals.pushes }), color: 'info' },
  ];
  if (totals.deactivations) chips.push({ key: 'deact', label: t('preview.totals.deactivations', { count: totals.deactivations }), color: 'error' });
  if (totals.disabledVariations) chips.push({ key: 'dis', label: t('preview.totals.disabledVariations', { count: totals.disabledVariations }), color: 'warning' });
  if (totals.bigDrops) chips.push({ key: 'drop', label: t('preview.totals.bigDrops', { count: totals.bigDrops }), color: 'warning' });
  if (totals.needsReview) chips.push({ key: 'rev', label: t('preview.totals.needsReview', { count: totals.needsReview }), color: 'warning' });
  if (totals.cappedLinks) chips.push({ key: 'cap', label: t('preview.totals.capped', { count: totals.cappedLinks }), color: 'default' });

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {chips.map((c) => (
          <Chip key={c.key} size="small" color={c.color} label={c.label} variant={c.color === 'default' ? 'outlined' : 'filled'} />
        ))}
      </Box>
      {Object.keys(preview.oversellWindowMinutes || {}).length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {Object.entries(preview.oversellWindowMinutes).map(([ch, min]) => (
            <Chip key={ch} size="small" variant="outlined" label={`${channelLabel(t as any, ch)}: ${t('wizard.oversellWindow', { minutes: min })}`} />
          ))}
        </Box>
      )}
      {rows.length === 0 ? (
        <Alert severity="success">{t('preview.noChanges')}</Alert>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 2, maxHeight: { xs: 'none', sm: 420 }, overflow: 'auto' }}>
          {rows.slice(0, maxRows).map(({ it, l }) => (
            <Box key={l.linkId} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', minWidth: 0 }}>
              <Chip size="small" label={channelLabel(t as any, l.channel)} sx={{ bgcolor: CHANNEL_COLORS[l.channel] || 'grey.300', color: '#fff', flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {it.sku}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {l.title || l.remoteSku || l.externalId} · {t(`preview.remoteSource.${l.remoteSource}` as any)}
                </Typography>
              </Box>
              <Typography
                variant="body2"
                sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: l.effect === 'deactivate' ? 'error.main' : l.bigDrop || l.effect === 'disable_variation' ? 'warning.main' : 'text.primary' }}
              >
                {l.effect === 'set'
                  ? t('preview.effect.set', { from: l.remote ?? '?', to: l.wouldSend ?? l.target })
                  : t(`preview.effect.${l.effect}` as any)}
              </Typography>
            </Box>
          ))}
        </Paper>
      )}
    </Stack>
  );
}
