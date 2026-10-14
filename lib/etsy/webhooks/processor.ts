/**
 * Etsy webhook processor — compatibility layer (owner W1).
 *
 * The queue is processed by ./worker.ts (fair per-shop claims, coalescing
 * with persisted event-type unions, heartbeats, defers that keep attempts,
 * blocked_reauth parking, rate budget). Event vocabulary and payload parsing
 * live in ./events.ts; the pre-backbone listing handler (fallback while W3's
 * handler is a stub) lives in ./legacyListingHandler.ts.
 *
 * This module keeps the old exported names so existing imports keep working.
 */
import { kickEtsyWorker, runEtsyWorkerPass, type WorkerPassResult } from './worker';

export {
  ETSY_WEBHOOK_PROVIDER,
  LISTING_EVENTS,
  INVENTORY_EVENTS,
  ORDER_EVENTS,
  isSupportedEtsyEvent,
  receiptIdFromPayload,
  listingIdFromPayload,
  resourceKeyFor,
  etsyEventPriority,
} from './events';

/** Terminal after this many attempts (worker setting). */
export const MAX_ATTEMPTS = 10;

export type ProcessResult = WorkerPassResult;

/**
 * Runs one worker pass and waits for the events it started (cron sweeper).
 * The options of the old processor are accepted and ignored: the worker
 * claims up to its concurrency caps.
 */
export async function processEtsyWebhookQueue(opts: { maxEvents?: number; maxApiEvents?: number; waitTimeoutMs?: number } = {}): Promise<ProcessResult> {
  return runEtsyWorkerPass({ wait: true, waitTimeoutMs: opts.waitTimeoutMs ?? 90_000 });
}

/** Debounced in-process kick after a webhook is stored (always runs, whatever the env flags). */
export function kickEtsyWebhookProcessing(delayMs = 3_000) {
  kickEtsyWorker(delayMs);
}
