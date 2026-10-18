import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── API route mocks (HB enabled, Wix/Trendyol off) ─────────────────────────────────────────────────
const authUser = vi.fn();
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: any[]) => authUser(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/config', () => ({ isWixEnabled: () => false, isTrendyolEnabled: () => false, isHepsiburadaEnabled: () => true }));
vi.mock('@/lib/prisma', () => ({
  default: {
    credential: { findUnique: async () => ({ hepsiburadaMerchantId: 'M-1', hepsiburadaApiKey: 'k' }), update: async () => ({}) },
    wixSite: { findFirst: async () => null },
    order: { findMany: async () => [] },
    trendyolProduct: { findFirst: async () => null },
  },
}));
const hb = { listQuestions: vi.fn(), questionCounts: vi.fn(), getQuestion: vi.fn(), answerQuestion: vi.fn() };
vi.mock('@/lib/hepsiburada/client', () => ({ createHepsiburadaClient: () => hb }));
vi.mock('@/lib/integrations/trendyolApiClient', () => ({ createTrendyolClient: () => ({}) }));
vi.mock('@/lib/integrations/wixClient', () => ({ createWixClient: () => ({}) }));

import handler from '@/pages/api/messages/index';
import {
  hepsiburadaFromSeller,
  hepsiburadaNeedsReply,
  hepsiburadaStatusForFilter,
  normalizeHepsiburadaQuestion,
  validateReplyText,
} from '@/lib/messages/normalize';
import { composerMode, messageRowState } from '@/lib/messages/threadState';
import { decodeCursor, encodeCursor, nextHepsiburadaPage } from '@/lib/messages/cursor';
import { isQuestionPlatform, replyLimits } from '@/lib/messages/platforms';
import { hepsiburadaThreadFromIssue, validateDraft } from '@/lib/messages/draftReply';
import { listOpenHepsiburadaClaims, mergeClaims, normalizeHbClaim } from '@/lib/hepsiburada/claims';

// ── fixtures (IssueViewModel / Claim shapes from HB's OpenAPI documents) ────────────────────────────
const waitingIssue = {
  id: 'a1b2', issueNumber: 4521, createdAt: '2026-10-15T08:10:00Z', customerId: 'cust-1', orderNumber: '4038201933',
  status: 'WaitingForAnswer', subject: { id: 's1', description: 'Ürün hakkında' }, lastContent: 'Kargoya ne zaman verilir?',
  conversations: [{ id: 'c1', createdAt: '2026-10-15T08:10:00Z', content: 'Kargoya ne zaman verilir?', from: 'Customer' }],
  product: { sku: 'HBCV00000ABC12', name: 'Ahşap Takı Kutusu', imageUrl: 'https://img/1.jpg', stockCode: 'BOX-1' },
  expireDate: '2026-10-16T08:10:00Z',
};
const answeredIssue = {
  id: 'z9', issueNumber: 4400, createdAt: '2026-10-10T10:00:00Z', status: 'Answered',
  conversations: [
    { id: 'c2', createdAt: '2026-10-10T12:00:00Z', content: 'Yarın kargoda.', from: 'Merchant' },
    { id: 'c1', createdAt: '2026-10-10T10:00:00Z', content: 'Ne zaman gelir?', from: 'Customer' },
  ],
  product: { sku: 'HBCV1', name: 'Kutu' },
};

describe('normalizeHepsiburadaQuestion', () => {
  it('maps a waiting question: id = issue number, deadline, product, order', () => {
    const c = normalizeHepsiburadaQuestion(waitingIssue, null);
    expect(c).toMatchObject({
      id: '4521', platform: 'hepsiburada', needsReply: true, unread: true, status: 'unanswered', platformStatus: 'WaitingForAnswer',
      expiresAt: '2026-10-16T08:10:00.000Z', subject: 'Ahşap Takı Kutusu', orderRef: '4038201933',
      lastFromCustomer: true, lastMessageText: 'Kargoya ne zaman verilir?', lastMessageAt: '2026-10-15T08:10:00.000Z', customerName: '',
    });
    expect(c.productInfo).toEqual({ id: 'HBCV00000ABC12', title: 'Ahşap Takı Kutusu', imageUrl: 'https://img/1.jpg', webUrl: 'https://www.hepsiburada.com/ara?q=HBCV00000ABC12' });
    expect(c.messages).toEqual([{ id: 'c1', sender: 'customer', text: 'Kargoya ne zaman verilir?', date: '2026-10-15T08:10:00.000Z' }]);
  });

  it('orders conversations oldest first and marks the seller answer', () => {
    const c = normalizeHepsiburadaQuestion(answeredIssue, null);
    expect(c.needsReply).toBe(false);
    expect(c.unread).toBe(false);
    expect(c.expiresAt).toBeNull();
    expect(c.messages.map((m) => m.sender)).toEqual(['customer', 'seller']);
    expect(c.answeredAt).toBe('2026-10-10T12:00:00.000Z');
    expect(c.lastFromCustomer).toBe(false);
  });

  it('falls back to lastContent when there are no conversations; seen clears unread', () => {
    const c = normalizeHepsiburadaQuestion({ issueNumber: 7, status: 'WaitingForAnswer', lastContent: 'Merhaba', createdAt: '2026-10-15T08:00:00Z' }, '2026-10-15T09:00:00Z');
    expect(c.messages).toEqual([{ id: '7-q', sender: 'customer', text: 'Merhaba', date: '2026-10-15T08:00:00.000Z' }]);
    expect(c.unread).toBe(false);
    expect(c.productInfo).toBeUndefined();
  });

  it('needs reply only for WaitingForAnswer (HB "Rejected" = the seller reported it)', () => {
    expect(hepsiburadaNeedsReply('WaitingForAnswer')).toBe(true);
    expect(hepsiburadaNeedsReply('waitingforanswer')).toBe(true);
    for (const s of ['Answered', 'Rejected', 'AutoClosed', '', null]) expect(hepsiburadaNeedsReply(s as any)).toBe(false);
  });

  it('status query codes per view', () => {
    expect(hepsiburadaStatusForFilter('needs_reply')).toBe(1);
    expect(hepsiburadaStatusForFilter('unread')).toBe(1);
    expect(hepsiburadaStatusForFilter('answered')).toBe(2);
    expect(hepsiburadaStatusForFilter('all')).toBeUndefined();
  });

  it('seller detection is loose on the undocumented `from` values', () => {
    expect(hepsiburadaFromSeller('Merchant')).toBe(true);
    expect(hepsiburadaFromSeller('Satıcı')).toBe(true);
    expect(hepsiburadaFromSeller('Customer')).toBe(false);
    expect(hepsiburadaFromSeller('Müşteri')).toBe(false);
  });
});

describe('composer / limits', () => {
  it('waiting → answer, answered → answered, reported/closed → cannot_answer, local send → answered', () => {
    const w = normalizeHepsiburadaQuestion(waitingIssue);
    expect(composerMode(w).kind).toBe('answer');
    expect(composerMode(w, { locallyAnsweredAt: '2026-10-15T09:00:00Z' })).toEqual({ kind: 'answered', answeredAt: '2026-10-15T09:00:00Z' });
    expect(composerMode(normalizeHepsiburadaQuestion(answeredIssue)).kind).toBe('answered');
    expect(composerMode(normalizeHepsiburadaQuestion({ ...waitingIssue, status: 'AutoClosed' }))).toEqual({ kind: 'cannot_answer', rawStatus: 'AutoClosed' });
    expect(messageRowState(normalizeHepsiburadaQuestion(answeredIssue)).muted).toBe(true);
  });

  it('2000-char answers, Q&A platform', () => {
    expect(isQuestionPlatform('hepsiburada')).toBe(true);
    expect(isQuestionPlatform('wix')).toBe(false);
    expect(replyLimits('hepsiburada')).toEqual({ min: 1, max: 2000 });
    expect(validateReplyText('hepsiburada', 'x'.repeat(2001))).toBe('tooLong');
    expect(validateReplyText('hepsiburada', 'Evet')).toBeNull();
  });

  it('AI drafts on Hepsiburada reject contact details', () => {
    expect(validateDraft({ reply: 'Bize 0532 123 45 67 numarasından ulaşın', missing: [] }, 'hepsiburada', '').ok).toBe(false);
    expect(validateDraft({ reply: 'Yarın kargoya verilecek.', missing: [] }, 'hepsiburada', '').ok).toBe(true);
    expect(hepsiburadaThreadFromIssue(answeredIssue).map((m) => m.sender)).toEqual(['customer', 'seller']);
  });
});

describe('cursor h (Hepsiburada page, 1-based)', () => {
  it('round-trips; legacy cursors without h decode as exhausted', () => {
    expect(decodeCursor(encodeCursor({ t: null, w: null, h: 3 }))).toEqual({ t: null, w: null, h: 3 });
    expect(encodeCursor({ t: null, w: null, h: null })).toBeNull();
    expect(decodeCursor(Buffer.from('{"t":1,"w":""}').toString('base64'))).toEqual({ t: 1, w: '', h: null });
    expect(decodeCursor(Buffer.from('{"t":1,"w":"","h":0}').toString('base64'))).toBeNull();
  });

  it('nextHepsiburadaPage', () => {
    expect(nextHepsiburadaPage(1, 3, 25, 25)).toBe(2);
    expect(nextHepsiburadaPage(3, 3, 25, 25)).toBeNull();
    expect(nextHepsiburadaPage(1, undefined, 10, 25)).toBeNull();
    expect(nextHepsiburadaPage(1, undefined, 25, 25)).toBe(2);
  });
});

describe('claims', () => {
  const claimA = {
    number: 'CLM-1', id: 'c-1', status: 'AwaitingAction', claimType: 'Return', orderNumber: '4038201933', sku: 'HBCV1',
    MerchantSku: 'BOX-1', quantity: 1, totalPriceAmount: 499.9, priceCurrency: 'TRY', claimDate: '2026-10-14T10:00:00',
    AwaitingActionExpireDate: '2026-10-17T10:00:00', Reason: 'Hasarlı ürün',
    Reports: [{ ImageUrl: 'https://img/r1.jpg', ReportedBy: 'Customer' }],
    Deliveries: [{ Status: 'Delivered', Direction: 'CustomerToMerchant', TrackingNumber: 'TRK1', CargoCompany: { Name: 'HepsiJet' }, PackageNumber: 'P1', CreatedDate: '2026-10-15T10:00:00Z' }],
  };
  const claimB = { number: 'CLM-2', status: 'NewRequest', claimDate: '2026-10-15T09:00:00Z' };

  it('normalizes mixed-case fields; zone-less dates are Turkey time', () => {
    const c = normalizeHbClaim(claimA);
    expect(c).toMatchObject({
      number: 'CLM-1', status: 'AwaitingAction', actionable: true, reason: 'Hasarlı ürün', merchantSku: 'BOX-1', amount: 499.9,
      currency: 'TRY', claimDate: '2026-10-14T07:00:00.000Z', actionDeadline: '2026-10-17T07:00:00.000Z', images: ['https://img/r1.jpg'],
    });
    expect(c.deliveries[0]).toMatchObject({ trackingNumber: 'TRK1', cargoCompany: 'HepsiJet', direction: 'CustomerToMerchant' });
    expect(normalizeHbClaim({ number: 'X', status: 'InDispute' }).actionable).toBe(false);
  });

  it('merges per-status lists without duplicates, soonest deadline first', () => {
    const merged = mergeClaims([[claimB], [claimA, { ...claimA, status: 'NewRequest' }]]);
    expect(merged.map((c) => c.number)).toEqual(['CLM-1', 'CLM-2']);
  });

  it('a failing status is reported, not fatal; all failing throws', async () => {
    const client = { listClaimsByStatus: vi.fn(async (s: string) => { if (s === 'InDispute') throw { status: 500 }; return s === 'AwaitingAction' ? [claimA] : []; }) };
    const r = await listOpenHepsiburadaClaims(client as any);
    expect(r.claims.map((c) => c.number)).toEqual(['CLM-1']);
    expect(r.failedStatuses).toEqual(['InDispute']);
    const down = { listClaimsByStatus: vi.fn(async () => { throw { status: 401 }; }) };
    await expect(listOpenHepsiburadaClaims(down as any)).rejects.toEqual({ status: 401 });
  });
});

// ── /api/messages with Hepsiburada ─────────────────────────────────────────────────────────────────

function call(method: string, query: Record<string, string>, body?: any) {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.end = () => res;
  return handler({ method, query, body, headers: {} } as any, res).then(() => res);
}

let seq = 0;
beforeEach(() => {
  vi.clearAllMocks();
  authUser.mockResolvedValue({ id: `hb-user-${++seq}` });
  hb.listQuestions.mockResolvedValue({ data: [waitingIssue], currentPage: 1, totalPageCount: 2, totalItemCount: 26 });
  hb.questionCounts.mockResolvedValue({ waitingForAnswer: 4, answered: 10 });
});

describe('GET /api/messages (Hepsiburada)', () => {
  it('lists waiting questions with page 1 and a cursor for page 2', async () => {
    const res = await call('GET', { action: 'list', view: 'needs_reply' });
    expect(res.statusCode).toBe(200);
    expect(res.body.enabledPlatforms).toEqual(['hepsiburada']);
    expect(res.body.conversations.map((c: any) => `${c.platform}:${c.id}`)).toEqual(['hepsiburada:4521']);
    expect(hb.listQuestions).toHaveBeenCalledWith({ status: '1', page: 1, size: 30 });
    expect(decodeCursor(res.body.nextCursor)).toEqual({ t: null, w: null, h: 2 });
  });

  it('a transient failure keeps the page; auth ends it', async () => {
    hb.listQuestions.mockRejectedValueOnce({ status: 503, body: { message: 'down' } });
    const res = await call('GET', { action: 'list', view: 'all', cursor: encodeCursor({ t: null, w: null, h: 3 })! });
    expect(res.body.platformErrors).toEqual([expect.objectContaining({ platform: 'hepsiburada', code: 'unavailable' })]);
    expect(decodeCursor(res.body.nextCursor)).toEqual({ t: null, w: null, h: 3 });
    hb.listQuestions.mockRejectedValueOnce({ status: 401, body: {} });
    const denied = await call('GET', { action: 'list', view: 'all' });
    expect(denied.body.platformErrors[0].code).toBe('auth');
    expect(denied.body.nextCursor).toBeNull();
  });

  it('counts from issues/count', async () => {
    const res = await call('GET', { action: 'counts' });
    expect(res.body).toEqual({ wix: 0, trendyol: 0, hepsiburada: 4, total: 4 });
  });

  it('thread and reply', async () => {
    hb.getQuestion.mockResolvedValue(waitingIssue);
    const thread = await call('GET', { action: 'thread', platform: 'hepsiburada', conversationId: '4521' });
    expect(thread.statusCode).toBe(200);
    expect(thread.body.id).toBe('4521');

    hb.answerQuestion.mockResolvedValue('');
    const ok = await call('POST', { action: 'reply' }, { platform: 'hepsiburada', questionId: '4521', text: 'Yarın kargoda.' });
    expect(ok.statusCode).toBe(200);
    expect(hb.answerQuestion).toHaveBeenCalledWith('4521', 'Yarın kargoda.');

    const long = await call('POST', { action: 'reply' }, { platform: 'hepsiburada', questionId: '4521', text: 'x'.repeat(2001) });
    expect(long.statusCode).toBe(400);
    expect(long.body).toMatchObject({ code: 'tooLong', max: 2000 });

    hb.answerQuestion.mockRejectedValueOnce({ status: 400, body: { message: 'Bu soru zaten cevaplanmış' } });
    const dup = await call('POST', { action: 'reply' }, { platform: 'hepsiburada', questionId: '4521', text: 'Tekrar' });
    expect(dup.statusCode).toBe(409);
    expect(dup.body.code).toBe('alreadyAnswered');

    expect((await call('POST', { action: 'markSeen' }, { platform: 'hepsiburada', id: '4521' })).statusCode).toBe(204);
  });
});
