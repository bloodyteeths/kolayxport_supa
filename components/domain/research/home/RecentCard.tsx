// Home "Recent and watched" (research.md §4.1): the viewer's recent searches (localStorage, 10) merged with watched
// items from `GET /api/research/home` (`recentWatched`: R3 watches + tracked keywords), newest first. Not rendered
// when both are empty.
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { useDsFormat } from '@/components/ds/data/fmt';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import { MKT_NAME, RESEARCH_TABS, researchToolHref, type ResearchTab } from '../ResearchLayout';
import type { RecentSearch } from './recentSearches';
import type { RecentWatchedItem } from '@/lib/research/types';

export type RecentItem = { id: string; label: string; meta: string[]; href: string; at: string };

export type RecentCardProps = {
  searches: RecentSearch[];
  watched: RecentWatchedItem[];
  limit?: number;
};

/** Pure: merge, newest first. */
export function mergeRecent<A extends { at: string }>(a: A[], b: A[], limit = 8): A[] {
  return [...a, ...b].sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).slice(0, limit);
}

export function RecentCard({ searches, watched, limit = 8 }: RecentCardProps) {
  const t = useTranslations('research');
  const root = useTranslations();
  const fmt = useDsFormat();

  const toolLabel = (kind: string) => ((RESEARCH_TABS as readonly string[]).includes(kind) ? t(`tabs.${kind as ResearchTab}`) : null);

  const fromSearches: RecentItem[] = searches.map((s, i) => ({
    id: `s${i}-${s.at}`,
    label: s.q,
    meta: [t(`tabs.${s.tool}`), MKT_NAME[s.mkt]],
    href: s.href ?? researchToolHref(s.tool, s.mkt, s.tool === 'home' ? {} : { q: s.q }),
    at: s.at,
  }));
  const fromWatched: RecentItem[] = watched
    .filter((w) => typeof w.href === 'string' && w.href.startsWith('/') && typeof w.label === 'string')
    .map((w, i) => ({
      id: `w${i}-${w.at}`,
      label: w.label,
      meta: [
        ...(w.change && root.has(w.change.key) ? [root(w.change.key, w.change.params ?? {})] : []),
        ...(toolLabel(w.kind) ? [toolLabel(w.kind) as string] : []),
      ],
      href: w.href,
      at: w.at,
    }));
  const items = mergeRecent(fromSearches, fromWatched, limit);
  if (items.length === 0) return null;

  return (
    <Section variant="card" title={t('home.recent')} data-testid="research-recent">
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {items.map((it) => (
          <Box component="li" key={it.id} sx={{ borderTop: `1px solid ${neutral[100]}`, '&:first-of-type': { borderTop: 0 } }}>
            <ButtonBase
              component={NextLink}
              href={it.href}
              sx={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', minHeight: 44, py: '6px', textAlign: 'left', justifyContent: 'flex-start' }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ color: neutral[900] }}>{it.label}</Typography>
                <Typography variant="caption" component="p" noWrap sx={{ m: 0, color: neutral[500] }}>
                  {[...it.meta, fmt.relative(it.at)].join(' · ')}
                </Typography>
              </Box>
              <icons.next size={16} aria-hidden color={neutral[400]} />
            </ButtonBase>
          </Box>
        ))}
      </Box>
    </Section>
  );
}

export default RecentCard;
