/**
 * lib/settings/integrations.ts — the Settings integration catalog (settings-billing-pricing §4, §5).
 *
 * Pure data + pure helpers, no React and no runtime import from server modules (connectionStatus.ts
 * pulls Prisma; only its types are imported, and type imports are erased).
 *
 * Every tile on Settings › Connections and every row on Settings › Carriers & API keys comes from
 * `INTEGRATIONS`. Credential field names are the exact `integrationSettings` keys that
 * `PATCH /api/user/settings` accepts (no new fields, no renamed fields). The required set per provider
 * mirrors the server's completeness check in `lib/integrations/connectionStatus.ts` (`credentialEntry`),
 * so the panel's "required together" validation and the server's `incomplete_credentials` agree.
 *
 * Deliberately absent (§0.1): `mngAppId`, `mngAppSecret`, `mngApiEnvironment` (platform env vars,
 * `lib/mng/mng.credentials.ts`), `parasutBaseUrl`, `parasutRedirectUri` (never saved).
 */
import type { ConnectionProvider } from '@/lib/integrations/connectionStatus';

export type IntegrationId = ConnectionProvider | 'chrome';
export type IntegrationGroup = 'marketplaces' | 'shipping' | 'accounting' | 'tools';
/**
 * oauth: a "Connect" redirect (or a panel that ends in one: Amazon, Shopify) · install: Wix app install +
 * polling · credentials: keys typed into ProviderCredentialsPanel · readonly: nothing to set up here
 * (Hepsiburada is set up by support; the Chrome extension is detected).
 */
export type IntegrationKind = 'oauth' | 'install' | 'credentials' | 'readonly';
/** Which panel the tile's "Manage"/"Connect" opens. `null` = no panel (eBay, Wix, readonly). */
export type IntegrationPanel = 'etsy' | 'amazon' | 'shopify' | 'credentials' | null;

/** i18n key suffix under `settings.credentials.field.*`. */
export type CredentialLabelKey =
  | 'apiKey' | 'apiSecret' | 'supplierId' | 'token' | 'accountNumber'
  | 'mngCustomerNumber' | 'mngPassword'
  | 'clientId' | 'clientSecret' | 'username' | 'password' | 'companyId'
  | 'merchantId' | 'serviceKey';

export interface CredentialFieldSpec {
  /** The `integrationSettings` key sent in the PATCH body. */
  name: string;
  labelKey: CredentialLabelKey;
  /** Masked by the server on GET ('••••1234'); rendered through CredentialField's mask logic. */
  secret?: boolean;
  /** Every field listed here is required by the server's completeness check. */
  required: boolean;
  /** `digits`: only 0-9 (Trendyol supplier ID). `uuid`: a GUID (Hepsiburada Mağaza ID). */
  pattern?: 'digits' | 'uuid';
  /** Trim whitespace before saving (account numbers, ids). */
  trim?: boolean;
  /** FormField width (DS §3.7). */
  width?: 'short' | 'medium' | 'full';
  /** Shown in the list row's masked hint ("API key ••••1234 · Supplier ID 123456"). */
  hint?: boolean;
}

export interface IntegrationSpec {
  id: IntegrationId;
  /** Proper noun, not translated. */
  name: string;
  /** Brand key for `<LogoTile brand>` (lib/ds/logos.ts). */
  logo: string;
  group: IntegrationGroup;
  kind: IntegrationKind;
  panel: IntegrationPanel;
  /** OAuth entry point (302s to the provider and back to /ayarlar). */
  connectHref?: string;
  /** "View setup guide" target. */
  guideHref: string;
  /** Credential providers: the exact PATCH keys, in display order. */
  fields?: CredentialFieldSpec[];
  /** Listed on Settings › Carriers & API keys. */
  inCredentialsList?: boolean;
  /** Has a disconnect endpoint (oauth/install providers). Credential providers use "Remove credentials". */
  disconnect?: { method: 'delete' | 'post'; url: string; body?: Record<string, unknown> };
}

const GUIDE = '/app/entegrasyonlar-ve-rehberler';

export const ETSY_CONNECT_HREF = '/api/integrations/etsy/connect';
export const EBAY_CONNECT_HREF = '/api/integrations/ebay/connect';
export const amazonConnectHref = (marketplaceIds: readonly string[]) =>
  `/api/integrations/amazon/connect?marketplaceIds=${marketplaceIds.join(',')}`;
export const shopifyConnectHref = (subdomain: string) =>
  `/api/integrations/shopify/connect?shop=${encodeURIComponent(`${subdomain.trim()}.myshopify.com`)}`;
/** Today's default Amazon selection (amazon.com.tr) until the stored selection loads. */
export const AMAZON_DEFAULT_MARKETPLACES: readonly string[] = ['A33AVAJ2PDY3EV'];

/** "x.myshopify.com" / " x " → "x" (same normalisation as the legacy input). */
export function normalizeShopifySubdomain(raw: string): string {
  return raw.replace(/\s/g, '').replace(/\.myshopify\.com$/i, '');
}

const f = (name: string, labelKey: CredentialLabelKey, extra: Partial<CredentialFieldSpec> = {}): CredentialFieldSpec => ({
  name, labelKey, required: true, ...extra,
});

export const INTEGRATIONS: readonly IntegrationSpec[] = [
  // ── Stores ──────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'etsy', name: 'Etsy', logo: 'etsy', group: 'marketplaces', kind: 'oauth', panel: 'etsy',
    connectHref: ETSY_CONNECT_HREF, guideHref: `${GUIDE}#etsy-guide`,
    // Per shop: useConnectionActions POSTs { shopId, action: 'delete' } for each shop (never this bare body).
    disconnect: { method: 'post', url: '/api/integrations/etsy/shops' },
  },
  {
    id: 'ebay', name: 'eBay', logo: 'ebay', group: 'marketplaces', kind: 'oauth', panel: null,
    connectHref: EBAY_CONNECT_HREF, guideHref: GUIDE,
    disconnect: { method: 'delete', url: '/api/integrations/ebay/status' },
  },
  {
    id: 'amazon', name: 'Amazon', logo: 'amazon', group: 'marketplaces', kind: 'oauth', panel: 'amazon', guideHref: GUIDE,
    disconnect: { method: 'delete', url: '/api/integrations/amazon/status' },
  },
  {
    id: 'shopify', name: 'Shopify', logo: 'shopify', group: 'marketplaces', kind: 'oauth', panel: 'shopify', guideHref: GUIDE,
    disconnect: { method: 'delete', url: '/api/integrations/shopify/status', body: {} },
  },
  {
    id: 'wix', name: 'Wix', logo: 'wix', group: 'marketplaces', kind: 'install', panel: null, guideHref: GUIDE,
    disconnect: { method: 'delete', url: '/api/integrations/wix/status' },
  },
  {
    id: 'trendyol', name: 'Trendyol', logo: 'trendyol', group: 'marketplaces', kind: 'credentials', panel: 'credentials',
    guideHref: `${GUIDE}#trendyol-guide`, inCredentialsList: true,
    fields: [
      f('trendyolApiKey', 'apiKey', { secret: true, hint: true }),
      f('trendyolApiSecret', 'apiSecret', { secret: true }),
      f('trendyolSupplierId', 'supplierId', { pattern: 'digits', trim: true, width: 'short', hint: true }),
    ],
  },
  {
    // Self-serve once enabled for the user (connectionView falls back to "set up by support" while the flag is off).
    // The merchant adds our integrator in HB panel → Entegratör bilgileri and copies the Mağaza ID + its servis anahtarı.
    id: 'hepsiburada', name: 'Hepsiburada', logo: 'hepsiburada', group: 'marketplaces', kind: 'credentials', panel: 'credentials',
    guideHref: `${GUIDE}#hepsiburada-guide`, inCredentialsList: true,
    fields: [
      f('hepsiburadaMerchantId', 'merchantId', { pattern: 'uuid', trim: true, width: 'medium', hint: true }),
      f('hepsiburadaApiKey', 'serviceKey', { secret: true, hint: true }),
    ],
  },
  {
    id: 'veeqo', name: 'Veeqo', logo: 'veeqo', group: 'marketplaces', kind: 'credentials', panel: 'credentials',
    guideHref: GUIDE, inCredentialsList: true,
    fields: [f('veeqoApiKey', 'apiKey', { secret: true, hint: true })],
  },
  {
    id: 'shippo', name: 'Shippo', logo: 'shippo', group: 'marketplaces', kind: 'credentials', panel: 'credentials',
    guideHref: GUIDE, inCredentialsList: true,
    fields: [f('shippoToken', 'token', { secret: true, hint: true })],
  },
  // ── Shipping ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'fedex', name: 'FedEx', logo: 'fedex', group: 'shipping', kind: 'credentials', panel: 'credentials',
    guideHref: GUIDE, inCredentialsList: true,
    fields: [
      f('fedexApiKey', 'apiKey', { secret: true }),
      f('fedexApiSecret', 'apiSecret', { secret: true }),
      f('fedexAccountNumber', 'accountNumber', { trim: true, width: 'medium', hint: true }),
    ],
  },
  {
    id: 'ups', name: 'UPS', logo: 'ups', group: 'shipping', kind: 'credentials', panel: 'credentials',
    guideHref: GUIDE, inCredentialsList: true,
    fields: [
      f('upsApiKey', 'apiKey', { secret: true }),
      f('upsApiSecret', 'apiSecret', { secret: true }),
      f('upsAccountNumber', 'accountNumber', { trim: true, width: 'medium', hint: true }),
    ],
  },
  {
    // Glossary name (DS §3.19); the connection key stays `mng`, the mark is DHL's.
    id: 'mng', name: 'DHL eCommerce', logo: 'dhl-ecommerce', group: 'shipping', kind: 'credentials', panel: 'credentials',
    guideHref: GUIDE, inCredentialsList: true,
    fields: [
      f('mngCustomerNumber', 'mngCustomerNumber', { trim: true, width: 'medium', hint: true }),
      f('mngPassword', 'mngPassword', { secret: true }),
    ],
  },
  // ── Accounting ──────────────────────────────────────────────────────────────────────────────────
  {
    id: 'parasut', name: 'Paraşüt', logo: 'parasut', group: 'accounting', kind: 'credentials', panel: 'credentials',
    guideHref: GUIDE, inCredentialsList: true,
    fields: [
      f('parasutClientId', 'clientId', { trim: true }),
      f('parasutClientSecret', 'clientSecret', { secret: true }),
      f('parasutUsername', 'username', { trim: true }),
      f('parasutPassword', 'password', { secret: true }),
      f('parasutCompanyId', 'companyId', { trim: true, width: 'short', hint: true }),
    ],
  },
  // ── Tools ───────────────────────────────────────────────────────────────────────────────────────
  { id: 'chrome', name: 'Chrome extension', logo: 'chrome', group: 'tools', kind: 'readonly', panel: null, guideHref: `${GUIDE}#etsy-guide` },
];

export const INTEGRATION_GROUPS: readonly IntegrationGroup[] = ['marketplaces', 'shipping', 'accounting', 'tools'];
/** Groups shown on the Carriers & API keys list. */
export const CREDENTIAL_GROUPS: readonly IntegrationGroup[] = ['marketplaces', 'shipping', 'accounting'];

const BY_ID = new Map<string, IntegrationSpec>(INTEGRATIONS.map((s) => [s.id, s]));

export function getIntegration(id: string | null | undefined): IntegrationSpec | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function integrationsInGroup(group: IntegrationGroup, opts: { credentialsOnly?: boolean } = {}): IntegrationSpec[] {
  return INTEGRATIONS.filter((s) => s.group === group && (!opts.credentialsOnly || s.inCredentialsList));
}

export const CREDENTIAL_PROVIDERS: readonly IntegrationSpec[] = INTEGRATIONS.filter((s) => s.inCredentialsList);

/** The PATCH keys of one provider (empty for non-credential providers). */
export function credentialFieldNames(id: string): string[] {
  return getIntegration(id)?.fields?.map((x) => x.name) ?? [];
}

/* ─────────────────────────────────────────── values, validation, save payload */

export type CredentialValues = Record<string, string | null | undefined>;

/** Same rule as lib/encryption.ts `isMaskedSecret` (server-only module): the mask char means "saved, unchanged". */
export const SECRET_MASK_CHAR = '•';
export function isMaskedValue(v: unknown): boolean {
  return typeof v === 'string' && v.includes(SECRET_MASK_CHAR);
}
const filled = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

export type CredentialError =
  | { code: 'requiredWith'; field: string }
  | { code: 'digits' }
  | { code: 'uuid' };

/**
 * Inline validation (§5.2): any field filled → every required field must be filled (mirrors the server's
 * `incomplete_credentials`); the Trendyol supplier ID is digits only. An all-empty form is valid (that is
 * "Remove credentials"). A masked secret counts as filled. Returns errors keyed by field name, in field order.
 */
export function validateCredentials(id: string, values: CredentialValues): Record<string, CredentialError> {
  const spec = getIntegration(id);
  const out: Record<string, CredentialError> = {};
  if (!spec?.fields) return out;
  const anyFilled = spec.fields.some((x) => filled(values[x.name]));
  for (const x of spec.fields) {
    const v = values[x.name];
    if (anyFilled && x.required && !filled(v)) {
      out[x.name] = { code: 'requiredWith', field: x.name };
      continue;
    }
    if (x.pattern === 'digits' && filled(v) && !isMaskedValue(v) && !/^\d+$/.test(String(v).trim())) {
      out[x.name] = { code: 'digits' };
    }
    if (x.pattern === 'uuid' && filled(v) && !isMaskedValue(v)
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v).trim())) {
      out[x.name] = { code: 'uuid' };
    }
  }
  return out;
}

/**
 * The `integrationSettings` slice for one provider's PATCH: only that provider's keys, masked secrets
 * dropped (server keeps the stored value), `trim` fields trimmed, everything else as typed. An empty
 * string clears a stored value (that is how "Remove credentials" works).
 */
export function credentialPatch(id: string, values: CredentialValues): Record<string, string> {
  const spec = getIntegration(id);
  const out: Record<string, string> = {};
  for (const x of spec?.fields ?? []) {
    const raw = values[x.name];
    if (isMaskedValue(raw)) continue;
    const v = typeof raw === 'string' ? raw : '';
    out[x.name] = x.trim ? v.trim() : v;
  }
  return out;
}

/** PATCH slice that clears every field of one provider ("Remove credentials…"). */
export function clearCredentialsPatch(id: string): Record<string, string> {
  return Object.fromEntries(credentialFieldNames(id).map((n) => [n, '']));
}

/** First required field that is empty (for the "{field} missing" meta of an incomplete tile). */
export function firstMissingField(id: string, values: CredentialValues | null | undefined): CredentialFieldSpec | undefined {
  if (!values) return undefined;
  return getIntegration(id)?.fields?.find((x) => x.required && !filled(values[x.name]));
}

/** Hint fields shown in full (§5.1: "Supplier ID 123456"). Every other non-secret identifier is display-masked. */
const UNMASKED_HINTS: ReadonlySet<string> = new Set(['trendyolSupplierId']);

/** Display mask for a non-secret identifier: last 4 behind '••••' (spec §4.1/§5.1 "Account ••••5678"). */
export function maskIdentifier(v: string): string {
  if (isMaskedValue(v)) return v;
  return v.length <= 4 ? `••••${v}` : `••••${v.slice(-4)}`;
}

/**
 * Fields shown in the list row's hint. Secrets arrive masked from the server; non-secret identifiers
 * (account / customer numbers, company IDs) come back in plaintext and are display-masked here, except
 * the Trendyol supplier ID, which the spec shows in full.
 */
export function credentialHints(id: string, values: CredentialValues | null | undefined): { field: CredentialFieldSpec; value: string }[] {
  if (!values) return [];
  return (getIntegration(id)?.fields ?? [])
    .filter((x) => x.hint && filled(values[x.name]))
    .map((x) => {
      const v = String(values[x.name]).trim();
      return { field: x, value: x.secret || UNMASKED_HINTS.has(x.name) ? v : maskIdentifier(v) };
    });
}

/**
 * CredentialField mask logic, unchanged from the legacy ApiKeysPanel.onSecretChange: saved secrets arrive
 * masked ('••••1234'). Typing next to the mask replaces it with just the typed text; a partial edit of
 * the mask (backspace, typing inside it) keeps the saved secret; only clearing the whole field removes it.
 */
export function nextSecretValue(current: string, typed: string): string {
  if (isMaskedValue(current)) {
    if (typed.includes(current)) return typed.replace(current, '');
    if (isMaskedValue(typed)) return current;
  }
  return typed;
}
