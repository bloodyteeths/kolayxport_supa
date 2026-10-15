// /app/research/keywords — Keyword explorer (research.md §6, R2-B). Behind the `research` flag (lib/ds/uiFlags.ts,
// DS §7.1.5), gated with R1-C's `useResearchRouteGate` (pending until the viewer's `?ui=` override is resolved, so an
// opted-in viewer is never bounced to the legacy page and back): on → ResearchLayout + KeywordExplorer; off →
// forwards to the legacy keyword tool (Etsy research tab / eBay keyword intelligence); off but the build default is
// on → a link instead of a redirect (the legacy page would redirect back to the hub).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import withAuth from '@/components/withAuth';
import { useResearchRouteGate } from '@/components/domain/research/ResearchLayout';
import { KeywordExplorer } from '@/components/domain/research/keywords/KeywordExplorer';
import { legacyKeywordsHref } from '@/components/domain/research/keywords/keywordModel';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { icons } from '@/lib/ds/icons';

function KeywordExplorerPage() {
  return <KeywordExplorer variant="page" />;
}

const KeywordExplorerWithAuth = withAuth(KeywordExplorerPage);

export default function ResearchKeywordsRoute() {
  const t = useTranslations('research');
  const router = useRouter();
  const { state } = useResearchRouteGate();
  const q = router?.query?.mkt;
  const legacy = legacyKeywordsHref(Array.isArray(q) ? q[0] : q);
  React.useEffect(() => {
    if (state === 'off-redirect' && router?.isReady) void router.replace(legacy);
  }, [state, router, legacy]);
  if (state === 'on') return <KeywordExplorerWithAuth />;
  if (state === 'off-link') {
    return (
      <Box sx={{ p: '24px' }}>
        <EmptyState
          kind="first-use"
          icon={icons.research}
          title={t('legacy.title')}
          action={{ id: 'legacy', label: t('legacy.open'), href: legacy }}
          data-testid="research-legacy-link"
        />
      </Box>
    );
  }
  return null;
}
