import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { syncDraft } from '@/lib/etsy/draftService';
import { isEtsyDraftError } from '@/lib/etsy/draftErrors';

// Etsy public limit is ~10 req/s per shop with a small burst budget. Each
// syncDraft call itself fires multiple Etsy requests (PATCH listing, PUT
// inventory, taxonomy props, media ops). We target ~4 r/s of *syncDraft starts*
// so the bursts inside one draft don't push us past the shop limit. That keeps
// a 50-draft bulk under ~30s on the happy path while staying well clear of 429s.
const INTER_DRAFT_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type DraftResult = {
  draftId: string;
  status: string;
  reason?: string;
  count?: number;
  error?: string;
  code?: string;
  key?: string;
  warnings?: any[];
};

const MAX_BULK_DRAFTS = 500;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const draftIds = Array.isArray(req.body?.draftIds) ? req.body.draftIds : [];
  if (draftIds.length === 0) return res.status(400).json({ error: 'draftIds is required' });
  if (draftIds.length > MAX_BULK_DRAFTS) return res.status(400).json({ error: `At most ${MAX_BULK_DRAFTS} drafts per bulk sync` });
  // Explicit opt-in to overwrite listings that changed on Etsy (default false:
  // such drafts come back as 'conflict' and are left untouched).
  const force = req.body?.force === true;

  const results: DraftResult[] = [];
  for (let i = 0; i < draftIds.length; i++) {
    const draftId = String(draftIds[i]);
    try {
      const result = (await syncDraft(draftId, user.id, { force })) as DraftResult;
      results.push(result);
    } catch (err: any) {
      results.push({
        draftId,
        status: 'failed',
        error: err?.message || 'Sync failed',
        ...(isEtsyDraftError(err) ? { code: err.code, key: err.key } : {}),
      });
    }
    // Serialized loop with a small inter-request delay so we don't burst past
    // Etsy's 10 r/s shop limit. Skip the delay after the final draft.
    if (i < draftIds.length - 1) await sleep(INTER_DRAFT_DELAY_MS);
  }

  const success = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'failed');
  const conflicts = results.filter((r) => r.status === 'conflict');
  // Drafts with nothing left to send were cancelled without calling Etsy: neither sent nor failed.
  const empty = results.filter((r) => r.status === 'skipped' && r.reason === 'empty');

  return res.status(200).json({
    results,
    success,
    failed: failed.length,
    conflicts: conflicts.length,
    skipped: empty.length,
    emptyDrafts: empty.map((r) => r.draftId),
    // Surface partial failures so the UI can tell the user *which* drafts to
    // retry instead of showing a single generic error.
    failedDrafts: failed.map((r) => ({ draftId: r.draftId, error: r.error || 'Sync failed' })),
    conflictDrafts: conflicts.map((r) => ({ draftId: r.draftId, error: r.error, code: r.code })),
    partialDrafts: results.filter((r) => r.status === 'success' && r.warnings?.length).map((r) => ({ draftId: r.draftId, warnings: r.warnings })),
  });
}
