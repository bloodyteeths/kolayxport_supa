/**
 * Pure view models for Settings › Connections (settings-billing-pricing §4.2, §4.3, §4.6). No React:
 * every decision a tile, the reauth banner or the store-limit modal makes lives here and is unit-tested.
 */
import type { ConnectionEntry, ConnectionsMap, ExtensionStatus } from '@/lib/integrations/connectionStatus';
import { connectionStatus } from '@/lib/ds/status/connections';
import type { ConnectionStatusKey } from '@/lib/ds/status/vocabulary';
import { DECIDED_PLAN_LIMITS, type PlanKey } from '@/lib/billing/planLimits';
import {
  firstMissingField,
  getIntegration,
  type CredentialLabelKey,
  type CredentialValues,
  type IntegrationId,
  type IntegrationSpec,
} from '@/lib/settings/integrations';

/** A last refresh older than this shows in warning text with an inline "Refresh all orders" (§4.2, CRITIQUE V3). */
export const STALE_SYNC_MS = 24 * 60 * 60 * 1000;

export type WixPollState = 'idle' | 'polling' | 'timedOut';

export type TileMeta =
  | { kind: 'none' }
  | { kind: 'blurb' }
  | { kind: 'missingField'; field: CredentialLabelKey }
  | { kind: 'reason'; reason: 'authExpired' | 'incomplete'; account?: string }
  | { kind: 'shops'; count: number }
  | { kind: 'account'; name?: string; lastSyncAt?: string | null; stale: boolean }
  | { kind: 'supportManaged' }
  | { kind: 'extension'; lastActivityAt: string | null }
  | { kind: 'notDetected' }
  | { kind: 'wixWaiting' }
  | { kind: 'wixTimedOut' };

export type TileButton =
  | 'connect' | 'setUp' | 'finishSetup' | 'reconnect' | 'manage'
  | 'contactSupport' | 'checkAgain' | 'installExtension';

export interface TileModel {
  id: IntegrationId;
  /** `loading` renders a skeleton pill; otherwise a DS connection status key. */
  status: ConnectionStatusKey | 'loading';
  /** The status ignoring a failed re-check (what the tile last knew). Drives meta and button. */
  knownStatus: ConnectionStatusKey | 'loading';
  meta: TileMeta;
  button: TileButton | null;
  /** Show "Refresh all orders" in ⋯ (connected only). */
  canRefresh: boolean;
  /** Show "Disconnect {name}…" (oauth/install, connected). */
  canDisconnect: boolean;
  /** Show "Remove credentials…" (credential provider with something saved). */
  canRemoveCredentials: boolean;
  /** Show "Reconnect" in ⋯. */
  canReconnect: boolean;
}

export interface TileContext {
  entry?: ConnectionEntry;
  /** First load, nothing cached. */
  loading: boolean;
  /** The status request failed but cached data is shown (`connError && connections`). */
  checkFailed: boolean;
  extension?: ExtensionStatus | null;
  /** Masked `integrationSettings` (from GET /api/user/settings) when loaded. */
  credentialValues?: CredentialValues | null;
  wixPoll?: WixPollState;
  now: Date;
}

const toTime = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Latest `lastSyncAt` over the provider's accounts (ISO), or null. */
export function latestSync(entry: ConnectionEntry | undefined): string | null {
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const a of entry?.accounts ?? []) {
    const t = toTime(a.lastSyncAt);
    if (t !== null && (best === null || t > best)) {
      best = t;
      bestIso = a.lastSyncAt ?? null;
    }
  }
  return bestIso;
}

export function isStale(lastSyncAt: string | null | undefined, now: Date): boolean {
  const t = toTime(lastSyncAt);
  return t !== null && now.getTime() - t > STALE_SYNC_MS;
}

/**
 * Server account names that only repeat the provider ("Veeqo", "eBay") or the provider plus a raw account id
 * ("Amazon A1Q4UP10N4XSPS") carry no information for the seller.
 */
export function meaningfulName(spec: IntegrationSpec, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const v = name.trim();
  const provider = spec.name.toLowerCase();
  if (v.toLowerCase() === provider) return undefined;
  const rest = v.toLowerCase().startsWith(`${provider} `) ? v.slice(provider.length).trim() : null;
  if (rest && (/^[A-Z0-9]{8,}$/.test(rest) || /^\d{4,}$/.test(rest))) return undefined;
  return v;
}

function reauthReason(entry: ConnectionEntry | undefined): 'authExpired' | 'incomplete' {
  const flagged = entry?.accounts.find((a) => a.needsReauth);
  const reason = flagged?.reason ?? entry?.reason;
  return reason === 'incomplete_credentials' ? 'incomplete' : 'authExpired';
}

export function tileModel(spec: IntegrationSpec, ctx: TileContext): TileModel {
  const none: Omit<TileModel, 'id' | 'status' | 'knownStatus' | 'meta' | 'button'> = {
    canRefresh: false, canDisconnect: false, canRemoveCredentials: false, canReconnect: false,
  };

  if (ctx.loading) {
    return { id: spec.id, status: 'loading', knownStatus: 'loading', meta: { kind: 'none' }, button: null, ...none };
  }

  // Chrome extension: detected from tracking pushes (readonly).
  if (spec.id === 'chrome') {
    const detected = !!ctx.extension?.detected;
    const status: ConnectionStatusKey = detected ? 'connected' : 'not_connected';
    return {
      id: spec.id,
      status: ctx.checkFailed ? 'check_failed' : status,
      knownStatus: status,
      meta: detected ? { kind: 'extension', lastActivityAt: ctx.extension?.lastActivityAt ?? null } : { kind: 'notDetected' },
      button: detected ? null : 'installExtension',
      ...none,
    };
  }

  const entry = ctx.entry;
  const known = connectionStatus(entry ?? { connected: false });
  const status: ConnectionStatusKey = ctx.checkFailed || !entry ? 'check_failed' : known;
  const connected = !!entry?.connected;
  const isCredentials = spec.kind === 'credentials';
  const hasSavedCredentials = isCredentials && (connected || known === 'incomplete');
  const base = {
    ...none,
    canRefresh: connected,
    canDisconnect: connected && !!spec.disconnect,
    canRemoveCredentials: hasSavedCredentials,
    canReconnect: connected && (spec.kind === 'oauth' || spec.kind === 'install'),
  };

  // Hepsiburada before it is enabled for this user (MARKETPLACE_HEPSIBURADA / ALLOW_HEPSIBURADA_USERS): set up by
  // our support team, no self-serve connect. Once enabled it is a normal credentials tile (Mağaza ID + servis anahtarı).
  if (spec.id === 'hepsiburada' && entry?.available !== true) {
    if (connected) {
      return {
        id: spec.id, status, knownStatus: known, button: null, ...base, canDisconnect: false, canReconnect: false,
        meta: { kind: 'account', name: meaningfulName(spec, entry?.accounts[0]?.name), lastSyncAt: latestSync(entry), stale: isStale(latestSync(entry), ctx.now) },
      };
    }
    return { id: spec.id, status, knownStatus: known, meta: { kind: 'supportManaged' }, button: 'contactSupport', ...base };
  }

  // Wix install polling overrides the meta line (logic in useWixInstallPoll, moved verbatim).
  if (spec.id === 'wix' && ctx.wixPoll && ctx.wixPoll !== 'idle' && !connected) {
    return {
      id: spec.id, status, knownStatus: known, ...base,
      meta: ctx.wixPoll === 'polling' ? { kind: 'wixWaiting' } : { kind: 'wixTimedOut' },
      button: ctx.wixPoll === 'polling' ? 'connect' : 'checkAgain',
    };
  }

  switch (known) {
    case 'not_connected':
      return { id: spec.id, status, knownStatus: known, meta: { kind: 'blurb' }, button: isCredentials ? 'setUp' : 'connect', ...base };
    case 'incomplete': {
      const missing = firstMissingField(spec.id, ctx.credentialValues);
      return {
        id: spec.id, status, knownStatus: known, ...base,
        meta: missing ? { kind: 'missingField', field: missing.labelKey } : { kind: 'reason', reason: 'incomplete' },
        button: 'finishSetup',
      };
    }
    case 'needs_reconnect': {
      const flagged = entry?.accounts.find((a) => a.needsReauth) ?? entry?.accounts[0];
      return {
        id: spec.id, status, knownStatus: known, ...base,
        meta: { kind: 'reason', reason: reauthReason(entry), account: meaningfulName(spec, flagged?.name) },
        button: 'reconnect',
      };
    }
    case 'connected':
    default: {
      const last = latestSync(entry);
      const accounts = entry?.accounts ?? [];
      const meta: TileMeta =
        spec.id === 'etsy' && accounts.length > 1
          ? { kind: 'shops', count: accounts.length }
          : { kind: 'account', name: meaningfulName(spec, accounts[0]?.name), lastSyncAt: last, stale: isStale(last, ctx.now) };
      return { id: spec.id, status, knownStatus: 'connected', meta, button: spec.panel ? 'manage' : null, ...base };
    }
  }
}

/* ─────────────────────────────────────────── reauth banner (§4.3) */

export type ReauthBannerModel =
  | { kind: 'one'; spec: IntegrationSpec; account?: string; since: string | null }
  | { kind: 'many'; count: number; firstId: IntegrationId }
  | null;

/** The one warning Banner at the top of Connections; `needsReauth` from useConnections(). */
export function reauthBannerModel(
  needsReauth: readonly string[],
  connections: Partial<ConnectionsMap> | null | undefined,
): ReauthBannerModel {
  const specs = needsReauth.map((id) => getIntegration(id)).filter((s): s is IntegrationSpec => !!s && s.id !== 'chrome');
  if (specs.length === 0) return null;
  if (specs.length > 1) return { kind: 'many', count: specs.length, firstId: specs[0].id };
  const spec = specs[0];
  const entry = spec.id === 'chrome' ? undefined : connections?.[spec.id];
  const flagged = entry?.accounts.find((a) => a.needsReauth) ?? entry?.accounts[0];
  return { kind: 'one', spec, account: meaningfulName(spec, flagged?.name) ?? flagged?.name, since: flagged?.lastSyncAt ?? null };
}

/* ─────────────────────────────────────────── store meter + store-limit modal (§4.5, §4.6) */

export interface StoreAllowance {
  /** `undefined` = billing provider unknown (loading / failed): render no Stripe surface (§0.2). */
  stripeUpsell: boolean | undefined;
  plan?: string | null;
  used?: number;
  /** `null` = unlimited; `undefined` = no store meter known (entitlement fallback mode). */
  limit?: number | null;
  /** Extra-store modules (pricing v2), added to the decided limit in fallback mode. */
  extraStores?: number;
}

/** "Stores · 4 of 5 used": only with a real, finite store meter. */
export function storesLine(a: StoreAllowance): { used: number; limit: number; showCompare: boolean } | null {
  if (typeof a.used !== 'number' || typeof a.limit !== 'number') return null;
  return { used: a.used, limit: a.limit, showCompare: a.stripeUpsell === true };
}

/** True when the store meter is known and full (hides "Connect another shop"). */
export function storesFull(a: StoreAllowance): boolean {
  return typeof a.used === 'number' && typeof a.limit === 'number' && a.used >= a.limit;
}

const UPGRADE_ORDER: readonly PlanKey[] = ['starter', 'growth', 'pro'];
/** Pricing v2 accounts move up the yearly packages, never back to the legacy ladder. */
const V2_UPGRADE_ORDER: readonly PlanKey[] = ['baslangic_yil', 'buyume_yil', 'pro_yil'];
const V2_KEYS = new Set<string>(['aylik', 'baslangic_yil', 'buyume_yil', 'pro_yil', 'kurumsal']);

export type StoreLimitModel =
  | { neutral: true }
  | { neutral: false; plan: PlanKey; limit: number; nextPlan: PlanKey; nextLimit: number; compareHref: string };

/**
 * §4.6. Plan copy and "Compare plans" only when Stripe upsells are allowed AND a higher self-serve plan
 * with more stores exists. shopify_free, an unknown provider, Pro (next is Enterprise, sales-led) and an
 * unknown plan get the neutral copy with a single "OK".
 *
 * Entitlement fallback mode carries no store meter (`limit === undefined`): the modal and the 402 banner then
 * take the plan's decided store limit from DECIDED_PLAN_LIMITS so the upgrade copy works before the
 * entitlement backend lands. The meter line (`storesLine`) stays hidden in that mode (§4.5).
 */
export function storeLimitModel(a: StoreAllowance): StoreLimitModel {
  if (a.stripeUpsell !== true || a.limit === null) return { neutral: true };
  const plan = a.plan as PlanKey | undefined;
  if (!plan || !Object.prototype.hasOwnProperty.call(DECIDED_PLAN_LIMITS, plan)) return { neutral: true };
  const decided = DECIDED_PLAN_LIMITS[plan].limits.connectedStores;
  // Extra-store modules (pricing v2) raise the decided limit; the server meter, when present, already includes them.
  const limit = typeof a.limit === 'number' ? a.limit : typeof decided === 'number' ? decided + (a.extraStores ?? 0) : undefined;
  if (limit === undefined) return { neutral: true };
  const next = (V2_KEYS.has(plan) ? V2_UPGRADE_ORDER : UPGRADE_ORDER).find((p) => {
    const l = DECIDED_PLAN_LIMITS[p].limits.connectedStores;
    return typeof l === 'number' && l > limit;
  });
  if (!next) return { neutral: true };
  return {
    neutral: false,
    plan,
    limit,
    nextPlan: next,
    nextLimit: DECIDED_PLAN_LIMITS[next].limits.connectedStores as number,
    compareHref: `/fiyatlandirma?plan=${next}`,
  };
}
