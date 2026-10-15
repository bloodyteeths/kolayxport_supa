// lib/ds/status/messages.ts — messages §5.2 (pure, unit-tested). At most one pill per row: unread is the
// dot + bold name, never a second pill. Trendyol raw names marked "verify" in the spec are matched loosely.

import { normalizeRaw, type MessageStatusKey } from './vocabulary';

export interface MessageStatusInput {
  platform: string;
  needsReply: boolean;
  /** Trendyol Q&A status (WAITING_FOR_ANSWER, WAITING_FOR_APPROVE, ANSWERED, REJECTED, REPORTED). */
  platformStatus?: string | null;
}

const IN_REVIEW = new Set(['waiting_for_approve', 'waiting_for_approval', 'waiting_approval', 'pending_approval']);
const REJECTED = new Set(['rejected', 'answer_rejected']);

export function messageStatus(c: MessageStatusInput): MessageStatusKey | null {
  if (normalizeRaw(c.platform) === 'trendyol') {
    const s = normalizeRaw(c.platformStatus);
    if (s === 'waiting_for_answer') return 'needs_reply';
    if (IN_REVIEW.has(s)) return 'in_review';
    if (REJECTED.has(s)) return 'answer_rejected';
    if (s === '' && c.needsReply) return 'needs_reply';
    return null; // ANSWERED, REPORTED, unknown: raw goes to the tooltip
  }
  return c.needsReply ? 'needs_reply' : null;
}

/** `unread` = needsReply && (never seen || newest message after last seen). Rendered as a dot, not a pill. */
export function isUnread(c: {
  needsReply: boolean;
  lastMessageAt?: Date | string | number | null;
  lastSeenAt?: Date | string | number | null;
}): boolean {
  if (!c.needsReply) return false;
  if (c.lastSeenAt == null) return true;
  if (c.lastMessageAt == null) return false;
  return new Date(c.lastMessageAt).getTime() > new Date(c.lastSeenAt).getTime();
}
