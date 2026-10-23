import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDelegate } from './fakeDb';

const h = vi.hoisted(() => ({
  etsyListingDraft: null as any,
  ebayListingDraft: null as any,
  catalogDraft: null as any,
  knownTypes: new Set<string>(),
  notify: vi.fn(async () => undefined),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    get etsyListingDraft() { return h.etsyListingDraft; },
    get ebayListingDraft() { return h.ebayListingDraft; },
    get catalogDraft() { return h.catalogDraft; },
  },
}));
vi.mock('@prisma/client', () => ({
  Prisma: {
    dmmf: {
      datamodel: {
        models: [
          { name: 'EtsyListingDraft', fields: [{ name: 'id' }, { name: 'scheduledSendAt' }] },
          { name: 'EbayListingDraft', fields: [{ name: 'id' }] },
        ],
      },
    },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() } }));
vi.mock('@/lib/notifications', () => ({ notify: h.notify }));
vi.mock('@/lib/notificationCenter/registry', () => ({ isKnownType: (t: string) => h.knownTypes.has(t) }));
vi.mock('@/lib/etsy/draftService', () => ({ syncDraft: vi.fn() }));
vi.mock('@/lib/ebay/draftService', () => ({ syncDraft: vi.fn() }));
vi.mock('@/lib/stock/settings', () => ({ getStockSettings: vi.fn(), isStockSyncActive: () => false, channelEnabled: () => false }));

import {
  hasPendingDeleteAction,
  modelHasField,
  runScheduledSends,
  ScheduleError,
  scheduledSendSupported,
  setDraftScheduledSendAt,
} from '@/lib/drafts/scheduledSend';

const NOW = new Date('2026-10-15T12:00:00Z');
const DUE = new Date('2026-10-15T11:55:00Z');
const LATER = new Date('2026-10-15T13:00:00Z');

function etsyRow(over: Record<string, any> = {}) {
  return { id: 'e1', userId: 'u1', status: 'draft', queuedActions: [], scheduledSendAt: DUE, updatedAt: DUE, ...over };
}

const allSupported = () => true;

beforeEach(() => {
  vi.clearAllMocks();
  h.etsyListingDraft = createFakeDelegate();
  h.ebayListingDraft = createFakeDelegate();
  h.catalogDraft = createFakeDelegate();
  h.knownTypes = new Set();
});

describe('schema guard', () => {
  it('reads field presence from the generated client', () => {
    expect(modelHasField('EtsyListingDraft', 'scheduledSendAt')).toBe(true);
    expect(modelHasField('EbayListingDraft', 'scheduledSendAt')).toBe(false);
    expect(scheduledSendSupported('ebay')).toBe(false);
  });

  it('PATCH answers 503 while the column is not deployed', async () => {
    await expect(setDraftScheduledSendAt('ebay', 'x', 'u1', LATER.toISOString())).rejects.toMatchObject({ code: 'SCHEDULED_SEND_UNAVAILABLE', status: 503 });
  });

  it('a run without the schema does nothing', async () => {
    h.etsyListingDraft.rows.push(etsyRow());
    const syncEtsy = vi.fn();
    const s = await runScheduledSends({ now: NOW, deps: { supported: () => false, syncEtsy: syncEtsy as any } });
    expect(syncEtsy).not.toHaveBeenCalled();
    expect(s.totals.sent).toBe(0);
  });
});

describe('setDraftScheduledSendAt (Etsy)', () => {
  it('schedules and unschedules an open draft', async () => {
    h.etsyListingDraft.rows.push(etsyRow({ scheduledSendAt: null }));
    const at = new Date(Date.now() + 3600_000);
    await setDraftScheduledSendAt('etsy', 'e1', 'u1', at.toISOString());
    expect(h.etsyListingDraft.rows[0].scheduledSendAt.getTime()).toBe(at.getTime());
    await setDraftScheduledSendAt('etsy', 'e1', 'u1', null);
    expect(h.etsyListingDraft.rows[0].scheduledSendAt).toBeNull();
  });

  it('refuses a queued delete, a conflict, someone else\'s draft and a past time', async () => {
    const at = new Date(Date.now() + 3600_000).toISOString();
    h.etsyListingDraft.rows.push(etsyRow({ queuedActions: [{ type: 'delete' }] }), etsyRow({ id: 'e2', status: 'conflict' }));
    await expect(setDraftScheduledSendAt('etsy', 'e1', 'u1', at)).rejects.toMatchObject({ code: 'SCHEDULE_DELETE_REFUSED' });
    await expect(setDraftScheduledSendAt('etsy', 'e2', 'u1', at)).rejects.toMatchObject({ code: 'DRAFT_NOT_EDITABLE' });
    await expect(setDraftScheduledSendAt('etsy', 'e1', 'other', at)).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' });
    await expect(setDraftScheduledSendAt('etsy', 'e2', 'u1', '2020-01-01T00:00:00Z')).rejects.toBeInstanceOf(ScheduleError);
    // Unscheduling a conflict is allowed.
    await expect(setDraftScheduledSendAt('etsy', 'e2', 'u1', null)).resolves.toBeNull();
  });
});

describe('setDraftScheduledSendAt dry run', () => {
  it('validates as if removed actions were gone and writes nothing', async () => {
    h.etsyListingDraft.rows.push(etsyRow({ scheduledSendAt: null, queuedActions: [{ type: 'delete' }] }));
    const at = new Date(Date.now() + 3600_000).toISOString();
    await expect(setDraftScheduledSendAt('etsy', 'e1', 'u1', at, { dryRun: true })).rejects.toMatchObject({ code: 'SCHEDULE_DELETE_REFUSED' });
    await expect(setDraftScheduledSendAt('etsy', 'e1', 'u1', '2020-01-01T00:00:00Z', { dryRun: true, assumeRemovedTypes: ['delete'] })).rejects.toMatchObject({ code: 'SCHEDULE_INVALID' });
    await setDraftScheduledSendAt('etsy', 'e1', 'u1', at, { dryRun: true, assumeRemovedTypes: ['delete'] });
    expect(h.etsyListingDraft.rows[0].scheduledSendAt).toBeNull();
    expect(h.etsyListingDraft.rows[0].queuedActions).toEqual([{ type: 'delete' }]);
  });
});

describe('runScheduledSends', () => {
  it('sends due Etsy drafts without force, once, and leaves future ones alone', async () => {
    h.etsyListingDraft.rows.push(etsyRow(), etsyRow({ id: 'e2', scheduledSendAt: LATER }));
    const syncEtsy = vi.fn(async () => ({ status: 'success' }));
    const s = await runScheduledSends({ now: NOW, interDraftDelayMs: 0, deps: { supported: allSupported, syncEtsy: syncEtsy as any, syncEbay: vi.fn() as any, sendCatalog: vi.fn() as any, resolveBatches: vi.fn(async () => ({ synced: 0, failed: 0, pending: 0 })) } });
    expect(syncEtsy).toHaveBeenCalledTimes(1);
    expect(syncEtsy).toHaveBeenCalledWith('e1', 'u1', { force: false, priority: 4 }) // P4 Bulk (lib/etsy/rateBudget);
    expect(s.byUser.u1.etsy).toMatchObject({ sent: 1 });
    expect(h.etsyListingDraft.rows[0].scheduledSendAt).toBeNull();
    expect(h.etsyListingDraft.rows[1].scheduledSendAt).toEqual(LATER);

    // A second (overlapping) run finds nothing to claim.
    await runScheduledSends({ now: NOW, interDraftDelayMs: 0, deps: { supported: allSupported, syncEtsy: syncEtsy as any, syncEbay: vi.fn() as any, sendCatalog: vi.fn() as any, resolveBatches: vi.fn(async () => ({ synced: 0, failed: 0, pending: 0 })) } });
    expect(syncEtsy).toHaveBeenCalledTimes(1);
  });

  it('never sends a draft with a queued delete: it is unscheduled and counted as skipped', async () => {
    h.etsyListingDraft.rows.push(etsyRow({ queuedActions: [{ type: 'delete' }] }));
    const syncEtsy = vi.fn();
    const s = await runScheduledSends({ now: NOW, interDraftDelayMs: 0, deps: { supported: (k) => k === 'etsy', syncEtsy: syncEtsy as any } });
    expect(syncEtsy).not.toHaveBeenCalled();
    expect(s.byUser.u1.etsy).toMatchObject({ skipped: 1, sent: 0 });
    expect(h.etsyListingDraft.rows[0].scheduledSendAt).toBeNull();
  });

  it('re-checks the queued delete after the claim, not on the minutes-old due list', async () => {
    h.etsyListingDraft.rows.push(etsyRow(), etsyRow({ id: 'e2' }));
    const syncEtsy = vi.fn(async () => {
      // While e1 is sending, the seller queues a delete on e2.
      h.etsyListingDraft.rows[1].queuedActions = [{ type: 'delete' }];
      return { status: 'success' };
    });
    const s = await runScheduledSends({ now: NOW, interDraftDelayMs: 0, deps: { supported: (k) => k === 'etsy', syncEtsy: syncEtsy as any } });
    expect(syncEtsy).toHaveBeenCalledTimes(1);
    expect(syncEtsy).toHaveBeenCalledWith('e1', 'u1', { force: false, priority: 4 }) // P4 Bulk (lib/etsy/rateBudget);
    expect(s.byUser.u1.etsy).toMatchObject({ sent: 1, skipped: 1 });
  });

  it('counts conflicts and failures, and notifies once the type is registered', async () => {
    h.knownTypes.add('scheduledSendResult');
    h.etsyListingDraft.rows.push(etsyRow(), etsyRow({ id: 'e2' }), etsyRow({ id: 'e3', status: 'conflict' }));
    const syncEtsy = vi.fn(async (id: string) => {
      if (id === 'e2') throw new Error('Etsy 500');
      return { status: 'conflict' };
    });
    const s = await runScheduledSends({ now: NOW, interDraftDelayMs: 0, deps: { supported: (k) => k === 'etsy', syncEtsy: syncEtsy as any } });
    expect(syncEtsy).toHaveBeenCalledTimes(2); // the conflict draft is not due
    expect(s.byUser.u1.etsy).toMatchObject({ conflicts: 1, failed: 1 });
    expect(h.notify).toHaveBeenCalledWith('u1', expect.objectContaining({
      type: 'scheduledSendResult',
      titleKey: 'types.scheduledSendResult',
      params: expect.objectContaining({ marketplace: 'etsy', sent: 0, failed: 1, conflicts: 1 }),
      link: '/app/etsy-listings',
    }));
  });

  it('an empty draft (every change undone) is reported as empty, not failed or skipped, and does not notify', async () => {
    h.knownTypes.add('scheduledSendResult');
    h.etsyListingDraft.rows.push(etsyRow());
    h.catalogDraft.rows.push({ id: 'c1', userId: 'u1', marketplace: 'shopify', status: 'draft', queuedActions: [], scheduledSendAt: DUE });
    const syncEtsy = vi.fn(async () => ({ status: 'skipped', reason: 'empty', draftId: 'e1' }));
    const sendCatalog = vi.fn(async () => ({
      results: [{ draftId: 'c1', status: 'skipped' as const, reason: 'empty' as const }],
      sent: [], failed: [], conflicts: [], pending: [], skipped: [{ id: 'c1', reason: 'empty' as const }],
    }));
    const s = await runScheduledSends({ now: NOW, interDraftDelayMs: 0, deps: { supported: (k) => k !== 'ebay', syncEtsy: syncEtsy as any, sendCatalog: sendCatalog as any, resolveBatches: vi.fn(async () => ({ synced: 0, failed: 0, pending: 0 })) } });
    expect(s.byUser.u1.etsy).toMatchObject({ empty: 1, sent: 0, failed: 0, skipped: 0 });
    expect(s.byUser.u1.shopify).toMatchObject({ empty: 1, sent: 0, failed: 0, skipped: 0 });
    expect(s.totals.failed).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('sends catalog drafts through sendCatalogDrafts with no delete confirmation', async () => {
    h.catalogDraft.rows.push(
      { id: 'c1', userId: 'u2', marketplace: 'shopify', status: 'draft', queuedActions: [], scheduledSendAt: DUE },
      { id: 'c2', userId: 'u2', marketplace: 'wix', status: 'draft', queuedActions: [{ type: 'delete' }], scheduledSendAt: DUE },
    );
    const sendCatalog = vi.fn(async (_u: string, ids: string[]) => ({
      results: ids.map((id) => ({ draftId: id, status: 'success' as const })),
      sent: ids, failed: [], conflicts: [], pending: [], skipped: [],
    }));
    const s = await runScheduledSends({ now: NOW, deps: { supported: (k) => k === 'catalog', sendCatalog: sendCatalog as any, resolveBatches: vi.fn(async () => ({ synced: 0, failed: 0, pending: 0 })) } });
    expect(sendCatalog).toHaveBeenCalledWith('u2', ['c1'], expect.objectContaining({ confirmDeleteIds: [] }));
    expect(s.byUser.u2.shopify).toMatchObject({ sent: 1 });
    expect(s.byUser.u2.wix).toMatchObject({ skipped: 1 });
  });
});

describe('hasPendingDeleteAction', () => {
  it('ignores completed actions', () => {
    expect(hasPendingDeleteAction([{ type: 'delete', completedAt: 'x' }])).toBe(false);
    expect(hasPendingDeleteAction([{ type: 'archive' }])).toBe(true);
    expect(hasPendingDeleteAction(null)).toBe(false);
  });
});
