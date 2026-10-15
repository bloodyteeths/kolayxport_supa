// components/domain/listing-editor/useStagedMediaUndo.ts — the M6 editor's staged-media undo (Etsy only).
// Feeds PhotosSection's `removeStagedMedia` (ImageManager / VideoUploader: undo a staged photo/video removal,
// remove a staged upload, drop a staged alt text) and the rail's Revert for the media change groups (Photos,
// Photo order, Alt text, Video). Both go through `PATCH /api/etsy-drafts/[id] { removeMediaIds }`; nothing is
// sent to Etsy. A refusal (409 DRAFT_SENDING / DRAFT_NOT_EDITABLE) is thrown as `EtsyDraftClientError` so the
// callers show the translated key (`etsy.draftSync.draftSyncing` / `etsy.draftSync.draftNotEditable`).
import * as React from 'react';
import type { ChangeSummary, DraftRow } from '@/lib/listingEditor/types';
import { MEDIA_CHANGE_GROUPS, mediaIdsForGroup, removeDraftMedia } from './stagedMedia';

export interface UseStagedMediaUndoInput {
  /** Etsy editor with a loaded draft engine (eBay / catalog editors pass false: no media rows). */
  enabled: boolean;
  draft: DraftRow | null;
  reloadDraft: () => Promise<DraftRow | null>;
}

export interface UseStagedMediaUndo {
  /** PhotosSection prop; undefined when disabled (the sub-editors then keep their "Discard changes" fallback). */
  removeStagedMedia: ((draftMediaId: string) => Promise<void>) | undefined;
  /** A rail row the media undo can revert (draft-only media group with staged rows, no unsaved strip edit). */
  canRevert: (change: Pick<ChangeSummary, 'group' | 'kind' | 'fields' | 'source'>) => boolean;
  /** Drops every staged row of the change's media group, then re-reads the draft. Throws on refusal. */
  revert: (change: Pick<ChangeSummary, 'group'>) => Promise<void>;
}

export function useStagedMediaUndo({ enabled, draft, reloadDraft }: UseStagedMediaUndoInput): UseStagedMediaUndo {
  const live = React.useRef({ draft, reloadDraft });
  live.current = { draft, reloadDraft };

  /** The draft holding the row: the loaded one, else a fresh read (a strip upload may have created the draft). */
  const draftFor = React.useCallback(async (mediaId: string): Promise<DraftRow | null> => {
    const current = live.current.draft;
    if (current && (current.media ?? []).some((m) => m.id === mediaId)) return current;
    const fresh = await live.current.reloadDraft();
    return fresh ?? current;
  }, []);

  const removeStagedMedia = React.useCallback(async (mediaId: string) => {
    const d = await draftFor(mediaId);
    if (!d?.id) return;
    await removeDraftMedia(d.id, [mediaId]);
    // The sub-editors re-read the draft through `onImagesChanged` / `onVideoChanged` (afterStage → reloadDraft).
  }, [draftFor]);

  const canRevert = React.useCallback((c: Pick<ChangeSummary, 'group' | 'kind' | 'fields' | 'source'>) => {
    if (!enabled || c.kind !== 'field' || !c.group || !MEDIA_CHANGE_GROUPS.has(c.group)) return false;
    // A drag / alt edit not staged yet (source 'form') would re-stage right after; only staged rows revert.
    if (c.source !== 'draft' || c.fields.length > 0) return false;
    return mediaIdsForGroup(draft?.media, c.group).length > 0;
  }, [enabled, draft]);

  const revert = React.useCallback(async (c: Pick<ChangeSummary, 'group'>) => {
    const d = live.current.draft;
    if (!d?.id || !c.group) return;
    const ids = mediaIdsForGroup(d.media, c.group);
    if (!ids.length) return;
    try {
      await removeDraftMedia(d.id, ids);
    } finally {
      // Refused or not: show what the draft holds now.
      await live.current.reloadDraft();
    }
  }, []);

  return { removeStagedMedia: enabled ? removeStagedMedia : undefined, canRevert, revert };
}

export default useStagedMediaUndo;
