// /app/financials — old Financials URL: `router.replace` to Reports › Profit (`/app/reports/profit`), keeping the
// query string, so old links and bookmarks land on the new tab (finance-analytics §8).
import * as React from 'react';
import { useRouter } from 'next/router';
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
  const ready = Boolean(router?.isReady);
  React.useEffect(() => {
    if (ready) void router.replace(financialsRedirectHref((router.query ?? {}) as UrlQuery));
  }, [ready, router]);
  return null;
}
