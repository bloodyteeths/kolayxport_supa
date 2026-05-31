import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logCronEvent, logSecurityEvent } from '@/lib/admin/events';

/**
 * Constant-time verification of the `Authorization: Bearer <CRON_SECRET>` header.
 * Returns true only if CRON_SECRET is set, the header is present, and the comparison succeeds.
 *
 * NOT a middleware — call from inside the handler so it can write its own 401 body.
 */
export function verifyCronAuth(req: NextApiRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const presented = req.headers.authorization;
  if (typeof presented !== 'string' || presented.length === 0) return false;

  const expected = `Bearer ${secret}`;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Quantize the current time into a bucket string suitable for the unique constraint
 * `(jobName, bucket)` on CronLock. Two triggers landing in the same bucket are
 * considered duplicates and only the first acquires the lock.
 *
 * intervalMinutes:
 *   - 15       -> 'YYYY-MM-DDTHH:MM' rounded down to 15-minute boundary (UTC)
 *   - 60       -> 'YYYY-MM-DDTHH'    (UTC hour)
 *   - 1440     -> 'YYYY-MM-DD'        (UTC day)
 *   - any other -> rounded to that minute boundary
 */
export function bucketFor(intervalMinutes: number, now: Date = new Date()): string {
  if (intervalMinutes <= 0) {
    throw new Error('bucketFor: intervalMinutes must be > 0');
  }
  if (intervalMinutes === 1440) {
    return now.toISOString().slice(0, 10);
  }
  if (intervalMinutes === 60) {
    return now.toISOString().slice(0, 13);
  }
  const ms = intervalMinutes * 60 * 1000;
  const flatMs = Math.floor(now.getTime() / ms) * ms;
  return new Date(flatMs).toISOString().slice(0, 16);
}

/**
 * Attempt to acquire a per-(job, bucket) lock by inserting into CronLock.
 * Returns true on first insert, false on duplicate (Prisma unique-violation).
 *
 * Concurrency: the unique constraint guarantees atomicity at the DB level —
 * exactly one caller wins, the others see the duplicate-key error and lose.
 *
 * The `(prisma as any).cronLock` cast covers local dev workflows where
 * `prisma generate` has not run since the CronLock model was added (the prod
 * build always regenerates). The runtime delegate exists once the migration
 * has been applied.
 */
export async function tryAcquireCronLock(jobName: string, bucket: string): Promise<boolean> {
  try {
    await (prisma as any).cronLock.create({ data: { jobName, bucket } });
    return true;
  } catch (err: any) {
    // Prisma maps Postgres `unique_violation` (SQLSTATE 23505) to code P2002.
    if (err?.code === 'P2002') return false;
    // Anything else is a real failure — re-throw so the handler can decide.
    throw err;
  }
}

/**
 * One-shot helper combining auth + idempotency.
 *   const guard = await runCronGuard(req, res, { jobName: 'sync-orders', intervalMinutes: 15 });
 *   if (!guard.ok) return; // response already written
 *   // ...do the work...
 *
 * If auth fails -> writes 401.
 * If duplicate -> writes 200 { skipped: true, reason: 'duplicate' }.
 * If the helper writes a response, returns { ok: false }.
 */
export async function runCronGuard(
  req: NextApiRequest,
  res: NextApiResponse,
  args: { jobName: string; intervalMinutes: number },
): Promise<{ ok: true; bucket: string } | { ok: false }> {
  if (!verifyCronAuth(req)) {
    logSecurityEvent('warn', {
      message: `Cron auth failed for "${args.jobName}"`,
      operation: 'cron.auth_failed',
      details: { jobName: args.jobName },
    });
    res.status(401).json({ error: 'Unauthorized' });
    return { ok: false };
  }
  const bucket = bucketFor(args.intervalMinutes);
  let acquired: boolean;
  try {
    acquired = await tryAcquireCronLock(args.jobName, bucket);
  } catch (err: any) {
    logCronEvent('error', {
      message: `Cron lock acquisition failed for "${args.jobName}"`,
      operation: 'cron.lock_error',
      details: { jobName: args.jobName, bucket },
      error: err instanceof Error ? err : new Error(String(err)),
    });
    res.status(500).json({ error: 'cron lock acquisition failed' });
    return { ok: false };
  }
  if (!acquired) {
    logCronEvent('info', {
      message: `Cron skipped duplicate "${args.jobName}" @ ${bucket}`,
      operation: 'cron.skipped_duplicate',
      details: { jobName: args.jobName, bucket },
    });
    res.status(200).json({ skipped: true, reason: 'duplicate', bucket });
    return { ok: false };
  }
  logCronEvent('info', {
    message: `Cron acquired lock "${args.jobName}" @ ${bucket}`,
    operation: 'cron.acquired',
    details: { jobName: args.jobName, bucket },
  });
  return { ok: true, bucket };
}
