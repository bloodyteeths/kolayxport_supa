import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { editorAllows, editorLockedBody } from '@/lib/billing/editorTier';
import { accountEditorTier } from '@/lib/billing/editorTierServer';
import { cancelDraftIfEmpty, discardDraft, removeDraftMedia, removeQueuedActions, toSerializable } from '@/lib/etsy/draftService';
import { draftErrorResponse } from '@/lib/etsy/draftErrors';
import { ScheduleError, scheduleErrorResponse, setDraftScheduledSendAt } from '@/lib/drafts/scheduledSend';
import { withLegacyLastSyncError } from '@/lib/drafts/syncErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    if (req.method === 'GET') {
      const draft = await prisma.etsyListingDraft.findFirst({
        where: { id, userId: user.id },
        include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 10 } },
      });
      if (!draft) return res.status(404).json({ error: 'Draft not found' });
      return res.status(200).json({ draft: toSerializable(draft ? withLegacyLastSyncError(draft as any) : draft) });
    }

    // PATCH { removeQueuedActions?: ['delete', ...], scheduledSendAt?: string|null, removeMediaIds?: string[] }
    // removeQueuedActions un-queues staged actions (e.g. cancel a queued
    // listing delete without discarding the draft). scheduledSendAt (additive,
    // listings-grid §9.4) schedules/unschedules the send; it never syncs.
    // removeMediaIds (additive) un-stages EtsyDraftMedia rows of this draft by
    // their row id and deletes their staged files; 409 DRAFT_SENDING while the
    // draft is being sent. Ids not on this draft are ignored.
    if (req.method === 'PATCH') {
      const hasSchedule = req.body && Object.prototype.hasOwnProperty.call(req.body, 'scheduledSendAt');
      const types = req.body?.removeQueuedActions;
      const mediaIds = req.body?.removeMediaIds;
      const hasRemoveMedia = mediaIds !== undefined;
      if (hasRemoveMedia && (!Array.isArray(mediaIds) || mediaIds.length === 0 || mediaIds.length > 100
        || mediaIds.some((m: unknown) => typeof m !== 'string' || !m))) {
        return res.status(400).json({ error: 'removeMediaIds must be a non-empty array (max 100) of media ids', code: 'BAD_REQUEST' });
      }
      if (types !== undefined || (!hasSchedule && !hasRemoveMedia)) {
        if (!Array.isArray(types) || types.length === 0 || types.some((t: unknown) => typeof t !== 'string')) {
          return res.status(400).json({ error: 'removeQueuedActions must be a non-empty array of action types' });
        }
      }
      // Scheduling a send needs the Büyüme tier or above (lib/billing/editorTier); clearing a schedule is always allowed.
      if (hasSchedule && req.body.scheduledSendAt) {
        const tier = await accountEditorTier(user.id);
        if (!editorAllows(tier, 'schedule')) return res.status(402).json(editorLockedBody(tier, 'schedule'));
      }
      if (hasSchedule) {
        try {
          // Validate the schedule first (as if the removed actions were already
          // gone), so a refused schedule never leaves a half-applied request.
          // Then un-queue, so "remove the delete, then schedule" works in one call.
          await setDraftScheduledSendAt('etsy', id, user.id, req.body.scheduledSendAt, {
            dryRun: true,
            assumeRemovedTypes: Array.isArray(types) ? types : [],
          });
          if (hasRemoveMedia) await removeDraftMedia(id, user.id, mediaIds);
          if (Array.isArray(types)) await removeQueuedActions(id, user.id, types);
          await setDraftScheduledSendAt('etsy', id, user.id, req.body.scheduledSendAt);
          // Unscheduling a draft whose other changes are all gone leaves nothing to send: close it.
          if (req.body.scheduledSendAt === null || req.body.scheduledSendAt === '') await cancelDraftIfEmpty(id, user.id);
        } catch (err) {
          if (err instanceof ScheduleError) {
            const { status, body } = scheduleErrorResponse(err);
            return res.status(status).json(body);
          }
          throw err;
        }
        const draft = await prisma.etsyListingDraft.findFirst({
          where: { id, userId: user.id },
          include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
        });
        return res.status(200).json({ draft: toSerializable(draft ? withLegacyLastSyncError(draft as any) : draft) });
      }
      if (hasRemoveMedia) await removeDraftMedia(id, user.id, mediaIds);
      const draft = Array.isArray(types)
        ? await removeQueuedActions(id, user.id, types)
        : await prisma.etsyListingDraft.findFirst({
          where: { id, userId: user.id },
          include: { media: true, syncAttempts: { orderBy: { startedAt: 'desc' }, take: 5 } },
        });
      return res.status(200).json({ draft: toSerializable(draft ? withLegacyLastSyncError(draft as any) : draft) });
    }

    if (req.method === 'DELETE') {
      const result = await discardDraft(id, user.id);
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    const { status, body } = draftErrorResponse(err, 'Draft request failed');
    return res.status(status).json(body);
  }
}
