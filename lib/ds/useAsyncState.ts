import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * DS P6 / §3.13: every async region has skeleton, data, empty and error states and never sticks.
 * At 15s a loading region becomes `slow` ("Still loading… Retry"), at 30s `error`.
 * `stale` = the latest request failed but earlier data is still there (render the data plus
 * `<ErrorState variant="stale">`).
 */
export type AsyncState = 'loading' | 'slow' | 'ready' | 'empty' | 'error' | 'stale';

/** The subset of an SWR response this hook reads (SWR, useSWRInfinite or a hand-rolled fetch). */
export interface SwrLike<T> {
  data?: T;
  error?: unknown;
  isLoading?: boolean;
  isValidating?: boolean;
  mutate?: (...args: never[]) => unknown;
}

export interface AsyncStateOptions<T> {
  /** Default: `null`/`undefined` data or an empty array. */
  isEmpty?: (data: T) => boolean;
  /** Default 15000. */
  slowMs?: number;
  /** Default 30000. */
  errorMs?: number;
  /**
   * State for an idle region: no data, no error and no request in flight (`isLoading === false`
   * and not validating), e.g. SWR with a conditional `null` key. Default `'empty'`. Idle regions
   * never start the slow/error timers.
   */
  idle?: AsyncState;
}

export const ASYNC_SLOW_MS = 15_000;
export const ASYNC_TIMEOUT_MS = 30_000;

export function defaultIsEmpty(data: unknown): boolean {
  return data == null || (Array.isArray(data) && data.length === 0);
}

/**
 * true while the region waits for a first response. A paused SWR (null key) reports
 * `isLoading: false` and is idle, not waiting. When `isLoading` is undefined (hand-rolled fetch)
 * "no data and no error" still counts as waiting.
 */
export function isWaiting(swr: SwrLike<unknown>): boolean {
  if (swr.data !== undefined || swr.error) return false;
  if (swr.isLoading === false && !swr.isValidating) return false;
  return true;
}

/** Pure resolver (unit-tested). `loadingForMs` = how long the region has been loading without data. */
export function resolveAsyncState<T>(swr: SwrLike<T>, loadingForMs: number, opts: AsyncStateOptions<T> = {}): AsyncState {
  const { isEmpty = defaultIsEmpty, slowMs = ASYNC_SLOW_MS, errorMs = ASYNC_TIMEOUT_MS, idle = 'empty' } = opts;
  const hasData = swr.data !== undefined;
  if (swr.error) return hasData ? 'stale' : 'error';
  if (hasData) return isEmpty(swr.data as T) ? 'empty' : 'ready';
  if (!isWaiting(swr)) return idle;
  if (loadingForMs >= errorMs) return 'error';
  if (loadingForMs >= slowMs) return 'slow';
  return 'loading';
}

export interface AsyncRegion {
  state: AsyncState;
  /** true when `error` came from the 30s timeout rather than a request error. */
  timedOut: boolean;
  /** Restarts the timers and revalidates (`swr.mutate()`). */
  retry: () => void;
}

/** Full form: state + retry + timeout flag. */
export function useAsyncRegion<T>(swr: SwrLike<T>, opts: AsyncStateOptions<T> = {}): AsyncRegion {
  const slowMs = opts.slowMs ?? ASYNC_SLOW_MS;
  const errorMs = opts.errorMs ?? ASYNC_TIMEOUT_MS;
  const waiting = isWaiting(swr);
  const startRef = useRef<number | null>(null);
  const [, setTick] = useState(0);
  const [epoch, setEpoch] = useState(0);

  if (waiting && startRef.current === null) startRef.current = Date.now();
  if (!waiting) startRef.current = null;

  useEffect(() => {
    if (!waiting) return undefined;
    const started = startRef.current ?? Date.now();
    const elapsed = Date.now() - started;
    const timers = [slowMs, errorMs]
      .filter((ms) => ms > elapsed)
      .map((ms) => setTimeout(() => setTick((x) => x + 1), ms - elapsed + 1));
    return () => timers.forEach(clearTimeout);
  }, [waiting, slowMs, errorMs, epoch]);

  const loadingFor = waiting && startRef.current !== null ? Date.now() - startRef.current : 0;
  const state = resolveAsyncState(swr, loadingFor, opts);
  const mutate = swr.mutate;

  const retry = useCallback(() => {
    startRef.current = Date.now();
    setEpoch((e) => e + 1);
    (mutate as (() => unknown) | undefined)?.();
  }, [mutate]);

  return { state, timedOut: state === 'error' && waiting, retry };
}

/** DS §4.5 signature: `useAsyncState(swr) => 'loading'|'slow'|'ready'|'empty'|'error'` (+ `'stale'`). */
export function useAsyncState<T>(swr: SwrLike<T>, opts?: AsyncStateOptions<T>): AsyncState {
  return useAsyncRegion(swr, opts).state;
}

export default useAsyncState;
