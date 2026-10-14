/**
 * Single source of truth for "which integrations does this user have".
 *
 * Server-only. Derives everything from rows we already store (Credential,
 * EtsyShop, WixSite, ShopifyShop, TrackingSubmission) in ONE Prisma query:
 * no external API calls, no schema changes.
 *
 * Secrets are never returned: token / key / password columns are selected only
 * to test presence and are reduced to booleans before leaving this module.
 * Identifiers returned as `externalId` are the plaintext, user-facing ones
 * (shop id, site id, shop domain, supplier/merchant/seller id). Carrier account
 * numbers are masked to their last 4 characters.
 *
 * Consumed by:  GET /api/integrations/status  ->  lib/hooks/useConnections.ts
 */
import prisma from '@/lib/prisma';
import { getOpenReauthFlags, resolveNotification, type OpenReauthFlag } from '@/lib/notifications';

export const CONNECTION_PROVIDERS = [
  'etsy',
  'ebay',
  'amazon',
  'shopify',
  'wix',
  'trendyol',
  'hepsiburada',
  'veeqo',
  'shippo',
  'fedex',
  'ups',
  'mng',
  'parasut',
] as const;

export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];

/** Providers that bring orders/listings in (used for `anyMarketplace`). */
export const MARKETPLACE_PROVIDERS: readonly ConnectionProvider[] = [
  'etsy',
  'ebay',
  'amazon',
  'shopify',
  'wix',
  'trendyol',
  'hepsiburada',
  'veeqo',
  'shippo',
] as const;

/**
 * Machine-readable reasons. The UI maps them to i18n strings; never show raw.
 * - token_expired_no_refresh: access token expired and no refresh token stored
 * - refresh_token_expired:    the provider's refresh token lifetime has passed
 *                             since the last refresh (Etsy 90d only)
 * - missing_refresh_token:    access token present but refresh token missing
 *                             for a provider whose access tokens are short-lived
 * - incomplete_credentials:   some but not all required fields are filled in
 * - reauth_required:          the provider rejected our stored grant at runtime
 *                             (e.g. Etsy invalid_grant) — an unresolved
 *                             reauthRequired Notification exists for it
 */
export type ConnectionReason =
  | 'token_expired_no_refresh'
  | 'refresh_token_expired'
  | 'missing_refresh_token'
  | 'incomplete_credentials'
  | 'reauth_required';

export interface ConnectionAccount {
  /** Stable id for React keys / disconnect calls (DB row id, or `legacy-<id>` / `credential`). */
  id: string;
  /** Human-readable label (shop name, site name, domain, masked account). */
  name: string;
  /** Provider-side identifier (Etsy shop id, Wix site id, Shopify domain, seller id, ...). */
  externalId: string | null;
  /** ISO timestamp of the last successful sync we know about, if tracked. */
  lastSyncAt?: string | null;
  needsReauth?: boolean;
  reason?: ConnectionReason;
}

export interface ConnectionEntry {
  connected: boolean;
  accounts: ConnectionAccount[];
  /** True when at least one connected account must be re-authorised by the user. */
  needsReauth: boolean;
  reason?: ConnectionReason;
}

export interface ExtensionStatus {
  /** True once the Chrome extension has successfully pushed tracking for this user. */
  detected: boolean;
  /** ISO timestamp of the last extension-confirmed tracking push. */
  lastActivityAt: string | null;
}

export type ConnectionsMap = Record<ConnectionProvider, ConnectionEntry>;

export interface ConnectionStatusResponse {
  connections: ConnectionsMap;
  extension?: ExtensionStatus;
  /** ISO time the snapshot was computed (server clock). */
  generatedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Etsy refresh tokens expire 90 days after issue; each refresh issues a new one. */
const ETSY_REFRESH_LIFETIME_MS = 90 * DAY_MS;
// eBay refresh tokens live ~18 months from the ORIGINAL consent and are not
// rotated on refresh (ebayClient keeps the old one), so ebayTokenExpiresAt
// tracks the last refresh, not the consent date. Their expiry cannot be
// detected from stored data without a schema change, so no lifetime check.

const has = (v: string | null | undefined): boolean => typeof v === 'string' && v.trim().length > 0;
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const latest = (...dates: (Date | null | undefined)[]): Date | null => {
  let best: Date | null = null;
  for (const d of dates) if (d && (!best || d > best)) best = d;
  return best;
};
const maskTail = (v: string | null | undefined): string | null => {
  if (!has(v)) return null;
  const s = String(v).trim();
  return s.length <= 4 ? s : `••••${s.slice(-4)}`;
};

/**
 * Re-auth heuristic for an OAuth account, from stored data only.
 * `refreshLifetimeMs`: when set, a token whose access-token expiry is older
 * than this means the refresh token itself has lapsed (access tokens are
 * refreshed on use, so tokenExpiresAt ~= last refresh time).
 */
function oauthReauth(
  hasRefresh: boolean,
  expiresAt: Date | null | undefined,
  now: number,
  opts: { refreshLifetimeMs?: number; requireRefresh?: boolean } = {},
): ConnectionReason | undefined {
  const exp = expiresAt ? expiresAt.getTime() : null;
  if (!hasRefresh) {
    if (exp !== null && exp < now) return 'token_expired_no_refresh';
    if (opts.requireRefresh) return 'missing_refresh_token';
    return undefined;
  }
  if (opts.refreshLifetimeMs && exp !== null && now - exp > opts.refreshLifetimeMs) {
    return 'refresh_token_expired';
  }
  return undefined;
}

function entry(accounts: ConnectionAccount[], incomplete = false): ConnectionEntry {
  const flagged = accounts.find((a) => a.needsReauth);
  if (accounts.length === 0) {
    return incomplete
      ? { connected: false, accounts: [], needsReauth: false, reason: 'incomplete_credentials' }
      : { connected: false, accounts: [], needsReauth: false };
  }
  return flagged
    ? { connected: true, accounts, needsReauth: true, reason: flagged.reason }
    : { connected: true, accounts, needsReauth: false };
}

/** Simple "all required fields present" providers stored on Credential. */
function credentialEntry(
  fields: (string | null | undefined)[],
  account: Omit<ConnectionAccount, 'id'>,
): ConnectionEntry {
  const filled = fields.filter(has).length;
  if (filled === fields.length) return entry([{ id: 'credential', ...account }]);
  return entry([], filled > 0);
}

/** Etsy access tokens live 1h; tokenExpiresAt - this ~= when the token was issued. */
const ETSY_ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/**
 * Mark accounts flagged by an unresolved reauthRequired notification.
 * accountId (from the dedupe key 'reauth:<provider>:<accountId>') is matched
 * against the account's externalId. Only a flag WITHOUT an accountId flags
 * every account of the provider.
 *
 * Stale flags are skipped and resolved (fire-and-forget) so neither Settings
 * nor the bell keeps asking for a reconnect:
 *  - the flagged account is no longer connected (shop removed/deactivated);
 *  - `tokenIssuedAt` shows a token issued after the flag was raised (the user
 *    reconnected via OAuth; no refresh runs for ~1h so etsyToken cannot clear it).
 */
function applyRuntimeReauthFlags(
  userId: string,
  connections: ConnectionsMap,
  flags: OpenReauthFlag[],
  tokenIssuedAt: Partial<Record<ConnectionProvider, Map<string, number>>>,
) {
  for (const flag of flags) {
    const provider = flag.provider as ConnectionProvider;
    if (!(CONNECTION_PROVIDERS as readonly string[]).includes(provider)) continue;
    const current = connections[provider];
    const accounts0 = current?.connected ? current.accounts : [];

    let targets: ConnectionAccount[];
    if (flag.accountId) {
      targets = accounts0.filter((a) => a.externalId === flag.accountId);
      const issuedAt = tokenIssuedAt[provider]?.get(flag.accountId);
      const reconnected = typeof issuedAt === 'number' && issuedAt > flag.createdAt.getTime();
      if (targets.length === 0 || reconnected) {
        if (flag.dedupeKey) void resolveNotification(userId, flag.dedupeKey);
        continue;
      }
    } else {
      targets = accounts0;
    }
    if (!current || targets.length === 0) continue;

    const accounts = current.accounts.map((a) =>
      targets.includes(a) && !a.needsReauth ? { ...a, needsReauth: true, reason: 'reauth_required' as const } : a,
    );
    connections[provider] = entry(accounts);
  }
}

export async function getConnectionStatus(userId: string): Promise<ConnectionStatusResponse> {
  const now = Date.now();

  // Runtime re-auth signals (one indexed query, never throws). Runs in
  // parallel with the main snapshot query.
  const reauthFlagsPromise = getOpenReauthFlags(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      integrationSettings: {
        select: {
          veeqoApiKey: true,
          shippoToken: true,
          fedexApiKey: true,
          fedexApiSecret: true,
          fedexAccountNumber: true,
          upsApiKey: true,
          upsApiSecret: true,
          upsAccountNumber: true,
          hepsiburadaApiKey: true,
          hepsiburadaMerchantId: true,
          trendyolApiKey: true,
          trendyolApiSecret: true,
          trendyolSupplierId: true,
          parasutClientId: true,
          parasutClientSecret: true,
          parasutUsername: true,
          parasutPassword: true,
          parasutCompanyId: true,
          mngCustomerNumber: true,
          mngPassword: true,
          etsyAccessToken: true,
          etsyRefreshToken: true,
          etsyShopId: true,
          etsyTokenExpiresAt: true,
          ebayAccessToken: true,
          ebayRefreshToken: true,
          ebayTokenExpiresAt: true,
          wixAccessToken: true,
          wixSiteId: true,
          wixInstanceId: true,
          amazonAccessToken: true,
          amazonRefreshToken: true,
          amazonTokenExpiresAt: true,
          amazonSellerId: true,
        },
      },
      etsyShops: {
        where: { isActive: true },
        select: {
          id: true,
          shopId: true,
          shopName: true,
          refreshToken: true,
          tokenExpiresAt: true,
          lastListingSyncAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      wixSites: {
        where: { isActive: true },
        select: {
          id: true,
          siteId: true,
          siteName: true,
          siteUrl: true,
          lastOrderSyncAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      shopifyShops: {
        where: { isActive: true },
        select: {
          id: true,
          shopDomain: true,
          shopName: true,
          refreshToken: true,
          tokenExpiresAt: true,
          lastOrderSyncAt: true,
          lastProductSyncAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      trackingSubmissions: {
        where: { etsySubmitStatus: 'submitted', etsySubmittedAt: { not: null } },
        select: { etsySubmittedAt: true },
        orderBy: { etsySubmittedAt: 'desc' },
        take: 1,
      },
    },
  });

  const c = user?.integrationSettings ?? null;

  // ---- Etsy: EtsyShop rows (primary) + legacy Credential mirror ----------
  const etsyAccounts: ConnectionAccount[] = (user?.etsyShops ?? []).map((s) => {
    const reason = oauthReauth(has(s.refreshToken), s.tokenExpiresAt, now, {
      refreshLifetimeMs: ETSY_REFRESH_LIFETIME_MS,
    });
    return {
      id: s.id,
      name: s.shopName || `Shop ${s.shopId}`,
      externalId: s.shopId,
      lastSyncAt: iso(s.lastListingSyncAt),
      needsReauth: !!reason,
      ...(reason ? { reason } : {}),
    };
  });
  if (c && has(c.etsyAccessToken) && has(c.etsyShopId) && !etsyAccounts.some((a) => a.externalId === c.etsyShopId)) {
    const reason = oauthReauth(has(c.etsyRefreshToken), c.etsyTokenExpiresAt, now, {
      refreshLifetimeMs: ETSY_REFRESH_LIFETIME_MS,
    });
    // Same id convention as /api/integrations/etsy/shops (legacy-<shopId>).
    etsyAccounts.unshift({
      id: `legacy-${c.etsyShopId}`,
      name: `Shop ${c.etsyShopId}`,
      externalId: c.etsyShopId,
      lastSyncAt: null,
      needsReauth: !!reason,
      ...(reason ? { reason } : {}),
    });
  }

  // ---- eBay: refresh token is the durable grant ---------------------------
  let ebay: ConnectionEntry;
  if (c && (has(c.ebayRefreshToken) || has(c.ebayAccessToken))) {
    const reason = oauthReauth(has(c.ebayRefreshToken), c.ebayTokenExpiresAt, now, { requireRefresh: true });
    ebay = entry([
      { id: 'credential', name: 'eBay', externalId: null, lastSyncAt: null, needsReauth: !!reason, ...(reason ? { reason } : {}) },
    ]);
  } else {
    ebay = entry([]);
  }

  // ---- Amazon: LWA refresh tokens do not expire; access tokens last 1h ----
  let amazon: ConnectionEntry;
  if (c && (has(c.amazonRefreshToken) || has(c.amazonAccessToken))) {
    const reason = oauthReauth(has(c.amazonRefreshToken), c.amazonTokenExpiresAt, now, { requireRefresh: true });
    amazon = entry([
      {
        id: 'credential',
        name: c.amazonSellerId ? `Amazon ${c.amazonSellerId}` : 'Amazon',
        externalId: c.amazonSellerId ?? null,
        lastSyncAt: null,
        needsReauth: !!reason,
        ...(reason ? { reason } : {}),
      },
    ]);
    // Marketplace list/details stay in /api/integrations/amazon/status.
  } else {
    amazon = entry([]);
  }

  // ---- Shopify: active ShopifyShop rows (offline tokens normally don't expire)
  const shopify = entry(
    (user?.shopifyShops ?? []).map((s) => {
      const reason = s.tokenExpiresAt ? oauthReauth(has(s.refreshToken), s.tokenExpiresAt, now) : undefined;
      return {
        id: s.id,
        name: s.shopName || s.shopDomain,
        externalId: s.shopDomain,
        lastSyncAt: iso(latest(s.lastOrderSyncAt, s.lastProductSyncAt)),
        needsReauth: !!reason,
        ...(reason ? { reason } : {}),
      };
    }),
  );

  // ---- Wix: WixSite rows (primary), Credential fallback -------------------
  // Wix uses the client_credentials grant (appId + appSecret + instanceId):
  // there is no refresh token and an expired ~4h access token is re-minted
  // silently on next use, so token expiry is NOT a re-auth signal. A WixSite
  // can always mint (lib/sync/wix.ts falls back instanceId -> siteId); the
  // legacy Credential path needs wixInstanceId or wixSiteId to mint.
  const wixAccounts: ConnectionAccount[] = (user?.wixSites ?? []).map((s) => ({
    id: s.id,
    name: s.siteName || s.siteUrl || s.siteId,
    externalId: s.siteId,
    lastSyncAt: iso(s.lastOrderSyncAt),
    needsReauth: false,
  }));
  if (wixAccounts.length === 0 && c && has(c.wixAccessToken)) {
    const reason: ConnectionReason | undefined =
      has(c.wixInstanceId) || has(c.wixSiteId) ? undefined : 'incomplete_credentials';
    wixAccounts.push({
      id: 'credential',
      name: c.wixSiteId || 'Wix',
      externalId: c.wixSiteId ?? null,
      lastSyncAt: null,
      needsReauth: !!reason,
      ...(reason ? { reason } : {}),
    });
  }

  const connections: ConnectionsMap = {
    etsy: entry(etsyAccounts),
    ebay,
    amazon,
    shopify,
    wix: entry(wixAccounts),
    trendyol: credentialEntry([c?.trendyolApiKey, c?.trendyolApiSecret, c?.trendyolSupplierId], {
      name: c?.trendyolSupplierId ? `Trendyol ${c.trendyolSupplierId}` : 'Trendyol',
      externalId: c?.trendyolSupplierId ?? null,
    }),
    hepsiburada: credentialEntry([c?.hepsiburadaApiKey, c?.hepsiburadaMerchantId], {
      name: c?.hepsiburadaMerchantId ? `Hepsiburada ${c.hepsiburadaMerchantId}` : 'Hepsiburada',
      externalId: c?.hepsiburadaMerchantId ?? null,
    }),
    veeqo: credentialEntry([c?.veeqoApiKey], { name: 'Veeqo', externalId: null }),
    shippo: credentialEntry([c?.shippoToken], { name: 'Shippo', externalId: null }),
    fedex: credentialEntry([c?.fedexApiKey, c?.fedexApiSecret, c?.fedexAccountNumber], {
      name: maskTail(c?.fedexAccountNumber) ? `FedEx ${maskTail(c?.fedexAccountNumber)}` : 'FedEx',
      externalId: maskTail(c?.fedexAccountNumber),
    }),
    ups: credentialEntry([c?.upsApiKey, c?.upsApiSecret, c?.upsAccountNumber], {
      name: maskTail(c?.upsAccountNumber) ? `UPS ${maskTail(c?.upsAccountNumber)}` : 'UPS',
      externalId: maskTail(c?.upsAccountNumber),
    }),
    // MNG/DHL eCommerce: app id/secret are platform env vars; per-user = customer no + password.
    mng: credentialEntry([c?.mngCustomerNumber, c?.mngPassword], { name: 'DHL eCommerce', externalId: null }),
    // Same required set as invoiceService.getParasutCredentials().
    parasut: credentialEntry(
      [c?.parasutClientId, c?.parasutClientSecret, c?.parasutUsername, c?.parasutPassword, c?.parasutCompanyId],
      { name: c?.parasutCompanyId ? `Paraşüt ${c.parasutCompanyId}` : 'Paraşüt', externalId: c?.parasutCompanyId ?? null },
    ),
  };

  // When each Etsy account's current access token was issued (expiry - 1h).
  const etsyIssued = new Map<string, number>();
  for (const sh of user?.etsyShops ?? []) {
    if (sh.shopId && sh.tokenExpiresAt) etsyIssued.set(sh.shopId, sh.tokenExpiresAt.getTime() - ETSY_ACCESS_TOKEN_LIFETIME_MS);
  }
  if (c?.etsyShopId && c.etsyTokenExpiresAt && !etsyIssued.has(c.etsyShopId)) {
    etsyIssued.set(c.etsyShopId, c.etsyTokenExpiresAt.getTime() - ETSY_ACCESS_TOKEN_LIFETIME_MS);
  }

  applyRuntimeReauthFlags(userId, connections, await reauthFlagsPromise, { etsy: etsyIssued });

  const lastExt = user?.trackingSubmissions?.[0]?.etsySubmittedAt ?? null;

  return {
    connections,
    extension: { detected: !!lastExt, lastActivityAt: iso(lastExt) },
    generatedAt: new Date(now).toISOString(),
  };
}
