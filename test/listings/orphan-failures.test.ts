import { describe, expect, it } from 'vitest';
import { dropOrphanFailures } from '@/lib/listings/query';

const now = new Date('2026-10-17T12:00:00Z');
const d = (extId: string, status: string) => [extId, { id: `d-${extId}`, extId, status, queuedDelete: false, syncedAt: null, updatedAt: now }] as const;

describe('dropOrphanFailures', () => {
  it('drops failed/conflict drafts of listings that are gone, keeps pending ones and existing listings', async () => {
    const adapter = { idField: 'listingId', delegateKey: 'listing', toDbId: (id: string) => id } as never;
    const db = { listing: { findMany: async () => [{ listingId: '1' }] } } as never;
    const drafts = new Map([d('1', 'failed'), d('2', 'failed'), d('3', 'conflict'), d('4', 'draft')]);
    const out = await dropOrphanFailures(db, adapter, { storeWhere: {} } as never, drafts as never, now);
    expect([...out.keys()].sort()).toEqual(['1', '4']);
  });
});
