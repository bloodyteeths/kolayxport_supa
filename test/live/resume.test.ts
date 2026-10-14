import { beforeEach, describe, expect, it } from 'vitest';
import { liveUserKey } from '@/lib/live/names';
import { __resetLiveResumeStateForTests, getLiveResumeState, markLiveSeen } from '@/components/live/liveStore';
import { buildStatusEnvelope } from '@/lib/live/sse';

describe('liveUserKey', () => {
  it('is stable, 16 hex chars, and differs per user', () => {
    const a = liveUserKey('cm123abc');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(liveUserKey('cm123abc')).toBe(a);
    expect(liveUserKey('cm123abd')).not.toBe(a);
    expect(liveUserKey('')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hello envelope carries it; heartbeat does not', () => {
    const hello = buildStatusEnvelope('hello', 'local', 'c1', 1000, liveUserKey('u1'));
    expect((hello.event as { userKey?: string }).userKey).toBe(liveUserKey('u1'));
    const beat = buildStatusEnvelope('heartbeat', 'local', 'c1', 1000);
    expect('userKey' in beat.event).toBe(false);
  });
});

describe('live resume state (survives provider remounts)', () => {
  beforeEach(() => __resetLiveResumeStateForTests());

  it('keeps lastEventId / seen / unseen for the same user across getter calls', () => {
    const k = liveUserKey('u1');
    const st = getLiveResumeState(k);
    expect(markLiveSeen(st, 'e1')).toBe(true);
    st.lastEventId = 'e1';
    st.unseenOrders = 2;
    const again = getLiveResumeState(k);
    expect(again).toBe(st);
    expect(markLiveSeen(again, 'e1')).toBe(false);
    expect(again.lastEventId).toBe('e1');
    expect(again.unseenOrders).toBe(2);
  });

  it('starts fresh for a different user', () => {
    const st = getLiveResumeState(liveUserKey('u1'));
    markLiveSeen(st, 'e1');
    st.lastEventId = 'e1';
    const other = getLiveResumeState(liveUserKey('u2'));
    expect(other).not.toBe(st);
    expect(other.lastEventId).toBeNull();
    expect(markLiveSeen(other, 'e1')).toBe(true);
  });

  it('bounds the seen ring', () => {
    const st = getLiveResumeState('k');
    for (let i = 0; i < 450; i++) markLiveSeen(st, `e${i}`);
    expect(st.seen.size).toBe(400);
    expect(markLiveSeen(st, 'e0')).toBe(true); // evicted
    expect(markLiveSeen(st, 'e449')).toBe(false);
  });
});
