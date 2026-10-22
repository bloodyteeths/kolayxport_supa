import { describe, expect, it } from 'vitest';
import { IN_FLIGHT_MS, dedupeAction } from '@/lib/billing/webhookDedupe';

const now = new Date('2026-10-23T08:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('dedupeAction', () => {
  it('new event is processed', () => expect(dedupeAction(null, now)).toBe('process'));
  it('processed / ignored events are duplicates', () => {
    expect(dedupeAction({ status: 'processed', createdAt: ago(1000) }, now)).toBe('duplicate');
    expect(dedupeAction({ status: 'ignored', createdAt: ago(1000) }, now)).toBe('duplicate');
  });
  it('a failed handler runs again on retry', () => expect(dedupeAction({ status: 'failed', createdAt: ago(1000) }, now)).toBe('process'));
  it('a delivery still running is in flight; a stale one runs again', () => {
    expect(dedupeAction({ status: 'received', createdAt: ago(IN_FLIGHT_MS - 1) }, now)).toBe('in_flight');
    expect(dedupeAction({ status: 'received', createdAt: ago(IN_FLIGHT_MS + 1) }, now)).toBe('process');
    expect(dedupeAction({ status: 'received', createdAt: ago(IN_FLIGHT_MS * 10), processingStartedAt: ago(1000) }, now)).toBe('in_flight');
  });
});
