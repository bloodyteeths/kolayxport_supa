// components/domain/listing-editor/stagedMedia.ts — undo one staged media change (editor photo strip, rail
// Revert, PhotoStudio) and name staging refusals with their translated key.
//
// Backend: `PATCH /api/etsy-drafts/[id] { removeMediaIds: string[] }` (1–100 ids; ids not on the draft are
// ignored) un-stages EtsyDraftMedia rows and deletes their staged files. 200 { draft } | 400 BAD_REQUEST |
// 404 DRAFT_NOT_FOUND | 409 DRAFT_SENDING (key draftSync.draftSyncing) | 409 DRAFT_NOT_EDITABLE (key
// draftSync.draftNotEditable). Nothing here talks to Etsy: undo only edits the local draft.
import { EtsyDraftClientError } from '@/lib/etsy/draftClient';

/** Server cap per PATCH (`removeMediaIds` 1–100). */
export const REMOVE_MEDIA_MAX = 100;

/** The media row fields this module reads (DraftMediaRow, StudioMediaRow and the raw API rows all fit). */
export interface MediaRowLike {
  id: string;
  kind: string;
  operation: string;
  etsyMediaId?: string | number | null;
  rank?: number | null;
  altText?: string | null;
}

/**
 * Un-stages media rows of one draft. Ids are de-duplicated and sent in chunks of 100 (one draft, sequential).
 * Returns the draft row the last call answered with (raw API shape). Throws `EtsyDraftClientError` (status,
 * code, `key` relative to the `etsy` namespace) on any non-2xx answer.
 */
export async function removeDraftMedia(draftId: string, mediaIds: ReadonlyArray<string>): Promise<unknown> {
  const ids = [...new Set(mediaIds.map(String).filter(Boolean))];
  if (!draftId || !ids.length) return null;
  let draft: unknown = null;
  for (let i = 0; i < ids.length; i += REMOVE_MEDIA_MAX) {
    const res = await fetch(`/api/etsy-drafts/${encodeURIComponent(draftId)}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ removeMediaIds: ids.slice(i, i + REMOVE_MEDIA_MAX) }),
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) throw new EtsyDraftClientError(res.status, data);
    draft = (data as { draft?: unknown } | null)?.draft ?? null;
  }
  return draft;
}

// ─── Undo plans ─────────────────────────────────────────────────────────────────────────────────────────

/** Ops the draft API replaces in place (one row per image: a new stage deletes the older row). */
const REPLACEABLE = new Set(['reorder', 'update_alt']);

/** A media op that puts a replaced row back (same shape the batch-media / POST /api/etsy-drafts take). */
export type RestoreOp =
  | { kind: 'image'; operation: 'reorder'; etsyMediaId: number; rank: number }
  | { kind: 'image'; operation: 'update_alt'; etsyMediaId: number; altText: string };

export interface MediaUndoPlan {
  /** Rows the change created: un-staged with `removeMediaIds`. */
  removeIds: string[];
  /** Rows the change replaced (an older reorder / alt of the same photo): staged again after the removal. */
  restore: RestoreOp[];
}

/**
 * What undoing one staging call means, from the draft's media before and after it: drop the rows it added and
 * re-stage the reorder / alt rows it replaced (the server deletes a photo's older reorder / alt row when a new
 * one is staged, so "drop the new row" alone would lose the earlier staged value). Deletes of an already-staged
 * delete are no-ops on the server and never show up here.
 */
export function mediaUndoPlan(before: ReadonlyArray<MediaRowLike>, after: ReadonlyArray<MediaRowLike>): MediaUndoPlan {
  const beforeIds = new Set(before.map((m) => m.id));
  const afterIds = new Set(after.map((m) => m.id));
  const removeIds = after.filter((m) => !beforeIds.has(m.id)).map((m) => m.id);
  const restore: RestoreOp[] = [];
  for (const m of before) {
    if (afterIds.has(m.id) || m.kind !== 'image' || !REPLACEABLE.has(m.operation)) continue;
    const etsyMediaId = Number(m.etsyMediaId);
    if (!Number.isFinite(etsyMediaId) || etsyMediaId <= 0) continue;
    if (m.operation === 'reorder' && m.rank != null && Number.isFinite(Number(m.rank))) {
      restore.push({ kind: 'image', operation: 'reorder', etsyMediaId, rank: Number(m.rank) });
    } else if (m.operation === 'update_alt') {
      restore.push({ kind: 'image', operation: 'update_alt', etsyMediaId, altText: String(m.altText ?? '') });
    }
  }
  return { removeIds, restore };
}

export function isEmptyUndo(plan: MediaUndoPlan): boolean {
  return plan.removeIds.length === 0 && plan.restore.length === 0;
}

/**
 * A stored undo plan checked against the draft's media now (a toast Undo runs seconds after the stage).
 * - `null`: stale. A row the change created is gone (a later stage of the same photo's order / alt replaced it,
 *   or it was already un-staged), so restoring the older value would overwrite the newer staged edit.
 * - otherwise the plan to run, with any restore op dropped whose photo already holds a newer row of the same
 *   operation outside `removeIds` (the server keeps one such row per photo, so restoring would replace it).
 */
export function currentUndoPlan(plan: MediaUndoPlan, current: ReadonlyArray<MediaRowLike>): MediaUndoPlan | null {
  const currentIds = new Set(current.map((m) => m.id));
  if (plan.removeIds.some((id) => !currentIds.has(id))) return null;
  const removing = new Set(plan.removeIds);
  const held = new Set(
    current
      .filter((m) => !removing.has(m.id) && m.kind === 'image' && REPLACEABLE.has(m.operation))
      .map((m) => `${m.operation}:${Number(m.etsyMediaId)}`),
  );
  const restore = plan.restore.filter((op) => !held.has(`${op.operation}:${op.etsyMediaId}`));
  return { removeIds: plan.removeIds.slice(), restore };
}

// ─── Rail "Revert" for staged media groups ──────────────────────────────────────────────────────────────

/** The editor's media change groups (changeSummary `mediaGroup`). */
export type MediaChangeGroup = 'photos' | 'photoOrder' | 'altText' | 'video';
export const MEDIA_CHANGE_GROUPS: ReadonlySet<string> = new Set<MediaChangeGroup>(['photos', 'photoOrder', 'altText', 'video']);

/** Same bucketing as changeSummary's `mediaGroup` (so a rail row's Revert drops exactly the rows it counts). */
export function mediaRowGroup(m: Pick<MediaRowLike, 'kind' | 'operation'>): MediaChangeGroup | null {
  if (m.kind === 'video') return 'video';
  if (m.kind !== 'image') return null;
  if (m.operation === 'reorder') return 'photoOrder';
  if (m.operation === 'update_alt') return 'altText';
  if (m.operation === 'upload' || m.operation === 'ai_upload' || m.operation === 'delete') return 'photos';
  return null;
}

/** Row ids of one media group (rail Revert of "Photos" / "Photo order" / "Alt text" / "Video"). */
export function mediaIdsForGroup(media: ReadonlyArray<MediaRowLike> | null | undefined, group: string): string[] {
  return (media ?? []).filter((m) => mediaRowGroup(m) === group).map((m) => m.id);
}

// ─── Staging refusals (a send in progress / a draft that can no longer be edited) ───────────────────────

/**
 * Codes the staging routes answer while a draft is being sent (`DRAFT_SENDING` single routes + batch-media,
 * `DRAFT_SYNCING` batch-stage items and eBay) or once it is not editable.
 */
export const SENDING_CODES: ReadonlySet<string> = new Set(['DRAFT_SENDING', 'DRAFT_SYNCING']);

/** `etsy`-relative key for a staging refusal code (used when the server sent a code without a key). */
export function stagingRefusalKey(code: string | null | undefined): string | null {
  if (!code) return null;
  if (SENDING_CODES.has(code)) return 'draftSync.draftSyncing';
  if (code === 'DRAFT_NOT_EDITABLE') return 'draftSync.draftNotEditable';
  return null;
}

/** True when the error / item result says the draft is being sent right now. */
export function isSendingRefusal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; key?: unknown };
  if (typeof e.code === 'string' && SENDING_CODES.has(e.code)) return true;
  return typeof e.key === 'string' && /(^|\.)draftSync\.draftSyncing$/.test(e.key);
}

/** Key of a staging refusal, `etsy`-relative (`draftSync.*`); a full `etsy.` key is made relative. */
export function etsyRelativeKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return key.startsWith('etsy.') ? key.slice(5) : key;
}

/**
 * The translated-key target of a failed stage: the server's key (made `etsy`-relative), else the refusal key
 * for its code, else null (callers fall back to their generic text).
 */
export function stagingErrorKey(err: { code?: string | null; key?: string | null } | null | undefined): string | null {
  if (!err) return null;
  return etsyRelativeKey(err.key) ?? stagingRefusalKey(err.code);
}

/** Full (root-namespace) keys of the refusals the editor footer names instead of the generic "Couldn't save". */
export function isRefusalKey(fullKey: string | null | undefined): boolean {
  return typeof fullKey === 'string' && /(^|\.)draftSync\.(draftSyncing|draftNotEditable)$/.test(fullKey);
}
