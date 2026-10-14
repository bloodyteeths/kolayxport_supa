/**
 * In-process scheduler + Etsy webhook worker bootstrap (owner W1).
 *
 * Production (single Hetzner node, systemd) runs both ON BY DEFAULT:
 *   - scheduler tick every 15 s -> runDueJobs (JobRun-claimed, so the GitHub
 *     run-due fallback and this loop never double-run a bucket);
 *   - Etsy webhook worker loop every 5 s (plus kicks from the ingest route).
 *
 * They start only when ALL hold:
 *   - NEXT_RUNTIME === 'nodejs' (never in the edge bundle),
 *   - NEXT_PHASE !== 'phase-production-build' (never during `next build`),
 *   - NODE_ENV === 'production' or KX_INPROCESS_JOBS === '1'
 *     (a local `next dev` must not process the queue: .env.local can point at prod),
 *   - KX_DISABLE_INPROCESS_JOBS !== '1' (kill switch for both).
 * ETSY_WEBHOOK_WORKER=0 disables only the worker loop (the ingest kick still runs).
 *
 * Started from instrumentation-node.ts after the credential key loads; any
 * failure is logged and never crashes boot.
 */
import { logSystemEvent } from '@/lib/admin/events';
import { processState } from '@/lib/processState';

export const SCHEDULER_TICK_MS = 15_000;
const BOOT_DELAY_MS = 10_000;

// Shared across the instrumentation and API-route bundles (lib/processState.ts),
// so isSchedulerRunning() is truthful from the monitoring route.
const T = processState('scheduler.index', () => ({
  tickTimer: null as NodeJS.Timeout | null,
  ticking: false,
  started: false,
  signalsHooked: false,
}));

export type InProcessDecision = { scheduler: boolean; worker: boolean; reason: string };

/** Pure: should the in-process scheduler/worker start in this environment? */
export function decideInProcessJobs(env: Record<string, string | undefined> = process.env): InProcessDecision {
  if (env.NEXT_RUNTIME && env.NEXT_RUNTIME !== 'nodejs') return { scheduler: false, worker: false, reason: 'non-node runtime' };
  if (env.NEXT_PHASE === 'phase-production-build') return { scheduler: false, worker: false, reason: 'next build' };
  if (env.KX_DISABLE_INPROCESS_JOBS === '1') return { scheduler: false, worker: false, reason: 'KX_DISABLE_INPROCESS_JOBS=1' };
  if (env.NODE_ENV !== 'production' && env.KX_INPROCESS_JOBS !== '1') {
    return { scheduler: false, worker: false, reason: 'not production (set KX_INPROCESS_JOBS=1 to force)' };
  }
  const worker = env.ETSY_WEBHOOK_WORKER !== '0';
  return { scheduler: true, worker, reason: worker ? 'enabled' : 'enabled (worker loop off: ETSY_WEBHOOK_WORKER=0)' };
}

async function tick() {
  if (T.ticking) return;
  T.ticking = true;
  try {
    const { runDueJobs } = await import('./runs');
    await runDueJobs({ wait: false });
  } catch (err) {
    logSystemEvent('error', {
      message: 'Scheduler tick failed',
      operation: 'scheduler.tick_failed',
      error: err instanceof Error ? err : new Error(String(err)),
    });
  } finally {
    T.ticking = false;
  }
}

function hookSignals() {
  if (T.signalsHooked) return;
  T.signalsHooked = true;
  const onStop = async (signal: NodeJS.Signals) => {
    try {
      stopInProcessJobsTimers();
      const [{ stopEtsyWebhookWorker }, { abortAllJobs }] = await Promise.all([
        import('@/lib/etsy/webhooks/worker'),
        import('./runs'),
      ]);
      abortAllJobs();
      await stopEtsyWebhookWorker(20_000);
      const { flushEtsyUsage } = await import('@/lib/etsy/rateBudget');
      await flushEtsyUsage();
    } catch {
      /* best effort during shutdown */
    }
    // If nobody else handles the signal (Next normally does and exits first),
    // keep the default "terminate" semantics after draining.
    if (process.listenerCount(signal) === 0) process.exit(0);
  };
  // Next's own handler usually exits the process; this stops claiming new work
  // and gives in-flight events a head start. Interrupted rows recover via heartbeat.
  process.once('SIGTERM', () => void onStop('SIGTERM'));
  process.once('SIGINT', () => void onStop('SIGINT'));
}

function stopInProcessJobsTimers() {
  if (T.tickTimer) clearInterval(T.tickTimer);
  T.tickTimer = null;
}

/** Starts the scheduler and the worker per decideInProcessJobs. Idempotent; never throws. */
export async function startInProcessJobs(env: Record<string, string | undefined> = process.env): Promise<InProcessDecision> {
  const decision = decideInProcessJobs(env);
  if (T.started || !decision.scheduler) {
    if (!decision.scheduler) console.log(`[scheduler] in-process jobs not started: ${decision.reason}`);
    return decision;
  }
  T.started = true;
  try {
    const { loadEtsyUsageFromDb } = await import('@/lib/etsy/rateBudget');
    await loadEtsyUsageFromDb();
  } catch {
    /* budget falls back to empty counters */
  }

  const boot = setTimeout(async () => {
    try {
      if (decision.worker) {
        const { startEtsyWebhookWorker } = await import('@/lib/etsy/webhooks/worker');
        startEtsyWebhookWorker();
      }
      T.tickTimer = setInterval(() => void tick(), SCHEDULER_TICK_MS);
      T.tickTimer.unref?.();
      void tick();
      hookSignals();
      logSystemEvent('info', {
        message: 'In-process scheduler started',
        operation: 'scheduler.started',
        details: { worker: decision.worker, tickMs: SCHEDULER_TICK_MS },
      });
    } catch (err) {
      T.started = false;
      logSystemEvent('error', {
        message: 'In-process scheduler failed to start',
        operation: 'scheduler.start_failed',
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }, BOOT_DELAY_MS);
  boot.unref?.();
  return decision;
}

export function isSchedulerRunning(): boolean {
  return Boolean(T.tickTimer);
}
