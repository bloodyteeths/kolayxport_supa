// lib/messages/limits.ts — messages §6, §10. Every platform limit the inbox relies on, with its source.
// Pure constants: imported by the API route (G1), the AI draft builder (G2) and the composer (G6).

/**
 * Trendyol Q&A question statuses (`GET /qna/sellers/{id}/questions/filter?status=`).
 * Source: Trendyol seller integration docs, "Müşteri Soruları" (questions/filter `status` values:
 * WAITING_FOR_ANSWER, WAITING_FOR_APPROVE, ANSWERED, REPORTED, REJECTED).
 * VERIFY (messages §10): confirm WAITING_FOR_APPROVE and REJECTED against one live response before the
 * `messages` flag is flipped. Unknown values are treated as "can't be answered here" (never needsReply).
 */
export const TRENDYOL_STATUS = {
  waiting: 'WAITING_FOR_ANSWER',
  inReview: 'WAITING_FOR_APPROVE',
  answered: 'ANSWERED',
  rejected: 'REJECTED',
  reported: 'REPORTED',
} as const;

/**
 * Trendyol answer length. messages §2.2: until verified against Trendyol's Q&A docs or a live rejected
 * answer, use no minimum (1 = any non-empty answer, as the legacy route sent) and max 2000.
 * VERIFY (messages §10) before raising the minimum: a higher value blocks short answers like "Mevcut".
 */
export const TRENDYOL_ANSWER_MIN = 1;
export const TRENDYOL_ANSWER_MAX = 2000;

/** AI drafts stay well under the Trendyol maximum (messages §6.3). */
export const AI_DRAFT_MAX = 600;

/** Wix Inbox has no documented text limit for business messages; we cap what we send. */
export const WIX_REPLY_MAX = 4000;

/** `GET /api/messages?action=list` page size (messages §6.1). */
export const LIST_SIZE_DEFAULT = 30;
export const LIST_SIZE_MAX = 50;

/** Wix enrichment (messages §6.2): parallel Inbox calls; the client keeps its own 200ms spacing. */
export const WIX_ENRICH_CONCURRENCY = 5;

/**
 * A cached Wix row is re-checked when the contact's `lastActivity` is newer than the cache, or when the
 * row is older than this (a reply sent from the Wix dashboard may not move the contact's lastActivity).
 */
export const WIX_CACHE_MAX_AGE_MS = 15 * 60 * 1000;

/** `InboxThread.lastMessageText` keeps the first 280 characters (messages §6.2). */
export const PREVIEW_MAX = 280;

/** Wix orders returned by `orderContext`. */
export const ORDER_CONTEXT_LIMIT = 5;

/** In-memory store bound per user while the `InboxThread` table is not deployed (BR-4 guard). */
export const MEMORY_STORE_MAX_ROWS_PER_USER = 1000;

/**
 * Hepsiburada "Satıcıya Sor" question statuses. Responses carry the name; the list `status=` query takes the
 * numeric code (OpenAPI `IssueEsStatus`: 1 WaitingForAnswer, 2 Answered, 3 Rejected — the seller reported the
 * question, 4 AutoClosed — unanswered past the deadline, 7 contacted). Only WaitingForAnswer needs a reply;
 * unlike Trendyol, HB "Rejected" is not a rejected answer.
 */
export const HEPSIBURADA_STATUS = {
  waiting: 'WaitingForAnswer',
  answered: 'Answered',
  rejected: 'Rejected',
  autoClosed: 'AutoClosed',
} as const;

export const HEPSIBURADA_STATUS_CODE = {
  waiting: 1,
  answered: 2,
  rejected: 3,
  autoClosed: 4,
  contacted: 7,
} as const;

/** HB answer: multipart `Answer`, max 2000 characters (Satıcıya Sor docs). */
export const HEPSIBURADA_ANSWER_MIN = 1;
export const HEPSIBURADA_ANSWER_MAX = 2000;
