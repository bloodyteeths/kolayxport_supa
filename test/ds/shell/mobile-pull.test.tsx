// @vitest-environment jsdom
// Group D: usePullToRefresh (legacy AppLayout.js:392–490 behaviour, soft refresh only).
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const router = { asPath: '/app/labels?tab=x', replace: vi.fn(async () => true) };
vi.mock('next/router', () => ({ useRouter: () => router }));
const swrMutate = vi.fn(async () => undefined);
vi.mock('swr', async (orig) => ({ ...(await orig<typeof import('swr')>()), mutate: (...a: unknown[]) => swrMutate(...(a as [])) }));

import {
  PULL_REFRESH_EVENT,
  PULL_THRESHOLD,
  dampenPull,
  inScrolledChild,
  pullPhaseFor,
  usePullToRefresh,
  type PullToRefreshState,
} from '@/components/ds/shell/usePullToRefresh';

function touch(el: Element, type: string, y = 0, x = 0) {
  const ev = new Event(type, { bubbles: true });
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [{ clientY: y, clientX: x }] });
  el.dispatchEvent(ev);
}

let last: PullToRefreshState | null = null;
function Harness({ enabled = true, onRefresh }: { enabled?: boolean; onRefresh?: () => Promise<void> }) {
  const ref = React.useRef<HTMLDivElement>(null);
  last = usePullToRefresh(ref, { enabled, onRefresh });
  return (
    <div ref={ref} data-testid="main">
      <div data-testid="inner" />
    </div>
  );
}

beforeEach(() => {
  router.replace.mockClear();
  swrMutate.mockClear();
  last = null;
});
afterEach(cleanup);

describe('usePullToRefresh: pure', () => {
  it('dampens finger travel like the legacy shell', () => {
    expect(dampenPull(5)).toBe(0);
    expect(dampenPull(110)).toBe(40);
    expect(dampenPull(1000)).toBe(120);
    expect(pullPhaseFor(0)).toBe('idle');
    expect(pullPhaseFor(40)).toBe('pull');
    expect(pullPhaseFor(PULL_THRESHOLD)).toBe('release');
  });

  it('inScrolledChild detects a nested scroller that is not at its top', () => {
    const root = document.createElement('div');
    const child = document.createElement('div');
    const leaf = document.createElement('span');
    root.appendChild(child);
    child.appendChild(leaf);
    expect(inScrolledChild(leaf, root)).toBe(false);
    Object.defineProperty(child, 'scrollTop', { value: 30 });
    expect(inScrolledChild(leaf, root)).toBe(true);
  });
});

describe('usePullToRefresh: gesture', () => {
  it('a long pull runs the soft refresh: event + router.replace(scroll:false) + SWR revalidate', async () => {
    const onEvent = vi.fn();
    window.addEventListener(PULL_REFRESH_EVENT, onEvent);
    const { getByTestId } = render(<Harness />);
    const main = getByTestId('main');
    act(() => {
      touch(main, 'touchstart', 100);
      touch(main, 'touchmove', 100 + 260);
    });
    expect(last?.phase).toBe('release');
    expect(last?.dragging).toBe(true);
    await act(async () => {
      touch(main, 'touchend');
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/app/labels?tab=x', undefined, { scroll: false });
    expect(swrMutate).toHaveBeenCalledTimes(1);
    expect(last?.phase).toBe('idle');
    window.removeEventListener(PULL_REFRESH_EVENT, onEvent);
  });

  it('a short pull or an upward move does nothing', async () => {
    const onRefresh = vi.fn(async () => {});
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    const main = getByTestId('main');
    act(() => {
      touch(main, 'touchstart', 100);
      touch(main, 'touchmove', 150);
    });
    expect(last?.phase).toBe('pull');
    await act(async () => touch(main, 'touchend'));
    act(() => {
      touch(main, 'touchstart', 300);
      touch(main, 'touchmove', 200);
    });
    await act(async () => touch(main, 'touchend'));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(last?.phase).toBe('idle');
  });

  it('never starts when main is scrolled, and binds nothing when disabled', async () => {
    const onRefresh = vi.fn(async () => {});
    const { getByTestId, rerender } = render(<Harness onRefresh={onRefresh} />);
    const main = getByTestId('main');
    Object.defineProperty(main, 'scrollTop', { value: 10, configurable: true });
    act(() => {
      touch(main, 'touchstart', 0);
      touch(main, 'touchmove', 400);
    });
    await act(async () => touch(main, 'touchend'));
    expect(onRefresh).not.toHaveBeenCalled();
    Object.defineProperty(main, 'scrollTop', { value: 0, configurable: true });
    rerender(<Harness onRefresh={onRefresh} enabled={false} />);
    act(() => {
      touch(main, 'touchstart', 0);
      touch(main, 'touchmove', 400);
    });
    await act(async () => touch(main, 'touchend'));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(last?.phase).toBe('idle');
  });

  it('a custom onRefresh replaces the default refresh', async () => {
    const onRefresh = vi.fn(async () => {});
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    const main = getByTestId('main');
    act(() => {
      touch(main, 'touchstart', 0);
      touch(main, 'touchmove', 400);
    });
    await act(async () => touch(main, 'touchend'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('touchcancel during an in-flight refresh keeps the spinner until the refresh settles', async () => {
    let finish: () => void = () => {};
    const onRefresh = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    const main = getByTestId('main');
    act(() => {
      touch(main, 'touchstart', 0);
      touch(main, 'touchmove', 400);
    });
    await act(async () => touch(main, 'touchend'));
    expect(last?.phase).toBe('refreshing');
    act(() => touch(main, 'touchcancel'));
    expect(last?.phase).toBe('refreshing');
    await act(async () => finish());
    expect(last?.phase).toBe('idle');
  });

  it('re-binding mid-refresh (enabled flips) never resurfaces a stale refreshing state', async () => {
    const onRefresh = vi.fn(() => new Promise<void>(() => {}));
    const { getByTestId, rerender } = render(<Harness onRefresh={onRefresh} />);
    const main = getByTestId('main');
    act(() => {
      touch(main, 'touchstart', 0);
      touch(main, 'touchmove', 400);
    });
    await act(async () => touch(main, 'touchend'));
    expect(last?.phase).toBe('refreshing');
    rerender(<Harness onRefresh={onRefresh} enabled={false} />);
    rerender(<Harness onRefresh={onRefresh} enabled />);
    expect(last?.phase).toBe('idle');
  });
});
