// Product finder "Demand Signal" card (research.md §5.1, RR §6.2): 5-dot tier from 2–3 indirect inputs (Google
// interest, autocomplete presence, engagement). Never a volume: Etsy shares no search volume ("Signal · why?").
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { SignalDots } from '@/components/ds/research/SignalDots';
import { neutral } from '@/lib/ds/tokens';
import type { DemandSignal } from '@/lib/research/types';
import { useDemandInputLines } from './cardParts';

export function DemandCard({ demand }: { demand: DemandSignal }) {
  const t = useTranslations('research');
  const tk = useTranslations('ds.research');
  const lines = useDemandInputLines()(demand.inputs);
  const okInputs = lines.filter((l) => l.ok);
  return (
    <Section variant="card" title={t('card.demand')} data-testid="research-card-demand" sx={{ mb: 0, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <SignalDots tier={demand.tier} inputs={okInputs.map(({ label, value }) => ({ label, value }))} />
        {demand.tier !== null ? (
          <Typography variant="titleSm" component="span" sx={{ color: neutral[900] }}>{t(`signal.tier${demand.tier}`)}</Typography>
        ) : (
          <Typography variant="caption" component="span" sx={{ color: neutral[600] }}>{t('guard.notEnoughSignal')}</Typography>
        )}
      </Box>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: '6px', p: 0 }}>
        {lines.map((l) => (
          <Typography key={l.label} component="li" variant="caption" sx={{ color: l.ok ? neutral[700] : neutral[500] }}>
            {tk('inputLine', { label: l.label, value: l.value })}
          </Typography>
        ))}
      </Box>
      <Tooltip title={t('card.demandNote')}>
        <Typography variant="caption" component="p" tabIndex={0} sx={{ m: 0, mt: '4px', color: neutral[500], textDecoration: 'underline dotted', width: 'fit-content' }}>
          {t('card.signalWhy', { kind: tk('kind.signal') })}
        </Typography>
      </Tooltip>
    </Section>
  );
}

export default DemandCard;
