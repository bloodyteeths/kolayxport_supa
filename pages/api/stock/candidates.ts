import type { NextApiRequest, NextApiResponse } from 'next';
import { stockAuth, serverError, qstr } from '@/lib/stock/api';
import { listChannelAccounts, salesCoverage, wizardSuggestions } from '@/lib/stock/candidates';

export const config = { maxDuration: 120 };

const MAX_LIST = 400;

/**
 * GET /api/stock/candidates?channels=etsy,trendyol
 * -> { channels, groups, unmatched, unmatchedTotal, loose, titles, coverage, candidateCount }
 * Local caches only (no marketplace calls). Loose / title suggestions are
 * never auto-linked.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await stockAuth(req, res, ['GET']);
  if (!userId) return;
  try {
    const channels = (qstr(req.query.channels) || '').split(',').map((s) => s.trim()).filter(Boolean);
    const [accounts, sugg, coverage] = await Promise.all([
      listChannelAccounts(userId),
      wizardSuggestions(userId, channels.length ? channels : undefined),
      salesCoverage(userId),
    ]);
    const multi = sugg.groups.filter((g) => g.multiChannel);
    const single = sugg.groups.filter((g) => !g.multiChannel);
    return res.status(200).json({
      channels: accounts,
      groups: [...multi, ...single.slice(0, Math.max(0, MAX_LIST - multi.length))],
      groupsTotal: sugg.groups.length,
      multiChannelGroups: multi.length,
      unmatched: sugg.unmatched.slice(0, MAX_LIST),
      unmatchedTotal: sugg.unmatched.length,
      loose: sugg.loose.slice(0, 100),
      titles: sugg.titles.slice(0, 100),
      coverage,
      candidateCount: sugg.candidateCount,
      linkedCount: sugg.linkedCount,
    });
  } catch (err) {
    return serverError(res, 'candidates', err, userId);
  }
}
