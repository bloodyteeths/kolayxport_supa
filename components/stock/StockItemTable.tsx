import React, { useState } from 'react';
import {
  Avatar, Box, Button, Chip, Collapse, IconButton, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import { useTranslations } from 'next-intl';
import StockLinkList from './StockLinkList';
import { channelLabel, CHANNEL_COLORS } from './labels';
import type { StockItemView } from './stockClient';

export type StockItemTableProps = {
  items: StockItemView[];
  onAdjust: (item: StockItemView) => void;
  onTimeline: (item: StockItemView) => void;
  onChanged: () => void;
};

/** md+ only: plain MUI table (no DataGrid) with expandable link rows. */
export default function StockItemTable({ items, onAdjust, onTimeline, onChanged }: StockItemTableProps) {
  const t = useTranslations('stockSync');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell width={40} />
            <TableCell>{t('items.product')}</TableCell>
            <TableCell>{t('items.links')}</TableCell>
            <TableCell align="right">{t('items.onHand')}</TableCell>
            <TableCell align="right">{t('items.safetyBuffer')}</TableCell>
            <TableCell align="right" />
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => {
            const isOpen = !!open[item.id];
            const channels = Array.from(new Set(item.links.map((l) => l.channel)));
            return (
              <React.Fragment key={item.id}>
                <TableRow hover sx={{ '& > td': { borderBottom: isOpen ? 'none' : undefined } }}>
                  <TableCell>
                    <IconButton size="small" onClick={() => setOpen((o) => ({ ...o, [item.id]: !isOpen }))} aria-expanded={isOpen}>
                      <KeyboardArrowDownRoundedIcon sx={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                    </IconButton>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 380 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                      <Avatar variant="rounded" src={item.imageUrl || undefined} sx={{ width: 36, height: 36, bgcolor: 'grey.100', color: 'text.secondary', fontSize: 12 }}>
                        {item.displaySku.slice(0, 2)}
                      </Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {item.displaySku}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap component="div">
                          {item.title}
                        </Typography>
                      </Box>
                      {item.status !== 'active' && (
                        <Chip size="small" color={item.status === 'needs_review' ? 'warning' : 'default'} label={t(`items.statusLabels.${item.status}` as any)} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {channels.map((ch) => (
                        <Chip key={ch} size="small" label={channelLabel(t as any, ch)} sx={{ bgcolor: CHANNEL_COLORS[ch] || 'grey.300', color: '#fff', height: 22 }} />
                      ))}
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: item.onHand <= 0 ? 'error.main' : undefined }}>
                    {item.status === 'needs_review' && !item.seededAt ? '?' : item.onHand}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {item.safetyBuffer}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" onClick={() => onAdjust(item)}>
                      {item.status === 'needs_review' && !item.seededAt ? t('items.enterCount') : t('items.adjust')}
                    </Button>
                    <Button size="small" onClick={() => onTimeline(item)}>
                      {t('items.why')}
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 0 }}>
                    <Collapse in={isOpen} unmountOnExit>
                      <Box sx={{ py: 1, pl: 6, pr: 1 }}>
                        {item.lastError && (
                          <Typography variant="caption" color="error.main" component="div" sx={{ mb: 1 }}>
                            {t('items.lastError', { error: item.lastError.slice(0, 160) })}
                          </Typography>
                        )}
                        <StockLinkList links={item.links} onChanged={onChanged} dense />
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
