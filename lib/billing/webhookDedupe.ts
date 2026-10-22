// lib/billing/webhookDedupe.ts — what the Stripe webhook does with an event id it has seen before.
// Only finished events are duplicates. A handler that threw (status 'failed') or a process that died mid-event
// ('received' and stale) is processed again when Stripe retries; Stripe's retries are the recovery path.
// A 'received' row younger than IN_FLIGHT_MS means another delivery is running right now: answer non-2xx so
// Stripe retries later instead of two handlers running at once.
export const IN_FLIGHT_MS = 5 * 60_000;

export type DedupeAction = 'process' | 'duplicate' | 'in_flight';

export function dedupeAction(
  existing: { status: string | null; createdAt: Date; processingStartedAt?: Date | null } | null,
  now: Date = new Date(),
): DedupeAction {
  if (!existing) return 'process';
  if (existing.status === 'processed' || existing.status === 'ignored') return 'duplicate';
  if (existing.status === 'received') {
    const started = existing.processingStartedAt ?? existing.createdAt;
    return now.getTime() - started.getTime() < IN_FLIGHT_MS ? 'in_flight' : 'process';
  }
  return 'process'; // failed (or unknown): try again
}
