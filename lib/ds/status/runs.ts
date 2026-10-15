// lib/ds/status/runs.ts — settings §8 refresh history: `run` domain (pull jobs). The `sync` domain means
// pushing staged drafts and is never reused for runs. Raw values: JobRun.status (running | succeeded | failed),
// SyncOperation.status (free text).

import { normalizeRaw, type RunStatusKey } from './vocabulary';

const COMPLETED = new Set(['completed', 'complete', 'succeeded', 'success', 'done', 'finished', 'ok']);
const RUNNING = new Set(['running', 'in_progress', 'started', 'pending', 'queued', 'processing']);
const FAILED = new Set(['failed', 'failure', 'error', 'errored', 'timeout', 'timed_out', 'aborted']);

export function runStatus(raw: string | null | undefined): RunStatusKey | null {
  const r = normalizeRaw(raw);
  if (COMPLETED.has(r)) return 'completed';
  if (RUNNING.has(r)) return 'running';
  if (FAILED.has(r)) return 'failed';
  return null;
}
