// messages G5: pure inbox helpers (cursor keys, merge / keep-on-failure, locallyAnswered, seen, search, j/k).
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SNAPSHOT,
  applyLocalState,
  autoOpenTarget,
  filterConversations,
  inboxPageKey,
  mergeInboxPages,
  neighbourKey,
  nextNeedsReplyKey,
  parseInboxPage,
  sortConversations,
} from '@/components/domain/messages/useInbox';
import { parseOpenKey, toOpenKey } from '@/components/domain/messages/useInboxUrlState';
import { escapeStep, listRegion, storeFilterPlatforms } from '@/components/domain/messages/useInbox';
import { bannerModel } from '@/components/domain/messages/PlatformBanners';
import type { InboxListResponse, UnifiedConversation } from '@/types/messages';

function conv(p: Partial<UnifiedConversation> & { id: string }): UnifiedConversation {
  return {
    platform: 'wix',
    status: 'unanswered',
    needsReply: true,
    unread: true,
    customerName: 'Ayşe Kaya',
    subject: '',
    lastMessageText: 'Merhaba',
    lastMessageAt: '2026-10-15T10:00:00.000Z',
    lastMessageDate: '2026-10-15T10:00:00.000Z',
    lastFromCustomer: true,
    unreadCount: 1,
    messages: [],
    ...p,
  };
}

function page(p: Partial<InboxListResponse>): InboxListResponse {
  return parseInboxPage({ conversations: [], enabledPlatforms: ['wix', 'trendyol'], platformErrors: [], nextCursor: null, fetchedAt: '2026-10-15T10:00:00Z', ...p });
}

describe('URL keys', () => {
  it('parses and builds open keys (ids may contain ":")', () => {
    expect(parseOpenKey('wix:abc:1')).toEqual({ platform: 'wix', id: 'abc:1' });
    expect(parseOpenKey('etsy:1')).toBeNull();
    expect(parseOpenKey('wix:')).toBeNull();
    expect(toOpenKey({ platform: 'trendyol', id: '9' })).toBe('trendyol:9');
  });

  it('page keys carry view/platform/size and the previous cursor; stop without one', () => {
    const k0 = inboxPageKey(0, null, { platform: 'all', view: 'needs_reply' })!;
    expect(k0).toContain('action=list');
    expect(k0).toContain('view=needs_reply');
    expect(k0).toContain('size=30');
    expect(k0).not.toContain('cursor');
    expect(inboxPageKey(1, page({ nextCursor: 'abc' }), { platform: 'wix', view: 'all' })).toContain('cursor=abc');
    expect(inboxPageKey(1, page({ nextCursor: null }), { platform: 'wix', view: 'all' })).toBeNull();
  });
});

describe('parseInboxPage', () => {
  it('drops malformed rows and unknown error codes', () => {
    const p = parseInboxPage({ conversations: [{ id: 'a', platform: 'wix' }, { id: 1 }, null], platformErrors: [{ platform: 'wix', code: 'nope' }, { platform: 'trendyol', code: 'auth', detail: '' }] });
    expect(p.conversations).toHaveLength(1);
    expect(p.platformErrors.map((e) => e.code)).toEqual(['auth']);
    expect(p.readStateStore).toBe('memory');
  });
});

describe('sort + merge', () => {
  it('sorts newest first with unknown times last', () => {
    const rows = sortConversations([conv({ id: 'a', lastMessageAt: null }), conv({ id: 'b', lastMessageAt: '2026-10-14T00:00:00Z' }), conv({ id: 'c' })]);
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('a failed platform keeps its last good rows; healthy platform refreshes', () => {
    const first = mergeInboxPages([page({ conversations: [conv({ id: 'w1' }), conv({ id: 't1', platform: 'trendyol' })] })], EMPTY_SNAPSHOT, null);
    const second = mergeInboxPages(
      [page({ conversations: [conv({ id: 't2', platform: 'trendyol' })], platformErrors: [{ platform: 'wix', code: 'unavailable', detail: '' }] })],
      first.snapshot,
      null,
    );
    expect(second.rows.map(toOpenKey).sort()).toEqual(['trendyol:t2', 'wix:w1']);
    expect(second.platformErrors).toHaveLength(1);
  });

  it('keeps the open thread listed after it leaves the view, dedupes across pages', () => {
    const first = mergeInboxPages([page({ conversations: [conv({ id: 'w1' }), conv({ id: 'w2' })] })], EMPTY_SNAPSHOT, null);
    const second = mergeInboxPages([page({ conversations: [conv({ id: 'w2' })] }), page({ conversations: [conv({ id: 'w2' })] })], first.snapshot, 'wix:w1');
    expect(second.rows.map((r) => r.id).sort()).toEqual(['w1', 'w2']);
  });
});

describe('applyLocalState', () => {
  it('Trendyol answered from this tab stays answered even when a poll says waiting', () => {
    const { rows } = applyLocalState([conv({ id: 't', platform: 'trendyol' })], new Map([['trendyol:t', { at: '2026-10-15T11:00:00Z', text: 'Cevap' }]]), new Map());
    expect(rows[0]).toMatchObject({ needsReply: false, unread: false, status: 'answered', lastFromCustomer: false, lastMessageText: 'Cevap' });
  });

  it('a newer Wix customer message re-opens the thread and expires the local answer', () => {
    const { rows, expired } = applyLocalState(
      [conv({ id: 'w', lastMessageAt: '2026-10-15T12:00:00Z', lastFromCustomer: true })],
      new Map([['wix:w', { at: '2026-10-15T11:00:00Z', text: 'x' }]]),
      new Map(),
    );
    expect(expired).toEqual(['wix:w']);
    expect(rows[0].needsReply).toBe(true);
  });

  it('a Wix answer expires once the server shows it (row stops being muted); Trendyol keeps its mark', () => {
    const answered = new Map([
      ['wix:w', { at: '2026-10-15T11:00:00Z', text: 'x' }],
      ['trendyol:t', { at: '2026-10-15T11:00:00Z', text: 'y' }],
    ]);
    const { rows, expired } = applyLocalState(
      [
        conv({ id: 'w', lastMessageAt: '2026-10-15T11:00:05Z', lastFromCustomer: false, needsReply: false }),
        conv({ id: 't', platform: 'trendyol', lastMessageAt: '2026-10-15T11:00:05Z', lastFromCustomer: false, needsReply: false }),
      ],
      answered,
      new Map(),
    );
    expect(expired).toEqual(['wix:w']);
    expect(rows[0].lastMessageAt).toBe('2026-10-15T11:00:05Z');
    expect(rows[1].status).toBe('answered');
  });

  it('a Wix answer the server has not caught up with stays overlaid', () => {
    const { rows, expired } = applyLocalState([conv({ id: 'w', lastMessageAt: '2026-10-15T10:00:00Z' })], new Map([['wix:w', { at: '2026-10-15T11:00:00Z', text: 'x' }]]), new Map());
    expect(expired).toEqual([]);
    expect(rows[0]).toMatchObject({ needsReply: false, lastMessageText: 'x' });
  });

  it('seen clears the dot until a newer message; unseen shows it again', () => {
    const seenAt = new Date('2026-10-15T10:30:00Z').getTime();
    expect(applyLocalState([conv({ id: 'w' })], new Map(), new Map([['wix:w', { seen: true, at: seenAt }]])).rows[0].unread).toBe(false);
    expect(applyLocalState([conv({ id: 'w', lastMessageAt: '2026-10-15T11:00:00Z' })], new Map(), new Map([['wix:w', { seen: true, at: seenAt }]])).rows[0].unread).toBe(true);
    expect(applyLocalState([conv({ id: 'w', unread: false })], new Map(), new Map([['wix:w', { seen: false, at: seenAt }]])).rows[0].unread).toBe(true);
  });
});

describe('search + navigation', () => {
  const rows = [
    conv({ id: 'a', needsReply: false, customerName: 'Selin' }),
    conv({ id: 'b', customerName: 'Mehmet', productInfo: { id: 'p', title: 'Ahşap anı kutusu' } }),
    conv({ id: 'c', orderRef: '10482' }),
  ];
  it('searches name, text, product and order number (Turkish casing)', () => {
    expect(filterConversations(rows, 'AHŞAP').map((r) => r.id)).toEqual(['b']);
    expect(filterConversations(rows, '1048').map((r) => r.id)).toEqual(['c']);
    expect(filterConversations(rows, '  ')).toHaveLength(3);
  });
  it('auto-open picks the newest needs-reply row; j/k and next-needs-reply', () => {
    expect(autoOpenTarget(rows)?.id).toBe('b');
    expect(neighbourKey(rows, null, 1)).toBe('wix:a');
    expect(neighbourKey(rows, 'wix:b', 1)).toBe('wix:c');
    expect(neighbourKey(rows, 'wix:c', 1)).toBeNull();
    expect(neighbourKey(rows, 'wix:a', -1)).toBeNull();
    expect(nextNeedsReplyKey(rows, 'wix:b')).toBe('wix:c');
    expect(nextNeedsReplyKey(rows, 'wix:c')).toBe('wix:b');
    expect(nextNeedsReplyKey([rows[0]], 'wix:a')).toBeNull();
  });
});

describe('page rules', () => {
  const base = { state: 'ready' as const, loaded: true, connected: { wix: true, trendyol: undefined }, enabledPlatforms: ['wix' as const], visibleCount: 0, view: 'needs_reply' as const, filtered: false };
  it('list region states', () => {
    expect(listRegion({ ...base, connected: { wix: false, trendyol: false }, enabledPlatforms: [] }).kind).toBe('noStore');
    expect(listRegion({ ...base, loaded: false, state: 'loading' }).kind).toBe('loading');
    expect(listRegion({ ...base, loaded: false, state: 'slow' }).kind).toBe('slow');
    expect(listRegion({ ...base, loaded: false, state: 'error' }).kind).toBe('error');
    expect(listRegion(base)).toEqual({ kind: 'empty', empty: 'done' });
    expect(listRegion({ ...base, view: 'all' })).toEqual({ kind: 'empty', empty: 'none' });
    expect(listRegion({ ...base, filtered: true })).toEqual({ kind: 'empty', empty: 'noResults' });
    expect(listRegion({ ...base, visibleCount: 2 }).kind).toBe('rows');
  });
  it('every platform failed with nothing cached: page error, never "Every message has a reply"', () => {
    expect(listRegion({ ...base, failedPlatforms: ['wix'], rowCount: 0 }).kind).toBe('error');
    expect(listRegion({ ...base, enabledPlatforms: ['wix', 'trendyol'], failedPlatforms: ['wix', 'trendyol'], rowCount: 0, filtered: true }).kind).toBe('error');
    // Kept rows from the last good response: rows stay, no page error.
    expect(listRegion({ ...base, failedPlatforms: ['wix'], rowCount: 3, visibleCount: 3 }).kind).toBe('rows');
  });
  it('one platform failed and the healthy one is empty: no "done" claim', () => {
    expect(listRegion({ ...base, enabledPlatforms: ['wix', 'trendyol'], failedPlatforms: ['wix'], rowCount: 0 })).toEqual({ kind: 'empty', empty: 'none' });
  });
  it('store filter offers every connected store whatever the current filter', () => {
    expect(storeFilterPlatforms({ wix: true, trendyol: true }, ['wix'], 'wix')).toEqual(['wix', 'trendyol']);
    expect(storeFilterPlatforms({ wix: undefined, trendyol: undefined }, ['wix', 'trendyol'], 'wix')).toEqual(['wix', 'trendyol']);
    expect(storeFilterPlatforms({ wix: true, trendyol: false }, [], 'all')).toEqual(['wix']);
    expect(storeFilterPlatforms({ wix: false, trendyol: undefined }, [], 'trendyol')).toEqual(['trendyol']);
  });
  it('Escape order', () => {
    expect(escapeStep({ inField: true, hasSearch: true, sheetOpen: true })).toBe('blur');
    expect(escapeStep({ inField: false, hasSearch: true, sheetOpen: true })).toBe('clearSearch');
    expect(escapeStep({ inField: false, hasSearch: false, sheetOpen: true })).toBe('closeSheet');
    expect(escapeStep({ inField: false, hasSearch: false, sheetOpen: false })).toBeNull();
  });
  it('platform banners: tone and action per code', () => {
    expect(bannerModel({ platform: 'wix', code: 'permission', detail: '' })).toMatchObject({ tone: 'warning', action: { kind: 'reconnect', href: '/ayarlar?tab=connections' } });
    expect(bannerModel({ platform: 'trendyol', code: 'auth', detail: '' }).action).toEqual({ kind: 'reconnect', href: '/ayarlar?tab=apiKeys' });
    expect(bannerModel({ platform: 'trendyol', code: 'credentials', detail: '' }).action).toMatchObject({ kind: 'finishSetup' });
    expect(bannerModel({ platform: 'wix', code: 'rateLimited', detail: '' })).toMatchObject({ tone: 'info', action: { kind: 'retry' } });
  });
});
