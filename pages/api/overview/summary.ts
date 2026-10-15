/**
 * GET /api/overview/summary — the one Overview call (overview.md §4). Behind the client flag
 * 'overview' (the route itself is harmless when the flag is off: nothing calls it).
 *
 * Query:
 *   tz        IANA zone from `Intl.supportedValuesOf('timeZone')` or 'UTC'; else Europe/Istanbul.
 *   currency  'TRY' | 'USD'; else `localeConfig.defaultCurrency` for `locale`, else TRY.
 *   locale    optional 'tr' | 'en' (the client's app locale), only used for the currency default.
 *
 * 200 → OverviewSummary (lib/overview/types.ts). One failed section is `null` + listed in
 *       `errors`; the route never answers 500 for a section failure.
 * 401 → { error } without a session. 405 → { error } for non-GET (Allow: GET).
 * 500 → { error, requestId } only if composing the summary itself threw.
 * Always `Cache-Control: private, no-store`.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'crypto';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getOverviewSummary, parseOverviewCurrency, parseOverviewTz } from '@/lib/overview/summary';
import type { OverviewSummary, OverviewSummaryError } from '@/lib/overview/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse<OverviewSummary | OverviewSummaryError>) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const query = req.query ?? {};
  const tz = parseOverviewTz(query.tz);
  const locale = typeof query.locale === 'string' ? query.locale : null;
  const currency = parseOverviewCurrency(query.currency, locale);
  const requestId = randomUUID();

  try {
    const summary = await getOverviewSummary({ userId: user.id, tz, currency, requestId });
    return res.status(200).json(summary);
  } catch (error) {
    try {
      void logger.error('[overview] summary failed', error instanceof Error ? error : new Error(String(error)), {
        requestId,
        userId: user.id,
      });
    } catch {
      /* never let logging mask the response */
    }
    return res.status(500).json({ error: 'Failed to load overview', requestId });
  }
}
