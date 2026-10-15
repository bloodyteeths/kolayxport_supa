import { describe, it, expect } from 'vitest';
import {
  classifyPlatformError,
  classifyReplyError,
  compareConversations,
  joinLocalOrders,
  matchesFilter,
  newestWixMessage,
  normalizeTrendyolQuestion,
  normalizeWixMessage,
  normalizeWixOrder,
  normalizeWixThread,
  parseListFilter,
  replyErrorStatus,
  sortOrdersNewestFirst,
  toIso,
  trendyolNeedsReply,
  trendyolStatusForFilter,
  validateReplyText,
} from '@/lib/messages/normalize';
import { messageStatus } from '@/lib/ds/status/messages';
import type { InboxThreadRow } from '@/lib/messages/inboxCache';
import { PREVIEW_MAX, TRENDYOL_ANSWER_MAX, TRENDYOL_ANSWER_MIN } from '@/lib/messages/limits';
import listFixture from '../fixtures/messages/list.json';
import type { InboxListResponse } from '@/types/messages';

const Q = {
  id: 881234,
  status: 'WAITING_FOR_ANSWER',
  text: 'Kutunun iç ölçüleri nedir?',
  creationDate: 1760515800000,
  customerFirstName: 'Ayşe',
  productName: 'Ahşap anı kutusu',
  productMainId: 'PMI-77',
  imageUrl: 'https://cdn.example.com/p.jpg',
  webUrl: 'https://www.trendyol.com/x',
};

function row(p: Partial<InboxThreadRow> = {}): InboxThreadRow {
  return {
    platform: 'wix', externalId: 'conv-1', contactId: 'c1', customerName: 'Cached Name',
    lastMessageAt: new Date('2026-10-15T09:00:00Z'), lastMessageText: 'Hi', lastFromCustomer: true, needsReply: true,
    messageCount: 3, contactActivityAt: null, lastOrderNumber: null, lastSeenAt: null, updatedAt: new Date('2026-10-15T09:00:00Z'),
    ...p,
  };
}

describe('dates: no "now" fallbacks (D2)', () => {
  it('toIso', () => {
    expect(toIso(undefined)).toBeNull();
    expect(toIso('')).toBeNull();
    expect(toIso('garbage')).toBeNull();
    expect(toIso(0)).toBe('1970-01-01T00:00:00.000Z');
    expect(toIso('2026-10-15T09:00:00Z')).toBe('2026-10-15T09:00:00.000Z');
  });

  it('a Trendyol question without creationDate has null lastMessageAt and "" legacy fields', () => {
    const c = normalizeTrendyolQuestion({ ...Q, creationDate: undefined });
    expect(c.lastMessageAt).toBeNull();
    expect(c.lastMessageDate).toBe('');
    expect(c.messages[0].date).toBe('');
  });

  it('a Wix message without createdDate has date ""', () => {
    expect(normalizeWixMessage({ id: 'm', direction: 'PARTICIPANT_TO_BUSINESS', content: { previewText: 'x' } }).date).toBe('');
  });
});

describe('Trendyol status map (§5.2)', () => {
  it.each([
    ['WAITING_FOR_ANSWER', true, 'needs_reply'],
    ['WAITING_FOR_APPROVE', false, 'in_review'],
    ['ANSWERED', false, null],
    ['REJECTED', true, 'answer_rejected'],
    ['REPORTED', false, null],
    ['SOMETHING_NEW', false, null],
  ])('%s → needsReply %s, pill %s', (status, needs, pill) => {
    expect(trendyolNeedsReply(status)).toBe(needs);
    const c = normalizeTrendyolQuestion({ ...Q, status });
    expect(c.needsReply).toBe(needs);
    expect(c.status).toBe(needs ? 'unanswered' : 'answered');
    expect(c.platformStatus).toBe(status);
    expect(messageStatus(c)).toBe(pill);
  });

  it('answered question: seller answer is the newest message', () => {
    const c = normalizeTrendyolQuestion({ ...Q, status: 'ANSWERED', answer: { text: '20×15 cm', creationDate: 1760519400000 } });
    expect(c.messages.map((m) => m.sender)).toEqual(['customer', 'seller']);
    expect(c.answeredAt).toBe(new Date(1760519400000).toISOString());
    expect(c.lastMessageAt).toBe(c.answeredAt);
    expect(c.lastFromCustomer).toBe(false);
    expect(c.lastMessageText).toBe('20×15 cm');
    expect(c.unread).toBe(false);
    expect(c.unreadCount).toBe(0);
  });

  it('rejected answer exposes reason and text', () => {
    const c = normalizeTrendyolQuestion({ ...Q, status: 'REJECTED', rejectedAnswer: { text: 'www.x.com', reason: 'Link' } });
    expect(c.rejectReason).toBe('Link');
    expect(c.rejectedAnswerText).toBe('www.x.com');
    expect(c.messages).toHaveLength(1);
  });

  it('unread uses lastSeenAt', () => {
    expect(normalizeTrendyolQuestion(Q).unread).toBe(true);
    expect(normalizeTrendyolQuestion(Q, new Date(Q.creationDate + 1000)).unread).toBe(false);
    expect(normalizeTrendyolQuestion(Q, new Date(Q.creationDate - 1000)).unread).toBe(true);
  });

  it('product info and status filter', () => {
    expect(normalizeTrendyolQuestion(Q).productInfo).toEqual({ id: 'PMI-77', title: 'Ahşap anı kutusu', imageUrl: Q.imageUrl, webUrl: Q.webUrl });
    expect(trendyolStatusForFilter('needs_reply')).toBe('WAITING_FOR_ANSWER');
    expect(trendyolStatusForFilter('unread')).toBe('WAITING_FOR_ANSWER');
    expect(trendyolStatusForFilter('answered')).toBe('ANSWERED');
    expect(trendyolStatusForFilter('all')).toBeUndefined();
  });
});

describe('Wix', () => {
  it('newestWixMessage picks by createdDate and reads direction', () => {
    const n = newestWixMessage([
      { id: 'a', direction: 'BUSINESS_TO_PARTICIPANT', createdDate: '2026-10-14T10:00:00Z', content: { previewText: 'old' } },
      { id: 'b', direction: 'PARTICIPANT_TO_BUSINESS', createdDate: '2026-10-15T10:00:00Z', content: { basic: { items: [{ text: 'new' }] } } },
    ]);
    expect(n).toEqual({ text: 'new', at: '2026-10-15T10:00:00.000Z', fromCustomer: true, count: 2 });
  });

  it('newestWixMessage: empty, undated (first = newest), truncated preview', () => {
    expect(newestWixMessage([])).toEqual({ text: '', at: null, fromCustomer: null, count: 0 });
    expect(newestWixMessage(undefined).count).toBe(0);
    const n = newestWixMessage([{ direction: 'BUSINESS_TO_CUSTOMER', text: 'x'.repeat(400) }, { direction: 'VISITOR', text: 'y' }]);
    expect(n.fromCustomer).toBe(false);
    expect(n.text).toHaveLength(PREVIEW_MAX);
  });

  it('normalizeWixThread: needsReply from direction, unread from lastSeenAt, live contact wins', () => {
    const contact = { info: { name: { first: 'Mehmet', last: 'Y.' } }, primaryInfo: { email: 'm@x.com' } };
    const c = normalizeWixThread(row({ lastOrderNumber: '10482' }), contact);
    expect(c).toMatchObject({ id: 'conv-1', platform: 'wix', needsReply: true, unread: true, status: 'unanswered', customerName: 'Mehmet Y.', customerEmail: 'm@x.com', orderRef: '10482', contactId: 'c1', lastFromCustomer: true, unreadCount: 1 });
    expect(messageStatus(c)).toBe('needs_reply');

    const seen = normalizeWixThread(row({ lastSeenAt: new Date('2026-10-15T10:00:00Z') }));
    expect(seen.unread).toBe(false);
    expect(seen.customerName).toBe('Cached Name');

    const fromSeller = normalizeWixThread(row({ lastFromCustomer: false, needsReply: false }));
    expect(fromSeller.needsReply).toBe(false);
    expect(messageStatus(fromSeller)).toBeNull();

    const unknown = normalizeWixThread(row({ lastMessageAt: null, lastFromCustomer: null }));
    expect(unknown.lastMessageAt).toBeNull();
    expect(unknown.lastMessageDate).toBe('');
    expect(unknown.needsReply).toBe(false);
  });
});

describe('views and sorting', () => {
  it('view wins over legacy status', () => {
    expect(parseListFilter('unread', 'answered')).toBe('unread');
    expect(parseListFilter(undefined, 'unanswered')).toBe('unanswered');
    expect(parseListFilter('bogus', undefined)).toBe('all');
  });

  it('matchesFilter', () => {
    const a = { needsReply: true, unread: false };
    expect(matchesFilter(a, 'needs_reply')).toBe(true);
    expect(matchesFilter(a, 'unread')).toBe(false);
    expect(matchesFilter(a, 'answered')).toBe(false);
    expect(matchesFilter(a, 'all')).toBe(true);
  });

  it('newest first, unknown times last', () => {
    const list = [
      { id: 'x', lastMessageAt: null },
      { id: 'a', lastMessageAt: '2026-10-14T00:00:00Z' },
      { id: 'b', lastMessageAt: '2026-10-15T00:00:00Z' },
      { id: 'w', lastMessageAt: null },
    ].sort(compareConversations);
    expect(list.map((c) => c.id)).toEqual(['b', 'a', 'w', 'x']);
  });

  it('the shared list fixture is sorted and self-consistent', () => {
    const fx = listFixture as unknown as InboxListResponse;
    const sorted = [...fx.conversations].sort(compareConversations);
    expect(sorted.map((c) => c.id)).toEqual(fx.conversations.map((c) => c.id));
    for (const c of fx.conversations) {
      expect(c.status).toBe(c.needsReply ? 'unanswered' : 'answered');
      expect(c.lastMessageDate).toBe(c.lastMessageAt ?? '');
      if (c.unread) expect(c.needsReply).toBe(true);
    }
    expect(fx.unansweredCount).toBe(fx.conversations.filter((c) => c.needsReply).length);
  });
});

describe('errors', () => {
  it('platform errors from Wix messages and Trendyol status', () => {
    expect(classifyPlatformError(new Error('Wix API 403: forbidden'))).toBe('permission');
    expect(classifyPlatformError(new Error('Wix API 401: x'))).toBe('auth');
    expect(classifyPlatformError({ status: 429 })).toBe('rateLimited');
    expect(classifyPlatformError({ status: 500 })).toBe('unavailable');
  });

  it('reply validation uses Trendyol limits only', () => {
    expect(TRENDYOL_ANSWER_MIN).toBe(1); // §2.2: no minimum until verified
    expect(validateReplyText('trendyol', 'Evet, var.')).toBeNull();
    expect(validateReplyText('trendyol', 'x'.repeat(TRENDYOL_ANSWER_MIN))).toBeNull();
    expect(validateReplyText('trendyol', 'x'.repeat(TRENDYOL_ANSWER_MAX + 1))).toBe('tooLong');
    expect(validateReplyText('wix', 'ok')).toBeNull();
  });

  it('reply error codes and HTTP statuses (never 401)', () => {
    expect(classifyReplyError({ status: 400, body: { errors: [{ message: 'Bu soru zaten cevaplanmış' }] } })).toBe('alreadyAnswered');
    expect(classifyReplyError({ status: 400, body: { errors: [{ message: 'Cevap en az 10 karakter olmalıdır' }] } })).toBe('tooShort');
    expect(classifyReplyError({ status: 400, body: { errors: [{ message: 'Cevap en fazla 2000 karakter' }] } })).toBe('tooLong');
    expect(classifyReplyError({ status: 409 })).toBe('alreadyAnswered');
    expect(classifyReplyError({ status: 400, body: { message: 'This question has already been answered' } })).toBe('alreadyAnswered');
    // "unanswered" / "cevaplanmalı(dır)" / "cevaplanmamış" are not "already answered".
    expect(classifyReplyError({ status: 400, body: { message: 'Only unanswered questions can be answered' } })).toBe('unavailable');
    expect(classifyReplyError({ status: 400, body: { message: 'Soru 24 saat içinde cevaplanmalıdır' } })).toBe('unavailable');
    expect(classifyReplyError({ status: 400, body: { message: 'Henüz cevaplanmamış soru' } })).toBe('unavailable');
    // Length errors win over answering words in the same body.
    expect(classifyReplyError({ status: 400, body: { message: 'Cevap çok kısa; soru cevaplanmış sayılmadı' } })).toBe('tooShort');
    expect(classifyReplyError({ status: 401 })).toBe('auth');
    expect(classifyReplyError(new Error('Wix API 403: no scope'))).toBe('permission');
    expect(classifyReplyError({ status: 500 })).toBe('unavailable');
    expect(replyErrorStatus('tooShort')).toBe(400);
    expect(replyErrorStatus('alreadyAnswered')).toBe(409);
    expect(replyErrorStatus('auth')).toBe(502);
  });
});

describe('orderContext mapping (D8)', () => {
  const wixOrder = {
    number: 10482,
    status: 'APPROVED',
    _createdDate: '2026-10-13T11:00:00Z',
    currency: 'USD',
    priceSummary: { total: { amount: '64.50', formattedAmount: '$64.50' } },
    lineItems: [{ productName: { original: 'Box' }, quantity: 2, price: { amount: '27.25', formattedAmount: '$27.25' }, image: { url: 'u' } }],
  };

  it('numeric amounts, raw status, legacy strings kept', () => {
    const o = normalizeWixOrder(wixOrder);
    expect(o).toMatchObject({ orderNumber: '10482', status: 'APPROVED', createdDate: '2026-10-13T11:00:00.000Z', totalAmount: 64.5, currency: 'USD', total: '$64.50' });
    expect(o.items[0]).toEqual({ name: 'Box', imageUrl: 'u', quantity: 2, amount: 27.25, price: '$27.25' });
    const bare = normalizeWixOrder({ _id: 'o1' });
    expect(bare).toMatchObject({ orderNumber: 'o1', status: 'UNKNOWN', createdDate: '', totalAmount: null, total: '0', items: [] });
  });

  it('local join adds kxOrderId, tracking and earliest ship-by', () => {
    const [o] = joinLocalOrders([normalizeWixOrder(wixOrder)], [
      { id: 'kx1', orderNumber: '10482', trackingNumber: '1Z', shipByAt: null, items: [{ shipBy: new Date('2026-10-17Z') }, { shipBy: new Date('2026-10-16Z') }, { shipBy: null }] },
    ]);
    expect(o).toMatchObject({ kxOrderId: 'kx1', trackingNumber: '1Z', shipByDate: '2026-10-16T00:00:00.000Z' });
    const [none] = joinLocalOrders([normalizeWixOrder({ number: 9 })], []);
    expect(none.kxOrderId).toBeUndefined();
  });

  it('sorts newest first, unknown last', () => {
    const s = sortOrdersNewestFirst([
      normalizeWixOrder({ number: 1 }),
      normalizeWixOrder({ number: 2, _createdDate: '2026-01-01Z' }),
      normalizeWixOrder({ number: 3, _createdDate: '2026-05-01Z' }),
    ]);
    expect(s.map((o) => o.orderNumber)).toEqual(['3', '2', '1']);
  });
});
