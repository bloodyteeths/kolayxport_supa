// Home "Your listings that need work" (research.md §4.1, §4.2): the top 3 by opportunity from the Listing doctor
// (`GET /api/research/home`). No Etsy or eBay store connected → a ConnectState. Each row opens the doctor panel
// (`/app/research/listings?open=<id>`); the card link opens the Listing doctor sorted by opportunity.
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { Button } from '@/components/ds/inputs/Button';
import { Thumb } from '@/components/ds/data/Thumb';
import { ScoreMeter } from '@/components/ds/data/ScoreMeter';
import { ConnectState } from '@/components/ds/state/ConnectState';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { ListSkeleton } from '@/components/ds/state/Skeletons';
import { useDsFormat } from '@/components/ds/data/fmt';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import type { AsyncRegion } from '@/lib/ds/useAsyncState';
import type { DoctorRow, SourceNoteProps } from '@/lib/research/types';
import { MKT_NAME, researchToolHref } from '../ResearchLayout';
import { ApiSourceNote } from '../products/ApiSourceNote';

/** Settings › Connections (same target as components/ui/ConnectEmptyState). */
const CONNECT_HREF = '/ayarlar?tab=connections';

export type NeedsWorkCardProps = {
  /** null = no Etsy/eBay store connected (ConnectState); undefined = connections still loading. */
  doctorMkt: 'etsy' | 'ebay' | null | undefined;
  rows: DoctorRow[];
  total: number;
  source?: SourceNoteProps;
  region: AsyncRegion;
};

/** Pure: the second line of a row: "412 views, 0 sales (30 d)" for traffic without sales, else "4 issues". */
export function needsWorkLine(row: DoctorRow): { key: 'viewsNoSales' | 'issues'; params: Record<string, number> } {
  const views = row.views30d?.guard?.ok ? row.views30d.value : null;
  const sales = row.sales30d?.guard?.ok ? row.sales30d.value : null;
  if (typeof views === 'number' && views > 0 && sales === 0) return { key: 'viewsNoSales', params: { views } };
  return { key: 'issues', params: { count: row.issues ?? 0 } };
}

export function NeedsWorkCard({ doctorMkt, rows, total, source, region }: NeedsWorkCardProps) {
  const t = useTranslations('research');
  const fmt = useDsFormat();
  const mobile = useIsMobile();
  const mkt = doctorMkt ?? 'etsy';
  const doctorHref = researchToolHref('listings', mkt, { sort: 'opportunity' });

  let body: React.ReactNode;
  if (region.state === 'loading') {
    body = <ListSkeleton rows={3} leading="thumb" />;
  } else if (region.state === 'slow') {
    body = <SlowState variant="inline" onRetry={region.retry} />;
  } else if (region.state === 'error') {
    body = <ErrorState variant="inline" title={t('home.needsWorkFailed')} onRetry={region.retry} />;
  } else if (doctorMkt === null) {
    body = <ConnectState brand="etsy" title={t('home.needsWorkConnect')} connectHref={CONNECT_HREF} data-testid="research-needswork-connect" />;
  } else if (region.state === 'empty' || rows.length === 0) {
    body = <EmptyState kind="done" compact title={t('doc.doneEmpty')} />;
  } else {
    body = (
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {rows.map((row) => {
          const line = needsWorkLine(row);
          const href = researchToolHref('listings', mkt, { open: row.listing.id });
          const score = row.listing.health?.score ?? null;
          const text = line.key === 'viewsNoSales' ? t('home.viewsNoSales', { views: fmt.num(line.params.views) }) : t('home.issues', { count: line.params.count });
          const content = (
            <>
              <Thumb src={row.listing.thumbUrl} alt="" size={40} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ color: neutral[900] }}>{row.listing.title}</Typography>
                {mobile ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', color: neutral[600] }}>
                    <ScoreMeter score={score} variant="cell" />
                    <Typography variant="caption" component="span">{text}</Typography>
                  </Box>
                ) : null}
              </Box>
              {mobile ? null : (
                <>
                  <ScoreMeter score={score} variant="cell" />
                  <Typography variant="caption" component="span" sx={{ color: neutral[600], width: 200, flexShrink: 0 }} noWrap>{text}</Typography>
                  <Button variant="ghost" size="sm" href={href} data-testid={`research-fix-${row.listing.id}`}>{t('home.fix')}</Button>
                </>
              )}
            </>
          );
          return (
            <Box component="li" key={row.listing.id} sx={{ borderTop: `1px solid ${neutral[100]}`, '&:first-of-type': { borderTop: 0 } }}>
              {mobile ? (
                <ButtonBase
                  component={NextLink}
                  href={href}
                  sx={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', minHeight: 56, py: '8px', textAlign: 'left', justifyContent: 'flex-start' }}
                  data-testid={`research-needswork-row-${row.listing.id}`}
                >
                  {content}
                  <icons.next size={16} aria-hidden color={neutral[400]} />
                </ButtonBase>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', minHeight: 56, py: '8px' }} data-testid={`research-needswork-row-${row.listing.id}`}>
                  {content}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    );
  }

  const showFooter = doctorMkt && rows.length > 0 && (region.state === 'ready' || region.state === 'stale');
  return (
    <Section
      variant="card"
      title={t('home.needsWork')}
      description={doctorMkt ? <ApiSourceNote source={source} /> : undefined}
      headingLevel={2}
      data-testid="research-needswork"
    >
      {region.state === 'stale' ? <ErrorState variant="stale" onRetry={region.retry} /> : null}
      {body}
      {showFooter ? (
        <Box sx={{ pt: '8px' }}>
          <Button variant="ghost" size="sm" href={doctorHref} trailingIcon={icons.next} data-testid="research-open-doctor">
            {total > rows.length ? t('home.needsWorkMore', { count: total }) : t('home.openDoctor', { marketplace: MKT_NAME[mkt] })}
          </Button>
        </Box>
      ) : null}
    </Section>
  );
}

export default NeedsWorkCard;
