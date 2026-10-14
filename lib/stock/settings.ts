/**
 * Stock sync settings (W2). Server-only.
 *
 * Stock sync ships DISABLED. A user has no StockSettings row until they open
 * the setup wizard; a missing row means "disabled". Writes to marketplaces
 * happen only when enabled && !dryRun (after Go Live) and the global kill
 * switch STOCK_SYNC_GLOBAL_DISABLE is not set.
 *
 * Reads are cached per user for 30 s so the hooks called from hot paths
 * (webhook handlers, order upserts, draft sync) cost one Map lookup when the
 * feature is off.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { publishLive } from '@/lib/live/publish';
import { processState } from '@/lib/processState';
import type { StockChannel } from './types';

export const SETTINGS_CACHE_MS = 30_000;

export type StockSettingsRow = {
  userId: string;
  enabled: boolean;
  dryRun: boolean;
  enabledAt: Date | null;
  goLiveAt: Date | null;
  restockOnCancel: boolean;
  autoFixDrift: boolean;
  etsyZeroStockAction: string;
  seedPolicy: string;
  seedSubtractReserved: boolean;
  channels: string[];
  shopifyLocationId: string | null;
  orderScanCursorAt: Date | null;
  orderScanCursorId: string | null;
  updatedAt: Date;
};

export type EtsyZeroStockAction = 'disable_variation' | 'deactivate_listing';
export type SeedPolicy = 'min' | 'etsy_master' | 'manual';

// Shared per process (processState): an invalidation from an API route must
// also reach the instrumentation bundle's scheduler/worker copy of this module.
const shared = processState('stock.settingsCache', () => ({
  cache: new Map<string, { at: number; value: StockSettingsRow | null }>(),
  enabledUsers: null as { at: number; ids: Set<string> } | null,
}));
const cache = shared.cache;

export function stockGloballyDisabled(): boolean {
  const v = String(process.env.STOCK_SYNC_GLOBAL_DISABLE || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** enabled (dry-run or live) and not globally killed. */
export function isStockSyncActive(s: Pick<StockSettingsRow, 'enabled'> | null | undefined): boolean {
  return !!s?.enabled && !stockGloballyDisabled();
}

/** Active and past Go Live: the only state in which marketplace stock writes may happen. */
export function isStockLive(s: Pick<StockSettingsRow, 'enabled' | 'dryRun'> | null | undefined): boolean {
  return isStockSyncActive(s) && !s!.dryRun;
}

export function channelEnabled(s: Pick<StockSettingsRow, 'channels'> | null | undefined, channel: StockChannel | string): boolean {
  if (!s) return false;
  // An empty list means "all channels the user linked" (wizard default).
  return !s.channels?.length || s.channels.includes(String(channel));
}

export function invalidateStockSettings(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
  shared.enabledUsers = null;
}

/** Cached (30 s). Returns null when the user never set up stock sync. */
export async function getStockSettings(userId: string, opts: { fresh?: boolean } = {}): Promise<StockSettingsRow | null> {
  if (!userId) return null;
  const hit = cache.get(userId);
  if (!opts.fresh && hit && Date.now() - hit.at < SETTINGS_CACHE_MS) return hit.value;
  try {
    const row = (await prisma.stockSettings.findUnique({ where: { userId } })) as StockSettingsRow | null;
    cache.set(userId, { at: Date.now(), value: row });
    return row;
  } catch (err) {
    void logger.warn('stock.settings.read_failed', { userId, error: err instanceof Error ? err.message : String(err) });
    // Fail closed: treat as disabled.
    return null;
  }
}

/** Users with enabled stock sync (dry-run or live). Cached 30 s; used by shop-keyed hooks. */
export async function getEnabledStockUserIds(): Promise<Set<string>> {
  if (stockGloballyDisabled()) return new Set();
  if (shared.enabledUsers && Date.now() - shared.enabledUsers.at < SETTINGS_CACHE_MS) return shared.enabledUsers.ids;
  try {
    const rows = await prisma.stockSettings.findMany({ where: { enabled: true }, select: { userId: true } });
    shared.enabledUsers = { at: Date.now(), ids: new Set(rows.map((r) => r.userId)) };
  } catch (err) {
    void logger.warn('stock.settings.enabled_users_failed', { error: err instanceof Error ? err.message : String(err) });
    shared.enabledUsers = { at: Date.now(), ids: new Set() };
  }
  return shared.enabledUsers.ids;
}

export const EDITABLE_SETTINGS = [
  'restockOnCancel',
  'autoFixDrift',
  'etsyZeroStockAction',
  'seedPolicy',
  'seedSubtractReserved',
  'channels',
  'shopifyLocationId',
] as const;

export type StockSettingsPatch = Partial<Pick<StockSettingsRow, (typeof EDITABLE_SETTINGS)[number]>>;

/** Validates a client patch; unknown keys are dropped. Pure. */
export function sanitizeSettingsPatch(input: any): StockSettingsPatch {
  const out: StockSettingsPatch = {};
  if (!input || typeof input !== 'object') return out;
  if (typeof input.restockOnCancel === 'boolean') out.restockOnCancel = input.restockOnCancel;
  if (typeof input.autoFixDrift === 'boolean') out.autoFixDrift = input.autoFixDrift;
  if (input.etsyZeroStockAction === 'disable_variation' || input.etsyZeroStockAction === 'deactivate_listing') {
    out.etsyZeroStockAction = input.etsyZeroStockAction;
  }
  if (['min', 'etsy_master', 'manual'].includes(input.seedPolicy)) out.seedPolicy = input.seedPolicy;
  if (typeof input.seedSubtractReserved === 'boolean') out.seedSubtractReserved = input.seedSubtractReserved;
  if (Array.isArray(input.channels)) {
    const allowed = new Set(['etsy', 'ebay', 'trendyol', 'shopify', 'wix', 'amazon', 'hepsiburada']);
    out.channels = Array.from(new Set(input.channels.map(String).filter((c: string) => allowed.has(c))));
  }
  if (input.shopifyLocationId === null || (typeof input.shopifyLocationId === 'string' && input.shopifyLocationId.length < 100)) {
    out.shopifyLocationId = input.shopifyLocationId || null;
  }
  return out;
}

/** Creates the row (disabled, dry-run) if needed and applies a sanitized patch. */
export async function updateStockSettings(userId: string, patch: StockSettingsPatch & {
  enabled?: boolean;
  dryRun?: boolean;
  enabledAt?: Date | null;
  goLiveAt?: Date | null;
  orderScanCursorAt?: Date | null;
  orderScanCursorId?: string | null;
}): Promise<StockSettingsRow> {
  const row = (await prisma.stockSettings.upsert({
    where: { userId },
    create: { userId, ...patch },
    update: { ...patch },
  })) as StockSettingsRow;
  invalidateStockSettings(userId);
  cache.set(userId, { at: Date.now(), value: row });
  publishLive(userId, { type: 'stock', kind: 'settings_changed' });
  return row;
}

/** JSON-safe view for the API. */
export function serializeSettings(s: StockSettingsRow | null) {
  const base = s ?? {
    userId: '',
    enabled: false,
    dryRun: true,
    enabledAt: null,
    goLiveAt: null,
    restockOnCancel: true,
    autoFixDrift: false,
    etsyZeroStockAction: 'disable_variation',
    seedPolicy: 'min',
    seedSubtractReserved: true,
    channels: [],
    shopifyLocationId: null,
    orderScanCursorAt: null,
    orderScanCursorId: null,
    updatedAt: new Date(0),
  };
  return {
    configured: !!s,
    enabled: base.enabled,
    dryRun: base.dryRun,
    live: isStockLive(base),
    globallyDisabled: stockGloballyDisabled(),
    enabledAt: base.enabledAt ? base.enabledAt.toISOString() : null,
    goLiveAt: base.goLiveAt ? base.goLiveAt.toISOString() : null,
    restockOnCancel: base.restockOnCancel,
    autoFixDrift: base.autoFixDrift,
    etsyZeroStockAction: base.etsyZeroStockAction,
    seedPolicy: base.seedPolicy,
    seedSubtractReserved: base.seedSubtractReserved,
    channels: base.channels,
    shopifyLocationId: base.shopifyLocationId,
  };
}
