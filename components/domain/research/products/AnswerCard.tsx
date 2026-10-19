// Product finder answer card: the decision first, in plain words — opportunity score (lib/research/opportunityScore,
// a signal from measured inputs) + one verdict sentence + four tiles (demand · price · competition · newcomers) +
// "How is this calculated?". The statistician-style cards (EvidenceCard, PriceCard, …) stay below under "Details".
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { useDsFormat } from '@/components/ds/data/fmt';
import { neutral, radius, tone } from '@/lib/ds/tokens';
import { opportunityOf, type Level, type OpportunityBand } from '@/lib/research/opportunityScore';
import type { ProductsResult } from '@/lib/research/types';
import type { marketTotals } from '@/lib/research/hooks/useListingSales';

/** Market sales from the top listings (Etsy); shown once enough listings have a number. */
export type MarketSales = ReturnType<typeof marketTotals> & { loading: boolean; listed: number };
const MIN_COUNTED = 8;

const BAND_TONE: Record<OpportunityBand, keyof typeof tone> = { good: 'success', ok: 'warning', hard: 'danger' };
const LEVEL_TONE: Record<Level, keyof typeof tone> = { high: 'success', medium: 'warning', low: 'neutral' };
/** Competition reads the other way round: low competition is the good news. */
const COMPETITION_TONE: Record<Level, keyof typeof tone> = { low: 'success', medium: 'warning', high: 'danger' };

export type AnswerCardProps = {
  result: ProductsResult;
  onUsePrice?: (amount: number, currency: string) => void;
  market?: MarketSales;
};

function Tile({ label, value, sub, toneKey, children, testId }: { label: string; value: string; sub?: string | null; toneKey?: keyof typeof tone; children?: React.ReactNode; testId: string }) {
  return (
    <Box sx={{ p: '12px', borderRadius: `${radius.md}px`, border: `1px solid ${neutral[200]}`, bgcolor: neutral[0], minWidth: 0 }} data-testid={testId}>
      <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[500] }}>{label}</Typography>
      <Typography component="p" sx={{ m: 0, mt: '2px', fontSize: 18, fontWeight: 700, color: toneKey ? tone[toneKey].fg : neutral[900], lineHeight: 1.3 }}>
        {value}
      </Typography>
      {sub ? <Typography variant="caption" component="p" sx={{ m: 0, mt: '2px', color: neutral[600] }}>{sub}</Typography> : null}
      {children}
    </Box>
  );
}

export function AnswerCard({ result, onUsePrice, market }: AnswerCardProps) {
  const t = useTranslations('research.answer');
  const fmt = useDsFormat();
  const [why, setWhy] = React.useState(false);
  const o = React.useMemo(() => opportunityOf(result), [result]);
  const p = result.price;
  const total = result.competition.total.guard.ok ? result.competition.total.value : null;
  const newcomers = result.newcomers.guard.ok ? result.newcomers.value : null;
  // Trendyol shows no shop opening dates: no tile instead of a tile that is always "—".
  const showNewcomers = result.newcomers.guard.ok || result.newcomers.guard.reasonKey !== 'research.guard.notAvailableTrendyol';
  const hasRange = p.p25 != null && p.p75 != null && p.n >= 5 && p.quality !== 'implausible';
  const median = p.median != null && p.n >= 5 && p.quality !== 'implausible' ? p.median : null;

  const reasons: string[] = [];
  if (o.demand) reasons.push(t(`reason.demand.${o.demand}`));
  if (o.competition) reasons.push(t(`reason.competition.${o.competition}`));
  if (o.newcomersOk != null) reasons.push(t(o.newcomersOk ? 'reason.newcomersOk' : 'reason.newcomersHard'));
  if (o.dominated) reasons.push(t('reason.dominated'));
  const priceHint = hasRange ? t('reason.price', { low: fmt.money(p.p25 as number, p.currency), high: fmt.money(p.p75 as number, p.currency) }) : null;

  const bandTone = o.band ? tone[BAND_TONE[o.band]] : tone.neutral;

  return (
    <Box
      component="section"
      aria-label={t('title')}
      sx={{ mb: '16px', p: { xs: '16px', md: '20px' }, borderRadius: `${radius.lg}px`, border: `1px solid ${bandTone.border}`, bgcolor: bandTone.bg }}
      data-testid="research-answer"
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <Box
          sx={{
            flex: '0 0 auto', width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: neutral[0], border: `3px solid ${bandTone.solid}`,
          }}
          data-testid="research-answer-score"
        >
          <Typography component="span" sx={{ fontSize: 24, fontWeight: 800, color: bandTone.fg }}>{o.score ?? '—'}</Typography>
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h2" sx={{ m: 0, fontSize: 20, fontWeight: 700, color: neutral[900] }}>
            {o.band ? t(`band.${o.band}`) : t('band.unknown')}
          </Typography>
          <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[600] }}>
            {t('scoreOf', { max: 100 })} · {t('signal')}
          </Typography>
        </Box>
      </Box>

      <Typography component="p" sx={{ m: 0, mt: '12px', fontSize: 15, color: neutral[800], lineHeight: 1.5 }} data-testid="research-answer-verdict">
        {[...reasons, priceHint].filter(Boolean).join(' ')}
      </Typography>

      {market && (market.loading || market.counted > 0) ? (
        <Box
          sx={{ mt: '14px', p: '12px 14px', borderRadius: `${radius.md}px`, bgcolor: neutral[0], border: `1px solid ${neutral[200]}` }}
          data-testid="research-answer-market"
        >
          <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[500] }}>{t('market.label', { count: market.listed })}</Typography>
          {market.counted >= MIN_COUNTED ? (
            <>
              <Typography component="p" sx={{ m: 0, mt: '2px', fontSize: 20, fontWeight: 800, color: neutral[900] }}>
                {t('market.sales', { count: fmt.num(market.monthlySales) })}
                {market.revenue != null && market.currency ? ` · ${t('market.revenue', { amount: fmt.money(market.revenue, market.currency, { approx: true }) })}` : ''}
              </Typography>
              <Typography variant="caption" component="p" sx={{ m: 0, mt: '2px', color: neutral[600] }}>
                {t('market.basis', { counted: market.counted, listed: market.listed, measured: market.measured })}
              </Typography>
            </>
          ) : (
            <Typography variant="caption" component="p" sx={{ m: 0, mt: '2px', color: neutral[600] }}>
              {market.loading ? t('market.loading') : t('market.few')}
            </Typography>
          )}
        </Box>
      ) : null}

      <Box sx={{ mt: '14px', display: 'grid', gap: '10px', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: showNewcomers ? 'repeat(4, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))' } }}>
        <Tile
          label={t('tile.demand')}
          value={o.demand ? t(`level.${o.demand}`) : t('level.unknown')}
          sub={t('tile.demandSub')}
          toneKey={o.demand ? LEVEL_TONE[o.demand] : undefined}
          testId="research-answer-demand"
        />
        <Tile
          label={t('tile.price')}
          value={median != null ? fmt.money(median, p.currency) : '—'}
          sub={hasRange ? t('tile.priceSub', { low: fmt.money(p.p25 as number, p.currency), high: fmt.money(p.p75 as number, p.currency) }) : t('tile.priceFew')}
          testId="research-answer-price"
        >
          {onUsePrice && median != null ? (
            <Box sx={{ mt: '8px' }}>
              <Button variant="secondary" size="sm" onClick={() => onUsePrice(median, p.currency)} data-testid="research-answer-use-price">
                {t('usePrice')}
              </Button>
            </Box>
          ) : null}
        </Tile>
        <Tile
          label={t('tile.competition')}
          value={o.competition ? t(`competition.${o.competition}`) : '—'}
          sub={total != null ? t('tile.competitionSub', { count: fmt.num(total) }) : null}
          toneKey={o.competition ? COMPETITION_TONE[o.competition] : undefined}
          testId="research-answer-competition"
        />
        {showNewcomers ? <Tile
          label={t('tile.newcomers')}
          value={newcomers != null ? fmt.percent(newcomers) : '—'}
          sub={newcomers != null ? t(o.newcomersOk ? 'tile.newcomersOk' : 'tile.newcomersHard') : t('tile.newcomersNa')}
          toneKey={o.newcomersOk == null ? undefined : o.newcomersOk ? 'success' : 'warning'}
          testId="research-answer-newcomers"
        /> : null}
      </Box>

      <ButtonBase
        onClick={() => setWhy((v) => !v)}
        aria-expanded={why}
        sx={{ mt: '12px', fontSize: 13, color: neutral[700], textDecoration: 'underline', textUnderlineOffset: '3px' }}
        data-testid="research-answer-why"
      >
        {t('why')}
      </ButtonBase>
      {why ? (
        <Box component="ul" sx={{ m: 0, mt: '8px', pl: '18px', color: neutral[700], fontSize: 13, lineHeight: 1.6 }} data-testid="research-answer-parts">
          {o.parts.map((part) => (
            <li key={part.key}>
              {t(`part.${part.key}`, { weight: Math.round(part.weight * 100), value: Math.round(part.value * 100) })}
            </li>
          ))}
          <li>{t('part.note')}</li>
        </Box>
      ) : null}
    </Box>
  );
}

export default AnswerCard;
