/**
 * Process-wide singleton state (owner W1).
 *
 * Next compiles instrumentation and API routes against separate webpack
 * runtimes, so each gets its own copy of every module. Module-level `let` /
 * `new Map()` state is therefore NOT shared between the in-process worker /
 * scheduler (started from instrumentation) and the API routes. Anything that
 * must be one-per-process (locks, budgets, worker/scheduler bookkeeping) lives
 * on globalThis under a Symbol.for key, like lib/live/bus.ts and lib/prisma.ts.
 */
export function processState<T extends object>(name: string, init: () => T): T {
  const key = Symbol.for(`kolayxport.processState.${name}`);
  const g = globalThis as unknown as Record<symbol, T | undefined>;
  let state = g[key];
  if (!state) {
    state = init();
    g[key] = state;
  }
  return state;
}
