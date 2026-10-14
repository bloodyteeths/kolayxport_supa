/**
 * Shared Etsy event-backbone types (contract, owner W1).
 *
 * Handlers (listing cache W3, order lifecycle W4) receive an EtsyEventContext
 * for the winning WebhookEvent row of a coalesced group and return a
 * HandlerOutcome. Throwing EtsyDeferError re-queues the event WITHOUT
 * consuming an attempt (rate limit, budget, lock busy, min interval).
 */

export type EtsyEventContext = {
  /** WebhookEvent.id of the winning row. */
  eventId: string;
  userId: string;
  shopId: string;
  /** e.g. 'listing:123' | 'receipt:456' */
  resourceKey: string;
  /** Union of event types absorbed by the winner (WebhookEvent.eventTypes). */
  eventTypes: Set<string>;
  /** min(createdAt) of the absorbed rows. */
  firstReceivedAt: Date;
  /** 1-based attempt number of this processing run. */
  attempt: number;
};

export type HandlerOutcome = { outcome: 'done' | 'ignored'; note?: string };

export type EtsyDeferReason = 'rate_limited' | 'budget' | 'lock_busy' | 'min_interval' | 'p0_retry';

export class EtsyDeferError extends Error {
  retryAfterMs: number;
  reason: EtsyDeferReason;

  constructor(reason: EtsyDeferReason, retryAfterMs: number, message?: string) {
    super(message || `Etsy work deferred (${reason}) for ${Math.max(0, Math.round(retryAfterMs))}ms`);
    this.name = 'EtsyDeferError';
    this.reason = reason;
    this.retryAfterMs = Math.max(0, Math.round(Number(retryAfterMs) || 0));
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class EtsyRateLimitedError extends EtsyDeferError {
  constructor(retryAfterMs: number, message?: string) {
    super('rate_limited', retryAfterMs, message);
    this.name = 'EtsyRateLimitedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isEtsyDeferError(err: unknown): err is EtsyDeferError {
  return err instanceof EtsyDeferError || (!!err && typeof err === 'object' && (err as any).name === 'EtsyDeferError');
}
