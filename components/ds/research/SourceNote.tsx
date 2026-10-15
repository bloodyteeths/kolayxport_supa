// SourceNote: mandatory under every research card and table (P6, research §3.1):
// "Etsy search · 48 listings sampled · 3 excluded (no FX rate) · updated 2 h ago · Measured".
import { Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { neutral as n } from '@/lib/ds/tokens';
import { useDsFormat } from '@/components/ds/data/fmt';
import type { MetricKind, SampleUnit } from './types';

export type SourceNoteProps = {
  /** i18n key (full path from the root, research API `source`) or already-translated text. */
  source: string;
  sourceParams?: Record<string, string | number>;
  fetchedAt: Date | string;
  sample?: number;
  /** "287 of 300 listings used" when the sample was trimmed. */
  sampleTotal?: number;
  sampleUnit?: SampleUnit;
  /** `reason` (translated) or `reasonKey` (i18n key + params). */
  excluded?: { count: number; reason?: string; reasonKey?: string; reasonParams?: Record<string, string | number> };
  kind: MetricKind;
  /** Progress or extra meta ("Checking 12 of 40 keywords…"), already translated. */
  meta?: string;
  className?: string;
  'data-testid'?: string;
};

export function SourceNote({
  source, sourceParams, fetchedAt, sample, sampleTotal, sampleUnit = 'listings', excluded, kind, meta,
  className, 'data-testid': testId,
}: SourceNoteProps) {
  const t = useTranslations('ds.research');
  const root = useTranslations();
  const fmt = useDsFormat();
  const sourceText = root.has(source) ? root(source, sourceParams ?? {}) : source;
  const parts: string[] = [sourceText];
  if (typeof sample === 'number') {
    parts.push(
      typeof sampleTotal === 'number' && sampleTotal > sample
        ? t(`sampleOf.${sampleUnit}`, { count: sample, total: sampleTotal })
        : t(`sample.${sampleUnit}`, { count: sample }),
    );
  }
  if (excluded && excluded.count > 0) {
    const reason = excluded.reason ?? (excluded.reasonKey ? root(excluded.reasonKey, excluded.reasonParams ?? {}) : '');
    parts.push(reason ? t('excludedWithReason', { count: excluded.count, reason }) : t('excluded', { count: excluded.count }));
  }
  if (meta) parts.push(meta);
  parts.push(t('updated', { time: fmt.relative(fetchedAt) }));
  parts.push(t(`kind.${kind}`));
  return (
    <Typography
      variant="caption"
      component="p"
      className={className}
      data-testid={testId}
      data-kind={kind}
      title={fmt.dateTime(fetchedAt)}
      sx={{ m: 0, color: n[500] }}
    >
      {parts.join(' · ')}
    </Typography>
  );
}

export default SourceNote;
