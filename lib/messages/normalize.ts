// lib/messages/normalize.ts — messages §5.2, §6.1. Pure normalizers moved out of pages/api/messages/index.ts.
// No "now" fallbacks (D2): an unknown time is null (new fields) or '' (legacy fields). Shared read-only with
// G2 (draft-reply). No I/O.

import { isUnread } from '@/lib/ds/status/messages';
import type {
  InboxView,
  MessagePlatform,
  OrderContext,
  PlatformErrorCode,
  ReplyErrorCode,
  UnifiedConversation,
  UnifiedMessage,
} from '@/types/messages';
import type { InboxThreadRow } from './inboxCache';
import { PREVIEW_MAX, TRENDYOL_ANSWER_MAX, TRENDYOL_ANSWER_MIN, TRENDYOL_STATUS } from './limits';

// ─── Dates ──────────────────────────────────────────────

/** ISO string for a date-ish value (ISO string, epoch ms, Date); null when absent or invalid. */
export function toIso(v: unknown): string | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(typeof v === 'number' || typeof v === 'string' ? v : NaN);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Sort comparator: newest `lastMessageAt` first, unknown times last, then stable by id. */
export function compareConversations(a: Pick<UnifiedConversation, 'lastMessageAt' | 'id'>, b: Pick<UnifiedConversation, 'lastMessageAt' | 'id'>): number {
  const ta = toMs(a.lastMessageAt);
  const tb = toMs(b.lastMessageAt);
  if (ta === null && tb === null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return tb - ta;
}

export function preview(text: string | null | undefined): string {
  return (text ?? '').slice(0, PREVIEW_MAX);
}

// ─── Trendyol ───────────────────────────────────────────

/** messages §5.2: WAITING_FOR_ANSWER and REJECTED need a reply; everything else does not. */
export function trendyolNeedsReply(status: string | null | undefined): boolean {
  const s = String(status ?? '').toUpperCase();
  return s === TRENDYOL_STATUS.waiting || s === TRENDYOL_STATUS.rejected;
}

/** Trendyol `status` query value for a view (null = no filter). */
export function trendyolStatusForFilter(filter: ListFilter): string | undefined {
  if (filter === 'needs_reply' || filter === 'unread' || filter === 'unanswered') return TRENDYOL_STATUS.waiting;
  if (filter === 'answered') return TRENDYOL_STATUS.answered;
  return undefined;
}

interface TrendyolAnswerLike { text?: string; creationDate?: unknown; reason?: string; rejectReason?: string }

/** Rejected answer: field name unverified (limits.ts) — accept the plausible shapes. */
function trendyolRejected(q: any): { text: string | null; reason: string | null } {
  const ra: TrendyolAnswerLike | undefined = q?.rejectedAnswer || q?.rejectedAnswers?.[0];
  const reason = ra?.reason || ra?.rejectReason || q?.rejectReason || q?.rejectedReason || q?.reason || null;
  return { text: ra?.text || null, reason: typeof reason === 'string' && reason ? reason : null };
}

export function normalizeTrendyolQuestion(q: any, lastSeenAt?: Date | string | null): UnifiedConversation {
  const platformStatus = String(q?.status ?? '');
  const isAnswered = platformStatus.toUpperCase() === TRENDYOL_STATUS.answered;
  const needsReply = trendyolNeedsReply(platformStatus);
  const askedAt = toIso(q?.creationDate);

  const messages: UnifiedMessage[] = [
    { id: `${q?.id}-q`, sender: 'customer', text: q?.text || '', date: askedAt ?? '' },
  ];

  // Trendyol Q&A returns the answer as a singular object (q.answer), not an array.
  const answer: TrendyolAnswerLike | undefined = q?.answer || q?.answers?.[0];
  const answeredAt = answer ? toIso(answer.creationDate) : null;
  if (isAnswered && answer) {
    messages.push({ id: `${q?.id}-a`, sender: 'seller', text: answer.text || '', date: answeredAt ?? '' });
  }

  const hasSellerLast = isAnswered && !!answer;
  const lastMessageAt = hasSellerLast ? (answeredAt ?? askedAt) : askedAt;
  const rejected = platformStatus.toUpperCase() === TRENDYOL_STATUS.rejected ? trendyolRejected(q) : { text: null, reason: null };
  const unread = isUnread({ needsReply, lastMessageAt, lastSeenAt: lastSeenAt ?? null });

  return {
    id: String(q?.id ?? ''),
    platform: 'trendyol',
    status: needsReply ? 'unanswered' : 'answered',
    needsReply,
    unread,
    platformStatus,
    answeredAt,
    rejectReason: rejected.reason,
    rejectedAnswerText: rejected.text,
    // Empty fallback: the UI renders a localized "Customer" label.
    customerName: q?.customerFirstName || q?.userName || '',
    subject: q?.productName || '',
    lastMessageText: preview(hasSellerLast ? answer?.text : q?.text),
    lastMessageAt,
    lastMessageDate: lastMessageAt ?? '',
    lastFromCustomer: !hasSellerLast,
    productInfo: q?.productMainId ? {
      id: String(q.productMainId),
      title: q.productName || '',
      imageUrl: q.imageUrl,
      webUrl: q.webUrl,
    } : undefined,
    unreadCount: needsReply ? 1 : 0,
    messages,
  };
}

// ─── Wix ────────────────────────────────────────────────

const WIX_CUSTOMER_DIRECTIONS = new Set(['PARTICIPANT_TO_BUSINESS', 'CUSTOMER_TO_BUSINESS', 'VISITOR']);
const WIX_SELLER_DIRECTIONS = new Set(['BUSINESS_TO_PARTICIPANT', 'BUSINESS_TO_CUSTOMER', 'BUSINESS']);

/** true = from the customer, false = from the business, null = unknown direction. */
export function wixFromCustomer(msg: any): boolean | null {
  const dir = String(msg?.direction || msg?.sender?.role || '').toUpperCase();
  if (WIX_CUSTOMER_DIRECTIONS.has(dir) || dir === 'PARTICIPANT' || dir === 'CONTACT' || dir === 'MEMBER') return true;
  if (WIX_SELLER_DIRECTIONS.has(dir)) return false;
  return null;
}

export function wixMessageText(msg: any): string {
  return msg?.content?.previewText
    || msg?.content?.basic?.items?.[0]?.text
    || msg?.content?.text
    || msg?.text
    || msg?.preview
    || '';
}

export function normalizeWixMessage(msg: any): UnifiedMessage {
  return {
    id: msg?.id || msg?.sequence?.toString() || '',
    sender: wixFromCustomer(msg) === false ? 'seller' : 'customer',
    text: wixMessageText(msg),
    date: toIso(msg?.createdDate || msg?.date) ?? '',
  };
}

export interface WixNewest {
  text: string;
  at: string | null;
  fromCustomer: boolean | null;
  count: number;
}

/**
 * Newest message of a Wix messages page. The API returns newest first; we still pick by `createdDate` when
 * every message has one, so a different order cannot flip needsReply.
 */
export function newestWixMessage(messages: any[] | null | undefined): WixNewest {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) return { text: '', at: null, fromCustomer: null, count: 0 };
  let newest = list[0];
  const allDated = list.every((m) => toIso(m?.createdDate || m?.date) !== null);
  if (allDated) {
    for (const m of list) {
      if ((toMs(toIso(m?.createdDate || m?.date)) ?? 0) > (toMs(toIso(newest?.createdDate || newest?.date)) ?? 0)) newest = m;
    }
  }
  return { text: preview(wixMessageText(newest)), at: toIso(newest?.createdDate || newest?.date), fromCustomer: wixFromCustomer(newest), count: list.length };
}

export function wixContactName(contact: any): string {
  return [contact?.info?.name?.first, contact?.info?.name?.last].filter(Boolean).join(' ')
    || contact?.primaryInfo?.email
    || '';
}

/** A Wix conversation row built from the cache row and the live contact (name/email). */
export function normalizeWixThread(row: InboxThreadRow, contact?: any): UnifiedConversation {
  const lastMessageAt = toIso(row.lastMessageAt);
  const needsReply = row.lastFromCustomer === true;
  const unread = isUnread({ needsReply, lastMessageAt, lastSeenAt: row.lastSeenAt });
  const customerName = (contact ? wixContactName(contact) : '') || row.customerName || '';
  const email = contact?.primaryInfo?.email;
  return {
    id: row.externalId,
    platform: 'wix',
    status: needsReply ? 'unanswered' : 'answered',
    needsReply,
    unread,
    platformStatus: 'open',
    customerName,
    ...(email ? { customerEmail: String(email) } : {}),
    subject: customerName,
    lastMessageText: row.lastMessageText ?? '',
    lastMessageAt,
    lastMessageDate: lastMessageAt ?? '',
    lastFromCustomer: row.lastFromCustomer ?? null,
    ...(row.lastOrderNumber ? { orderRef: row.lastOrderNumber } : {}),
    contactId: row.contactId ?? undefined,
    unreadCount: unread ? 1 : 0,
    messages: [],
  };
}

// ─── Views / filters ────────────────────────────────────

/** Internal filter: the three views plus the legacy `status=answered|unanswered`. */
export type ListFilter = InboxView | 'unanswered' | 'answered';

/** `view=` wins; legacy `status=` is still accepted. Unknown → 'all'. */
export function parseListFilter(view: unknown, legacyStatus: unknown): ListFilter {
  if (view === 'needs_reply' || view === 'unread' || view === 'all') return view;
  if (legacyStatus === 'unanswered' || legacyStatus === 'answered') return legacyStatus;
  return 'all';
}

export function matchesFilter(c: Pick<UnifiedConversation, 'needsReply' | 'unread'>, filter: ListFilter): boolean {
  switch (filter) {
    case 'needs_reply':
    case 'unanswered':
      return c.needsReply;
    case 'unread':
      return c.unread;
    case 'answered':
      return !c.needsReply;
    default:
      return true;
  }
}

// ─── Errors ─────────────────────────────────────────────

function statusOf(e: any): number {
  const s = Number(e?.status || e?.response?.status || 0);
  if (s) return s;
  const m = /\b(?:API|failed \()\s*(\d{3})\b/.exec(String(e?.message || ''));
  return m ? Number(m[1]) : 0;
}

export function classifyPlatformError(e: any): PlatformErrorCode {
  const status = statusOf(e);
  const msg = String(e?.message || '');
  if (status === 403 || /\b403\b/.test(msg)) return 'permission';
  if (status === 401 || /\b401\b/.test(msg)) return 'auth';
  if (status === 429 || /\b429\b/.test(msg)) return 'rateLimited';
  return 'unavailable';
}

/** Pre-send validation (server side, mirrors the composer). */
export function validateReplyText(platform: MessagePlatform, text: string): ReplyErrorCode | null {
  const len = text.trim().length;
  if (platform === 'trendyol') {
    if (len < TRENDYOL_ANSWER_MIN) return 'tooShort';
    if (len > TRENDYOL_ANSWER_MAX) return 'tooLong';
  }
  return null;
}

// Phrases only: a bare "answered" matches "unanswered", and "cevaplanm" matches "cevaplanmalı" (must be answered).
const ALREADY_ANSWERED = /\balready (?:been )?answered\b|zaten (?:cevap|yan[ıi]t)|daha önce (?:cevap|yan[ıi]t)|\bcevaplanm[ıi]ş|\byan[ıi]tlanm[ıi]ş/i;
const TOO_SHORT = /too short|en az|minimum|min\.?\s*\d|kısa/i;
const TOO_LONG = /too long|en fazla|maximum|max\.?\s*\d|uzun/i;

/** Maps a platform reply failure to a stable `code` (the UI never parses text). */
export function classifyReplyError(e: any): ReplyErrorCode {
  const status = statusOf(e);
  const body = e?.body ? JSON.stringify(e.body) : '';
  const text = `${String(e?.message || '')} ${body}`;
  if (status === 401) return 'auth';
  if (status === 403) return 'permission';
  if (status === 409) return 'alreadyAnswered';
  if (status === 400 || status === 422) {
    // Length errors first: their text can also mention answering.
    if (TOO_SHORT.test(text)) return 'tooShort';
    if (TOO_LONG.test(text)) return 'tooLong';
  }
  if (ALREADY_ANSWERED.test(text)) return 'alreadyAnswered';
  const code = classifyPlatformError(e);
  return code === 'auth' || code === 'permission' ? code : 'unavailable';
}

/** HTTP status for a reply error code. 401 is never used (it means "our session expired" to the client). */
export function replyErrorStatus(code: ReplyErrorCode): number {
  if (code === 'tooShort' || code === 'tooLong') return 400;
  if (code === 'alreadyAnswered') return 409;
  return 502;
}

// ─── Wix orders (orderContext) ──────────────────────────

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Wix eCom order → OrderContext without the local join. */
export function normalizeWixOrder(order: any): OrderContext {
  const totalNode = order?.priceSummary?.total;
  const totalAmount = num(totalNode?.amount ?? totalNode?.value ?? order?.totals?.total);
  return {
    orderNumber: String(order?.number ?? order?._id ?? order?.id ?? ''),
    status: String(order?.status || order?.fulfillmentStatus || 'UNKNOWN'),
    createdDate: toIso(order?._createdDate || order?.createdDate) ?? '',
    totalAmount,
    currency: String(order?.currency || totalNode?.currency || 'USD'),
    items: (Array.isArray(order?.lineItems) ? order.lineItems : []).map((item: any) => {
      const priceNode = item?.price ?? item?.priceData?.price;
      const amount = num(typeof priceNode === 'object' && priceNode ? (priceNode.amount ?? priceNode.value) : priceNode);
      return {
        name: item?.name || item?.productName?.original || '',
        imageUrl: item?.image?.url || item?.mediaItem?.url,
        quantity: Number(item?.quantity) || 1,
        amount,
        price: (typeof priceNode === 'object' && priceNode?.formattedAmount) || (amount != null ? String(amount) : '0'),
      };
    }),
    total: totalNode?.formattedAmount || (totalAmount != null ? String(totalAmount) : '0'),
  };
}

export interface LocalOrderRow {
  id: string;
  orderNumber: string;
  trackingNumber: string | null;
  shipByAt: Date | null;
  items: { shipBy: Date | null }[];
}

/** Adds `kxOrderId`, `trackingNumber`, `shipByDate` (Order.shipByAt, else earliest OrderItem.shipBy). */
export function joinLocalOrders(orders: OrderContext[], local: LocalOrderRow[]): OrderContext[] {
  const byNumber = new Map(local.map((o) => [String(o.orderNumber), o]));
  return orders.map((o) => {
    const l = byNumber.get(o.orderNumber);
    if (!l) return o;
    const itemShipBy = l.items.map((i) => i.shipBy).filter((d): d is Date => d instanceof Date).sort((a, b) => a.getTime() - b.getTime())[0];
    return { ...o, kxOrderId: l.id, trackingNumber: l.trackingNumber ?? null, shipByDate: toIso(l.shipByAt ?? itemShipBy ?? null) };
  });
}

/** Newest first by createdDate (unknown last). */
export function sortOrdersNewestFirst(orders: OrderContext[]): OrderContext[] {
  return [...orders].sort((a, b) => {
    const ta = toMs(a.createdDate);
    const tb = toMs(b.createdDate);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  });
}
