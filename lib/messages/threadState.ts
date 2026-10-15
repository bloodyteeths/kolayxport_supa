// lib/messages/threadState.ts — messages §5.2 "Pill" + "Composer" columns as one pure mapping (group G4).
// The pill itself comes from `messageStatus` (lib/ds/status/messages.ts, M1-a); this file adds what the
// row and the thread need around it: the raw-status tooltip, the unread dot, and which composer region to
// render. It returns kinds, not copy: G5/G6 map each kind to their own `messages.*` i18n keys.

import { messageStatus } from '@/lib/ds/status/messages';
import { normalizeRaw, type MessageStatusKey } from '@/lib/ds/status/vocabulary';

/** The fields of `UnifiedConversation` (types/messages.ts) this mapping reads. */
export interface ThreadStateInput {
  platform: string;
  needsReply: boolean;
  unread?: boolean;
  platformStatus?: string | null;
  answeredAt?: string | null;
  rejectReason?: string | null;
  rejectedAnswerText?: string | null;
}

/**
 * Composer region (messages §2.3, §5.2):
 * - `reply`          Wix, always (Wix allows follow-ups) → "Send reply"
 * - `answer`         Trendyol WAITING_FOR_ANSWER → "Send answer"
 * - `answered`       Trendyol ANSWERED (or answered in this tab) → caption, no composer, no primary
 * - `in_review`      Trendyol WAITING_FOR_APPROVE → pill + caption, no composer
 * - `rejected`       Trendyol REJECTED → danger banner + composer prefilled with the rejected text
 * - `cannot_answer`  Trendyol REPORTED / unknown → note + "View on Trendyol", no composer
 */
export type ComposerMode =
  | { kind: 'reply' }
  | { kind: 'answer' }
  | { kind: 'answered'; answeredAt: string | null }
  | { kind: 'in_review' }
  | { kind: 'rejected'; reason: string | null; prefill: string }
  | { kind: 'cannot_answer'; rawStatus: string };

export type ComposerKind = ComposerMode['kind'];

export interface ThreadStateOptions {
  /**
   * Set when this tab sent the Trendyol answer (the `locallyAnswered` map of messages §5.3), so a poll that
   * still returns WAITING_FOR_ANSWER or REJECTED cannot re-open a one-shot composer. ISO time of the send.
   */
  locallyAnsweredAt?: string | null;
}

/**
 * Answered spellings, matched like the IN_REVIEW / REJECTED sets in lib/ds/status/messages.ts. Trendyol's
 * documented value is 'ANSWERED' (TRENDYOL_STATUS.answered in lib/messages/limits.ts); the rest are defensive.
 */
const ANSWERED = new Set(['answered', 'answer_approved', 'approved', 'replied']);

function isTrendyol(platform: string): boolean {
  return normalizeRaw(platform) === 'trendyol';
}

/** Which composer region the thread renders. */
export function composerMode(c: ThreadStateInput, opts: ThreadStateOptions = {}): ComposerMode {
  if (!isTrendyol(c.platform)) return { kind: 'reply' };
  if (opts.locallyAnsweredAt) return { kind: 'answered', answeredAt: opts.locallyAnsweredAt };

  const pill = messageStatus({ platform: c.platform, needsReply: c.needsReply, platformStatus: c.platformStatus });
  if (pill === 'needs_reply') return { kind: 'answer' };
  if (pill === 'in_review') return { kind: 'in_review' };
  if (pill === 'answer_rejected') {
    return { kind: 'rejected', reason: nonEmpty(c.rejectReason), prefill: c.rejectedAnswerText ?? '' };
  }
  if (ANSWERED.has(normalizeRaw(c.platformStatus))) return { kind: 'answered', answeredAt: c.answeredAt ?? null };
  return { kind: 'cannot_answer', rawStatus: String(c.platformStatus ?? '').trim() };
}

/** true when the composer region shows a text field (and the "Send" primary). */
export function composerAcceptsText(mode: ComposerMode): boolean {
  return mode.kind === 'reply' || mode.kind === 'answer' || mode.kind === 'rejected';
}

/**
 * Raw platform status for the pill tooltip, only where no pill explains it (Trendyol REPORTED / unknown).
 * ANSWERED, WAITING_* and REJECTED have their own copy, so they return null; Wix never shows a raw status.
 */
export function rawStatusTooltip(c: ThreadStateInput): string | null {
  return composerMode(c).kind === 'cannot_answer' ? nonEmpty(c.platformStatus) : null;
}

export interface MessageRowState {
  /** At most one pill per row (DS); never `unread`. */
  pill: Exclude<MessageStatusKey, 'unread'> | null;
  /** The dot + bold name. */
  unread: boolean;
  /** Muted row: nothing to do here (Trendyol answered / in review / can't be answered, or sent from this tab). */
  muted: boolean;
  rawTooltip: string | null;
}

/**
 * Everything `ConversationRow` needs from the status columns of §5.2. A row sent from this tab
 * (`locallyAnsweredAt`, any platform) loses its pill and dot and turns muted until the next refresh (§5.3).
 */
export function messageRowState(c: ThreadStateInput, opts: ThreadStateOptions = {}): MessageRowState {
  if (opts.locallyAnsweredAt) return { pill: null, unread: false, muted: true, rawTooltip: null };
  const raw = messageStatus({ platform: c.platform, needsReply: c.needsReply, platformStatus: c.platformStatus });
  return {
    pill: raw === 'unread' ? null : raw,
    unread: !!c.unread,
    muted: !composerAcceptsText(composerMode(c)),
    rawTooltip: rawStatusTooltip(c),
  };
}

function nonEmpty(s: string | null | undefined): string | null {
  const t = typeof s === 'string' ? s.trim() : '';
  return t ? t : null;
}
