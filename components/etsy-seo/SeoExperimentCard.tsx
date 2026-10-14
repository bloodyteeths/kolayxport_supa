import React, { useState } from 'react';
import { Alert, Avatar, AvatarGroup, Box, Chip, Collapse, IconButton, Paper, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded';
import TrendingFlatRoundedIcon from '@mui/icons-material/TrendingFlatRounded';
import HourglassTopRoundedIcon from '@mui/icons-material/HourglassTopRounded';
import { useFormatter, useTranslations } from 'next-intl';
import type { SeoExperimentItem } from './types';

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  collecting: { bg: '#E0F2FE', fg: '#075985' },
  low_traffic: { bg: '#FEF3C7', fg: '#92400E' },
  ready: { bg: '#DCFCE7', fg: '#166534' },
  insufficient_data: { bg: '#F1F5F9', fg: '#334155' },
  confounded: { bg: '#FCE7F3', fg: '#9D174D' },
  cancelled: { bg: '#F1F5F9', fg: '#64748B' },
};

const CONF_COLORS: Record<string, string> = { high: '#16A34A', medium: '#D97706', low: '#64748B' };

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ p: 1, borderRadius: '8px', bgcolor: '#F8FAFC', minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {value}
      </Typography>
    </Box>
  );
}

/** One SEO cohort: what changed, before/after, control-adjusted lift, confidence, caveats. */
export default function SeoExperimentCard({ exp }: { exp: SeoExperimentItem }) {
  const t = useTranslations('seoExperiments');
  const format = useFormatter();
  const [open, setOpen] = useState(exp.status === 'ready');
  const sc = STATUS_COLORS[exp.status] || STATUS_COLORS.insufficient_data;
  const date = (iso: string) => format.dateTime(new Date(iso), { day: 'numeric', month: 'short' });
  const m = exp.metrics || {};
  const lift: number | null = m?.views?.lift ?? m?.orders?.lift ?? null;
  const liftPct = lift === null || lift === undefined ? null : Math.round(lift * 1000) / 10;
  const firstTitle = exp.listings.find((l) => l.title)?.title || `#${exp.listings[0]?.listingId ?? ''}`;

  const VerdictIcon =
    exp.status !== 'ready'
      ? HourglassTopRoundedIcon
      : exp.verdict === 'improved'
        ? TrendingUpRoundedIcon
        : exp.verdict === 'worse'
          ? TrendingDownRoundedIcon
          : TrendingFlatRoundedIcon;
  const verdictColor = exp.verdict === 'improved' ? '#16A34A' : exp.verdict === 'worse' ? '#DC2626' : '#64748B';

  return (
    <Paper variant="outlined" sx={{ borderRadius: '12px', overflow: 'hidden' }}>
      <Box
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen((o) => !o);
        }}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1.25, cursor: 'pointer', minHeight: 56 }}
      >
        <AvatarGroup max={3} sx={{ '& .MuiAvatar-root': { width: 36, height: 36, fontSize: 12 } }}>
          {exp.listings.map((l) => (
            <Avatar key={l.listingId} variant="rounded" src={l.thumbnail || undefined} alt={l.title || ''} />
          ))}
        </AvatarGroup>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {exp.listingCount > 1 ? `${firstTitle} ${t('andMore', { count: exp.listingCount - 1 })}` : firstTitle}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>
            <Chip size="small" label={t(`status.${exp.status}`)} sx={{ bgcolor: sc.bg, color: sc.fg, height: 22, fontWeight: 600, fontSize: '0.7rem' }} />
            {exp.changeKinds.map((k) => (
              <Chip key={k} size="small" variant="outlined" label={t.has(`changeKinds.${k}`) ? t(`changeKinds.${k}`) : k} sx={{ height: 22, fontSize: '0.7rem' }} />
            ))}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <VerdictIcon sx={{ color: exp.status === 'ready' ? verdictColor : '#94A3B8' }} />
          {exp.status === 'ready' && liftPct !== null && (
            <Typography variant="caption" sx={{ fontWeight: 700, color: verdictColor }}>
              {`${liftPct > 0 ? '+' : ''}${liftPct}%`}
            </Typography>
          )}
        </Box>
        <IconButton size="small" aria-label="expand" sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <ExpandMoreRoundedIcon fontSize="small" />
        </IconButton>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1.25, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Typography variant="caption" color="text.secondary">
            {t('changedAt', { date: date(exp.changedAt) })} · {t(`kind.${exp.kind}`)} · {t('listingsCount', { count: exp.listingCount })}
          </Typography>

          {exp.status === 'ready' ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 700, color: verdictColor }}>
                  {exp.verdict ? t(`verdict.${exp.verdict}`) : ''}
                </Typography>
                {exp.confidence && (
                  <Chip
                    size="small"
                    label={`${t('confidence.label')}: ${t(`confidence.${exp.confidence}`)}`}
                    sx={{ height: 22, color: '#fff', bgcolor: CONF_COLORS[exp.confidence] || '#64748B', fontWeight: 600 }}
                  />
                )}
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 0.75 }}>
                <Metric label={t('metrics.viewsBefore')} value={m?.treated?.viewsKnown ? format.number(m.treated.viewsBefore) : '—'} />
                <Metric label={t('metrics.viewsAfter')} value={m?.treated?.viewsKnown ? format.number(m.treated.viewsAfter) : '—'} />
                <Metric label={t('metrics.ordersBefore')} value={format.number(m?.treated?.ordersBefore ?? 0)} />
                <Metric label={t('metrics.ordersAfter')} value={format.number(m?.treated?.ordersAfter ?? 0)} />
              </Box>
              {liftPct !== null && (
                <Metric label={t('metrics.lift')} value={t('metrics.liftValue', { value: `${liftPct > 0 ? '+' : ''}${liftPct}` })} />
              )}
              {exp.controlType && (
                <Typography variant="caption" color="text.secondary">
                  {t(`control.${exp.controlType}`)}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                {t('metrics.rank')}:{' '}
                {m?.rank?.keywords
                  ? t('metrics.rankDelta', { count: m.rank.keywords, delta: m.rank.avgDelta ?? 0 })
                  : t('metrics.rankNone')}
              </Typography>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t.has(`statusHelp.${exp.status}`) ? t(`statusHelp.${exp.status}`, { date: date(exp.readyAfter) }) : ''}
            </Typography>
          )}
          {exp.seasonal && (
            <Alert severity="warning" sx={{ py: 0, borderRadius: '8px' }}>
              {t('seasonal')}
            </Alert>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
