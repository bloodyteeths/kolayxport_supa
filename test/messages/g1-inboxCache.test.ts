import { describe, it, expect, vi } from 'vitest';
import {
  createInboxStore,
  DbInboxStore,
  enrichWixContacts,
  GuardedInboxStore,
  isWixRowFresh,
  mapLimit,
  MemoryInboxStore,
  WixRefreshLog,
  type InboxThreadRow,
  type WixInboxClient,
} from '@/lib/messages/inboxCache';
import { WIX_CACHE_MAX_AGE_MS } from '@/lib/messages/limits';

const NOW = new Date('2026-10-15T10:00:00Z');

function contact(id: string, activity?: string) {
  return { id, info: { name: { first: `Name ${id}` } }, primaryInfo: { email: `${id}@x.com` }, ...(activity ? { lastActivity: { activityDate: activity } } : {}) };
}

function wixClient(messagesByConv: Record<string, any[]>, opts: { fail?: Record<string, Error> } = {}) {
  const calls = { create: 0, messages: 0 };
  const client: WixInboxClient = {
    async getOrCreateConversation({ contactId }) {
      calls.create++;
      if (opts.fail?.[contactId!]) throw opts.fail[contactId!];
      return { conversation: { id: `conv-${contactId}` } };
    },
    async getConversationMessages(conversationId) {
      calls.messages++;
      return { messages: messagesByConv[conversationId] ?? [] };
    },
  };
  return { client, calls };
}

describe('MemoryInboxStore', () => {
  it('upsert merges, updateExisting never creates, counts skip empty threads', async () => {
    const s = new MemoryInboxStore(() => NOW);
    await s.upsert('u', 'wix', 'a', { contactId: 'c1', needsReply: true, messageCount: 2 });
    await s.upsert('u', 'wix', 'a', { lastSeenAt: NOW });
    await s.upsert('u', 'wix', 'b', { contactId: 'c2', needsReply: true, messageCount: 0 });
    await s.updateExisting('u', 'wix', 'zzz', { needsReply: true });
    await s.upsert('u2', 'wix', 'a', { needsReply: true });
    const [a] = await s.findByExternalIds('u', 'wix', ['a']);
    expect(a).toMatchObject({ contactId: 'c1', needsReply: true, lastSeenAt: NOW, messageCount: 2 });
    expect(await s.findByExternalIds('u', 'wix', ['zzz'])).toEqual([]);
    expect(await s.countNeedsReply('u', 'wix')).toBe(1);
    await s.updateByContact('u', 'wix', 'c1', { lastOrderNumber: '10' });
    expect((await s.findByContactIds('u', 'wix', ['c1']))[0].lastOrderNumber).toBe('10');
    expect(await s.findByContactIds('u', 'trendyol', ['c1'])).toEqual([]);
  });

  it('truncates previews', async () => {
    const s = new MemoryInboxStore();
    await s.upsert('u', 'wix', 'a', { lastMessageText: 'x'.repeat(1000) });
    expect((await s.findByExternalIds('u', 'wix', ['a']))[0].lastMessageText).toHaveLength(280);
  });
});

describe('BR-4 guard', () => {
  it('uses memory when the Prisma client has no inboxThread model', () => {
    expect(createInboxStore({}).kind).toBe('memory');
    expect(createInboxStore(null).kind).toBe('memory');
  });

  it('uses the DB delegate when present', async () => {
    const d = { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({})), count: vi.fn(async () => 4) };
    const s = createInboxStore({ inboxThread: d });
    expect(s.kind).toBe('db');
    expect(await s.countNeedsReply('u', 'wix')).toBe(4);
    await s.upsert('u', 'wix', 'x', { lastSeenAt: NOW, customerName: undefined });
    expect(d.upsert).toHaveBeenCalledWith({
      where: { userId_platform_externalId: { userId: 'u', platform: 'wix', externalId: 'x' } },
      create: { userId: 'u', platform: 'wix', externalId: 'x', lastSeenAt: NOW },
      update: { lastSeenAt: NOW },
    });
  });

  it('falls back to memory for good when the table is missing (P2021)', async () => {
    const err = Object.assign(new Error('The table `InboxThread` does not exist'), { code: 'P2021' });
    const d = { findMany: vi.fn(async () => { throw err; }), upsert: vi.fn(async () => { throw err; }), updateMany: vi.fn(), count: vi.fn() };
    const warn = vi.fn();
    const s = new GuardedInboxStore(new DbInboxStore(d), new MemoryInboxStore(), { warn });
    await s.upsert('u', 'wix', 'x', { needsReply: true });
    expect(s.kind).toBe('memory');
    expect(await s.countNeedsReply('u', 'wix')).toBe(1);
    expect(d.count).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('mapLimit', () => {
  it('keeps order and the concurrency bound', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(await mapLimit([], 5, async () => 1)).toEqual([]);
  });
});

describe('isWixRowFresh', () => {
  const base: InboxThreadRow = {
    platform: 'wix', externalId: 'x', contactId: 'c', customerName: null, lastMessageAt: null, lastMessageText: null,
    lastFromCustomer: false, needsReply: false, messageCount: 1, contactActivityAt: new Date('2026-10-15T09:00:00Z'),
    lastOrderNumber: null, lastSeenAt: null, updatedAt: NOW,
  };
  it('stale when the contact moved after the cache', () => {
    expect(isWixRowFresh(base, new Date('2026-10-15T09:00:00Z'), NOW, NOW)).toBe(true);
    expect(isWixRowFresh(base, new Date('2026-10-15T09:30:00Z'), NOW, NOW)).toBe(false);
    expect(isWixRowFresh({ ...base, contactActivityAt: null }, new Date('2026-10-15T09:30:00Z'), NOW, NOW)).toBe(false);
    expect(isWixRowFresh(base, null, NOW, null)).toBe(true);
  });
  it('needs-reply rows are re-checked after the max age since the last Inbox re-read (not updatedAt)', () => {
    const old = new Date(NOW.getTime() - WIX_CACHE_MAX_AGE_MS - 1);
    expect(isWixRowFresh({ ...base, needsReply: true }, null, NOW, old)).toBe(false);
    // A recent read-state write (updatedAt = now) does not make an old re-read fresh.
    expect(isWixRowFresh({ ...base, needsReply: true, updatedAt: NOW }, null, NOW, old)).toBe(false);
    expect(isWixRowFresh({ ...base, needsReply: true }, null, NOW, null)).toBe(false);
    expect(isWixRowFresh({ ...base, needsReply: true }, null, NOW, NOW)).toBe(true);
    expect(isWixRowFresh({ ...base, needsReply: false, updatedAt: old }, null, NOW, null)).toBe(true);
  });
  it('markSeen-style writes do not reset the re-check timer', async () => {
    let clock = NOW;
    const store = new MemoryInboxStore(() => clock);
    const log = new WixRefreshLog();
    const { client, calls } = wixClient({ 'conv-c1': [{ direction: 'PARTICIPANT_TO_BUSINESS', createdDate: '2026-10-15T09:56:00Z', text: 'hi' }] });
    const contacts = [contact('c1', '2026-10-15T09:56:00Z')];
    await enrichWixContacts({ client, store, userId: 'u', contacts, now: NOW, refreshLog: log });
    const later = new Date(NOW.getTime() + WIX_CACHE_MAX_AGE_MS + 1000);
    clock = later;
    await store.upsert('u', 'wix', 'conv-c1', { lastSeenAt: later }); // seller opened it
    await enrichWixContacts({ client, store, userId: 'u', contacts, now: later, refreshLog: log });
    expect(calls).toEqual({ create: 2, messages: 2 });
  });
});

describe('enrichWixContacts (§6.2)', () => {
  it('fetches the newest message, hides empty conversations, then serves from cache', async () => {
    const store = new MemoryInboxStore(() => NOW);
    const { client, calls } = wixClient({
      'conv-c1': [{ id: 'm2', direction: 'PARTICIPANT_TO_BUSINESS', createdDate: '2026-10-15T09:56:00Z', content: { previewText: 'When will it ship?' } }, { id: 'm1', direction: 'BUSINESS_TO_PARTICIPANT', createdDate: '2026-10-14T09:00:00Z' }],
      'conv-c2': [],
    });
    const contacts = [contact('c1', '2026-10-15T09:56:00Z'), contact('c2', '2026-10-15T08:00:00Z'), { noId: true }];

    const log = new WixRefreshLog();
    const first = await enrichWixContacts({ client, store, userId: 'u', contacts, now: NOW, refreshLog: log });
    expect(first.rows.map((r) => r.row.externalId)).toEqual(['conv-c1']);
    expect(first.rows[0].row).toMatchObject({ lastFromCustomer: true, needsReply: true, messageCount: 2, lastMessageText: 'When will it ship?', customerName: 'Name c1' });
    expect(calls).toEqual({ create: 2, messages: 2 });
    expect(await store.countNeedsReply('u', 'wix')).toBe(1);

    const second = await enrichWixContacts({ client, store, userId: 'u', contacts, now: NOW, refreshLog: log });
    expect(second.fetched).toBe(0);
    expect(calls).toEqual({ create: 2, messages: 2 });
    expect(second.rows.map((r) => r.row.externalId)).toEqual(['conv-c1']);
  });

  it('keeps read state and order number when a row is refreshed', async () => {
    const store = new MemoryInboxStore(() => NOW);
    await store.upsert('u', 'wix', 'conv-c1', { contactId: 'c1', lastSeenAt: NOW, lastOrderNumber: '10482', contactActivityAt: new Date('2026-10-14Z'), messageCount: 1 });
    const { client } = wixClient({ 'conv-c1': [{ direction: 'PARTICIPANT_TO_BUSINESS', createdDate: '2026-10-15T09:59:00Z', text: 'new' }] });
    const { rows } = await enrichWixContacts({ client, store, userId: 'u', contacts: [contact('c1', '2026-10-15T09:59:00Z')], now: NOW });
    expect(rows[0].row).toMatchObject({ lastSeenAt: NOW, lastOrderNumber: '10482', lastMessageText: 'new' });
  });

  it('403 on a contact aborts the platform', async () => {
    const { client } = wixClient({}, { fail: { c2: new Error('Wix API 403: forbidden') } });
    await expect(enrichWixContacts({ client, store: new MemoryInboxStore(), userId: 'u', contacts: [contact('c1'), contact('c2')], concurrency: 1 })).rejects.toThrow('403');
  });

  it('other per-contact failures skip the contact; all failing throws', async () => {
    const { client } = wixClient({ 'conv-c1': [{ direction: 'VISITOR', text: 'hi' }] }, { fail: { c2: new Error('Wix API 500: x') } });
    const ok = await enrichWixContacts({ client, store: new MemoryInboxStore(), userId: 'u', contacts: [contact('c1'), contact('c2')] });
    expect(ok.rows).toHaveLength(1);
    expect(ok).toMatchObject({ failures: 1, failureCode: 'unavailable' });

    const bad = wixClient({}, { fail: { c1: new Error('Wix API 500: x') } });
    await expect(enrichWixContacts({ client: bad.client, store: new MemoryInboxStore(), userId: 'u', contacts: [contact('c1')] })).rejects.toThrow('500');
  });
});
