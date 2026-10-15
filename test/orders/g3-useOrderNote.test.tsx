// @vitest-environment jsdom
// M3 orders-G3: note autosave ordering (port of the legacy OrderNoteField sequence logic).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOrderNote, NOTE_AUTOSAVE_MS, ORDER_NOTE_MAX_LENGTH } from '@/components/domain/orders/panel/useOrderNote';

interface Pending {
  url: string;
  body: { not: string | null };
  resolve: (status?: number, internalNote?: string | null) => void;
  reject: (err: unknown) => void;
}

let calls: Pending[];

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => new Promise<Response>((res, rej) => {
    const body = JSON.parse(String(init.body));
    calls.push({
      url,
      body,
      resolve: (status = 200, internalNote = body.not) => res(new Response(JSON.stringify({ success: status < 400, internalNote }), { status })),
      reject: rej,
    });
  })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await flushMicrotasks();
  });
}

async function settle(fn: () => void) {
  await act(async () => {
    fn();
    await flushMicrotasks();
  });
}

function setup(initial: { orderId: string | null; note: string | null }) {
  const onSaved = vi.fn();
  const onError = vi.fn();
  const hook = renderHook((p: { orderId: string | null; note: string | null }) => useOrderNote({ ...p, onSaved, onError }), { initialProps: initial });
  return { ...hook, onSaved, onError };
}

describe('useOrderNote', () => {
  it('debounces typing into one request after 600 ms with the trimmed value', async () => {
    const { result } = setup({ orderId: 'o1', note: '' });
    act(() => result.current.setValue('a'));
    act(() => result.current.setValue('ab'));
    act(() => result.current.setValue('abc  '));
    expect(result.current.state).toBe('dirty');
    await advance(NOTE_AUTOSAVE_MS - 1);
    expect(calls).toHaveLength(0);
    await advance(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/orders/o1/updateNoteAndStatus');
    expect(calls[0].body).toEqual({ not: 'abc' });
    expect(result.current.state).toBe('saving');
    await settle(() => calls[0].resolve());
    expect(result.current.state).toBe('saved');
  });

  it('sends requests strictly one after another, in typing order', async () => {
    const { result, onSaved } = setup({ orderId: 'o1', note: '' });
    act(() => result.current.setValue('first'));
    await advance(NOTE_AUTOSAVE_MS);
    act(() => result.current.setValue('second'));
    await advance(NOTE_AUTOSAVE_MS);
    // The second save waits for the first response.
    expect(calls.map((c) => c.body.not)).toEqual(['first']);
    await settle(() => calls[0].resolve());
    expect(calls.map((c) => c.body.not)).toEqual(['first', 'second']);
    expect(result.current.state).toBe('saving'); // the latest request is still in flight
    await settle(() => calls[1].resolve());
    expect(result.current.state).toBe('saved');
    expect(onSaved.mock.calls.map((c) => c[0])).toEqual(['first', 'second']);
    expect(result.current.value).toBe('second');
  });

  it('an older failed request never marks the latest one as failed', async () => {
    const { result, onError } = setup({ orderId: 'o1', note: '' });
    act(() => result.current.setValue('one'));
    await advance(NOTE_AUTOSAVE_MS);
    act(() => result.current.setValue('two'));
    await advance(NOTE_AUTOSAVE_MS);
    await settle(() => calls[0].resolve(500));
    expect(onError).not.toHaveBeenCalled();
    await settle(() => calls[1].resolve());
    expect(result.current.state).toBe('saved');
  });

  it('keeps the typed text on error and retries the same value on flush', async () => {
    const { result, onError } = setup({ orderId: 'o1', note: 'old' });
    act(() => result.current.setValue('new text'));
    await advance(NOTE_AUTOSAVE_MS);
    await settle(() => calls[0].resolve(500));
    expect(result.current.state).toBe('error');
    expect(result.current.value).toBe('new text');
    expect(onError).toHaveBeenCalledTimes(1);
    await settle(() => result.current.flush());
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual({ not: 'new text' });
    await settle(() => calls[1].resolve());
    expect(result.current.state).toBe('saved');
  });

  it('never sends an unchanged value; an empty note is sent as null', async () => {
    const { result } = setup({ orderId: 'o1', note: 'same' });
    await settle(() => result.current.flush());
    expect(calls).toHaveLength(0);
    act(() => result.current.setValue('   '));
    await advance(NOTE_AUTOSAVE_MS);
    expect(calls[0].body).toEqual({ not: null });
  });

  it('caps the note at 1000 characters', async () => {
    const { result } = setup({ orderId: 'o1', note: '' });
    act(() => result.current.setValue('x'.repeat(ORDER_NOTE_MAX_LENGTH + 50)));
    expect(result.current.value).toHaveLength(ORDER_NOTE_MAX_LENGTH);
    await advance(NOTE_AUTOSAVE_MS);
    expect(calls[0].body.not).toHaveLength(ORDER_NOTE_MAX_LENGTH);
  });

  it('switching orders sends the pending edit for the previous order, then shows the new note', async () => {
    const { result, rerender, onSaved } = setup({ orderId: 'o1', note: '' });
    act(() => result.current.setValue('pack in blue'));
    rerender({ orderId: 'o2', note: 'other order note' });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/orders/o1/updateNoteAndStatus');
    expect(calls[0].body).toEqual({ not: 'pack in blue' });
    expect(result.current.value).toBe('other order note');
    expect(result.current.state).toBe('idle');
    // A late response for o1 does not touch o2's state but still reports the save for o1.
    await settle(() => calls[0].resolve());
    expect(result.current.state).toBe('idle');
    expect(onSaved).toHaveBeenCalledWith('pack in blue', 'o1');
  });

  it('a failed save is resent on order switch and on unmount, and its failure is still reported', async () => {
    const { result, rerender, unmount, onError } = setup({ orderId: 'o1', note: '' });
    act(() => result.current.setValue('fragile'));
    await advance(NOTE_AUTOSAVE_MS);
    await settle(() => calls[0].resolve(500));
    expect(result.current.state).toBe('error');
    rerender({ orderId: 'o2', note: '' });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe('/api/orders/o1/updateNoteAndStatus');
    expect(calls[1].body).toEqual({ not: 'fragile' });
    await settle(() => calls[1].resolve(500));
    expect(onError).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('idle');
    // o2: fail, then close the panel → resent.
    act(() => result.current.setValue('o2 text'));
    await advance(NOTE_AUTOSAVE_MS);
    await settle(() => calls[2].resolve(500));
    unmount();
    await act(async () => {
      await flushMicrotasks();
    });
    expect(calls).toHaveLength(4);
    expect(calls[3].body).toEqual({ not: 'o2 text' });
  });

  it('unmounting inside the debounce still sends the edit', async () => {
    const { result, unmount } = setup({ orderId: 'o1', note: '' });
    act(() => result.current.setValue('last words'));
    unmount();
    await act(async () => {
      await flushMicrotasks();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ not: 'last words' });
  });

  it('adopts server data while idle, never while typing', async () => {
    const { result, rerender } = setup({ orderId: 'o1', note: 'a' });
    rerender({ orderId: 'o1', note: 'b (from another tab)' });
    expect(result.current.value).toBe('b (from another tab)');
    act(() => result.current.setValue('typing'));
    rerender({ orderId: 'o1', note: 'c (revalidation)' });
    expect(result.current.value).toBe('typing');
  });
});
