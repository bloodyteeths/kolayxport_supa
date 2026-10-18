// Research Home `/app/research` (research.md §4): one big search (the page's one primary, "Research"), five
// question chips, then "Your listings that need work" + "Recent and watched" (8fr) next to "Upcoming seasons"
// (4fr) at ≥ 1200, one column below. No StickyActionBar on mobile (no state-driven primary).
//
// Smart search (§4.3): `routeResearchSearch` maps links (Etsy listing/shop, eBay item/seller, Trendyol, ASIN) and
// plain ideas to a tool. ⌘K "Research: {text}" lands here with `?q=`, which is routed once on arrival.
import * as React from 'react';
import { useRouter } from 'next/router';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { SearchField } from '@/components/ds/toolbar/SearchField';
import { Button } from '@/components/ds/inputs/Button';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { urlField, useUrlState } from '@/lib/ds/useUrlState';
import { readListingsCsv } from '@/lib/listings/csvImport';
import { ResearchLayout, useResearchMkt } from '../ResearchLayout';
import { NeedsWorkCard } from './NeedsWorkCard';
import { SeasonsCard } from './SeasonsCard';
import { RecentCard } from './RecentCard';
import { QuestionChips } from './QuestionChips';
import { NichesCard } from './NichesCard';
import { readRecentSearches, rememberSearch, toolOfHref, type RecentSearch } from './recentSearches';
import { routeResearchSearch, type QuestionKey } from './routeSearch';
import { useResearchHome } from './useResearchHome';

const HOME_SCHEMA = { q: urlField.string(undefined, { maxLength: 500 }) };

/** Own-shop check for a pasted Etsy listing link (DB cache only, via the listings export endpoint). */
export async function isOwnEtsyListing(id: string): Promise<boolean> {
  if (!/^\d{3,15}$/.test(id)) return false;
  const res = await fetch(`/api/listings/export?marketplace=etsy&ids=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
  if (!res.ok) return false;
  return readListingsCsv(await res.text()).has(id);
}

export type ResearchHomeProps = {
  /** Test seam for the seasons card. */
  now?: Date;
};

export function ResearchHome({ now }: ResearchHomeProps = {}) {
  const t = useTranslations('research');
  const router = useRouter();
  const mobile = useIsMobile();
  const market = useResearchMkt('home');
  const { mkt } = market;
  const [url, setUrl, urlHelpers] = useUrlState(HOME_SCHEMA);
  const [draft, setDraft] = React.useState('');
  const [hint, setHint] = React.useState<QuestionKey | null>(null);
  const [routing, setRouting] = React.useState(false);
  const searchBox = React.useRef<HTMLDivElement | null>(null);

  const home = useResearchHome(mkt);

  const [recent, setRecent] = React.useState<RecentSearch[]>([]);
  React.useEffect(() => setRecent(readRecentSearches()), []);

  const go = React.useCallback(
    async (input: string, question?: QuestionKey) => {
      const text = input.trim();
      if (!text) return;
      setRouting(true);
      try {
        const href = await routeResearchSearch(text, { mkt, question, isOwnEtsyListing });
        // Remember the resolved href, not a guessed tool + raw text: a pasted shop/own-listing link replays as itself.
        rememberSearch({ q: text, tool: toolOfHref(href), mkt, href });
        await router.push(href);
      } finally {
        setRouting(false);
      }
    },
    [mkt, router],
  );

  // ⌘K "Research: {text}" → `/app/research?q=` → route once.
  const routedQ = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!urlHelpers.ready || !url.q || routedQ.current === url.q) return;
    routedQ.current = url.q;
    setDraft(url.q);
    setUrl({ q: undefined });
    void go(url.q);
  }, [urlHelpers.ready, url.q, setUrl, go]);

  const focusSearch = () => {
    const input = searchBox.current?.querySelector('input');
    input?.focus();
  };

  const onQuestion = (key: QuestionKey) => {
    if (draft.trim()) {
      void go(draft, key);
      return;
    }
    // Empty query: focus the search with a placeholder hint for that question (§4.1).
    setHint(key);
    focusSearch();
  };

  return (
    <ResearchLayout tab="home" market={market} mobilePrimary="none">
      <Box sx={{ maxWidth: 880, display: 'flex', flexDirection: 'column', gap: '12px', mb: '32px' }}>
        <Box
          ref={searchBox}
          component="form"
          role="search"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            void go(draft, hint ?? undefined);
          }}
          sx={{ display: 'flex', gap: '8px', flexDirection: mobile ? 'column' : 'row', alignItems: mobile ? 'stretch' : 'center' }}
        >
          <Box sx={{ flex: 1, minWidth: 0, '& input': mobile ? { fontSize: 16 } : undefined }}>
            <SearchField
              value={draft}
              onChange={setDraft}
              onSubmit={(v) => void go(v, hint ?? undefined)}
              debounceMs={0}
              size="md"
              fullWidth
              placeholder={hint ? t(`qHint.${hint}`) : mobile ? t('search.placeholderShort') : t('search.placeholder')}
              ariaLabel={t('search.placeholder')}
              data-testid="research-home-search"
            />
          </Box>
          <Button
            variant="primary"
            size={mobile ? 'lg' : 'md'}
            type="submit"
            fullWidth={mobile}
            loading={routing}
            loadingLabel={t('search.loading')}
            data-testid="research-home-submit"
          >
            {t('search.cta')}
          </Button>
        </Box>
        <QuestionChips onPick={onQuestion} disabled={routing} />
      </Box>

      {mkt === 'etsy' ? (
        <Box sx={{ mb: '24px' }}>
          <NichesCard />
        </Box>
      ) : null}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 8fr) minmax(0, 4fr)' },
          columnGap: '24px',
          alignItems: 'start',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <NeedsWorkCard doctorMkt={home.needsWorkMkt} rows={home.needsWork} total={home.needsWorkTotal} source={home.source} region={home.region} />
          {mobile ? <SeasonsCard mkt={mkt} now={now} /> : null}
          <RecentCard searches={recent} watched={home.recentWatched} />
        </Box>
        {mobile ? null : (
          <Box sx={{ minWidth: 0 }}>
            <SeasonsCard mkt={mkt} now={now} />
          </Box>
        )}
      </Box>
    </ResearchLayout>
  );
}

export default ResearchHome;
