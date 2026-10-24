// lib/activation/events.ts — first-party activation events (why signups do or don't connect a store).
// Stored as SyncLog rows (category 'activation', message 'activation:<event>', userId set, details.provider);
// no third-party tracking, no PII beyond the userId. Read by /admin/signups (lib/admin/signups.ts).
//   app_visit         an app page was opened (once per browser tab session, client)
//   checklist_view    the "connect your store" checklist was shown (client)
//   connect_click     a store tile on the checklist was clicked (client, provider)
//   oauth_start       a store OAuth flow was started (server, provider)
//   oauth_ok          the provider sent the user back and the store was connected (server, provider)
//   oauth_fail        the callback failed after we knew the user (server, provider)
//   credentials_saved Trendyol / Hepsiburada API credentials were saved (server, provider)
import { logger } from '@/lib/logger';

export const ACTIVATION_EVENTS = ['app_visit', 'checklist_view', 'connect_click', 'oauth_start', 'oauth_ok', 'oauth_fail', 'credentials_saved', 'editor_open', 'editor_job', 'editor_staged', 'editor_sent'] as const;
export type ActivationEvent = (typeof ACTIVATION_EVENTS)[number];
/** Events the browser may report (the server-side ones can't be faked from the client). */
export const CLIENT_ACTIVATION_EVENTS: readonly ActivationEvent[] = ['app_visit', 'checklist_view', 'connect_click', 'editor_open', 'editor_job', 'editor_staged', 'editor_sent'];
/** Editor job names (bulk action keys); anything else is dropped. */
export const EDITOR_JOB_RE = /^[a-zA-Z]{2,24}$/;
export const ACTIVATION_PROVIDERS = ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada'] as const;
export type ActivationProvider = (typeof ACTIVATION_PROVIDERS)[number];

export const activationMessage = (event: ActivationEvent) => `activation:${event}`;

export function isActivationEvent(v: unknown): v is ActivationEvent {
  return typeof v === 'string' && (ACTIVATION_EVENTS as readonly string[]).includes(v);
}
export function isActivationProvider(v: unknown): v is ActivationProvider {
  return typeof v === 'string' && (ACTIVATION_PROVIDERS as readonly string[]).includes(v);
}

/** Records one event. Never throws (tracking must not break a connect flow). */
export function recordActivation(userId: string | null | undefined, event: ActivationEvent, provider?: ActivationProvider | null, extra?: { job?: string | null; count?: number | null }): void {
  if (!userId) return;
  const details: Record<string, unknown> = {};
  if (provider) details.provider = provider;
  if (extra?.job && EDITOR_JOB_RE.test(extra.job)) details.job = extra.job;
  if (typeof extra?.count === 'number' && Number.isFinite(extra.count) && extra.count >= 0) details.count = Math.min(100000, Math.round(extra.count));
  try {
    void Promise.resolve(
      logger.event('activation', 'info', activationMessage(event), Object.keys(details).length ? details : undefined, { userId }),
    ).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export interface ActivationSummary {
  visits: number;
  lastSeen: string | null;
  checklist: boolean;
  clicked: string[];
  started: Record<string, number>;
  connected: string[];
  failed: Record<string, number>;
  credentials: string[];
  editor: { opens: number; jobs: Record<string, number>; staged: number; sent: number };
}

/** Pure: one user's events → summary for the admin table. */
export function summarizeActivation(events: Array<{ message: string; details: unknown; timestamp: Date | string }>): ActivationSummary {
  const s: ActivationSummary = { visits: 0, lastSeen: null, checklist: false, clicked: [], started: {}, connected: [], failed: {}, credentials: [], editor: { opens: 0, jobs: {}, staged: 0, sent: 0 } };
  const add = (list: string[], v: string) => { if (!list.includes(v)) list.push(v); };
  for (const e of events) {
    const event = e.message.replace(/^activation:/, '');
    const p = (e.details && typeof e.details === 'object' ? (e.details as { provider?: unknown }).provider : undefined);
    const provider = typeof p === 'string' ? p : '';
    const at = new Date(e.timestamp).toISOString();
    if (!s.lastSeen || at > s.lastSeen) s.lastSeen = at;
    if (event === 'app_visit') s.visits += 1;
    else if (event === 'checklist_view') s.checklist = true;
    else if (event === 'connect_click' && provider) add(s.clicked, provider);
    else if (event === 'oauth_start' && provider) s.started[provider] = (s.started[provider] ?? 0) + 1;
    else if (event === 'oauth_ok' && provider) add(s.connected, provider);
    else if (event === 'oauth_fail' && provider) s.failed[provider] = (s.failed[provider] ?? 0) + 1;
    else if (event === 'credentials_saved' && provider) add(s.credentials, provider);
    else if (event === 'editor_open') s.editor.opens += 1;
    else if (event === 'editor_job') {
      const j = (e.details && typeof e.details === 'object' ? (e.details as { job?: unknown }).job : undefined);
      if (typeof j === 'string') s.editor.jobs[j] = (s.editor.jobs[j] ?? 0) + 1;
    } else if (event === 'editor_staged' || event === 'editor_sent') {
      const c = (e.details && typeof e.details === 'object' ? Number((e.details as { count?: unknown }).count) : NaN);
      const n = Number.isFinite(c) && c > 0 ? c : 1;
      if (event === 'editor_staged') s.editor.staged += n;
      else s.editor.sent += n;
    }
  }
  return s;
}

/** Pure: a one-line, human-readable summary (admin table, CSV). */
export function activationLine(s: ActivationSummary): string {
  const parts: string[] = [];
  if (s.visits) parts.push(`${s.visits} visit${s.visits === 1 ? '' : 's'}`);
  if (s.checklist) parts.push('checklist');
  if (s.clicked.length) parts.push(`clicked ${s.clicked.join('/')}`);
  const started = Object.entries(s.started).map(([p, n]) => (n > 1 ? `${p}×${n}` : p));
  if (started.length) parts.push(`started ${started.join('/')}`);
  if (s.connected.length) parts.push(`connected ${s.connected.join('/')}`);
  const failed = Object.entries(s.failed).map(([p, n]) => (n > 1 ? `${p}×${n}` : p));
  if (failed.length) parts.push(`failed ${failed.join('/')}`);
  if (s.credentials.length) parts.push(`keys ${s.credentials.join('/')}`);
  if (s.editor.opens) {
    const jobs = Object.entries(s.editor.jobs).map(([j, n]) => (n > 1 ? `${j}×${n}` : j));
    parts.push(`editor ${s.editor.opens}×${jobs.length ? ` (${jobs.join('/')})` : ''}${s.editor.staged ? ` staged ${s.editor.staged}` : ''}${s.editor.sent ? ` sent ${s.editor.sent}` : ''}`);
  }
  return parts.join(' · ');
}
