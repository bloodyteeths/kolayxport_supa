// @vitest-environment jsdom
// messages §5.3 / §8 G6: pure helpers of the thread + composer (validation, error codes, day grouping,
// local bubbles, sessionStorage drafts, keyboard inset, bubble time).
import { afterEach, describe, expect, it, vi } from 'vitest';

// lib/auth-context.js is JSX in a .js file (the saved-replies picker imports it through useSavedReplies).
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
import {
  cleanMissing,
  clearAllDrafts,
  draftStorageKey,
  groupByDay,
  listDraftKeys,
  mapReplyError,
  mergeThreadMessages,
  pathOf,
  readDraft,
  replyBody,
  threadKey,
  validateComposerText,
  writeDraft,
} from '@/components/domain/messages/useThread';
import { keyboardInset } from '@/components/domain/messages/useKeyboardInset';
import { bubbleTimeMode } from '@/components/domain/messages/MessageBubble';
import { sendKeysLabel } from '@/components/domain/messages/Composer';
import { orderHref } from '@/components/domain/messages/OrderContextList';
import { listingHref } from '@/components/domain/messages/ProductContextCard';
import { TRENDYOL_ANSWER_MAX, TRENDYOL_ANSWER_MIN } from '@/lib/messages/limits';
import { G6_EN, G6_TR, g6KeyRows } from './g6-messages';

afterEach(() => {
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('validateComposerText', () => {
  it('blocks empty and whitespace-only text', () => {
    expect(validateComposerText('wix', '   \n')).toEqual({ kind: 'empty' });
  });
  it('blocks unfilled saved-reply tokens before the length check', () => {
    expect(validateComposerText('trendyol', 'Hi {customer}, order {order}')).toEqual({ kind: 'unfilled', tokens: ['{customer}', '{order}'] });
  });
  it('applies Trendyol min/max only to Trendyol', () => {
    // No minimum until verified (messages §2.2): short answers like "Evet" are valid.
    expect(TRENDYOL_ANSWER_MIN).toBe(1);
    expect(validateComposerText('trendyol', 'Evet')).toBeNull();
    expect(validateComposerText('wix', 'Yes')).toBeNull();
    expect(validateComposerText('trendyol', 'x'.repeat(TRENDYOL_ANSWER_MAX + 1))).toEqual({ kind: 'tooLong', max: TRENDYOL_ANSWER_MAX });
    expect(validateComposerText('trendyol', 'Merhaba, ölçüleri 25×18×10 cm.')).toBeNull();
  });
});

describe('mapReplyError', () => {
  it('maps the route codes without parsing text', () => {
    expect(mapReplyError('trendyol', { code: 'alreadyAnswered', error: 'x' })).toEqual({ kind: 'alreadyAnswered' });
    expect(mapReplyError('trendyol', { code: 'tooShort', min: 10 })).toEqual({ kind: 'tooShort', min: 10 });
    expect(mapReplyError('trendyol', { code: 'tooLong', max: 2000 })).toEqual({ kind: 'tooLong', max: 2000 });
    expect(mapReplyError('wix', { code: 'permission' })).toEqual({ kind: 'auth', platform: 'wix' });
    expect(mapReplyError('wix', { code: 'auth' })).toEqual({ kind: 'auth', platform: 'wix' });
    expect(mapReplyError('wix', { code: 'unavailable' })).toEqual({ kind: 'generic' });
    expect(mapReplyError('wix', null)).toEqual({ kind: 'generic' });
    expect(mapReplyError('wix', ['garbled'])).toEqual({ kind: 'generic' });
  });
});

describe('groupByDay', () => {
  it('groups by calendar day in the seller timezone and keeps undated messages with the previous group', () => {
    const groups = groupByDay(
      [
        { id: 'a', sender: 'customer', text: 'a', date: '2026-10-14T20:30:00.000Z' }, // 23:30 Istanbul, 14 Oct
        { id: 'b', sender: 'seller', text: 'b', date: '' },
        { id: 'c', sender: 'customer', text: 'c', date: '2026-10-14T21:30:00.000Z' }, // 00:30 Istanbul, 15 Oct
      ],
      'Europe/Istanbul',
    );
    expect(groups.map((g) => [g.day, g.messages.map((m) => m.id)])).toEqual([
      ['2026-10-14', ['a', 'b']],
      ['2026-10-15', ['c']],
    ]);
  });
  it('a leading undated message adopts the first dated day', () => {
    const groups = groupByDay([
      { id: 'x', sender: 'customer', text: 'x', date: '' },
      { id: 'y', sender: 'seller', text: 'y', date: '2026-10-15T09:00:00.000Z' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe('2026-10-15T09:00:00.000Z');
  });
});

describe('mergeThreadMessages', () => {
  it('drops a local bubble once the server returns the same seller text', () => {
    const local = [{ id: 'local-1', sender: 'seller' as const, text: 'Ships tomorrow', date: '2026-10-15T10:00:00.000Z' }];
    expect(mergeThreadMessages([], local)).toHaveLength(1);
    expect(mergeThreadMessages([{ id: 'm9', sender: 'seller', text: 'Ships tomorrow ', date: '2026-10-15T10:00:01.000Z' }], local)).toHaveLength(1);
    expect(mergeThreadMessages([{ id: 'm1', sender: 'customer', text: 'Ships tomorrow', date: '' }], local)).toHaveLength(2);
  });
  it('an earlier identical seller message (or the rejected answer) does not hide a new send', () => {
    const local = [{ id: 'local-1', sender: 'seller' as const, text: 'Teşekkürler!', date: '2026-10-15T10:00:00.000Z' }];
    const older = { id: 'm1', sender: 'seller' as const, text: 'Teşekkürler!', date: '2026-10-14T08:00:00.000Z' };
    const merged = mergeThreadMessages([older], local);
    expect(merged).toHaveLength(2);
    expect(merged[1].id).toBe('local-1');
    // Clock skew: a server copy dated slightly before the local send still matches.
    expect(mergeThreadMessages([older, { id: 'm2', sender: 'seller', text: 'Teşekkürler!', date: '2026-10-15T09:59:30.000Z' }], local)).toHaveLength(2);
  });
  it('one server message accounts for one local bubble', () => {
    const local = [
      { id: 'local-1', sender: 'seller' as const, text: 'Ok', date: '2026-10-15T10:00:00.000Z' },
      { id: 'local-2', sender: 'seller' as const, text: 'Ok', date: '2026-10-15T10:01:00.000Z' },
    ];
    const merged = mergeThreadMessages([{ id: 'm1', sender: 'seller', text: 'Ok', date: '2026-10-15T10:00:02.000Z' }], local);
    expect(merged.map((m) => m.id)).toEqual(['m1', 'local-2']);
  });
});

describe('drafts in sessionStorage', () => {
  it('writes, reads and clears per-thread drafts under kx.msg.draft.{platform}:{id}', () => {
    const k = draftStorageKey('wix', 'c-1');
    expect(k).toBe('kx.msg.draft.wix:c-1');
    writeDraft(k, 'Merhaba');
    writeDraft(draftStorageKey('trendyol', '9'), 'Cevap');
    expect(readDraft(k)).toBe('Merhaba');
    expect(listDraftKeys().sort()).toEqual(['kx.msg.draft.trendyol:9', 'kx.msg.draft.wix:c-1']);
    writeDraft(k, '   ');
    expect(readDraft(k)).toBeNull();
    clearAllDrafts();
    expect(listDraftKeys()).toEqual([]);
  });
});

describe('small helpers', () => {
  it('threadKey / replyBody / pathOf / cleanMissing', () => {
    expect(threadKey({ platform: 'trendyol', id: '881234' })).toBe('trendyol:881234');
    expect(replyBody({ platform: 'trendyol', id: '881234' }, 'x')).toEqual({ platform: 'trendyol', questionId: '881234', text: 'x' });
    expect(replyBody({ platform: 'wix', id: 'c-1' }, 'x')).toEqual({ platform: 'wix', conversationId: 'c-1', text: 'x' });
    expect(pathOf('/app/mesajlar?open=wix:abc#x')).toBe('/app/mesajlar');
    expect(cleanMissing(['tracking', 'tracking', 'weather', 3, 'size'])).toEqual(['tracking', 'size']);
    expect(cleanMissing('tracking')).toEqual([]);
  });
  it('keyboard inset ignores browser chrome and counts the keyboard', () => {
    expect(keyboardInset(800, { height: 760, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(800, { height: 460, offsetTop: 0 })).toBe(340);
    expect(keyboardInset(800, { height: 460, offsetTop: 40 })).toBe(300);
    expect(keyboardInset(800, null)).toBe(0);
  });
  it('bubble time is relative under an hour, otherwise the time of day', () => {
    const now = new Date('2026-10-15T10:00:00.000Z');
    expect(bubbleTimeMode('2026-10-15T09:56:00.000Z', now)).toBe('relative');
    expect(bubbleTimeMode('2026-10-15T08:00:00.000Z', now)).toBe('time');
    expect(bubbleTimeMode('', now)).toBeNull();
    expect(bubbleTimeMode('not a date', now)).toBeNull();
  });
  it('send hint and link targets', () => {
    expect(sendKeysLabel(true)).toBe('⌘↵');
    expect(sendKeysLabel(false)).toBe('Ctrl+↵');
    // lib/nav/links.ts: Orders opens the OrderPanel with every order in scope; Trendyol opens the product editor.
    expect(orderHref('ckx 1')).toBe('/app/labels?view=all&open=ckx+1');
    expect(listingHref('8680001112223')).toBe('/app/trendyol-urunler/8680001112223');
  });
});

describe('G6 i18n mirror', () => {
  it('EN and TR have the same keys, real Turkish characters, no ASCII-Turkish', () => {
    const rows = g6KeyRows();
    expect(rows.length).toBeGreaterThan(60);
    for (const r of rows) {
      expect(r.en, r.key).toBeTruthy();
      expect(r.tr, r.key).toBeTruthy();
      expect(r.tr).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme/);
    }
    expect(Object.keys(G6_TR.messages)).toEqual(Object.keys(G6_EN.messages));
  });
});
