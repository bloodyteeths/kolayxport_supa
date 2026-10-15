// messages §5.2 status map (group G4): pill, unread dot, raw tooltip and composer region.
import { describe, expect, it } from 'vitest';
import { isUnread, messageStatus } from '@/lib/ds/status/messages';
import { getStatusStyle, statusMessageKey, STATUS_VOCABULARY } from '@/lib/ds/status/vocabulary';
import { composerAcceptsText, composerMode, messageRowState, rawStatusTooltip } from '@/lib/messages/threadState';

const ty = (platformStatus: string, needsReply: boolean, extra: object = {}) => ({ platform: 'trendyol', platformStatus, needsReply, ...extra });

describe('message vocabulary rows (messages §11.1)', () => {
  it('has in_review (info) and answer_rejected (danger)', () => {
    expect(getStatusStyle('message', 'in_review')).toEqual({ tone: 'info' });
    expect(getStatusStyle('message', 'answer_rejected')).toEqual({ tone: 'danger' });
    expect(statusMessageKey('message', 'answer_rejected')).toBe('message.answer_rejected');
    expect(Object.keys(STATUS_VOCABULARY.message).sort()).toEqual(['answer_rejected', 'in_review', 'needs_reply', 'unread']);
  });
});

describe('messageStatus: the §5.2 table', () => {
  it.each([
    ['WAITING_FOR_ANSWER', true, 'needs_reply'],
    ['WAITING_FOR_APPROVE', false, 'in_review'],
    ['ANSWERED', false, null],
    ['REJECTED', true, 'answer_rejected'],
    ['REPORTED', false, null],
    ['SOMETHING_NEW', false, null],
  ] as const)('Trendyol %s → %s', (raw, needsReply, pill) => {
    expect(messageStatus(ty(raw, needsReply))).toBe(pill);
  });

  it('matches Trendyol raw names case- and spelling-loosely', () => {
    expect(messageStatus(ty('waiting_for_answer', true))).toBe('needs_reply');
    expect(messageStatus(ty('WaitingForApprove', false))).toBe('in_review');
    expect(messageStatus(ty(' rejected ', true))).toBe('answer_rejected');
  });

  it('Wix follows needsReply only', () => {
    expect(messageStatus({ platform: 'wix', needsReply: true, platformStatus: 'open' })).toBe('needs_reply');
    expect(messageStatus({ platform: 'wix', needsReply: false, platformStatus: 'open' })).toBeNull();
  });

  it('never returns unread (unread is the dot, not a pill)', () => {
    for (const s of ['WAITING_FOR_ANSWER', 'ANSWERED', '']) {
      expect(messageStatus(ty(s, true))).not.toBe('unread');
    }
  });
});

describe('isUnread', () => {
  it('needsReply && (never seen || newer than last seen)', () => {
    expect(isUnread({ needsReply: false, lastSeenAt: null })).toBe(false);
    expect(isUnread({ needsReply: true, lastSeenAt: null, lastMessageAt: null })).toBe(true);
    expect(isUnread({ needsReply: true, lastSeenAt: '2026-10-01T10:00:00Z', lastMessageAt: '2026-10-01T11:00:00Z' })).toBe(true);
    expect(isUnread({ needsReply: true, lastSeenAt: '2026-10-01T12:00:00Z', lastMessageAt: '2026-10-01T11:00:00Z' })).toBe(false);
    expect(isUnread({ needsReply: true, lastSeenAt: '2026-10-01T12:00:00Z', lastMessageAt: null })).toBe(false);
  });
});

describe('composerMode: the §5.2 Composer column', () => {
  it('Wix always replies, whoever wrote last', () => {
    expect(composerMode({ platform: 'wix', needsReply: true })).toEqual({ kind: 'reply' });
    expect(composerMode({ platform: 'wix', needsReply: false })).toEqual({ kind: 'reply' });
    expect(composerMode({ platform: 'wix', needsReply: false }, { locallyAnsweredAt: '2026-10-15T09:00:00Z' })).toEqual({ kind: 'reply' });
  });

  it('Trendyol WAITING_FOR_ANSWER → answer', () => {
    expect(composerMode(ty('WAITING_FOR_ANSWER', true))).toEqual({ kind: 'answer' });
  });

  it('Trendyol WAITING_FOR_APPROVE → in_review (no composer)', () => {
    const m = composerMode(ty('WAITING_FOR_APPROVE', false));
    expect(m).toEqual({ kind: 'in_review' });
    expect(composerAcceptsText(m)).toBe(false);
  });

  it('Trendyol ANSWERED → answered with answeredAt', () => {
    expect(composerMode(ty('ANSWERED', false, { answeredAt: '2026-10-14T10:40:00Z' }))).toEqual({ kind: 'answered', answeredAt: '2026-10-14T10:40:00Z' });
    expect(composerMode(ty('ANSWERED', false))).toEqual({ kind: 'answered', answeredAt: null });
    expect(composerMode(ty('Answered', false))).toEqual({ kind: 'answered', answeredAt: null });
    expect(composerMode(ty('ANSWER_APPROVED', false))).toEqual({ kind: 'answered', answeredAt: null });
    expect(rawStatusTooltip(ty('ANSWER_APPROVED', false))).toBeNull();
  });

  it('Trendyol REJECTED → composer prefilled with the rejected text, reason trimmed', () => {
    const m = composerMode(ty('REJECTED', true, { rejectReason: '  contains contact info ', rejectedAnswerText: 'Call me at …' }));
    expect(m).toEqual({ kind: 'rejected', reason: 'contains contact info', prefill: 'Call me at …' });
    expect(composerAcceptsText(m)).toBe(true);
    expect(composerMode(ty('REJECTED', true, { rejectReason: '' }))).toEqual({ kind: 'rejected', reason: null, prefill: '' });
  });

  it('Trendyol REPORTED / unknown → cannot_answer with the raw status', () => {
    expect(composerMode(ty('REPORTED', false))).toEqual({ kind: 'cannot_answer', rawStatus: 'REPORTED' });
    expect(composerMode(ty('SOMETHING_NEW', false))).toEqual({ kind: 'cannot_answer', rawStatus: 'SOMETHING_NEW' });
  });

  it('a Trendyol answer sent from this tab cannot be re-opened by a stale poll', () => {
    const at = '2026-10-15T09:00:00Z';
    expect(composerMode(ty('WAITING_FOR_ANSWER', true), { locallyAnsweredAt: at })).toEqual({ kind: 'answered', answeredAt: at });
    expect(composerMode(ty('REJECTED', true), { locallyAnsweredAt: at })).toEqual({ kind: 'answered', answeredAt: at });
  });
});

describe('rawStatusTooltip', () => {
  it('only for statuses no pill or note explains', () => {
    expect(rawStatusTooltip(ty('REPORTED', false))).toBe('REPORTED');
    expect(rawStatusTooltip(ty('', false))).toBeNull();
    expect(rawStatusTooltip(ty('ANSWERED', false))).toBeNull();
    expect(rawStatusTooltip(ty('WAITING_FOR_APPROVE', false))).toBeNull();
    expect(rawStatusTooltip({ platform: 'wix', needsReply: false, platformStatus: 'open' })).toBeNull();
  });
});

describe('messageRowState', () => {
  it('needs-reply Trendyol row: pill + dot, not muted', () => {
    expect(messageRowState(ty('WAITING_FOR_ANSWER', true, { unread: true }))).toEqual({ pill: 'needs_reply', unread: true, muted: false, rawTooltip: null });
  });

  it('in-review / answered / reported rows are muted', () => {
    expect(messageRowState(ty('WAITING_FOR_APPROVE', false))).toMatchObject({ pill: 'in_review', muted: true });
    expect(messageRowState(ty('ANSWERED', false))).toMatchObject({ pill: null, muted: true });
    expect(messageRowState(ty('REPORTED', false))).toEqual({ pill: null, unread: false, muted: true, rawTooltip: 'REPORTED' });
  });

  it('rejected row is actionable', () => {
    expect(messageRowState(ty('REJECTED', true))).toMatchObject({ pill: 'answer_rejected', muted: false });
  });

  it('Wix rows are never muted by status', () => {
    expect(messageRowState({ platform: 'wix', needsReply: false, unread: false })).toEqual({ pill: null, unread: false, muted: false, rawTooltip: null });
    expect(messageRowState({ platform: 'wix', needsReply: true, unread: true })).toMatchObject({ pill: 'needs_reply', unread: true });
  });

  it('a row sent from this tab drops pill and dot and turns muted (any platform)', () => {
    const opts = { locallyAnsweredAt: '2026-10-15T09:00:00Z' };
    const sent = { pill: null, unread: false, muted: true, rawTooltip: null };
    expect(messageRowState({ platform: 'wix', needsReply: true, unread: true }, opts)).toEqual(sent);
    expect(messageRowState(ty('WAITING_FOR_ANSWER', true, { unread: true }), opts)).toEqual(sent);
  });
});
