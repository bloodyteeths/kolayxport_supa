// Product finder "Evidence" (research.md §5.1, §3.5): EvidenceSummary with 2–4 computed facts (i18n keys from the
// API, never AI text) + confidence from n. "Explain · 1 credit" asks /api/research/explain to rephrase the same
// numbers (server-side numbers check); a garbled or empty answer renders an inline ErrorState, never a toast.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { Button } from '@/components/ds/inputs/Button';
import { EvidenceSummary } from '@/components/ds/research/EvidenceSummary';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import type { ProductsResult } from '@/lib/research/types';
import { ResearchFetchError, requestExplain } from '@/lib/research/hooks/useResearchProducts';

export type EvidenceCardProps = {
  result: ProductsResult;
  /** Single line (compare mode): facts only, no Explain. */
  compact?: boolean;
};

/** Pure: the numbers the UI shows, sent to Explain (flat, numbers/strings only). */
export function explainMetrics(r: ProductsResult): Record<string, unknown> {
  // Same honesty gates as priceDisplay (lib/research/stats.ts): median only when quality 'ok', the P25–P75 band
  // when 'ok' or 'small'. Anything the Price card hides is sent as null so the AI can't quote it.
  const q = r.price.quality;
  const showMedian = q === 'ok';
  const showBand = q === 'ok' || q === 'small';
  return {
    query: r.query,
    marketplace: r.mkt,
    country: r.country,
    currency: r.price.currency,
    priceMedian: showMedian ? r.price.median : null,
    priceP25: showBand ? r.price.p25 : null,
    priceP75: showBand ? r.price.p75 : null,
    priceSample: r.price.n,
    priceQuality: r.price.quality,
    competingListings: r.competition.total.guard.ok ? r.competition.total.value : null,
    top5ShopShare: r.competition.top5Share.guard.ok ? r.competition.top5Share.value : null,
    demandTier: r.demand.tier,
    newcomerShare: r.newcomers.guard.ok ? r.newcomers.value : null,
    confidence: r.evidence.confidence,
  };
}

type ExplainState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; text: string } | { status: 'failed' } | { status: 'noCredits' };

export function EvidenceCard({ result, compact }: EvidenceCardProps) {
  const t = useTranslations('research');
  const locale = useLocale() === 'tr' ? 'tr' : 'en';
  const [explain, setExplain] = React.useState<ExplainState>({ status: 'idle' });
  const query = result.query;
  React.useEffect(() => setExplain({ status: 'idle' }), [query]);

  const run = async () => {
    setExplain({ status: 'loading' });
    try {
      const out = await requestExplain('products', explainMetrics(result), locale);
      setExplain(out ? { status: 'done', text: out.text } : { status: 'failed' });
    } catch (e) {
      setExplain(e instanceof ResearchFetchError && e.status === 402 ? { status: 'noCredits' } : { status: 'failed' });
    }
  };

  const summary = <EvidenceSummary facts={result.evidence.facts} confidence={result.evidence.confidence} basis={result.evidence.basis} data-testid="research-evidence-summary" />;
  if (compact) return summary;

  return (
    <Section
      title={t('evidence.title')}
      headerSlot={
        <Button variant="ghost" size="sm" icon={icons.ai} onClick={() => void run()} loading={explain.status === 'loading'} data-testid="research-explain">
          {t('explain.cta')}
        </Button>
      }
      data-testid="research-evidence"
    >
      {summary}
      {explain.status === 'done' ? (
        <Box sx={{ mt: '8px', display: 'flex', gap: '8px', alignItems: 'flex-start' }} data-testid="research-explain-text">
          <icons.ai size={16} aria-hidden color={neutral[500]} style={{ flexShrink: 0, marginTop: 2 }} />
          <Typography variant="body2" sx={{ color: neutral[800], whiteSpace: 'pre-line' }}>{explain.text}</Typography>
        </Box>
      ) : null}
      {explain.status === 'failed' ? (
        <Box sx={{ mt: '8px' }}>
          <ErrorState variant="inline" title={t('explain.failed')} onRetry={() => void run()} data-testid="research-explain-failed" />
        </Box>
      ) : null}
      {explain.status === 'noCredits' ? (
        <Typography variant="caption" component="p" sx={{ mt: '8px', color: neutral[600] }} data-testid="research-explain-credits">
          {t('explain.noCredits')}
        </Typography>
      ) : null}
    </Section>
  );
}

export default EvidenceCard;
