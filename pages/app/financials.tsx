// /app/financials — legacy Financials. Flag `reports` (lib/ds/uiFlags.ts, finance-analytics §0.3): on → `router.replace`
// to Reports › Profit (`/app/reports/profit`), keeping the query string, so old links and bookmarks land on the new tab;
// off → the legacy page, moved unchanged to components/legacy/reports/LegacyFinancialsPage.tsx (deleted one release
// after the flag flips, then this route becomes a next.config 308 redirect, §8).
import * as React from 'react';
import { useRouter } from 'next/router';
import LegacyFinancialsPage from '@/components/legacy/reports/LegacyFinancialsPage';
import { useReportsFlag } from '@/components/domain/reports/ReportsPage';
import type { UrlQuery } from '@/lib/ds/useUrlState';

/** Pure: the Profit tab href for a legacy `/app/financials` query (every pair kept). */
function financialsRedirectHref(query: UrlQuery = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    for (const s of Array.isArray(v) ? v : [v]) sp.append(k, s);
  }
  const qs = sp.toString();
  return qs ? `/app/reports/profit?${qs}` : '/app/reports/profit';
}

export default function FinancialsRoute() {
  const router = useRouter();
  const flag = useReportsFlag();
  const ready = Boolean(router?.isReady);
  React.useEffect(() => {
    if (flag === 'on' && ready) void router.replace(financialsRedirectHref((router.query ?? {}) as UrlQuery));
  }, [flag, ready, router]);
  // `pending` (server + first client render): nothing, so neither page flashes before the viewer's override is known.
  if (flag !== 'off') return null;
  return <LegacyFinancialsPage />;
}
