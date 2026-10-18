import { describe, it, expect, vi, beforeEach } from 'vitest';

const authUser = vi.fn();
const orderFindMany = vi.fn();
const productFindFirst = vi.fn();
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: any[]) => authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/config', () => ({ isWixEnabled: () => true, isTrendyolEnabled: () => true, isHepsiburadaEnabled: () => false }));
vi.mock('@/lib/prisma', () => ({
  default: {
    credential: { findUnique: async () => ({ trendyolSupplierId: 'S1', wixInstanceId: 'I1', wixSiteId: 'W1' }), update: async () => ({}) },
    wixSite: { findFirst: async () => null, update: async () => ({}) },
    order: { findMany: (...a: any[]) => orderFindMany(...a) },
    trendyolProduct: { findFirst: (...a: any[]) => productFindFirst(...a) },
  },
}));

const trendyol = { getQuestions: vi.fn(), answerQuestion: vi.fn() };
vi.mock('@/lib/integrations/trendyolApiClient', () => ({ createTrendyolClient: () => trendyol }));
const wix = { queryContacts: vi.fn(), getOrCreateConversation: vi.fn(), getConversationMessages: vi.fn(), sendMessage: vi.fn(), searchOrders: vi.fn() };
vi.mock('@/lib/integrations/wixClient', () => ({ createWixClient: () => wix }));

import handler, { inboxStore } from '@/pages/api/messages/index';
import { decodeCursor, encodeCursor } from '@/lib/messages/cursor';

function call(method: string, query: Record<string, string>, body?: any) {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.end = () => res;
  return handler({ method, query, body, headers: {} } as any, res).then(() => res);
}

let userSeq = 0;
beforeEach(() => {
  vi.clearAllMocks();
  authUser.mockResolvedValue({ id: `user-${++userSeq}` }); // fresh user → fresh in-memory rows
  trendyol.getQuestions.mockImplementation(async ({ status }: any) => {
    if (status === 'REJECTED') return { content: [{ id: 3, status: 'REJECTED', text: 'Yıkanabilir mi?', creationDate: Date.parse('2026-10-14T18:00:00Z') }], totalPages: 1 };
    return { content: [{ id: 1, status: 'WAITING_FOR_ANSWER', text: 'Ölçü?', creationDate: Date.parse('2026-10-15T08:10:00Z'), productMainId: 'P1', productName: 'Kutu' }], totalPages: 2, totalElements: 7 };
  });
  wix.queryContacts.mockResolvedValue({
    contacts: [
      { id: 'c1', info: { name: { first: 'Mehmet' } }, lastActivity: { activityDate: '2026-10-15T09:56:00Z' } },
      { id: 'c2', info: { name: { first: 'Empty' } }, lastActivity: { activityDate: '2026-10-15T07:00:00Z' } },
    ],
    pagingMetadata: { cursors: { next: 'wix-next' }, hasNext: true },
  });
  wix.getOrCreateConversation.mockImplementation(async ({ contactId }: any) => ({ conversation: { id: `conv-${contactId}` } }));
  wix.getConversationMessages.mockImplementation(async (id: string) => (id === 'conv-c1'
    ? { messages: [{ id: 'm2', direction: 'PARTICIPANT_TO_BUSINESS', createdDate: '2026-10-15T09:56:00Z', content: { previewText: 'When will it ship?' } }, { id: 'm1', direction: 'BUSINESS_TO_PARTICIPANT', createdDate: '2026-10-14T09:00:00Z', content: { previewText: 'Thanks' } }] }
    : { messages: [] }));
});

describe('GET list', () => {
  it('needs_reply merges both stores newest first, hides empty Wix threads, adds rejected, returns a cursor', async () => {
    const res = await call('GET', { action: 'list', view: 'needs_reply' });
    expect(res.statusCode).toBe(200);
    expect(res.body.conversations.map((c: any) => `${c.platform}:${c.id}`)).toEqual(['wix:conv-c1', 'trendyol:1', 'trendyol:3']);
    const [w] = res.body.conversations;
    expect(w).toMatchObject({ needsReply: true, unread: true, lastMessageText: 'When will it ship?', lastMessageAt: '2026-10-15T09:56:00.000Z', customerName: 'Mehmet', contactId: 'c1' });
    expect(decodeCursor(res.body.nextCursor)).toEqual({ t: 1, w: 'wix-next', h: null });
    expect(res.body).toMatchObject({ enabledPlatforms: ['trendyol', 'wix'], platformErrors: [], readStateStore: 'memory', unansweredCount: 3, pageSize: 30 });
    expect(typeof res.body.fetchedAt).toBe('string');
    expect(trendyol.getQuestions).toHaveBeenCalledWith({ status: 'WAITING_FOR_ANSWER', page: 0, size: 30 });
  });

  it('cursor continues each source; an exhausted source is not called', async () => {
    await call('GET', { action: 'list', view: 'all', cursor: encodeCursor({ t: null, w: 'wix-next' })!, size: '99' });
    expect(trendyol.getQuestions).not.toHaveBeenCalled();
    expect(wix.queryContacts).toHaveBeenCalledWith({ limit: 50, cursor: 'wix-next' });
    const bad = await call('GET', { action: 'list', cursor: '%%%' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.code).toBe('badCursor');
  });

  it('markSeen clears unread, seen:false restores it; Wix counts come from the cache', async () => {
    await call('GET', { action: 'list', view: 'all' });
    const counts = await call('GET', { action: 'counts' });
    expect(counts.body).toEqual({ wix: 1, trendyol: 7, hepsiburada: 0, total: 8 });
    expect(wix.queryContacts).toHaveBeenCalledTimes(1); // counts made no Wix call

    const seen = await call('POST', { action: 'markSeen' }, { platform: 'wix', id: 'conv-c1' });
    expect(seen.statusCode).toBe(204);
    let list = await call('GET', { action: 'list', view: 'unread' });
    expect(list.body.conversations.map((c: any) => c.id)).toEqual(['1', '3']);
    expect(wix.getConversationMessages).toHaveBeenCalledTimes(2); // second list served from cache

    await call('POST', { action: 'markSeen' }, { platform: 'trendyol', id: '1' });
    await call('POST', { action: 'markSeen' }, { platform: 'wix', id: 'conv-c1', seen: false });
    list = await call('GET', { action: 'list', view: 'unread' });
    expect(list.body.conversations.map((c: any) => c.id)).toEqual(['conv-c1', '3']);

    expect((await call('POST', { action: 'markSeen' }, { platform: 'etsy', id: 'x' })).statusCode).toBe(400);
  });

  it('legacy status=unanswered still filters; one failing platform is reported, the other kept', async () => {
    wix.queryContacts.mockRejectedValueOnce(new Error('Wix API 403: forbidden'));
    const res = await call('GET', { action: 'list', platform: 'all', status: 'unanswered', size: '50' });
    expect(res.body.conversations.every((c: any) => c.status === 'unanswered')).toBe(true);
    expect(res.body.platformErrors).toEqual([expect.objectContaining({ platform: 'wix', code: 'permission' })]);
    expect(res.body.conversations.length).toBe(2);
  });

  it('a transient platform failure keeps that page in the cursor so Load more retries it', async () => {
    trendyol.getQuestions.mockRejectedValueOnce({ status: 503, body: { message: 'down' } });
    wix.queryContacts.mockRejectedValueOnce(new Error('Wix API 429: slow down'));
    const res = await call('GET', { action: 'list', view: 'all', cursor: encodeCursor({ t: 2, w: 'wix-p2' })! });
    expect(res.body.platformErrors.map((e: any) => `${e.platform}:${e.code}`).sort()).toEqual(['trendyol:unavailable', 'wix:rateLimited']);
    expect(decodeCursor(res.body.nextCursor)).toEqual({ t: 2, w: 'wix-p2', h: null });

    // Auth / permission errors end pagination for that source.
    wix.queryContacts.mockRejectedValueOnce(new Error('Wix API 403: forbidden'));
    const denied = await call('GET', { action: 'list', view: 'all', platform: 'wix' });
    expect(res.body.nextCursor).not.toBeNull();
    expect(denied.body.nextCursor).toBeNull();
  });

  it('partial Wix enrichment failures are reported as a non-fatal platform error', async () => {
    wix.queryContacts.mockResolvedValueOnce({
      contacts: [
        { id: 'c1', info: { name: { first: 'Mehmet' } }, lastActivity: { activityDate: '2026-10-15T09:56:00Z' } },
        { id: 'c3', info: { name: { first: 'Limited' } }, lastActivity: { activityDate: '2026-10-15T09:00:00Z' } },
      ],
      pagingMetadata: { hasNext: false },
    });
    wix.getOrCreateConversation.mockImplementation(async ({ contactId }: any) => {
      if (contactId === 'c3') throw new Error('Wix API 429: too many requests');
      return { conversation: { id: `conv-${contactId}` } };
    });
    const res = await call('GET', { action: 'list', view: 'all', platform: 'wix' });
    expect(res.body.conversations.map((c: any) => c.id)).toEqual(['conv-c1']);
    expect(res.body.platformErrors).toEqual([expect.objectContaining({ platform: 'wix', code: 'rateLimited', partial: true })]);
  });
});

describe('GET counts', () => {
  it('Trendyol badge counts waiting questions plus rejected answers, like the Needs reply view', async () => {
    trendyol.getQuestions.mockImplementation(async ({ status }: any) => ({ content: [], totalElements: status === 'REJECTED' ? 2 : 7 }));
    const res = await call('GET', { action: 'counts' });
    expect(res.body).toEqual({ wix: 0, trendyol: 9, hepsiburada: 0, total: 9 });
  });

  it('a failing rejected count does not drop the waiting count', async () => {
    trendyol.getQuestions.mockImplementation(async ({ status }: any) => {
      if (status === 'REJECTED') throw new Error('boom');
      return { content: [], totalElements: 7 };
    });
    expect((await call('GET', { action: 'counts' })).body.trendyol).toBe(7);
  });
});

describe('POST reply', () => {
  it('validates Trendyol max length before calling Trendyol; short answers still go out (no min, §2.2)', async () => {
    const res = await call('POST', { action: 'reply' }, { platform: 'trendyol', questionId: '1', text: 'x'.repeat(2001) });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'tooLong', min: 1, max: 2000 });
    expect(trendyol.answerQuestion).not.toHaveBeenCalled();

    trendyol.answerQuestion.mockResolvedValueOnce({ ok: true });
    const short = await call('POST', { action: 'reply' }, { platform: 'trendyol', questionId: '1', text: 'Mevcut' });
    expect(short.statusCode).toBe(200);
    expect(trendyol.answerQuestion).toHaveBeenCalledWith('1', 'Mevcut');
  });

  it('maps "already answered" to 409 and upstream auth to 502 (never 401)', async () => {
    trendyol.answerQuestion.mockRejectedValueOnce({ status: 400, body: { errors: [{ message: 'Bu soru zaten cevaplanmış' }] } });
    const a = await call('POST', { action: 'reply' }, { platform: 'trendyol', questionId: '1', text: 'İç ölçüler 20×15 cm.' });
    expect(a.statusCode).toBe(409);
    expect(a.body.code).toBe('alreadyAnswered');

    wix.sendMessage.mockRejectedValueOnce(new Error('Wix API 401: expired'));
    const b = await call('POST', { action: 'reply' }, { platform: 'wix', conversationId: 'conv-c1', text: 'Hi' });
    expect(b.statusCode).toBe(502);
    expect(b.body.code).toBe('auth');
  });

  it('a successful Wix reply clears needs-reply in the cache', async () => {
    await call('GET', { action: 'list', view: 'all' });
    wix.sendMessage.mockResolvedValueOnce({ message: { id: 'm3' } });
    const res = await call('POST', { action: 'reply' }, { platform: 'wix', conversationId: 'conv-c1', text: 'Ships tomorrow.' });
    expect(res.statusCode).toBe(200);
    const counts = await call('GET', { action: 'counts' });
    expect(counts.body.wix).toBe(0);
  });
});

describe('GET thread', () => {
  it('Wix thread oldest first with ISO dates', async () => {
    const res = await call('GET', { action: 'thread', platform: 'wix', conversationId: 'conv-c1' });
    expect(res.body.messages.map((m: any) => [m.id, m.sender])).toEqual([['m1', 'seller'], ['m2', 'customer']]);
    expect(wix.getConversationMessages).toHaveBeenCalledWith('conv-c1');
  });
});

describe('GET orderContext / productContext', () => {
  it('returns 502 with a code instead of an empty list on Wix failure (D9)', async () => {
    wix.searchOrders.mockRejectedValueOnce(new Error('Wix API 500: boom'));
    const res = await call('GET', { action: 'orderContext', contactId: 'c1' });
    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe('unavailable');
  });

  it('joins local orders and stores the newest order number as orderRef', async () => {
    await call('GET', { action: 'list', view: 'all' });
    wix.searchOrders.mockResolvedValueOnce({ orders: [
      { number: 10311, _createdDate: '2026-09-02T09:00:00Z', priceSummary: { total: { amount: '38' } } },
      { number: 10482, _createdDate: '2026-10-13T11:00:00Z', priceSummary: { total: { amount: '64.50', formattedAmount: '$64.50' } } },
    ] });
    orderFindMany.mockResolvedValueOnce([{ id: 'kx1', orderNumber: '10482', trackingNumber: null, shipByAt: new Date('2026-10-16Z'), items: [] }]);
    const res = await call('GET', { action: 'orderContext', contactId: 'c1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.orders.map((o: any) => o.orderNumber)).toEqual(['10482', '10311']);
    expect(res.body.orders[0]).toMatchObject({ kxOrderId: 'kx1', totalAmount: 64.5, total: '$64.50', shipByDate: '2026-10-16T00:00:00.000Z' });
    expect(orderFindMany.mock.calls[0][0].where).toEqual({ userId: expect.any(String), marketplace: 'Wix', orderNumber: { in: ['10482', '10311'] } });
    const list = await call('GET', { action: 'list', view: 'all', platform: 'wix' });
    expect(list.body.conversations[0].orderRef).toBe('10482');
  });

  it('productContext reads the local catalog only', async () => {
    productFindFirst.mockResolvedValueOnce({ title: 'Kutu', barcode: '868', salePrice: { toString: () => '449.9', valueOf: () => 449.9 }, currencyType: 'TRY', quantity: 12, onSale: true, thumbnailUrl: null });
    const a = await call('GET', { action: 'productContext', productMainId: 'P1' });
    expect(a.body).toEqual({ productMainId: 'P1', inCatalog: true, title: 'Kutu', barcode: '868', salePrice: 449.9, currency: 'TRY', quantity: 12, onSale: true, thumbnailUrl: null });
    productFindFirst.mockResolvedValueOnce(null);
    const b = await call('GET', { action: 'productContext', productMainId: 'P2' });
    expect(b.body).toEqual({ productMainId: 'P2', inCatalog: false });
    expect(inboxStore.kind).toBe('memory');
  });
});
