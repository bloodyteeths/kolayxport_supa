/**
 * Scheduled sends for staged drafts (listings-grid §9.4). Server-only.
 *
 * A draft with `scheduledSendAt <= now` and status `draft` (or `failed`, a retry) is sent through the
 * SAME executors as an explicit send: Etsy `syncDraft` (lib/etsy/draftService,
 * never with force), eBay `syncDraft`, and `sendCatalogDrafts`. Rules:
 *  - never forces a conflict (a changed listing ends up `conflict`);
 *  - never sends a draft with a queued delete/archive (founder rule): such a
 *    draft is unscheduled and reported as skipped. Scheduling one is refused
 *    up front (SCHEDULE_DELETE_REFUSED). The check runs on the row re-read
 *    AFTER the claim (catalog: inside sendCatalogDrafts, which re-reads after
 *    its own claim), never on the possibly minutes-old due list. A delete
 *    staged in the tiny window between that re-read and the Etsy/eBay sync
 *    service's own read is closed only by backend BR (staging clears
 *    scheduledSendAt / syncDraft refuses deletes on scheduled runs);
 *  - each draft is claimed by clearing its scheduledSendAt in one conditional
 *    update, so overlapping runs (in-process scheduler + HTTP cron) never send
 *    a draft twice.
 * Results go to the notification center (type `scheduledSendResult`, backend
 * BR-7) once that type is registered, and to SyncLog via logger.
 *
 * `scheduledSendAt` on EtsyListingDraft / EbayListingDraft / CatalogDraft
 * ships with backend migration BR-1a. Until then `scheduledSendSupported()` is
 * false: the PATCH routes answer 503 and the run is a no-op.
 */
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notify } from '@/lib/notifications';
import { isKnownType } from '@/lib/notificationCenter/registry';
import { syncDraft as syncEtsyDraft } from '@/lib/etsy/draftService';
import { syncDraft as syncEbayDraft } from '@/lib/ebay/draftService';
import type { ScheduledJob } from '@/lib/scheduler/types';
import { isLegacyEbaySku } from '@/lib/ebay/legacy';
import {
  CatalogDraftError,
  catalogDraftsAvailable,
  parseScheduledSendAt,
  resolvePendingCatalogBatches,
  sendCatalogDrafts,
  type CatalogExecutors,
  type CatalogMarketplace,
} from '@/lib/catalogDrafts/service';

export { parseScheduledSendAt };

export type ScheduleKind = 'etsy' | 'ebay' | 'catalog';
export type ScheduledMarketplace = 'etsy' | 'ebay' | CatalogMarketplace;

const MODEL_BY_KIND: Record<ScheduleKind, string> = {
  etsy: 'EtsyListingDraft',
  ebay: 'EbayListingDraft',
  catalog: 'CatalogDraft',
};
const DELEGATE_BY_KIND: Record<ScheduleKind, string> = {
  etsy: 'etsyListingDraft',
  ebay: 'ebayListingDraft',
  catalog: 'catalogDraft',
};

/** Does the generated Prisma client know `model.field`? (false before BR-1a is generated) */
export function modelHasField(model: string, field: string): boolean {
  try {
    const models: any[] = (Prisma as any)?.dmmf?.datamodel?.models || [];
    const m = models.find((x) => x?.name === model);
    return Boolean(m?.fields?.some((f: any) => f?.name === field));
  } catch {
    return false;
  }
}

export function scheduledSendSupported(kind: ScheduleKind): boolean {
  if (kind === 'catalog' && !catalogDraftsAvailable()) return false;
  return modelHasField(MODEL_BY_KIND[kind], 'scheduledSendAt');
}

function delegate(kind: ScheduleKind): any {
  return (prisma as any)[DELEGATE_BY_KIND[kind]];
}

export function hasPendingDeleteAction(queuedActions: unknown): boolean {
  return Array.isArray(queuedActions)
    && queuedActions.some((a: any) => (a?.type === 'delete' || a?.type === 'archive') && !a?.completedAt);
}

/** Open drafts whose schedule may be changed (unscheduling is allowed on all of them). */
const OPEN_EDITABLE_STATUSES = ['draft', 'failed', 'conflict'];
/** Drafts that may be scheduled and that a run picks up. A conflict needs review first. */
export const DUE_STATUSES = ['draft', 'failed'];

export class ScheduleError extends Error {
  code: 'SCHEDULED_SEND_UNAVAILABLE' | 'DRAFT_NOT_FOUND' | 'DRAFT_NOT_EDITABLE' | 'SCHEDULE_INVALID' | 'SCHEDULE_DELETE_REFUSED';
  status: number;
  key: string;
  params?: Record<string, string | number>;
  constructor(code: ScheduleError['code'], message: string, params?: Record<string, string | number>) {
    super(message);
    this.name = 'ScheduleError';
    this.code = code;
    this.params = params;
    const meta: Record<ScheduleError['code'], [number, string]> = {
      SCHEDULED_SEND_UNAVAILABLE: [503, 'listings.draftError.scheduledSendUnavailable'],
      DRAFT_NOT_FOUND: [404, 'listings.draftError.draftNotFound'],
      DRAFT_NOT_EDITABLE: [409, 'listings.draftError.notEditable'],
      SCHEDULE_INVALID: [400, 'listings.draftError.scheduleInvalid'],
      SCHEDULE_DELETE_REFUSED: [409, 'listings.draftError.scheduleDeleteRefused'],
    };
    [this.status, this.key] = meta[code];
  }
}

export function scheduleErrorResponse(err: ScheduleError) {
  return { status: err.status, body: { error: err.message, code: err.code, key: err.key, ...(err.params ? { params: err.params } : {}) } };
}

export type ScheduleOptions = {
  /** Validate only: run every check, write nothing. */
  dryRun?: boolean;
  /** Queued action types the caller removes in the same request (checked as if already gone). */
  assumeRemovedTypes?: string[];
};

/**
 * Set or clear `scheduledSendAt` on an Etsy or eBay draft the user owns
 * (PATCH /api/{etsy,ebay}-drafts/[id]). Only open, non-sending drafts can be
 * scheduled; unscheduling (null) is always allowed on them. A draft with a
 * queued delete cannot be scheduled. `dryRun` validates without writing, so a
 * route can check the schedule before it changes anything else.
 */
export async function setDraftScheduledSendAt(
  kind: 'etsy' | 'ebay',
  draftId: string,
  userId: string,
  input: unknown,
  opts: ScheduleOptions = {},
): Promise<Date | null> {
  if (!scheduledSendSupported(kind)) throw new ScheduleError('SCHEDULED_SEND_UNAVAILABLE', 'Scheduled sends are not available yet');
  let at: Date | null | undefined;
  try {
    at = parseScheduledSendAt(input);
  } catch (err) {
    if (err instanceof CatalogDraftError) throw new ScheduleError('SCHEDULE_INVALID', err.message);
    throw err;
  }
  if (at === undefined) throw new ScheduleError('SCHEDULE_INVALID', 'scheduledSendAt is required');
  const d = delegate(kind);
  const draft = await d.findFirst({ where: { id: draftId, userId }, select: { id: true, status: true, queuedActions: true } });
  if (!draft) throw new ScheduleError('DRAFT_NOT_FOUND', 'Draft not found');
  if (!OPEN_EDITABLE_STATUSES.includes(draft.status) || (at && !DUE_STATUSES.includes(draft.status))) {
    throw new ScheduleError('DRAFT_NOT_EDITABLE', `Draft cannot be scheduled (${draft.status})`, { status: draft.status });
  }
  const removed = opts.assumeRemovedTypes || [];
  const actions = Array.isArray(draft.queuedActions) && removed.length
    ? draft.queuedActions.filter((a: any) => !removed.includes(a?.type))
    : draft.queuedActions;
  if (at && hasPendingDeleteAction(actions)) {
    throw new ScheduleError('SCHEDULE_DELETE_REFUSED', 'A draft with a queued delete cannot be scheduled');
  }
  if (opts.dryRun) return at;
  const res = await d.updateMany({
    where: { id: draftId, userId, status: { in: at ? DUE_STATUSES : OPEN_EDITABLE_STATUSES } },
    data: { scheduledSendAt: at },
  });
  if (res.count === 0) throw new ScheduleError('DRAFT_NOT_EDITABLE', 'Draft changed while scheduling');
  // Re-check after the write: a delete staged between the read and the write
  // must not stay scheduled (staging does not clear scheduledSendAt yet).
  if (at) {
    const after = await d.findFirst({ where: { id: draftId, userId }, select: { queuedActions: true } });
    if (after && hasPendingDeleteAction(after.queuedActions)) {
      await d.updateMany({ where: { id: draftId, userId }, data: { scheduledSendAt: null } });
      throw new ScheduleError('SCHEDULE_DELETE_REFUSED', 'A draft with a queued delete cannot be scheduled');
    }
  }
  return at;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * `empty`: drafts with nothing left to send, cancelled without calling the marketplace (not a problem).
 * `legacy`: eBay drafts of listings created on eBay (`legacy-<itemId>`), never sendable from KolayXport: not sent,
 * not failed, no warning; the draft row is left open (only its schedule is cleared by the claim).
 */
export type ScheduledTally = { sent: number; failed: number; conflicts: number; skipped: number; pending: number; empty: number; legacy: number };
export type ScheduledRunSummary = {
  /** false when the schema is not deployed yet (nothing ran). */
  supported: Record<ScheduleKind, boolean>;
  byUser: Record<string, Partial<Record<ScheduledMarketplace, ScheduledTally>>>;
  totals: ScheduledTally;
  batches: { synced: number; failed: number; pending: number };
};

export type RunScheduledSendsOptions = {
  now?: Date;
  /** Max drafts per kind per run. */
  limit?: number;
  signal?: AbortSignal;
  interDraftDelayMs?: number;
  /** Test injection. */
  deps?: {
    syncEtsy?: typeof syncEtsyDraft;
    syncEbay?: typeof syncEbayDraft;
    sendCatalog?: typeof sendCatalogDrafts;
    resolveBatches?: typeof resolvePendingCatalogBatches;
    catalogExecutors?: CatalogExecutors;
    notify?: typeof notify;
    supported?: (kind: ScheduleKind) => boolean;
  };
};

const LISTINGS_LINK: Record<ScheduledMarketplace, string> = {
  etsy: '/app/etsy-listings',
  ebay: '/app/ebay-listings',
  trendyol: '/app/trendyol-urunler',
  wix: '/app/wix-urunler',
  shopify: '/app/shopify-urunler',
};

const zero = (): ScheduledTally => ({ sent: 0, failed: 0, conflicts: 0, skipped: 0, pending: 0, empty: 0, legacy: 0 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tally(summary: ScheduledRunSummary, userId: string, mp: ScheduledMarketplace, key: keyof ScheduledTally, by = 1) {
  const u = (summary.byUser[userId] ||= {});
  const t = (u[mp] ||= zero());
  t[key] += by;
  summary.totals[key] += by;
}

/** Atomically take a due draft: clear scheduledSendAt only if it is still due and draft/failed. */
async function claim(kind: ScheduleKind, id: string, now: Date): Promise<boolean> {
  const res = await delegate(kind).updateMany({
    where: { id, status: { in: DUE_STATUSES }, scheduledSendAt: { lte: now } },
    data: { scheduledSendAt: null },
  });
  return res.count === 1;
}

async function dueDrafts(kind: ScheduleKind, now: Date, limit: number, select: Record<string, boolean>) {
  return delegate(kind).findMany({
    where: { status: { in: DUE_STATUSES }, scheduledSendAt: { lte: now } },
    orderBy: { scheduledSendAt: 'asc' },
    take: limit,
    select: { id: true, userId: true, queuedActions: true, ...select },
  }) as Promise<any[]>;
}

export async function runScheduledSends(opts: RunScheduledSendsOptions = {}): Promise<ScheduledRunSummary> {
  const now = opts.now || new Date();
  const limit = opts.limit ?? 200;
  const delayMs = opts.interDraftDelayMs ?? 250;
  const deps = opts.deps || {};
  const supported = deps.supported || scheduledSendSupported;
  const summary: ScheduledRunSummary = {
    supported: { etsy: supported('etsy'), ebay: supported('ebay'), catalog: supported('catalog') },
    byUser: {},
    totals: zero(),
    batches: { synced: 0, failed: 0, pending: 0 },
  };
  const aborted = () => Boolean(opts.signal?.aborted);

  // Etsy and eBay: one draft at a time through their own sync services.
  for (const kind of ['etsy', 'ebay'] as const) {
    if (!summary.supported[kind] || aborted()) continue;
    const rows = await dueDrafts(kind, now, limit, {});
    for (let i = 0; i < rows.length && !aborted(); i++) {
      const row = rows[i];
      if (!(await claim(kind, row.id, now))) continue;
      // Re-read after the claim: `rows` can be minutes old by now, and the
      // sync service runs whatever is queued at the time it reads the draft.
      const fresh = await delegate(kind).findFirst({
        where: { id: row.id },
        select: { status: true, queuedActions: true, ...(kind === 'ebay' ? { sku: true } : {}) },
      });
      if (!fresh || !DUE_STATUSES.includes(fresh.status)) continue;
      if (kind === 'ebay' && isLegacyEbaySku(fresh.sku)) {
        // Created on eBay: the Inventory API can't edit it. Not sent, not a failure, eBay never called.
        tally(summary, row.userId, kind, 'legacy');
        continue;
      }
      if (hasPendingDeleteAction(fresh.queuedActions)) {
        tally(summary, row.userId, kind, 'skipped');
        continue;
      }
      try {
        const result: any = kind === 'etsy'
          ? await (deps.syncEtsy || syncEtsyDraft)(row.id, row.userId, { force: false })
          : await (deps.syncEbay || syncEbayDraft)(row.id, row.userId);
        tally(summary, row.userId, kind, result?.status === 'conflict' ? 'conflicts'
          : result?.status === 'skipped' ? (result?.reason === 'legacy' ? 'legacy' : 'empty') : 'sent');
      } catch (err) {
        tally(summary, row.userId, kind, 'failed');
        logger.warn('scheduledSend.draft_failed', { kind, draftId: row.id, userId: row.userId, error: String((err as any)?.message || err) });
      }
      if (delayMs > 0 && i < rows.length - 1) await sleep(delayMs);
    }
  }

  // Catalog drafts: claim, then send per user through sendCatalogDrafts.
  if (summary.supported.catalog && !aborted()) {
    const rows = await dueDrafts('catalog', now, limit, { marketplace: true });
    const byUser = new Map<string, { id: string; marketplace: CatalogMarketplace }[]>();
    for (const row of rows) {
      if (!(await claim('catalog', row.id, now))) continue;
      if (hasPendingDeleteAction(row.queuedActions)) {
        tally(summary, row.userId, row.marketplace, 'skipped');
        continue;
      }
      byUser.set(row.userId, [...(byUser.get(row.userId) || []), { id: row.id, marketplace: row.marketplace }]);
    }
    for (const [userId, drafts] of Array.from(byUser.entries())) {
      if (aborted()) break;
      const mpById = new Map(drafts.map((d) => [d.id, d.marketplace]));
      try {
        const res = await (deps.sendCatalog || sendCatalogDrafts)(userId, drafts.map((d) => d.id), {
          confirmDeleteIds: [],
          executors: deps.catalogExecutors,
          now: () => new Date(),
        });
        for (const r of res.results) {
          const mp = mpById.get(r.draftId);
          if (!mp) continue;
          const key: keyof ScheduledTally = r.status === 'success' ? 'sent' : r.status === 'conflict' ? 'conflicts' : r.status === 'pending' ? 'pending'
            : r.status === 'skipped' ? (r.reason === 'empty' ? 'empty' : 'skipped') : 'failed';
          tally(summary, userId, mp, key);
        }
      } catch (err) {
        for (const d of drafts) tally(summary, userId, d.marketplace, 'failed');
        logger.warn('scheduledSend.catalog_failed', { userId, error: String((err as any)?.message || err) });
      }
    }
  }

  // Trendyol batches left pending by earlier sends (explicit or scheduled).
  if (summary.supported.catalog && !aborted()) {
    try {
      summary.batches = await (deps.resolveBatches || resolvePendingCatalogBatches)({ executors: deps.catalogExecutors });
    } catch (err) {
      logger.warn('scheduledSend.batch_resolve_failed', { error: String((err as any)?.message || err) });
    }
  }

  await notifyResults(summary, deps.notify || notify);
  logger.event('cron', summary.totals.failed > 0 ? 'warn' : 'info', 'Scheduled draft sends', {
    totals: summary.totals,
    batches: summary.batches,
    users: Object.keys(summary.byUser).length,
    supported: summary.supported,
  }, { operation: 'cron.send_scheduled_drafts' });
  return summary;
}

/**
 * One notification per user and marketplace: "3 scheduled changes sent to
 * Etsy · 1 failed". Only once the backend registered `scheduledSendResult`.
 */
async function notifyResults(summary: ScheduledRunSummary, notifyFn: typeof notify) {
  if (!isKnownType('scheduledSendResult')) return;
  for (const [userId, byMp] of Object.entries(summary.byUser)) {
    for (const [mp, t] of Object.entries(byMp) as [ScheduledMarketplace, ScheduledTally][]) {
      if (!t || t.sent + t.failed + t.conflicts + t.skipped === 0) continue;
      const problem = t.failed + t.conflicts + t.skipped;
      await notifyFn(userId, {
        type: 'scheduledSendResult' as any,
        severity: problem > 0 ? 'warning' : 'info',
        titleKey: 'types.scheduledSendResult',
        params: { marketplace: mp, sent: t.sent, failed: t.failed, conflicts: t.conflicts, skipped: t.skipped },
        link: LISTINGS_LINK[mp],
        badge: problem > 0,
      });
    }
  }
}

/**
 * Job for the in-process scheduler (registration in lib/scheduler/jobs.ts is
 * backend request BR-8). The HTTP fallback is /api/cron/send-scheduled-drafts.
 */
export const scheduledSendJob: ScheduledJob = {
  name: 'send-scheduled-drafts',
  intervalMinutes: 5,
  timeoutMs: 4 * 60 * 1000,
  maxAttemptsPerBucket: 1,
  run: async ({ signal }) => {
    const s = await runScheduledSends({ signal });
    return { ...s.totals, batches: s.batches };
  },
};
