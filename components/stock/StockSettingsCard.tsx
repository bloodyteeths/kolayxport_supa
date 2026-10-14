import React, { useState } from 'react';
import useSWR from 'swr';
import {
  Alert, Box, Button, Chip, Divider, FormControl, FormControlLabel, InputLabel, MenuItem, Paper, Select, Stack, Switch,
  Typography,
} from '@mui/material';
import { useTranslations } from 'next-intl';
import { notify } from '@/lib/notify';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { stockErrorKey, stockFetch, swrStockFetcher, type SettingsResponse } from './stockClient';
import { channelLabel } from './labels';

export type StockSettingsCardProps = {
  data: SettingsResponse;
  onChanged: () => void;
  onOpenWizard: () => void;
  onGoLive: () => void;
};

type DryRunReport = {
  wouldHaveSent: number;
  oversellRisksPrevented: number;
  examples: Array<{ sku: string; soldOn: string | null; exposedOn: string; shown: number; available: number; at: string }>;
};

/** Status (off / dry run / live), counts, options and the lifecycle buttons. */
export default function StockSettingsCard({ data, onChanged, onOpenWizard, onGoLive }: StockSettingsCardProps) {
  const t = useTranslations('stockSync');
  const confirm = useConfirm();
  const s = data.settings;
  const [busy, setBusy] = useState(false);
  const state: 'disabled' | 'dryRun' | 'live' | 'globallyDisabled' = s.globallyDisabled ? 'globallyDisabled' : !s.enabled ? 'disabled' : s.dryRun ? 'dryRun' : 'live';

  const { data: report } = useSWR<DryRunReport>(s.enabled && s.dryRun ? '/api/stock/pushes?report=dry_run' : null, swrStockFetcher);
  const { data: snap, mutate: mutateSnap } = useSWR<{ snapshot: { id: string; usable: boolean; takenAt: string } | null }>(s.configured ? '/api/stock/restore' : null, swrStockFetcher);

  const put = async (body: Record<string, unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await stockFetch('/api/stock/settings', { method: 'PUT', body });
      if (okMsg) notify.success(okMsg);
      onChanged();
    } catch (err) {
      notify.error(err, t(stockErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    const ok = await confirm({ title: t('settings.disableConfirmTitle'), description: t('settings.disableConfirmBody'), destructive: true });
    if (ok) await put({ enabled: false });
  };

  const restore = async () => {
    const word = t('restore.word');
    const ok = await confirm({ title: t('restore.title'), description: `${t('restore.body')} ${t('restore.typeToConfirm', { word })}`, destructive: true, typeToConfirm: word, confirmLabel: t('restore.confirm') });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await stockFetch<{ applied: number; failed: number }>('/api/stock/restore', { method: 'POST', body: { snapshotId: snap?.snapshot?.id, typedConfirm: word } });
      notify.success(t('restore.success', { applied: r.applied, failed: r.failed }));
      await mutateSnap();
      onChanged();
    } catch (err) {
      notify.error(err, t(stockErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const chipColor = state === 'live' ? 'success' : state === 'dryRun' ? 'info' : state === 'globallyDisabled' ? 'warning' : 'default';
  const counts = data.counts;
  const writable = data.channels.filter((c) => c.accounts.length > 0);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1, minWidth: 0 }}>
          {t('settings.title')}
        </Typography>
        <Chip color={chipColor} label={t(`status.${state}`)} />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t(`statusHelp.${state}`)}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(5, 1fr)' }, gap: 1, mb: 1.5 }}>
        {[
          ['items', counts.items],
          ['activeLinks', counts.activeLinks],
          ['needsReview', counts.needsReview],
          ['suggested', counts.suggestedLinks],
          ['failed', counts.failedPushes24h],
        ].map(([k, v]) => (
          <Box key={k as string} sx={{ p: 1, borderRadius: 1.5, bgcolor: 'action.hover' }}>
            <Typography variant="h6" lineHeight={1.1} sx={{ fontVariantNumeric: 'tabular-nums' }} color={k === 'failed' && Number(v) > 0 ? 'error.main' : k === 'needsReview' && Number(v) > 0 ? 'warning.main' : 'text.primary'}>
              {v as number}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t(`settings.counts.${k}` as any)}
            </Typography>
          </Box>
        ))}
      </Box>

      {s.enabled && s.dryRun && report && (
        <Alert severity={report.oversellRisksPrevented > 0 ? 'warning' : 'info'} sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2">{t('dryRunReport.title')}</Typography>
          {report.wouldHaveSent === 0 && report.oversellRisksPrevented === 0 ? (
            <Typography variant="body2">{t('dryRunReport.empty')}</Typography>
          ) : (
            <>
              <Typography variant="body2">{t('dryRunReport.wouldHaveSent', { count: report.wouldHaveSent })}</Typography>
              <Typography variant="body2">{t('dryRunReport.risksPrevented', { count: report.oversellRisksPrevented })}</Typography>
              {report.examples.slice(0, 3).map((ex, i) => (
                <Typography key={i} variant="caption" component="div" sx={{ wordBreak: 'break-word' }}>
                  {t('dryRunReport.riskExample', { sku: ex.sku, soldOn: channelLabel(t as any, ex.soldOn), exposedOn: channelLabel(t as any, ex.exposedOn), shown: ex.shown, available: ex.available })}
                </Typography>
              ))}
            </>
          )}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
        <Button variant={s.enabled ? 'outlined' : 'contained'} onClick={onOpenWizard} disabled={busy}>
          {t('settings.openWizard')}
        </Button>
        {s.enabled && s.dryRun && (
          <Button variant="contained" color="success" onClick={onGoLive} disabled={busy || s.globallyDisabled}>
            {t('settings.goLive')}
          </Button>
        )}
        {s.enabled && !s.dryRun && (
          <Button variant="outlined" onClick={() => put({ dryRun: true })} disabled={busy}>
            {t('settings.backToDryRun')}
          </Button>
        )}
        {s.enabled && (
          <Button color="error" onClick={disable} disabled={busy}>
            {t('settings.disable')}
          </Button>
        )}
        {snap?.snapshot?.usable && (
          <Button color="warning" onClick={restore} disabled={busy}>
            {t('settings.restore')}
          </Button>
        )}
      </Box>

      {s.configured && (
        <>
          <Divider sx={{ mb: 1.5 }} />
          <Stack spacing={1}>
            <FormControlLabel
              control={<Switch checked={s.restockOnCancel} onChange={(e) => put({ restockOnCancel: e.target.checked }, t('settings.saved'))} disabled={busy} />}
              label={<OptionLabel title={t('settings.restockOnCancel')} help={t('settings.restockOnCancelHelp')} />}
              sx={{ alignItems: 'flex-start', mr: 0 }}
            />
            <FormControlLabel
              control={<Switch checked={s.autoFixDrift} onChange={(e) => put({ autoFixDrift: e.target.checked }, t('settings.saved'))} disabled={busy} />}
              label={<OptionLabel title={t('settings.autoFixDrift')} help={t('settings.autoFixDriftHelp')} />}
              sx={{ alignItems: 'flex-start', mr: 0 }}
            />
            <FormControl size="small" fullWidth sx={{ maxWidth: 480 }}>
              <InputLabel id="kx-stock-zero">{t('settings.zeroAction')}</InputLabel>
              <Select
                labelId="kx-stock-zero"
                label={t('settings.zeroAction')}
                value={s.etsyZeroStockAction}
                onChange={(e) => put({ etsyZeroStockAction: e.target.value }, t('settings.saved'))}
                disabled={busy}
                MenuProps={{ sx: { zIndex: 1600 } }}
              >
                <MenuItem value="disable_variation">{t('settings.zeroDisable')}</MenuItem>
                <MenuItem value="deactivate_listing">{t('settings.zeroDeactivate')}</MenuItem>
              </Select>
            </FormControl>
            {writable.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t('settings.channelsTitle')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                  {writable.map((c) => {
                    const on = !s.channels.length || s.channels.includes(c.channel);
                    return (
                      <Chip
                        key={c.channel}
                        label={channelLabel(t as any, c.channel)}
                        color={on ? 'primary' : 'default'}
                        variant={on ? 'filled' : 'outlined'}
                        disabled={busy}
                        onClick={() => {
                          const all = writable.map((w) => w.channel);
                          const current = s.channels.length ? s.channels : all;
                          const next = on ? current.filter((x) => x !== c.channel) : [...current, c.channel];
                          if (!next.length) return; // at least one channel stays selected
                          void put({ channels: next.length === all.length ? [] : next }, t('settings.saved'));
                        }}
                      />
                    );
                  })}
                </Box>
              </Box>
            )}
          </Stack>
        </>
      )}
    </Paper>
  );
}

function OptionLabel({ title, help }: { title: string; help: string }) {
  return (
    <Box sx={{ pt: 0.75 }}>
      <Typography variant="body2">{title}</Typography>
      <Typography variant="caption" color="text.secondary">
        {help}
      </Typography>
    </Box>
  );
}
