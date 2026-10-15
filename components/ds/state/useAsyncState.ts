// DS §4.5 path. Implementation lives in lib/ds/useAsyncState.ts (BUILD_PLAN §4 M1-c).
export {
  useAsyncState, useAsyncRegion, resolveAsyncState, defaultIsEmpty, isWaiting, ASYNC_SLOW_MS, ASYNC_TIMEOUT_MS,
  type AsyncState, type AsyncRegion, type AsyncStateOptions, type SwrLike,
} from '@/lib/ds/useAsyncState';
export { default } from '@/lib/ds/useAsyncState';
