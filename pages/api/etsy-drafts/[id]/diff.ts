import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import * as draftService from '@/lib/etsy/draftService';

// Looked up by a non-constant key so bundlers do not statically resolve a
// missing export before BR-3 lands (webpack warns, Turbopack errors).
const BR3_EXPORT: string = ['getDraftDiff'].join('');
import { draftErrorResponse } from '@/lib/etsy/draftErrors';
import { decodeEntities } from '@/lib/text/decodeEntities';

// GET /api/etsy-drafts/:id/diff  (listing-editor §6.4 / §7.1 G1)
// Read-only field-level comparison of a draft against the live Etsy listing,
// powering the "Review differences" panel. Never writes, never sends.
// The comparison itself is backend BR-3 `getDraftDiff` in lib/etsy/draftService.ts
// (import-only here); until it ships this route answers 501 NOT_AVAILABLE so
// the UI can fall back to the plain conflict banner.

export interface DraftDiffField {
  /** Etsy listing field key (`title`, `price`, `tags`, ...). */
  key: string;
  /** Value in the draft's base snapshot (what the draft started from). */
  base: unknown;
  /** Value on Etsy now. */
  remote: unknown;
  /** Value staged in the draft's fieldPatch (undefined when `inDraft` is false). */
  draft: unknown;
  /** Etsy changed this field after the draft started. */
  changedRemotely: boolean;
  /** The draft stages a change to this field. */
  inDraft: boolean;
}

export interface DraftDiffResponse {
  /** ISO time of Etsy's `updated_timestamp` for the live listing, or null. */
  remoteUpdatedAt: string | null;
  /** Sorted: fields both sides touched first, then draft-only, then Etsy-only. */
  fields: DraftDiffField[];
  /** The draft's queuedActions, a queued `delete` first. */
  queuedActions: Array<{ type: string; [k: string]: unknown }>;
  /** Convenience for the panel: a queued listing delete is present. */
  hasQueuedDelete: boolean;
}

type GetDraftDiff = (draftId: string, userId: string) => Promise<{
  remoteUpdatedAt: string | number | Date | null;
  fields: DraftDiffField[];
  queuedActions: unknown;
}>;

/** Keys whose Etsy values arrive HTML-entity encoded ("one&#39;s"); decoded for display only. */
const TEXT_KEYS = new Set(['title', 'description', 'tags', 'materials', 'personalization_instructions', 'style']);

function decodeValue(key: string, value: unknown): unknown {
  if (!TEXT_KEYS.has(key)) return value;
  if (typeof value === 'string') return decodeEntities(value);
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? decodeEntities(v) : v));
  return value;
}

function toIso(v: string | number | Date | null | undefined): string | null {
  if (v == null || v === '') return null;
  // Etsy timestamps are unix seconds; accept ms, ISO strings and Dates too.
  const d = v instanceof Date ? v : typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rank(f: DraftDiffField): number {
  if (f.inDraft && f.changedRemotely) return 0;
  if (f.inDraft) return 1;
  return 2;
}

/** Pure shaping of the BR-3 result into the public response (exported for tests). */
export function shapeDraftDiff(raw: Awaited<ReturnType<GetDraftDiff>>): DraftDiffResponse {
  const fields = (Array.isArray(raw?.fields) ? raw.fields : [])
    .filter((f) => f && typeof f.key === 'string' && (f.inDraft || f.changedRemotely))
    .map((f) => ({
      key: f.key,
      base: decodeValue(f.key, f.base),
      remote: decodeValue(f.key, f.remote),
      draft: f.inDraft ? decodeValue(f.key, f.draft) : undefined,
      changedRemotely: Boolean(f.changedRemotely),
      inDraft: Boolean(f.inDraft),
    }))
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map(({ f }) => f);

  const actions = (Array.isArray(raw?.queuedActions) ? raw.queuedActions : [])
    .filter((a): a is { type: string } => Boolean(a) && typeof (a as { type?: unknown }).type === 'string');
  const queuedActions = [...actions.filter((a) => a.type === 'delete'), ...actions.filter((a) => a.type !== 'delete')];

  return {
    remoteUpdatedAt: toIso(raw?.remoteUpdatedAt ?? null),
    fields,
    queuedActions,
    hasQueuedDelete: queuedActions.some((a) => a.type === 'delete'),
  };
}

function resolveImpl(): GetDraftDiff | null {
  const fn = Reflect.get(draftService, BR3_EXPORT) as unknown;
  return typeof fn === 'function' ? (fn as GetDraftDiff) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  const getDraftDiff = resolveImpl();
  if (!getDraftDiff) {
    return res.status(501).json({ error: 'Review differences is not available yet', code: 'NOT_AVAILABLE', key: 'draftSync.reviewUnavailable' });
  }

  try {
    const raw = await getDraftDiff(id, user.id);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(draftService.toSerializable(shapeDraftDiff(raw)));
  } catch (err: unknown) {
    const { status, body } = draftErrorResponse(err, 'Could not compare the draft with Etsy');
    return res.status(status).json(body);
  }
}
