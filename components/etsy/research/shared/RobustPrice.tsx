import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { useLocale, useTranslations } from 'next-intl';
import { priceDisplay, type PriceSummary } from '@/lib/research/stats';

/**
 * R0 honesty patch: the one way research shows a market price.
 * Median + P25–P75 band + sample n, or "—" with the reason when the sample is
 * too small or implausible. Never an average. Shared by Etsy, eBay, Trendyol
 * and Amazon research until DS `Metric`/`SourceNote` land in R1.
 */

export function useResearchLocale(): string {
  const locale = useLocale();
  return locale === 'tr' ? 'tr-TR' : 'en-US';
}

type Summary = Partial<PriceSummary> | null | undefined;

export function usePriceReason(summary: Summary): string | null {
  const t = useTranslations('research.stats');
  const d = priceDisplay(summary);
  if (d.quality === 'insufficient') return t('notEnoughData');
  if (d.quality === 'implausible') return t('implausible');
  if (d.quality === 'small') return t('smallSample', { n: d.n });
  return null;
}

/** Stat card: "Median price" · value · band · n. */
export function RobustPriceCard({ summary, label, currency, color = 'text.primary', icon }: {
  summary: Summary; label?: string; currency?: string; color?: string; icon?: React.ReactNode;
}) {
  const t = useTranslations('research.stats');
  const locale = useResearchLocale();
  const d = priceDisplay(summary, locale, currency);
  const reason = usePriceReason(summary);
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 140, textAlign: 'center', borderRadius: '12px' }}>
      {icon && <Box sx={{ mb: 0.5, opacity: 0.8 }}>{icon}</Box>}
      <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 500 }}>{label ?? t('medianPrice')}</Typography>
      <Typography variant="h5" sx={{ color, fontWeight: 800 }}>{d.value}</Typography>
      {d.band && (
        <Typography variant="caption" display="block" color="text.secondary">
          {t('typicalRange')}: {d.band}
        </Typography>
      )}
      <Typography variant="caption" display="block" color="text.secondary">
        {reason ?? t('sampleN', { n: d.n })}
        {d.excluded > 0 && !reason ? ` · ${t('excluded', { count: d.excluded })}` : ''}
      </Typography>
    </Paper>
  );
}

/** Inline text: "$24.50 · $18–$32 · n=48", or "—" with its reason shown as visible caption text. */
export function RobustPriceText({ summary, currency, variant = 'body2', showN = true }: {
  summary: Summary; currency?: string; variant?: 'body2' | 'caption'; showN?: boolean;
}) {
  const t = useTranslations('research.stats');
  const locale = useResearchLocale();
  const d = priceDisplay(summary, locale, currency);
  const reason = usePriceReason(summary);
  const parts = [d.quality === 'small' && d.band ? d.band : d.value];
  if (d.quality === 'ok' && d.band) parts.push(d.band);
  if (showN && d.quality !== 'small') parts.push(t('nShort', { n: d.n }));
  return (
    <Typography component="span" variant={variant}>
      {parts.join(' · ')}
      {reason && (
        <Typography component="span" variant="caption" color="text.secondary">{` · ${reason}`}</Typography>
      )}
    </Typography>
  );
}

/**
 * Plain string version for chips and table cells.
 * - ok:            "Median $24 · $18–$32 · n=48"
 * - small (n<20):  "$18–$32 · <small sample reason>"   (range only, never a headline median)
 * - insufficient / implausible: "— · <reason> · n=3"
 * Pass `prefix: false` when the caller's own label already says "median".
 */
export function useRobustPriceLabel() {
  const t = useTranslations('research.stats');
  const locale = useResearchLocale();
  return (summary: Summary, currency?: string, opts: { showN?: boolean; prefix?: boolean } = {}) => {
    const d = priceDisplay(summary, locale, currency);
    const showN = opts.showN !== false;
    if (d.quality === 'ok' && d.value !== '—') {
      const parts = [opts.prefix === false ? d.value : `${t('medianShort')} ${d.value}`];
      if (d.band) parts.push(d.band);
      if (showN) parts.push(t('nShort', { n: d.n }));
      return parts.join(' · ');
    }
    if (d.quality === 'small') {
      // smallSample already carries n.
      return [d.band ?? '—', t('smallSample', { n: d.n })].join(' · ');
    }
    const reason = d.quality === 'implausible' ? t('implausible') : t('notEnoughData');
    // Failed values always carry their reason and n, even when showN is off.
    return ['—', reason, t('nShort', { n: d.n })].join(' · ');
  };
}
