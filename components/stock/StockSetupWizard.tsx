import React, { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, LinearProgress, Paper, Radio, RadioGroup, Stack, Step, StepLabel, Stepper, Switch,
  TextField, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/ui/ErrorState';
import { notify } from '@/lib/notify';
import SkuMappingDialog from './SkuMappingDialog';
import StockPreviewPanel from './StockPreviewPanel';
import {
  memberOf, stockErrorKey, stockFetch, swrStockFetcher,
  type Candidate, type CandidatesResponse, type MatchGroup, type PreviewResponse, type SettingsResponse,
} from './stockClient';
import { channelLabel, CHANNEL_COLORS } from './labels';

export type StockSetupWizardProps = {
  open: boolean;
  onClose: () => void;
  settings: SettingsResponse | undefined;
  onChanged: () => void;
};

const STEPS = ['channels', 'matches', 'unmatched', 'seed', 'enable'] as const;
type StepKey = (typeof STEPS)[number];

function groupKey(g: MatchGroup) {
  return g.sku;
}

/**
 * Setup wizard (mobile-first). Nothing here writes to a marketplace:
 * channels -> confirm auto-matched groups -> link unmatched (manual / staged
 * Etsy SKU drafts) -> seed policy -> start DRY RUN (seeds from fresh reads)
 * and show what Go Live would send. Go Live itself is a separate dialog.
 */
export default function StockSetupWizard({ open, onClose, settings, onChanged }: StockSetupWizardProps) {
  const t = useTranslations('stockSync');
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [step, setStep] = useState(0);
  const [channels, setChannels] = useState<string[]>([]);
  const stepKey: StepKey = STEPS[step];
  const enabled = !!settings?.settings.enabled;

  useEffect(() => {
    if (!open) return;
    setStep(0);
    const s = settings?.settings;
    const connected = (settings?.channels || []).filter((c) => c.accounts.length > 0).map((c) => c.channel);
    setChannels(s?.channels?.length ? s.channels : connected);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const candKey = open && step >= 1 && step <= 2 ? `/api/stock/candidates?channels=${encodeURIComponent(channels.join(','))}` : null;
  const cand = useSWR<CandidatesResponse>(candKey, swrStockFetcher, { revalidateOnFocus: false, keepPreviousData: true });

  const next = async () => {
    if (stepKey === 'channels') {
      try {
        await stockFetch('/api/stock/settings', { method: 'PUT', body: { channels } });
        onChanged();
      } catch (err) {
        notify.error(err, t(stockErrorKey(err)));
        return;
      }
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="md" sx={{ zIndex: 1500 }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="div" noWrap>
            {t('wizard.title')}
          </Typography>
          {fullScreen && (
            <Typography variant="caption" color="text.secondary">
              {step + 1}/{STEPS.length} · {t(`wizard.steps.${stepKey}`)}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} aria-label={t('common.close')}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      {!fullScreen && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Stepper activeStep={step} alternativeLabel>
            {STEPS.map((s) => (
              <Step key={s}>
                <StepLabel>{t(`wizard.steps.${s}`)}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>
      )}
      <DialogContent dividers sx={{ px: { xs: 1.5, sm: 3 } }}>
        {stepKey === 'channels' && <ChannelsStep settings={settings} selected={channels} onChange={setChannels} />}
        {stepKey === 'matches' && <MatchesStep cand={cand} onConfirmed={() => { void cand.mutate(); onChanged(); }} />}
        {stepKey === 'unmatched' && <UnmatchedStep cand={cand} onLinked={() => { void cand.mutate(); onChanged(); }} />}
        {stepKey === 'seed' && <SeedStep settings={settings} onChanged={onChanged} />}
        {stepKey === 'enable' && <EnableStep enabled={enabled} onChanged={onChanged} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          {t('common.back')}
        </Button>
        <Box sx={{ flex: 1 }} />
        {step < STEPS.length - 1 ? (
          <Button variant="contained" onClick={next} disabled={stepKey === 'channels' && channels.length === 0}>
            {t('common.next')}
          </Button>
        ) : (
          <Button variant="contained" onClick={onClose}>
            {t('common.close')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function ChannelsStep({ settings, selected, onChange }: { settings: SettingsResponse | undefined; selected: string[]; onChange: (c: string[]) => void }) {
  const t = useTranslations('stockSync');
  if (!settings) return <LinearProgress />;
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {t('wizard.channelsIntro')}
      </Typography>
      {settings.channels.map((c) => {
        const connected = c.accounts.length > 0;
        const comingSoon = c.unsupportedReason === 'coming_soon';
        const checked = selected.includes(c.channel);
        return (
          <Paper key={c.channel} variant="outlined" sx={{ p: 1.25, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1, opacity: connected ? 1 : 0.6 }}>
            <Checkbox
              checked={checked}
              disabled={!connected || comingSoon}
              onChange={(e) => onChange(e.target.checked ? [...selected, c.channel] : selected.filter((x) => x !== c.channel))}
            />
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: CHANNEL_COLORS[c.channel] || 'grey.400', flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600}>
                {channelLabel(t as any, c.channel)}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div" noWrap>
                {comingSoon
                  ? t('wizard.comingSoon')
                  : !connected
                    ? t('wizard.notConnected')
                    : [c.accounts.map((a) => a.label).join(', '), t('wizard.oversellWindow', { minutes: c.oversellWindowMinutes })].join(' · ')}
              </Typography>
              {connected && !c.supportsWrite && !comingSoon && (
                <Typography variant="caption" color="warning.main">
                  {t('wizard.writeUnsupported')}
                </Typography>
              )}
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
}

// ---------------------------------------------------------------------------

function MatchesStep({ cand, onConfirmed }: { cand: ReturnType<typeof useSWR<CandidatesResponse>>; onConfirmed: () => void }) {
  const t = useTranslations('stockSync');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [seedQty, setSeedQty] = useState<Record<string, string>>({});
  const [showSingles, setShowSingles] = useState(false);
  const [saving, setSaving] = useState(false);
  const data = cand.data;

  const multi = useMemo(() => (data?.groups || []).filter((g) => g.multiChannel), [data]);
  const singles = useMemo(() => (data?.groups || []).filter((g) => !g.multiChannel), [data]);

  useEffect(() => {
    if (!data) return;
    setChecked((prev) => {
      const nextState: Record<string, boolean> = {};
      for (const g of data.groups) nextState[groupKey(g)] = prev[groupKey(g)] ?? (g.multiChannel && !g.needsReview);
      return nextState;
    });
  }, [data]);

  if (cand.error) return <ErrorState error={cand.error} onRetry={() => cand.mutate()} />;
  if (!data) return <LinearProgress />;

  const isReady = (g: MatchGroup) => !g.needsReview || /^\d+$/.test((seedQty[groupKey(g)] || '').trim());
  const selected = data.groups.filter((g) => checked[groupKey(g)] && isReady(g));

  const confirm = async () => {
    setSaving(true);
    try {
      let done = 0;
      for (let i = 0; i < selected.length; i += 100) {
        const chunk = selected.slice(i, i + 100);
        const r = await stockFetch<{ results: Array<{ error?: string }> }>('/api/stock/links', {
          method: 'POST',
          body: {
            action: 'confirm',
            groups: chunk.map((g) => ({
              sku: g.displaySku,
              title: g.members.find((m) => m.title)?.title ?? null,
              imageUrl: g.members.find((m) => m.imageUrl)?.imageUrl ?? null,
              members: g.members.map((m) => ({ ...memberOf(m), matchType: 'auto_exact' })),
              seedQty: g.needsReview ? Number(seedQty[groupKey(g)]) : null,
              needsReview: g.needsReview,
            })),
          },
        });
        done += r.results.filter((x) => !x.error).length;
      }
      notify.success(t('wizard.confirmed', { count: done }));
      onConfirmed();
    } catch (err) {
      notify.error(err, t(stockErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  const renderGroup = (g: MatchGroup) => {
    const k = groupKey(g);
    return (
      <Paper key={k} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Checkbox checked={!!checked[k]} onChange={(e) => setChecked((c) => ({ ...c, [k]: e.target.checked }))} sx={{ p: 0.5 }} />
          <Typography variant="body2" fontWeight={700} noWrap sx={{ flex: 1, minWidth: 0 }}>
            {g.displaySku}
          </Typography>
          {g.needsReview && <Chip size="small" color="warning" label={t('wizard.needsReview')} />}
        </Box>
        {g.needsReview && (
          <Box sx={{ pl: 4.5, pt: 0.5 }}>
            <Typography variant="caption" color="warning.main" component="div">
              {g.reviewReasons.map((r) => t(`wizard.reviewReasons.${r}` as any)).join(' · ')}
            </Typography>
            <TextField
              size="small"
              type="number"
              label={t('wizard.seedQtyLabel')}
              value={seedQty[k] || ''}
              onChange={(e) => setSeedQty((s) => ({ ...s, [k]: e.target.value }))}
              sx={{ mt: 1, width: 160 }}
              inputProps={{ min: 0, inputMode: 'numeric' }}
            />
          </Box>
        )}
        {g.sharedPoolChannels.map((ch) => (
          <Typography key={ch} variant="caption" color="text.secondary" component="div" sx={{ pl: 4.5 }}>
            {t('wizard.sharedPool', { channel: channelLabel(t as any, ch), count: g.members.filter((m) => m.channel === ch).length })}
          </Typography>
        ))}
        <Box sx={{ pl: { xs: 0, sm: 4.5 }, pt: 0.75 }}>
          {g.members.map((m) => (
            <MemberRow key={`${m.channel}|${m.accountRef}|${m.externalId}|${m.variantRef}`} m={m} />
          ))}
        </Box>
      </Paper>
    );
  };

  return (
    <Stack spacing={1.25}>
      <Typography variant="body2" color="text.secondary">
        {t('wizard.matchesIntro')}
      </Typography>
      <Alert severity="info" icon={false}>
        {t('wizard.coverage', { percent: data.coverage.percent })}
      </Alert>
      {multi.length === 0 && <Alert severity="info">{t('wizard.noMatches')}</Alert>}
      {multi.length > 0 && (
        <FormControlLabel
          control={
            <Checkbox
              checked={multi.every((g) => checked[groupKey(g)])}
              indeterminate={multi.some((g) => checked[groupKey(g)]) && !multi.every((g) => checked[groupKey(g)])}
              onChange={(e) => setChecked((c) => ({ ...c, ...Object.fromEntries(multi.map((g) => [groupKey(g), e.target.checked && !g.needsReview])) }))}
            />
          }
          label={t('wizard.selectAll')}
        />
      )}
      {multi.map(renderGroup)}
      {singles.length > 0 && (
        <>
          <Button onClick={() => setShowSingles((v) => !v)} endIcon={<ExpandMoreRoundedIcon sx={{ transform: showSingles ? 'rotate(180deg)' : 'none' }} />} sx={{ alignSelf: 'flex-start' }}>
            {t('wizard.singleChannel', { count: singles.length })}
          </Button>
          <Collapse in={showSingles} unmountOnExit>
            <Stack spacing={1.25}>{singles.map(renderGroup)}</Stack>
          </Collapse>
        </>
      )}
      <Box sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', py: 1 }}>
        <Button variant="contained" fullWidth disabled={!selected.length || saving} onClick={confirm} startIcon={saving ? <CircularProgress size={16} /> : undefined}>
          {t('wizard.confirmSelected', { count: selected.length })}
        </Button>
      </Box>
    </Stack>
  );
}

function MemberRow({ m, action }: { m: Candidate; action?: React.ReactNode }) {
  const t = useTranslations('stockSync');
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, minWidth: 0 }}>
      <Chip size="small" label={channelLabel(t as any, m.channel)} sx={{ bgcolor: CHANNEL_COLORS[m.channel] || 'grey.300', color: '#fff', flexShrink: 0, height: 22 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap title={m.title || ''}>
          {m.title || m.externalId}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {[m.variantLabel, m.sku, m.accountLabel].filter(Boolean).join(' · ')}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {m.quantity}
      </Typography>
      {action}
    </Box>
  );
}

// ---------------------------------------------------------------------------

function UnmatchedStep({ cand, onLinked }: { cand: ReturnType<typeof useSWR<CandidatesResponse>>; onLinked: () => void }) {
  const t = useTranslations('stockSync');
  const [mapping, setMapping] = useState<Candidate | null>(null);
  const [skuSel, setSkuSel] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const data = cand.data;
  if (cand.error) return <ErrorState error={cand.error} onRetry={() => cand.mutate()} />;
  if (!data) return <LinearProgress />;

  const etsyNoSku = data.unmatched.filter((c) => c.channel === 'etsy' && !c.sku);
  const selectedListings = Array.from(new Set(etsyNoSku.filter((c) => skuSel[`${c.accountRef}|${c.externalId}`]).map((c) => `${c.accountRef}|${c.externalId}`)));

  const generate = async () => {
    setBusy(true);
    try {
      const byShop = new Map<string, string[]>();
      for (const k of selectedListings) {
        const [shopId, listingId] = k.split('|');
        byShop.set(shopId, [...(byShop.get(shopId) || []), listingId]);
      }
      let staged = 0;
      for (const [shopId, listingIds] of Array.from(byShop.entries())) {
        for (let i = 0; i < listingIds.length; i += 50) {
          const r = await stockFetch<{ proposals: Array<{ status: string }> }>('/api/stock/generate-skus', {
            method: 'POST',
            body: { shopId, listingIds: listingIds.slice(i, i + 50), apply: true },
          });
          staged += r.proposals.filter((p) => p.status === 'ok').length;
        }
      }
      notify.success(t('wizard.generateStaged', { count: staged }));
      setSkuSel({});
    } catch (err) {
      notify.error(err, t(stockErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.25}>
      <Typography variant="body2" color="text.secondary">
        {t('wizard.unmatchedIntro')}
      </Typography>
      <Typography variant="subtitle2">{t('wizard.unmatchedCount', { count: data.unmatchedTotal })}</Typography>

      {etsyNoSku.length > 0 && (
        <Alert severity="info" icon={false} action={<Button size="small" disabled={!selectedListings.length || busy} onClick={generate}>{t('wizard.generateSkus')}</Button>}>
          {t('wizard.generateSkusHelp')}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2, px: 1.25 }}>
        {data.unmatched.map((c) => {
          const lk = `${c.accountRef}|${c.externalId}`;
          return (
            <Box key={`${lk}|${c.variantRef}|${c.channel}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              {c.channel === 'etsy' && !c.sku ? (
                <Checkbox size="small" checked={!!skuSel[lk]} onChange={(e) => setSkuSel((s) => ({ ...s, [lk]: e.target.checked }))} sx={{ p: 0.5 }} />
              ) : (
                <Box sx={{ width: 30, flexShrink: 0 }} />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <MemberRow m={c} action={<Button size="small" onClick={() => setMapping(c)}>{t('wizard.linkToItem')}</Button>} />
              </Box>
            </Box>
          );
        })}
      </Paper>

      {data.loose.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ pt: 1 }}>
            {t('wizard.looseTitle')}
          </Typography>
          {data.loose.slice(0, 30).map((l) => (
            <Paper key={l.key} variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {l.skus.join(' ≈ ')}
              </Typography>
              {l.members.map((m) => (
                <MemberRow key={`${m.channel}|${m.externalId}|${m.variantRef}`} m={m} action={<Button size="small" onClick={() => setMapping(m)}>{t('wizard.linkToItem')}</Button>} />
              ))}
            </Paper>
          ))}
        </>
      )}

      {data.titles.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ pt: 1 }}>
            {t('wizard.titleTitle')}
          </Typography>
          {data.titles.slice(0, 30).map((s) => (
            <Paper key={`${s.candidate.externalId}|${s.candidate.variantRef}`} variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
              <MemberRow m={s.candidate} action={<Button size="small" onClick={() => setMapping(s.candidate)}>{t('wizard.linkToItem')}</Button>} />
              {s.matches.map((mm) => (
                <Box key={`${mm.candidate.channel}|${mm.candidate.externalId}|${mm.candidate.variantRef}`} sx={{ pl: 2 }}>
                  <MemberRow m={mm.candidate} />
                </Box>
              ))}
            </Paper>
          ))}
        </>
      )}

      <SkuMappingDialog candidate={mapping} open={!!mapping} onClose={() => setMapping(null)} onLinked={onLinked} />
    </Stack>
  );
}

// ---------------------------------------------------------------------------

function SeedStep({ settings, onChanged }: { settings: SettingsResponse | undefined; onChanged: () => void }) {
  const t = useTranslations('stockSync');
  const s = settings?.settings;
  const [busy, setBusy] = useState(false);
  if (!s) return <LinearProgress />;
  const put = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await stockFetch('/api/stock/settings', { method: 'PUT', body });
      onChanged();
    } catch (err) {
      notify.error(err, t(stockErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('wizard.seedIntro')}
      </Typography>
      <RadioGroup value={s.seedPolicy} onChange={(e) => put({ seedPolicy: e.target.value })}>
        {(['min', 'etsy_master', 'manual'] as const).map((p) => (
          <Paper key={p} variant="outlined" sx={{ p: 1, mb: 1, borderRadius: 2 }}>
            <FormControlLabel
              value={p}
              disabled={busy}
              control={<Radio />}
              sx={{ alignItems: 'flex-start', mr: 0 }}
              label={
                <Box sx={{ pt: 0.75 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {t(`wizard.policy.${p}`)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t(`wizard.policy.${p}Help` as any)}
                  </Typography>
                </Box>
              }
            />
          </Paper>
        ))}
      </RadioGroup>
      <FormControlLabel
        control={<Switch checked={s.seedSubtractReserved} disabled={busy} onChange={(e) => put({ seedSubtractReserved: e.target.checked })} />}
        sx={{ alignItems: 'flex-start', mr: 0 }}
        label={
          <Box sx={{ pt: 0.75 }}>
            <Typography variant="body2">{t('settings.seedReserved')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('settings.seedReservedHelp')}
            </Typography>
          </Box>
        }
      />
    </Stack>
  );
}

// ---------------------------------------------------------------------------

function EnableStep({ enabled, onChanged }: { enabled: boolean; onChanged: () => void }) {
  const t = useTranslations('stockSync');
  const [busy, setBusy] = useState(false);
  const [needsReview, setNeedsReview] = useState<number | null>(null);
  const preview = useSWR<PreviewResponse>(enabled ? '/api/stock/preview' : null, swrStockFetcher);

  const enable = async () => {
    setBusy(true);
    try {
      const r = await stockFetch<{ needsReview: string[] }>('/api/stock/settings', { method: 'PUT', body: { enabled: true } });
      setNeedsReview(r.needsReview?.length ?? 0);
      notify.success(t('wizard.enabled'));
      onChanged();
      await preview.mutate();
    } catch (err) {
      notify.error(err, t(stockErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('wizard.enableIntro')}
      </Typography>
      {!enabled && (
        <Button variant="contained" size="large" onClick={enable} disabled={busy} startIcon={busy ? <CircularProgress size={18} /> : undefined}>
          {t('wizard.enableButton')}
        </Button>
      )}
      {!!needsReview && <Alert severity="warning">{t('wizard.needsReviewLeft', { count: needsReview })}</Alert>}
      {enabled && (
        <>
          <Typography variant="subtitle2">{t('preview.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('wizard.previewIntro')}
          </Typography>
          {preview.error && <ErrorState error={preview.error} onRetry={() => preview.mutate()} compact />}
          {!preview.data && !preview.error && <LinearProgress />}
          {preview.data && <StockPreviewPanel preview={preview.data} />}
        </>
      )}
    </Stack>
  );
}
