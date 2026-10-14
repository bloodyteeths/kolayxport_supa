/**
 * In-process keyed mutex for Etsy listing inventory writes (owner W1).
 *
 * Serialises read-modify-write of one listing's inventory between the draft
 * sync, stock pushes and webhook-driven refreshes. Single node only (the app
 * runs as one systemd service); there is no cross-process guarantee. The lock
 * table lives on globalThis (lib/processState.ts) so the API-route bundle
 * (draft sync) and the instrumentation bundle (scheduler: stock pushes,
 * worker) share ONE lock per listing.
 *
 * Waiting for the lock is capped (default 60 s). On timeout an EtsyDeferError
 * ('lock_busy') is thrown so worker callers re-queue without consuming an
 * attempt; later waiters still queue behind the slow holder, never jump it
 * (a timed-out waiter keeps its place in the chain until the holder ahead of
 * it releases, so the key is never dropped while a holder is still inside fn).
 */
import { EtsyDeferError } from './webhooks/types';
import { processState } from '@/lib/processState';

export const INVENTORY_LOCK_TIMEOUT_MS = 60_000;

const { tails } = processState('etsy.inventoryLock', () => ({ tails: new Map<string, Promise<void>>() }));

function waitWithTimeout(p: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    p.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

export async function withListingInventoryLock<T>(
  listingId: string,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const key = String(listingId);
  const timeoutMs = opts.timeoutMs ?? INVENTORY_LOCK_TIMEOUT_MS;
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Next waiter waits for the previous holder AND us.
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  // Drop the key only once our tail has really settled, i.e. after every holder
  // ahead of us released AND we released. A holder (prev settled) can drop it
  // right away. A timed-out waiter's tail is still pending behind the slow
  // holder, so it must stay registered: later callers keep queueing behind it
  // instead of seeing an empty slot and running concurrently with the holder.
  let acquired = false;
  try {
    acquired = await waitWithTimeout(prev, timeoutMs);
    if (!acquired) {
      throw new EtsyDeferError('lock_busy', 30_000, `Listing ${key} inventory lock busy for ${Math.round(timeoutMs / 1000)}s`);
    }
    return await fn();
  } finally {
    // A timed-out waiter never ran fn; releasing `mine` only lets the chain
    // continue once `prev` (the slow holder) resolves, never earlier.
    release();
    if (acquired) {
      if (tails.get(key) === tail) tails.delete(key);
    } else {
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
    }
  }
}

/** Test/diagnostic hook: number of listings with a held or queued lock. */
export function __inventoryLockCount(): number {
  return tails.size;
}
