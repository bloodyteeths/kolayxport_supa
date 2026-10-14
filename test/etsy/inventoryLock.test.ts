import { describe, expect, it, vi } from 'vitest';
import { withListingInventoryLock, __inventoryLockCount } from '@/lib/etsy/inventoryLock';
import { EtsyDeferError, isEtsyDeferError } from '@/lib/etsy/webhooks/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('withListingInventoryLock', () => {
  it('serialises work on the same listing', async () => {
    const log: string[] = [];
    const run = (tag: string, ms: number) =>
      withListingInventoryLock('L1', async () => {
        log.push(`${tag}:start`);
        await sleep(ms);
        log.push(`${tag}:end`);
        return tag;
      });
    const results = await Promise.all([run('a', 20), run('b', 5), run('c', 1)]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    expect(__inventoryLockCount()).toBe(0);
  });

  it('does not block different listings', async () => {
    const log: string[] = [];
    await Promise.all([
      withListingInventoryLock('X', async () => {
        log.push('x:start');
        await sleep(20);
        log.push('x:end');
      }),
      withListingInventoryLock('Y', async () => {
        log.push('y:start');
        log.push('y:end');
      }),
    ]);
    expect(log.indexOf('y:end')).toBeLessThan(log.indexOf('x:end'));
  });

  it('releases on error', async () => {
    await expect(withListingInventoryLock('E', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withListingInventoryLock('E', async () => 'ok')).resolves.toBe('ok');
    expect(__inventoryLockCount()).toBe(0);
  });

  it('throws EtsyDeferError(lock_busy) on wait timeout without jumping the holder', async () => {
    const log: string[] = [];
    const holder = withListingInventoryLock('T', async () => {
      await sleep(60);
      log.push('holder:end');
    });
    const waiter = withListingInventoryLock('T', async () => 'never', { timeoutMs: 10 });
    const third = withListingInventoryLock('T', async () => {
      log.push('third:run');
    });
    const err = await waiter.catch((e) => e);
    expect(err).toBeInstanceOf(EtsyDeferError);
    expect(isEtsyDeferError(err)).toBe(true);
    expect(err.reason).toBe('lock_busy');
    await Promise.all([holder, third]);
    expect(log).toEqual(['holder:end', 'third:run']);
  });

  it('a waiter timing out does not free the lock while the slow holder is still running', async () => {
    const log: string[] = [];
    let holderRunning = false;
    const holder = withListingInventoryLock('SLOW', async () => {
      holderRunning = true;
      await sleep(60);
      holderRunning = false;
      log.push('holder:end');
    });
    const waiter = withListingInventoryLock('SLOW', async () => 'never', { timeoutMs: 10 });
    expect(isEtsyDeferError(await waiter.catch((e) => e))).toBe(true);
    // Arrives AFTER the waiter gave up: must still queue behind the holder.
    const late = withListingInventoryLock('SLOW', async () => {
      log.push(`late:run(holderRunning=${holderRunning})`);
    });
    await Promise.all([holder, late]);
    expect(log).toEqual(['holder:end', 'late:run(holderRunning=false)']);
    await sleep(0);
    expect(__inventoryLockCount()).toBe(0);
  });

  it('is shared between separately loaded copies of the module (API vs instrumentation bundles)', async () => {
    const log: string[] = [];
    vi.resetModules();
    const copy = await import('@/lib/etsy/inventoryLock');
    expect(copy.withListingInventoryLock).not.toBe(withListingInventoryLock);
    await Promise.all([
      withListingInventoryLock('SHARED', async () => {
        log.push('a:start');
        await sleep(20);
        log.push('a:end');
      }),
      copy.withListingInventoryLock('SHARED', async () => {
        log.push('b:start');
        log.push('b:end');
      }),
    ]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });
});
