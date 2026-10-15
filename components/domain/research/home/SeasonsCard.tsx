// Home "Upcoming seasons (shipping from Türkiye)" (research.md §4.1): deterministic events (R1-A seasons table)
// with the order-by date = last ship date (median transit from the user's own labels, else rate-card Estimate)
// minus the viewer's production days (Popover + NumberField, localStorage in v1). Each row opens Product finder
// with the event's seed. Names: `research.season.<key>` (falls back to the key when the message is missing).
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { Button } from '@/components/ds/inputs/Button';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { FormField } from '@/components/ds/inputs/FormField';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { SlowState } from '@/components/ds/state/SlowState';
import { ListSkeleton } from '@/components/ds/state/Skeletons';
import { useDsFormat } from '@/components/ds/data/fmt';
import { icons } from '@/lib/ds/icons';
import { neutral, zIndex } from '@/lib/ds/tokens';
import { MAX_PRODUCTION_DAYS, useSeasons, type SeasonView } from '@/lib/research/hooks/useSeasons';
import type { ResearchMkt } from '@/lib/research/types';
import { researchToolHref } from '../ResearchLayout';
import { ApiSourceNote } from '../products/ApiSourceNote';

export type SeasonsCardProps = {
  mkt: ResearchMkt;
  country?: string;
  /** Test seam. */
  now?: Date;
};

function useSeasonName() {
  const root = useTranslations();
  return (key: string) => {
    const k = `research.season.${key}`;
    return root.has(k) ? root(k) : key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  };
}

/** Pure: Product finder seed for a season row (API seed, else the English event key words). */
export function seasonSeed(row: Pick<SeasonView, 'key' | 'seed'>): string {
  if (row.seed && row.seed.trim()) return row.seed.trim();
  return row.key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase();
}

export function SeasonsCard({ mkt, country, now }: SeasonsCardProps) {
  const t = useTranslations('research');
  const tc = useTranslations('common');
  const fmt = useDsFormat();
  const seasonName = useSeasonName();
  const { rows, source, region, productionDays, setProductionDays } = useSeasons(country, now);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [draftDays, setDraftDays] = React.useState<number | null>(productionDays);
  const productMkt = mkt === 'amazon' ? 'etsy' : mkt;

  const openEditor = (el: HTMLElement) => {
    setDraftDays(productionDays);
    setAnchor(el);
  };
  const save = () => {
    if (draftDays !== null) setProductionDays(draftDays);
    setAnchor(null);
  };

  let body: React.ReactNode;
  if (region.state === 'loading') body = <ListSkeleton rows={3} leading="none" />;
  else if (region.state === 'slow') body = <SlowState variant="inline" onRetry={region.retry} />;
  else if (region.state === 'error') body = <ErrorState variant="inline" title={t('home.seasonsFailed')} onRetry={region.retry} />;
  else if (rows.length === 0) body = <EmptyState kind="done" compact title={t('home.seasonsEmpty')} />;
  else {
    body = (
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {rows.map((row) => {
          const href = researchToolHref('products', productMkt, { q: seasonSeed(row) });
          const listBy =
            row.listByDate && row.daysLeft !== null && row.daysLeft >= 0
              ? t('home.listBy', { date: fmt.date(row.listByDate), days: row.daysLeft })
              : t('home.listByPassed', { date: fmt.date(row.date) });
          return (
            <Box component="li" key={`${row.key}-${row.country ?? ''}-${row.date}`} sx={{ borderTop: `1px solid ${neutral[100]}`, '&:first-of-type': { borderTop: 0 } }}>
              <ButtonBase
                component={NextLink}
                href={href}
                sx={{ display: 'flex', alignItems: 'flex-start', gap: '12px', width: '100%', py: '8px', minHeight: 44, textAlign: 'left', justifyContent: 'flex-start' }}
                data-testid={`research-season-${row.key}`}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ color: neutral[900], fontWeight: 500 }}>
                    {row.country ? `${seasonName(row.key)} (${row.country})` : seasonName(row.key)}
                  </Typography>
                  <Typography variant="caption" component="p" sx={{ m: 0, color: row.daysLeft !== null && row.daysLeft >= 0 && row.daysLeft <= 14 ? neutral[900] : neutral[600] }}>
                    {listBy}
                  </Typography>
                  {row.lastShip?.date ? (
                    <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[500] }}>
                      {t('home.lastShip', { carrier: row.lastShip.carrier, date: fmt.date(row.lastShip.date) })}
                    </Typography>
                  ) : null}
                </Box>
                <icons.next size={16} aria-hidden color={neutral[400]} />
              </ButtonBase>
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Section variant="card" title={t('home.seasons')} description={<ApiSourceNote source={source} />} data-testid="research-seasons">
      {region.state === 'stale' ? <ErrorState variant="stale" onRetry={region.retry} /> : null}
      {body}
      <Box sx={{ pt: '8px' }}>
        <Button variant="ghost" size="sm" icon={icons.edit} onClick={(e) => openEditor(e.currentTarget)} aria-haspopup="dialog" data-testid="research-production-days">
          {t('home.productionDays', { days: productionDays })}
        </Button>
      </Box>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        sx={{ zIndex: zIndex.popover }}
        slotProps={{ paper: { sx: { p: '16px', width: 280 } } }}
      >
        <Box
          component="form"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            save();
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <FormField label={t('home.productionDaysLabel')} helper={t('home.productionDaysHelp')}>
            <NumberField value={draftDays} onChange={setDraftDays} min={0} max={MAX_PRODUCTION_DAYS} unit={t('home.daysUnit')} autoFocus data-testid="research-production-days-input" />
          </FormField>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="ghost" size="sm" onClick={() => setAnchor(null)}>{tc('cancel')}</Button>
            <Button variant="primary" size="sm" type="submit" data-testid="research-production-days-save">{tc('save')}</Button>
          </Box>
        </Box>
      </Popover>
    </Section>
  );
}

export default SeasonsCard;
