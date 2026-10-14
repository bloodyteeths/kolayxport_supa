import React, { useState } from 'react';
import { Avatar, Box, Button, Chip, Collapse, Paper, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { useTranslations } from 'next-intl';
import StockLinkList from './StockLinkList';
import { channelLabel, CHANNEL_COLORS } from './labels';
import type { StockItemView } from './stockClient';

export type StockItemCardProps = {
  item: StockItemView;
  onAdjust: (item: StockItemView) => void;
  onTimeline: (item: StockItemView) => void;
  onChanged: () => void;
};

const STATUS_COLOR: Record<string, 'success' | 'default' | 'warning'> = { active: 'success', paused: 'default', needs_review: 'warning' };

/** Mobile: expandable product card (collapsed = SKU, stock, channel dots). */
export default function StockItemCard({ item, onAdjust, onTimeline, onChanged }: StockItemCardProps) {
  const t = useTranslations('stockSync');
  const [open, setOpen] = useState(false);
  const channels = Array.from(new Set(item.links.map((l) => l.channel)));
  const mismatch = item.links.some((l) => l.status === 'active' && l.lastSeenRemoteQty !== null && l.lastSeenRemoteQty !== l.target);

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Box
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen((v) => !v)}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5, cursor: 'pointer', minWidth: 0 }}
      >
        <Avatar variant="rounded" src={item.imageUrl || undefined} sx={{ width: 44, height: 44, bgcolor: 'grey.100', color: 'text.secondary', fontSize: 14 }}>
          {item.displaySku.slice(0, 2)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            {item.displaySku}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {item.title || ' '}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {item.status !== 'active' && <Chip size="small" color={STATUS_COLOR[item.status] || 'default'} label={t(`items.statusLabels.${item.status}` as any)} sx={{ height: 20 }} />}
            {channels.map((ch) => (
              <Box key={ch} title={channelLabel(t as any, ch)} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: CHANNEL_COLORS[ch] || 'grey.400' }} />
            ))}
            {item.openPushes > 0 && (
              <Typography variant="caption" color="text.secondary">
                {t('items.openPushes', { count: item.openPushes })}
              </Typography>
            )}
          </Box>
        </Box>
        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
          <Typography variant="h6" lineHeight={1.1} color={item.onHand <= 0 ? 'error.main' : mismatch ? 'warning.main' : 'text.primary'} sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {item.status === 'needs_review' && !item.seededAt ? '?' : item.onHand}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('items.onHand')}
          </Typography>
        </Box>
        <ExpandMoreRoundedIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: 'text.secondary' }} />
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          {item.lastError && (
            <Typography variant="caption" color="error.main" component="div" sx={{ mb: 1, wordBreak: 'break-word' }}>
              {t('items.lastError', { error: item.lastError.slice(0, 120) })}
            </Typography>
          )}
          <StockLinkList links={item.links} onChanged={onChanged} />
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
            <Button size="small" variant={item.status === 'needs_review' ? 'contained' : 'outlined'} startIcon={<EditRoundedIcon />} onClick={() => onAdjust(item)}>
              {item.status === 'needs_review' && !item.seededAt ? t('items.enterCount') : t('items.adjust')}
            </Button>
            <Button size="small" startIcon={<HistoryRoundedIcon />} onClick={() => onTimeline(item)}>
              {t('items.why')}
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}
