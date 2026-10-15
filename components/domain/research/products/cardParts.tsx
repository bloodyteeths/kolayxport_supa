// Shared bits of the Product finder cards (research.md §5.1): the kind caption under a card value and the demand
// input lines (SignalDots tooltip + Demand card body).
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { neutral } from '@/lib/ds/tokens';
import type { DemandInput, MetricKind } from '@/lib/research/types';

export function KindNote({ kind, children }: { kind: MetricKind; children?: React.ReactNode }) {
  const t = useTranslations('ds.research');
  return (
    <Typography variant="caption" component="p" sx={{ m: 0, mt: '4px', color: neutral[500] }}>
      {children ? <>{children}{' · '}</> : null}
      {t(`kind.${kind}`)}
    </Typography>
  );
}

/** "Google interest 54 (12 months)" · "In 2 of 3 autocompletes" · dropped input → its reason. */
export function useDemandInputLines() {
  const t = useTranslations('research');
  const root = useTranslations();
  return (inputs: DemandInput[]): { label: string; value: string; ok: boolean }[] =>
    inputs.map((i) => {
      const label = t(`demand.input.${i.key}`);
      if (!i.ok || i.value === null) {
        const reason = i.reasonKey && root.has(i.reasonKey) ? root(i.reasonKey) : t('demand.inputMissing');
        return { label, value: reason, ok: false };
      }
      return { label, value: t(`demand.value.${i.key}`, { value: Math.round(i.value * 10) / 10 }), ok: true };
    });
}
