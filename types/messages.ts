// types/messages.ts — messages §6.1. One contract for the legacy page (flag off) and the new inbox
// (flag `messages`). Rule for dates: fields the legacy page reads stay `string` and use '' when the
// platform sent no time; every new field uses `null`. No field ever falls back to "now" (D2).

/** Q&A platforms (one question, seller answers): trendyol, hepsiburada. Chat platforms: wix. */
export type MessagePlatform = 'wix' | 'trendyol' | 'hepsiburada';

/** `GET /api/messages?action=list&view=` */
export type InboxView = 'needs_reply' | 'unread' | 'all';

export type PlatformErrorCode = 'permission' | 'auth' | 'credentials' | 'rateLimited' | 'unavailable';

export interface PlatformError {
  platform: MessagePlatform;
  code: PlatformErrorCode;
  /** Developer-facing (logs / tooltip). The UI maps `code` to i18n copy. */
  detail: string;
  /** True when the platform still returned rows but some conversations could not be loaded. */
  partial?: boolean;
}

/** `POST /api/messages?action=reply` error `code`. */
export type ReplyErrorCode = 'tooShort' | 'tooLong' | 'alreadyAnswered' | 'auth' | 'permission' | 'unavailable';

export interface UnifiedMessage {
  id: string;
  sender: 'customer' | 'seller';
  text: string;
  /**
   * ISO string, or '' when the platform sent no time (never "now"). Kept `string` (spec: `string | null`)
   * so the legacy page still type-checks under strictNullChecks. Treat falsy as unknown.
   */
  date: string;
}

export interface UnifiedConversation {
  id: string;
  platform: MessagePlatform;
  /** Kept for the legacy page during the flag period: needsReply ? 'unanswered' : 'answered'. */
  status: 'unanswered' | 'answered';
  /** Trendyol WAITING_FOR_ANSWER or REJECTED; Wix: the newest message is from the customer. */
  needsReply: boolean;
  /** needsReply && newest message after the seller last opened it (`InboxThread.lastSeenAt`). */
  unread: boolean;
  /** Raw platform status: Trendyol Q&A status; Wix 'open'. */
  platformStatus?: string;
  /** Trendyol `answer.creationDate`. */
  answeredAt?: string | null;
  /** Trendyol rejected-answer reason (field name to verify, see lib/messages/limits.ts). */
  rejectReason?: string | null;
  /** Trendyol rejected-answer text, to prefill the composer (messages §5.2). */
  rejectedAnswerText?: string | null;
  /** Hepsiburada: answer deadline (`expireDate`, 1 business day). null/absent when the platform sent none. */
  expiresAt?: string | null;
  customerName: string;
  /** Wix contact email (Trendyol: absent). */
  customerEmail?: string;
  subject: string;
  /** Newest message text ('' when unknown). */
  lastMessageText: string;
  /** Newest message time; null when unknown (renders —, sorts last). */
  lastMessageAt: string | null;
  /** Legacy: lastMessageAt ?? ''. */
  lastMessageDate: string;
  /** true = newest message from the customer, false = from the seller, null = unknown. */
  lastFromCustomer: boolean | null;
  /** Wix newest order number, once the context rail has loaded orders for this contact. Hepsiburada: the order the question is about. */
  orderRef?: string;
  productInfo?: {
    id: string;
    title: string;
    imageUrl?: string;
    webUrl?: string;
  };
  /** Wix contact id (orderContext lookup). */
  contactId?: string;
  unreadCount: number;
  /** Trendyol: question (+ answer). Wix: [] in the list; load `action=thread`. */
  messages: UnifiedMessage[];
}

export interface MessagesListResponse {
  conversations: UnifiedConversation[];
  totalCount: number;
  unansweredCount: number;
  page: number;
  pageSize: number;
}

export interface InboxListResponse extends MessagesListResponse {
  /** Pass back as `cursor` for the next page; null when every source is exhausted. */
  nextCursor: string | null;
  enabledPlatforms: MessagePlatform[];
  platformErrors: PlatformError[];
  /** Legacy developer strings (kept for the legacy page). */
  errors: string[];
  /** Server time of this response (ISO). */
  fetchedAt: string;
  /** 'db' once BR-4 (`InboxThread`) is deployed; 'memory' until then (read state is per process). */
  readStateStore: 'db' | 'memory';
}

export interface MessageCountsResponse {
  wix: number;
  trendyol: number;
  /** Absent from servers before the Hepsiburada inbox. */
  hepsiburada?: number;
  total: number;
}

export interface OrderContextItem {
  name: string;
  imageUrl?: string;
  quantity: number;
  /** Line amount (numeric) in the order currency; null when Wix sent none. */
  amount: number | null;
  /** Legacy pre-formatted price string. */
  price: string;
}

export interface OrderContext {
  orderNumber: string;
  /** Raw Wix status (map with orderStatus(raw, 'wix')). */
  status: string;
  /** ISO, '' when unknown (legacy-read field). */
  createdDate: string;
  /** Numeric total in `currency`; null when unknown. */
  totalAmount: number | null;
  currency: string;
  items: OrderContextItem[];
  /** Legacy pre-formatted total string. */
  total: string;
  /** Local join on Order(userId, marketplace='Wix', orderNumber). Absent when no local row. */
  kxOrderId?: string;
  trackingNumber?: string | null;
  shipByDate?: string | null;
}

/** `GET ?action=orderContext` → 200 `{ orders }` (newest first) or 502 `{ code, error }`. */
export interface OrderContextResponse {
  orders: OrderContext[];
}

/** `GET ?action=productContext&productMainId=` (local DB only). */
export interface ProductContext {
  productMainId: string;
  inCatalog: boolean;
  title?: string;
  barcode?: string;
  salePrice?: number | null;
  currency?: string;
  quantity?: number | null;
  onSale?: boolean;
  thumbnailUrl?: string | null;
}

/** `POST ?action=markSeen` body. */
export interface MarkSeenRequest {
  platform: MessagePlatform;
  id: string;
  /** false = mark as unread. Default true. */
  seen?: boolean;
}
