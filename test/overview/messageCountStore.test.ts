// useMessageCountStore `fetchedAt` / `failed` (overview §3.1, §4.4, G4): a failed fetch never reads as 0.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useMessageCountStore from '@/lib/stores/useMessageCountStore';

const reset = () => useMessageCountStore.setState({ counts: { wix: 0, trendyol: 0, total: 0 }, loading: false, fetchedAt: null, failed: false });

beforeEach(reset);
afterEach(() => {
  vi.unstubAllGlobals();
});

const respond = (status: number, json: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 300, status, json: async () => json })));

describe('useMessageCountStore', () => {
  it('starts with no fetchedAt and not failed', () => {
    expect(useMessageCountStore.getState().fetchedAt).toBeNull();
    expect(useMessageCountStore.getState().failed).toBe(false);
  });

  it('success sets counts and fetchedAt, clears failed', async () => {
    useMessageCountStore.setState({ failed: true });
    respond(200, { wix: 1, trendyol: 2, total: 3 });
    await useMessageCountStore.getState().fetch();
    const s = useMessageCountStore.getState();
    expect(s.counts.total).toBe(3);
    expect(s.fetchedAt).toEqual(expect.any(Number));
    expect(s.failed).toBe(false);
    expect(s.loading).toBe(false);
  });

  it('non-2xx marks failed and keeps the last good counts and time', async () => {
    respond(200, { wix: 0, trendyol: 5, total: 5 });
    await useMessageCountStore.getState().fetch();
    const at = useMessageCountStore.getState().fetchedAt;
    respond(500, {});
    await useMessageCountStore.getState().fetch();
    const s = useMessageCountStore.getState();
    expect(s.failed).toBe(true);
    expect(s.counts.total).toBe(5);
    expect(s.fetchedAt).toBe(at);
  });

  it('network error and malformed body mark failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    await useMessageCountStore.getState().fetch();
    expect(useMessageCountStore.getState().failed).toBe(true);
    reset();
    respond(200, { nope: true });
    await useMessageCountStore.getState().fetch();
    expect(useMessageCountStore.getState().failed).toBe(true);
    expect(useMessageCountStore.getState().fetchedAt).toBeNull();
  });
});
