import React, { useState } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ListItemText, Menu, MenuItem,
  Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { useTranslations } from 'next-intl';
import { notify } from '@/lib/notify';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { stockErrorKey, stockFetch, type StockLinkView } from './stockClient';
import { channelLabel, linkReasonLabel, CHANNEL_COLORS } from './labels';

export type StockLinkListProps = {
  links: StockLinkView[];
  onChanged: () => void;
  dense?: boolean;
};

const STATUS_COLOR: Record<string, 'success' | 'default' | 'warning' | 'error' | 'info'> = {
  active: 'success',
  paused: 'default',
  suggested: 'info',
  error: 'error',
  unsupported: 'warning',
};

/** Per-channel rows of a product: remote → target, status and actions. Used by cards and the table. */
export default function StockLinkList({ links, onChanged, dense }: StockLinkListProps) {
  const t = useTranslations('stockSync');
  const confirm = useConfirm();
  const [menu, setMenu] = useState<{ el: HTMLElement; link: StockLinkView } | null>(null);
  const [settingsFor, setSettingsFor] = useState<StockLinkView | null>(null);

  const act = async (link: StockLinkView, action: string, extra: Record<string, unknown> = {}) => {
    setMenu(null);
    if (action === 'unlink') {
      const ok = await confirm({ title: t('link.unlink'), description: t('link.unlinkConfirm'), destructive: true });
      if (!ok) return;
    }
    try {
      await stockFetch('/api/stock/links', { method: 'POST', body: { action, linkId: link.id, ...extra } });
      onChanged();
    } catch (err) {
      notify.error(err, t(stockErrorKey(err)));
    }
  };

  if (!links.length) return null;
  return (
    <Box>
      {links.map((l) => {
        const reason = linkReasonLabel(t as any, l.statusReason);
        const remote = l.lastSeenRemoteQty;
        return (
          <Box
            key={l.id}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, py: dense ? 0.5 : 0.75, borderTop: '1px solid', borderColor: 'divider', minWidth: 0 }}
          >
            <Chip
              size="small"
              label={channelLabel(t as any, l.channel)}
              sx={{ bgcolor: CHANNEL_COLORS[l.channel] || 'grey.300', color: '#fff', fontWeight: 600, flexShrink: 0 }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap title={l.title || l.remoteSku || l.externalId}>
                {l.title || l.remoteSku || l.externalId}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                {l.status !== 'active' && <Chip size="small" variant="outlined" color={STATUS_COLOR[l.status] || 'default'} label={t(`link.statusLabels.${l.status}` as any)} sx={{ height: 20 }} />}
                {reason && (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {reason}
                  </Typography>
                )}
                {l.deactivatedByStock && (
                  <Typography variant="caption" color="warning.main" noWrap>
                    {t('link.deactivatedByStock')}
                  </Typography>
                )}
              </Box>
            </Box>
            <Tooltip title={`${t('link.remote')} → ${t('link.target')}`} slotProps={{ popper: { sx: { zIndex: 1600 } } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                <Typography variant="body2" color={remote === null ? 'text.disabled' : remote !== l.target ? 'warning.main' : 'text.primary'}>
                  {remote === null ? '?' : remote}
                </Typography>
                <ArrowForwardRoundedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                <Typography variant="body2" fontWeight={600}>
                  {l.target}
                </Typography>
              </Box>
            </Tooltip>
            <IconButton size="small" onClick={(e) => setMenu({ el: e.currentTarget, link: l })} aria-label={t('link.settings')}>
              <MoreVertRoundedIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      })}

      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)} sx={{ zIndex: 1600 }}>
        {menu?.link.status === 'suggested' && (
          <MenuItem onClick={() => act(menu.link, 'accept')}>
            <ListItemText>{t('link.accept')}</ListItemText>
          </MenuItem>
        )}
        {menu?.link.status === 'active' && (
          <MenuItem onClick={() => act(menu.link, 'pause')}>
            <ListItemText>{t('link.pause')}</ListItemText>
          </MenuItem>
        )}
        {(menu?.link.status === 'paused' || menu?.link.status === 'error') && (
          <MenuItem onClick={() => act(menu.link, 'resume')}>
            <ListItemText>{t('link.resume')}</ListItemText>
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setSettingsFor(menu!.link);
            setMenu(null);
          }}
        >
          <ListItemText>{t('link.settings')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => act(menu!.link, 'unlink')} sx={{ color: 'error.main' }}>
          <ListItemText>{t('link.unlink')}</ListItemText>
        </MenuItem>
      </Menu>

      <LinkSettingsDialog link={settingsFor} onClose={() => setSettingsFor(null)} onSaved={onChanged} />
    </Box>
  );
}

function LinkSettingsDialog({ link, onClose, onSaved }: { link: StockLinkView | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('stockSync');
  const [units, setUnits] = useState('1');
  const [buffer, setBuffer] = useState('0');
  const [max, setMax] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (link) {
      setUnits(String(link.unitsPerSale));
      setBuffer(String(link.buffer));
      setMax(link.maxListedQty === null ? '' : String(link.maxListedQty));
    }
  }, [link]);

  const save = async () => {
    if (!link) return;
    setSaving(true);
    try {
      if (Number(units) !== link.unitsPerSale) await stockFetch('/api/stock/links', { method: 'POST', body: { action: 'set_units', linkId: link.id, value: Number(units) } });
      if (Number(buffer) !== link.buffer) await stockFetch('/api/stock/links', { method: 'POST', body: { action: 'set_buffer', linkId: link.id, value: Number(buffer) } });
      const nextMax = max.trim() === '' ? null : Number(max);
      if (nextMax !== link.maxListedQty) await stockFetch('/api/stock/links', { method: 'POST', body: { action: 'set_max', linkId: link.id, value: nextMax } });
      onSaved();
      onClose();
    } catch (err) {
      notify.error(err, t(stockErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!link} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs" sx={{ zIndex: 1550 }}>
      <DialogTitle>{t('link.settings')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField type="number" label={t('link.unitsPerSale')} value={units} onChange={(e) => setUnits(e.target.value)} inputProps={{ min: 1, max: 1000 }} />
          <TextField type="number" label={t('link.buffer')} value={buffer} onChange={(e) => setBuffer(e.target.value)} inputProps={{ min: 0 }} />
          <TextField type="number" label={t('link.maxListed')} value={max} onChange={(e) => setMax(e.target.value)} inputProps={{ min: 0 }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button variant="contained" onClick={save} disabled={saving || !(Number(units) >= 1) || !(Number(buffer) >= 0)}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
